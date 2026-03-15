import crypto from 'crypto'

// --- Types (duplicated from src/types/auth.ts since Electron uses separate tsconfig) ---

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

interface OAuthClientInfo {
  client_id: string
  client_name: string
  redirect_uris: string[]
  grant_types: string[]
  token_endpoint_auth_method: string
}

interface OAuthTokenResponse {
  access_token: string
  token_type: 'Bearer'
  expires_in: number
  refresh_token: string
  scope?: string
}

type UserRole = 'owner' | 'admin' | 'member' | 'chatUser' | 'unknown'

// --- PKCE Utilities ---

export function generateCodeVerifier(): string {
  // 32 random bytes → 43 chars in base64url
  return crypto.randomBytes(32).toString('base64url')
}

export function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url')
}

export function generateState(): string {
  return crypto.randomBytes(32).toString('hex')
}

export function generateInstanceId(url: string): string {
  return 'inst_' + crypto.createHash('sha256').update(url).digest('hex').slice(0, 12)
}

// --- OAuth2 Functions ---

/**
 * Discover the OAuth2 server metadata from an n8n instance.
 * Validates that the URL points to an n8n instance with OAuth support.
 */
export async function discoverServer(baseUrl: string): Promise<OAuthServerMetadata> {
  const discoveryUrl = `${baseUrl}/.well-known/oauth-authorization-server`

  const response = await fetch(discoveryUrl, {
    signal: AbortSignal.timeout(10000),
  })

  if (!response.ok) {
    throw new Error(`Discovery failed: HTTP ${response.status} from ${discoveryUrl}`)
  }

  const metadata = await response.json() as Record<string, unknown>

  // Validate required fields
  const requiredFields = [
    'issuer',
    'authorization_endpoint',
    'token_endpoint',
    'registration_endpoint',
  ]
  for (const field of requiredFields) {
    if (typeof metadata[field] !== 'string') {
      throw new Error(`Invalid OAuth metadata: missing or invalid "${field}"`)
    }
  }

  return metadata as unknown as OAuthServerMetadata
}

/**
 * Register n8n-desk as a dynamic OAuth2 client (RFC 7591).
 */
export async function registerClient(
  metadata: OAuthServerMetadata,
  redirectUri: string,
): Promise<OAuthClientInfo> {
  const response = await fetch(metadata.registration_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'n8n-desk',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_method: 'none',
    }),
    signal: AbortSignal.timeout(10000),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Client registration failed: HTTP ${response.status} — ${body}`)
  }

  return await response.json() as OAuthClientInfo
}

/**
 * Build the OAuth2 authorization URL with PKCE parameters.
 */
export function buildAuthorizationUrl(
  metadata: OAuthServerMetadata,
  clientId: string,
  redirectUri: string,
  state: string,
  codeVerifier: string,
): string {
  const codeChallenge = generateCodeChallenge(codeVerifier)

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  })

  // Request all supported scopes
  if (metadata.scopes_supported && metadata.scopes_supported.length > 0) {
    params.set('scope', metadata.scopes_supported.join(' '))
  }

  return `${metadata.authorization_endpoint}?${params.toString()}`
}

/**
 * Exchange an authorization code for access + refresh tokens.
 */
export async function exchangeCodeForTokens(
  metadata: OAuthServerMetadata,
  clientId: string,
  code: string,
  redirectUri: string,
  codeVerifier: string,
): Promise<OAuthTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: codeVerifier,
  })

  const response = await fetch(metadata.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(10000),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(`Token exchange failed: HTTP ${response.status} — ${errorBody}`)
  }

  return await response.json() as OAuthTokenResponse
}

/**
 * Refresh an expired access token using a refresh token.
 * Note: n8n rotates refresh tokens on each use — the returned refresh_token is new.
 */
export async function refreshTokens(
  metadata: OAuthServerMetadata,
  clientId: string,
  refreshToken: string,
): Promise<OAuthTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  })

  const response = await fetch(metadata.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(10000),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(`Token refresh failed: HTTP ${response.status} — ${errorBody}`)
  }

  return await response.json() as OAuthTokenResponse
}

/**
 * Revoke a token (access or refresh).
 * Swallows errors — revocation is best-effort.
 */
export async function revokeToken(
  metadata: OAuthServerMetadata,
  clientId: string,
  token: string,
  tokenTypeHint: 'access_token' | 'refresh_token',
): Promise<void> {
  if (!metadata.revocation_endpoint) return

  try {
    const body = new URLSearchParams({
      token,
      token_type_hint: tokenTypeHint,
      client_id: clientId,
    })

    await fetch(metadata.revocation_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(5000),
    })
  } catch {
    // Revocation is best-effort — swallow errors
  }
}

/**
 * Detect the user's role based on granted OAuth scopes.
 */
export function detectRole(scopes: string[]): UserRole {
  // If any MCP tool scopes are present, user is member+
  const hasMcpScope = scopes.some(
    (s) => s.startsWith('tool:') || s === 'mcp:oauth' || s === 'mcp:manage'
  )
  if (hasMcpScope) return 'member'

  // If only ChatHub scopes, user is chatUser
  const hasChatScope = scopes.some(
    (s) => s === 'chatHub:message' || s.startsWith('chatHubAgent:')
  )
  if (hasChatScope) return 'chatUser'

  // Default to member if full scope set (or empty — n8n may not return scopes)
  return 'member'
}

/**
 * Compute token expiry as ISO string from expires_in seconds.
 */
export function computeExpiresAt(expiresIn: number): string {
  return new Date(Date.now() + expiresIn * 1000).toISOString()
}
