import { ipcMain, shell, safeStorage } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import {
  discoverServer,
  registerClient,
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  refreshTokens,
  revokeToken,
  detectRole,
  computeExpiresAt,
  generateCodeVerifier,
  generateState,
  generateInstanceId,
} from '../oauth'
import { startOAuthRedirectListener } from '../oauth-redirect'

const BASE_DIR = path.join(os.homedir(), '.n8n-desk')

// --- Types (mirrored from src/types for Electron main process) ---

interface AuthLoginResult {
  success: boolean
  instanceId?: string
  userRole?: string
  scopes?: string[]
  expiresAt?: string
  error?: string
  errorCode?: string
}

interface AuthRefreshResult {
  success: boolean
  expiresAt?: string
  accessToken?: string
  error?: string
}

interface OAuthServerMetadata {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  registration_endpoint: string
  revocation_endpoint: string
  response_types_supported: string[]
  grant_types_supported: string[]
  code_challenge_methods_supported: string[]
  scopes_supported: string[]
}

interface AuthMetadata {
  clientId: string
  clientName: string
  scopes: string[]
  expiresAt: string
  userRole: string
  registeredAt: string
  serverMetadata: OAuthServerMetadata
  userProfile?: { firstName: string; lastName: string; email: string }
  hasSessionToken?: boolean
}

interface CredentialLoginResult {
  success: boolean
  userProfile?: { firstName: string; lastName: string; email: string }
  error?: string
  errorCode?: string
}

// --- Helpers ---

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true, mode: 0o700 })
}

function instanceDir(instanceId: string): string {
  return path.join(BASE_DIR, 'instances', instanceId)
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(content) as T
  } catch {
    return null
  }
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath))
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: 0o600 })
}

async function storeTokens(instanceId: string, accessToken: string, refreshToken: string): Promise<void> {
  const tokenData = JSON.stringify({ access_token: accessToken, refresh_token: refreshToken })
  const filePath = path.join(instanceDir(instanceId), 'tokens.enc')
  await ensureDir(path.dirname(filePath))

  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(tokenData)
    await fs.writeFile(filePath, encrypted, { mode: 0o600 })
  } else {
    await fs.writeFile(filePath, tokenData, { encoding: 'utf-8', mode: 0o600 })
  }
}

async function readTokens(instanceId: string): Promise<{ access_token: string; refresh_token: string } | null> {
  try {
    const filePath = path.join(instanceDir(instanceId), 'tokens.enc')
    const data = await fs.readFile(filePath)

    let jsonStr: string
    if (safeStorage.isEncryptionAvailable()) {
      jsonStr = safeStorage.decryptString(data)
    } else {
      jsonStr = data.toString('utf-8')
    }

    return JSON.parse(jsonStr) as { access_token: string; refresh_token: string }
  } catch {
    return null
  }
}

async function deleteTokens(instanceId: string): Promise<void> {
  try {
    await fs.unlink(path.join(instanceDir(instanceId), 'tokens.enc'))
  } catch {
    // Already deleted
  }
}

async function readSessionToken(instanceId: string): Promise<string | null> {
  try {
    const filePath = path.join(instanceDir(instanceId), 'session.enc')
    const data = await fs.readFile(filePath)

    let jsonStr: string
    if (safeStorage.isEncryptionAvailable()) {
      jsonStr = safeStorage.decryptString(data)
    } else {
      jsonStr = data.toString('utf-8')
    }

    const parsed = JSON.parse(jsonStr) as { session_token: string }
    return parsed.session_token
  } catch {
    return null
  }
}

async function deleteSessionToken(instanceId: string): Promise<void> {
  try {
    await fs.unlink(path.join(instanceDir(instanceId), 'session.enc'))
  } catch {
    // Already deleted
  }
}

async function updateInstanceIndex(instanceId: string, action: 'add' | 'remove'): Promise<void> {
  const indexPath = path.join(BASE_DIR, 'instances', 'index.json')
  let ids: string[] = []

  try {
    const content = await fs.readFile(indexPath, 'utf-8')
    ids = JSON.parse(content) as string[]
  } catch {
    // File doesn't exist yet
  }

  if (action === 'add' && !ids.includes(instanceId)) {
    ids.push(instanceId)
  } else if (action === 'remove') {
    ids = ids.filter((id) => id !== instanceId)
  }

  await ensureDir(path.dirname(indexPath))
  await fs.writeFile(indexPath, JSON.stringify(ids, null, 2), { encoding: 'utf-8', mode: 0o600 })
}

// --- Color generation for new instances ---

const INSTANCE_COLORS = [
  '#ff6d5a', // n8n orange-red
  '#7c3aed', // purple
  '#0ea5e9', // sky blue
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ec4899', // pink
]

function pickColor(existingCount: number): string {
  return INSTANCE_COLORS[existingCount % INSTANCE_COLORS.length]
}

// --- IPC Handlers ---

let handlersRegistered = false

export function registerAuthHandlers(): void {
  if (handlersRegistered) return
  handlersRegistered = true

  // --- auth:login ---
  ipcMain.handle('auth:login', async (_event, instanceUrl: string, options?: { forceLocalhost?: boolean }): Promise<AuthLoginResult> => {
    try {
      // 1. Normalize URL
      const url = instanceUrl.replace(/\/+$/, '')

      // 2. Generate instance ID
      const instanceId = generateInstanceId(url)
      const instDir = instanceDir(instanceId)

      // 3. Discover OAuth server
      let metadata
      try {
        metadata = await discoverServer(url)
      } catch (err) {
        return {
          success: false,
          error: `Cannot reach n8n at ${url}. Check the URL and try again.`,
          errorCode: 'discovery_failed',
        }
      }

      // 4. Start redirect listener
      const listener = await startOAuthRedirectListener({ forceLocalhost: options?.forceLocalhost })

      try {
        // 5. Register a new client for this redirect URI
        // Always re-register because the localhost port changes each time in dev mode,
        // and redirect_uris must match exactly between registration and authorization.
        let clientInfo
        try {
          clientInfo = await registerClient(metadata, listener.redirectUri)
        } catch (err) {
          listener.cleanup()
          return {
            success: false,
            error: 'Failed to register with n8n. The instance may not support OAuth.',
            errorCode: 'registration_failed',
          }
        }

        // 6. Generate PKCE + state
        const codeVerifier = generateCodeVerifier()
        const state = generateState()

        // 7. Build authorization URL and open in browser
        const authUrl = buildAuthorizationUrl(
          metadata,
          clientInfo.client_id,
          listener.redirectUri,
          state,
          codeVerifier,
        )

        await shell.openExternal(authUrl)

        // 8. Wait for callback
        let callback
        try {
          callback = await listener.waitForCallback()
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error'
          if (message.includes('timed out')) {
            return { success: false, error: 'Authentication timed out. Please try again.', errorCode: 'auth_timeout' }
          }
          if (message.includes('OAuth error')) {
            return { success: false, error: message, errorCode: 'auth_cancelled' }
          }
          return { success: false, error: message, errorCode: 'auth_cancelled' }
        }

        // 9. Validate state
        if (callback.state !== state) {
          return { success: false, error: 'State mismatch — possible CSRF attack. Please try again.', errorCode: 'auth_cancelled' }
        }

        // 10. Exchange code for tokens
        let tokenResponse
        try {
          tokenResponse = await exchangeCodeForTokens(
            metadata,
            clientInfo.client_id,
            callback.code,
            listener.redirectUri,
            codeVerifier,
          )
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Token exchange failed'
          return { success: false, error: message, errorCode: 'token_exchange_failed' }
        }

        // 11. Detect role from scopes
        const scopes = tokenResponse.scope ? tokenResponse.scope.split(' ') : metadata.scopes_supported || []
        const userRole = detectRole(scopes)
        const expiresAt = computeExpiresAt(tokenResponse.expires_in)

        // 12. Store tokens securely
        await storeTokens(instanceId, tokenResponse.access_token, tokenResponse.refresh_token)

        // 13. Write auth metadata (non-secret)
        // Note: User profile is not available — MCP OAuth tokens cannot access /api/v1/me
        const authMeta: AuthMetadata = {
          clientId: clientInfo.client_id,
          clientName: 'n8n-desk',
          scopes,
          expiresAt,
          userRole,
          registeredAt: new Date().toISOString(),
          serverMetadata: metadata,
        }
        await writeJson(path.join(instDir, 'auth.json'), authMeta)

        // 14. Write instance config
        // Read existing index to count instances for color picking
        let existingIds: string[] = []
        try {
          const indexPath = path.join(BASE_DIR, 'instances', 'index.json')
          const content = await fs.readFile(indexPath, 'utf-8')
          existingIds = JSON.parse(content) as string[]
        } catch {
          // No index yet
        }

        const hostname = new URL(url).hostname
        const instanceConfig = {
          id: instanceId,
          label: hostname,
          url,
          color: pickColor(existingIds.length),
          addedAt: new Date().toISOString(),
        }
        await writeJson(path.join(instDir, 'instance.json'), instanceConfig)

        // 15. Update instance index
        await updateInstanceIndex(instanceId, 'add')

        return {
          success: true,
          instanceId,
          userRole,
          scopes,
          expiresAt,
        }
      } finally {
        listener.cleanup()
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return { success: false, error: message, errorCode: 'network_error' }
    }
  })

  // --- auth:logout ---
  ipcMain.handle('auth:logout', async (_event, instanceId: string): Promise<void> => {
    const instDir = instanceDir(instanceId)

    // Read auth metadata and tokens for revocation
    const authMeta = await readJson<AuthMetadata>(path.join(instDir, 'auth.json'))
    const tokens = await readTokens(instanceId)

    if (authMeta && tokens && authMeta.serverMetadata) {
      const metadata = authMeta.serverMetadata
      // Revoke both tokens (best-effort)
      await revokeToken(metadata, authMeta.clientId, tokens.access_token, 'access_token')
      await revokeToken(metadata, authMeta.clientId, tokens.refresh_token, 'refresh_token')
    }

    // Delete encrypted tokens and session
    await deleteTokens(instanceId)
    await deleteSessionToken(instanceId)

    // Clear auth metadata but keep instance.json for re-login
    try {
      await fs.unlink(path.join(instDir, 'auth.json'))
    } catch {
      // Already gone
    }
  })

  // --- auth:refresh ---
  ipcMain.handle('auth:refresh', async (_event, instanceId: string): Promise<AuthRefreshResult> => {
    try {
      const instDir = instanceDir(instanceId)
      const authMeta = await readJson<AuthMetadata>(path.join(instDir, 'auth.json'))
      const tokens = await readTokens(instanceId)

      if (!authMeta || !tokens) {
        return { success: false, error: 'No auth data found. Please sign in again.' }
      }

      const metadata = authMeta.serverMetadata

      // Refresh tokens — n8n rotates the refresh token
      const tokenResponse = await refreshTokens(metadata, authMeta.clientId, tokens.refresh_token)

      // Atomically update stored tokens (critical: refresh token rotation)
      await storeTokens(instanceId, tokenResponse.access_token, tokenResponse.refresh_token)

      // Update auth metadata
      const expiresAt = computeExpiresAt(tokenResponse.expires_in)
      authMeta.expiresAt = expiresAt
      await writeJson(path.join(instDir, 'auth.json'), authMeta)

      return {
        success: true,
        expiresAt,
        accessToken: tokenResponse.access_token,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Token refresh failed'
      return { success: false, error: message }
    }
  })

  // --- auth:get-session-token ---
  // Read the REST API session token from encrypted storage.
  ipcMain.handle('auth:get-session-token', async (_event, instanceId: string): Promise<string | null> => {
    return readSessionToken(instanceId)
  })

  // --- auth:credential-login ---
  // Signs in with email+password to get a REST API session cookie (n8n-auth JWT).
  // This is separate from MCP OAuth — gives access to /api/v1/* endpoints.
  ipcMain.handle(
    'auth:credential-login',
    async (
      _event,
      instanceId: string,
      credentials: { email: string; password: string; mfaCode?: string },
    ): Promise<CredentialLoginResult> => {
      try {
        const instDir = instanceDir(instanceId)
        const instanceConfig = await readJson<{ url: string }>(path.join(instDir, 'instance.json'))
        if (!instanceConfig?.url) {
          return { success: false, error: 'Instance not found.', errorCode: 'network_error' }
        }

        const url = instanceConfig.url

        // POST to n8n login endpoint
        const body: Record<string, string> = {
          emailOrLdapLoginId: credentials.email,
          password: credentials.password,
        }
        if (credentials.mfaCode) {
          body.mfaCode = credentials.mfaCode
        }

        const response = await fetch(`${url}/rest/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          redirect: 'manual',
          signal: AbortSignal.timeout(15000),
        })

        // Extract set-cookie header to capture the n8n-auth JWT
        const setCookieHeader = response.headers.getSetCookie?.()
          ?? [response.headers.get('set-cookie') ?? ''].filter(Boolean)
        const authCookie = setCookieHeader
          .map((c: string) => c.split(';')[0])
          .find((c: string) => c.startsWith('n8n-auth='))

        if (!response.ok) {
          // n8n returns JSON error responses: { statusCode, message, code }
          // code 998 = MFA required (no code provided)
          let errorBody: { message?: string; code?: number } = {}
          try {
            errorBody = await response.json() as { message?: string; code?: number }
          } catch {
            // Non-JSON response
          }

          if (response.status === 401 && errorBody.code === 998) {
            return { success: false, error: 'MFA code required.', errorCode: 'mfa_required' }
          }
          if (response.status === 401) {
            const msg = errorBody.message || 'Invalid email or password.'
            return { success: false, error: msg, errorCode: 'invalid_credentials' }
          }
          if (response.status === 403) {
            return { success: false, error: 'Account is disabled.', errorCode: 'user_disabled' }
          }
          return {
            success: false,
            error: errorBody.message || 'Login failed. Check your credentials and try again.',
            errorCode: 'invalid_credentials',
          }
        }

        if (!authCookie) {
          return {
            success: false,
            error: 'Login succeeded but no session cookie was returned.',
            errorCode: 'network_error',
          }
        }

        // Parse the response body for user profile
        const userData = await response.json() as {
          data?: {
            firstName?: string
            lastName?: string
            email?: string
          }
        }

        const sessionToken = authCookie.replace('n8n-auth=', '')

        // Store session token in keychain (separate key from OAuth tokens)
        const sessionData = JSON.stringify({ session_token: sessionToken })
        const sessionFilePath = path.join(instDir, 'session.enc')
        await ensureDir(path.dirname(sessionFilePath))

        if (safeStorage.isEncryptionAvailable()) {
          const encrypted = safeStorage.encryptString(sessionData)
          await fs.writeFile(sessionFilePath, encrypted, { mode: 0o600 })
        } else {
          await fs.writeFile(sessionFilePath, sessionData, { encoding: 'utf-8', mode: 0o600 })
        }

        // Build user profile from login response
        const userProfile = {
          firstName: userData.data?.firstName ?? '',
          lastName: userData.data?.lastName ?? '',
          email: userData.data?.email ?? '',
        }

        // Update auth.json with profile + session flag
        const authMeta = await readJson<AuthMetadata>(path.join(instDir, 'auth.json'))
        if (authMeta) {
          authMeta.userProfile = userProfile
          authMeta.hasSessionToken = true
          await writeJson(path.join(instDir, 'auth.json'), authMeta)
        }

        return { success: true, userProfile }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Login failed'
        return { success: false, error: message, errorCode: 'network_error' }
      }
    },
  )
}

