import { ipcMain, shell } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { pluginManager } from '../plugin-manager'
import { loadAllSkills, saveUserSkill, deleteUserSkill } from '../skill-loader'
import {
  discoverServer,
  registerClient,
  generateCodeVerifier,
  generateState,
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  refreshTokens,
  revokeToken,
  computeExpiresAt,
} from '../oauth'
import { startOAuthRedirectListener, CUSTOM_OAUTH_PORT } from '../oauth-redirect'

const BASE_DIR = path.join(os.homedir(), '.n8n-desk')

// --- Helpers ---

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(content) as T
  } catch {
    return null
  }
}

/** Guard: only one OAuth flow at a time */
let oauthFlowInProgress = false

/**
 * Read the active instance ID from config.json.
 * Server-scoped handlers require an instance context (standalone MCP servers
 * are stored per-instance in mcp-servers.json).
 */
async function getActiveInstanceId(): Promise<string | null> {
  const config = await readJson<{ defaultInstanceId?: string }>(path.join(BASE_DIR, 'config.json'))
  return config?.defaultInstanceId ?? null
}

// --- IPC Handlers ---

let handlersRegistered = false

export function registerPluginHandlers(): void {
  if (handlersRegistered) return
  handlersRegistered = true

  // ── Marketplace ──

  ipcMain.handle('plugins:marketplace-list', async () => {
    try {
      const marketplaces = await pluginManager.getMarketplaces()
      return marketplaces
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: message }
    }
  })

  ipcMain.handle('plugins:marketplace-add', async (_event, source: { source: 'github' | 'url' | 'local'; repo?: string; url?: string; ref?: string }) => {
    try {
      const marketplace = await pluginManager.addMarketplace(source)
      return { success: true, marketplace }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: message }
    }
  })

  ipcMain.handle('plugins:marketplace-remove', async (_event, id: string) => {
    try {
      await pluginManager.removeMarketplace(id)
      return { success: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: message }
    }
  })

  ipcMain.handle('plugins:marketplace-refresh', async (_event, id: string) => {
    try {
      await pluginManager.refreshMarketplace(id)
      return { success: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: message }
    }
  })

  // ── Browse ──

  ipcMain.handle('plugins:browse', async (_event, marketplaceId?: string) => {
    try {
      const plugins = await pluginManager.browsePlugins(marketplaceId)
      return plugins
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: message }
    }
  })

  // ── Plugin Lifecycle ──

  ipcMain.handle('plugins:installed-list', async () => {
    try {
      const plugins = await pluginManager.getInstalledPlugins()
      return plugins
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: message }
    }
  })

  ipcMain.handle('plugins:install', async (_event, name: string, marketplaceId: string) => {
    try {
      const plugin = await pluginManager.installPlugin(name, marketplaceId)
      return { success: true, plugin }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: message }
    }
  })

  ipcMain.handle('plugins:uninstall', async (_event, id: string) => {
    try {
      await pluginManager.uninstallPlugin(id)
      return { success: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: message }
    }
  })

  ipcMain.handle('plugins:enable', async (_event, id: string) => {
    try {
      await pluginManager.enablePlugin(id)
      return { success: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: message }
    }
  })

  ipcMain.handle('plugins:disable', async (_event, id: string) => {
    try {
      await pluginManager.disablePlugin(id)
      return { success: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: message }
    }
  })

  ipcMain.handle('plugins:preview-install', async (_event, name: string, marketplaceId: string) => {
    try {
      const preview = await pluginManager.previewInstall(name, marketplaceId)
      return preview
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { urls: [], headerNames: [], toolCount: 0, error: message }
    }
  })

  // ── Standalone MCP Servers (instance-scoped) ──

  ipcMain.handle('plugins:servers-list', async () => {
    try {
      const instanceId = await getActiveInstanceId()
      if (!instanceId) return []
      const servers = await pluginManager.getStandaloneServers(instanceId)
      return servers
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: message }
    }
  })

  ipcMain.handle(
    'plugins:servers-add',
    async (
      _event,
      config: {
        name: string
        description?: string
        url: string
        headerNames?: string[]
        enabled: boolean
        requireApproval: boolean
      },
    ) => {
      try {
        const instanceId = await getActiveInstanceId()
        if (!instanceId) {
          return { success: false, error: 'No active instance configured' }
        }
        const server = await pluginManager.addStandaloneServer(instanceId, config)
        return { success: true, server }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { success: false, error: message }
      }
    },
  )

  ipcMain.handle(
    'plugins:servers-update',
    async (
      _event,
      id: string,
      updates: Record<string, unknown>,
    ) => {
      try {
        const instanceId = await getActiveInstanceId()
        if (!instanceId) {
          return { success: false, error: 'No active instance configured' }
        }
        await pluginManager.updateStandaloneServer(instanceId, id, updates as Partial<{
          name: string
          description?: string
          url: string
          headerNames?: string[]
          enabled: boolean
          requireApproval: boolean
        }>)
        return { success: true }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { success: false, error: message }
      }
    },
  )

  ipcMain.handle('plugins:servers-remove', async (_event, id: string) => {
    try {
      const instanceId = await getActiveInstanceId()
      if (!instanceId) {
        return { success: false, error: 'No active instance configured' }
      }
      await pluginManager.removeStandaloneServer(instanceId, id)
      return { success: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: message }
    }
  })

  ipcMain.handle(
    'plugins:servers-test',
    async (_event, url: string, headers: Record<string, string>) => {
      try {
        const tools = await pluginManager.discoverTools(url, headers)
        return { success: true, tools }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { success: false, error: message }
      }
    },
  )

  /** Test connection using stored credentials (OAuth token or static headers from keychain). */
  ipcMain.handle(
    'plugins:servers-test-by-id',
    async (_event, serverId: string) => {
      try {
        const instanceId = await getActiveInstanceId()
        if (!instanceId) return { success: false, error: 'No active instance configured' }

        const servers = await pluginManager.getStandaloneServers(instanceId)
        const server = servers.find((s) => s.id === serverId)
        if (!server) return { success: false, error: 'Server not found' }

        let headers: Record<string, string> = {}
        const authType = server.authType ?? 'static-headers'

        if (authType === 'oauth') {
          const tokens = await pluginManager.readServerOAuthTokens(serverId)
          if (!tokens) return { success: false, error: 'Not connected — authorize with OAuth first' }
          headers = { Authorization: `Bearer ${tokens.access_token}` }
        } else if (server.headerNames) {
          headers = await pluginManager.resolveServerHeadersPublic(serverId, server.headerNames)
        }

        const tools = await pluginManager.discoverTools(server.url, headers)
        return { success: true, tools }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { success: false, error: message }
      }
    },
  )

  // ── Secret Management ──

  ipcMain.handle(
    'plugins:set-secret',
    async (_event, namespace: 'plugin' | 'server', id: string, headerName: string, value: string) => {
      try {
        await pluginManager.setSecret(namespace, id, headerName, value)
        return { success: true }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { success: false, error: message }
      }
    },
  )

  ipcMain.handle(
    'plugins:delete-secrets',
    async (_event, namespace: 'plugin' | 'server', id: string) => {
      try {
        const instanceId = namespace === 'server' ? await getActiveInstanceId() : undefined
        await pluginManager.deleteSecrets(namespace, id, instanceId ?? undefined)
        return { success: true }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { success: false, error: message }
      }
    },
  )

  // ── Skills ──

  ipcMain.handle('plugins:list-skills', async () => {
    try {
      const skills = await loadAllSkills()
      return skills
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: message }
    }
  })

  ipcMain.handle(
    'plugins:save-skill',
    async (_event, skill: { name: string; content: string }) => {
      try {
        await saveUserSkill(skill.name, skill.content)
        return { success: true }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { success: false, error: message }
      }
    },
  )

  ipcMain.handle('plugins:delete-skill', async (_event, name: string) => {
    try {
      await deleteUserSkill(name)
      return { success: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: message }
    }
  })

  // ── Server OAuth ──

  /**
   * Probe whether a server URL supports OAuth discovery.
   * Lightweight — no registration, no redirect, just tries /.well-known/oauth-authorization-server.
   */
  ipcMain.handle(
    'plugins:server-probe-oauth',
    async (_event, params: { serverUrl: string }) => {
      try {
        const baseUrl = new URL(params.serverUrl).origin
        await discoverServer(baseUrl)
        return { supportsOAuth: true }
      } catch {
        return { supportsOAuth: false }
      }
    },
  )

  /**
   * Full OAuth 2.0 PKCE connect flow for a custom MCP server.
   * Opens browser for authorization, waits for callback, exchanges code for tokens.
   */
  ipcMain.handle(
    'plugins:server-oauth-connect',
    async (_event, params: { serverId: string; serverUrl: string; clientId?: string; clientSecret?: string }) => {
      if (oauthFlowInProgress) {
        return { success: false, error: 'Another OAuth flow is already in progress. Please wait.' }
      }
      oauthFlowInProgress = true
      try {
        const instanceId = await getActiveInstanceId()
        if (!instanceId) return { success: false, error: 'No active instance configured' }

        // 1. Derive base URL and discover OAuth endpoints
        const baseUrl = new URL(params.serverUrl).origin
        const metadata = await discoverServer(baseUrl)

        // 2. Start redirect listener on fixed port (predictable redirect URI for pre-registered apps)
        const listener = await startOAuthRedirectListener({ forceLocalhost: true, port: CUSTOM_OAUTH_PORT })

        try {
          // 3. Resolve client credentials — try dynamic registration, fall back to manual
          let clientId = params.clientId ?? ''
          let clientSecret = params.clientSecret

          if (!clientId) {
            // Try dynamic client registration
            try {
              const clientInfo = await registerClient(metadata, listener.redirectUri, { authMethod: 'client_secret_post' })
              clientId = clientInfo.client_id
              // Capture client_secret from registration response if present
              if (clientInfo.client_secret && !clientSecret) {
                clientSecret = clientInfo.client_secret
              }
            } catch {
              // Registration not supported — tell the UI to show manual client ID fields
              listener.cleanup()
              return {
                success: false,
                error: 'registration_not_supported',
                needsManualClient: true,
              }
            }
          }

          // 4. Generate PKCE verifier + state
          const codeVerifier = generateCodeVerifier()
          const state = generateState()

          // 5. Build authorization URL and open in browser
          const authUrl = buildAuthorizationUrl(
            metadata,
            clientId,
            listener.redirectUri,
            state,
            codeVerifier,
          )
          await shell.openExternal(authUrl)

          // 6. Wait for callback
          const callback = await listener.waitForCallback()

          // 7. Validate state
          if (callback.state !== state) {
            return { success: false, error: 'State mismatch — possible CSRF attack' }
          }

          // 8. Exchange code for tokens
          const tokens = await exchangeCodeForTokens(
            metadata,
            clientId,
            callback.code,
            listener.redirectUri,
            codeVerifier,
            clientSecret,
          )

          // 9. Store tokens + metadata + secret in keychain
          await pluginManager.storeServerOAuthTokens(
            params.serverId,
            tokens.access_token,
            tokens.refresh_token,
          )
          await pluginManager.storeServerOAuthMetadata(params.serverId, metadata)
          if (clientSecret) {
            await pluginManager.storeServerOAuthClientSecret(params.serverId, clientSecret)
          }

          // 10. Update server record with OAuth state
          const expiresAt = computeExpiresAt(tokens.expires_in)
          await pluginManager.updateStandaloneServer(instanceId, params.serverId, {
            oauthClientId: clientId,
            oauthDiscoveryUrl: baseUrl,
            oauthStatus: {
              connected: true,
              expiresAt,
              scope: tokens.scope,
            },
          })

          return { success: true, expiresAt, scope: tokens.scope }
        } finally {
          listener.cleanup()
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { success: false, error: message }
      } finally {
        oauthFlowInProgress = false
      }
    },
  )

  /**
   * Disconnect OAuth for a custom MCP server.
   * Revokes tokens (best-effort) and clears all OAuth data.
   */
  ipcMain.handle(
    'plugins:server-oauth-disconnect',
    async (_event, params: { serverId: string }) => {
      try {
        const instanceId = await getActiveInstanceId()
        if (!instanceId) return { success: false, error: 'No active instance configured' }

        const servers = await pluginManager.getStandaloneServers(instanceId)
        const server = servers.find((s) => s.id === params.serverId)

        // Best-effort token revocation
        if (server?.oauthClientId) {
          const tokens = await pluginManager.readServerOAuthTokens(params.serverId)
          const metadata = await pluginManager.readServerOAuthMetadata(params.serverId)

          if (tokens && metadata) {
            const oauthMeta = metadata as Parameters<typeof revokeToken>[0]
            try { await revokeToken(oauthMeta, server.oauthClientId, tokens.access_token, 'access_token') } catch { /* best-effort */ }
            try { await revokeToken(oauthMeta, server.oauthClientId, tokens.refresh_token, 'refresh_token') } catch { /* best-effort */ }
          }
        }

        // Delete keychain data
        await pluginManager.deleteServerOAuthData(params.serverId)

        // Clear OAuth fields on server record
        await pluginManager.updateStandaloneServer(instanceId, params.serverId, {
          oauthClientId: undefined,
          oauthStatus: undefined,
        })

        return { success: true }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { success: false, error: message }
      }
    },
  )

  /**
   * Refresh the OAuth access token for a custom MCP server.
   */
  ipcMain.handle(
    'plugins:server-oauth-refresh',
    async (_event, params: { serverId: string }) => {
      try {
        const instanceId = await getActiveInstanceId()
        if (!instanceId) return { success: false, error: 'No active instance configured' }

        const tokens = await pluginManager.readServerOAuthTokens(params.serverId)
        const metadata = await pluginManager.readServerOAuthMetadata(params.serverId)
        if (!tokens || !metadata) return { success: false, error: 'No OAuth tokens found' }

        const servers = await pluginManager.getStandaloneServers(instanceId)
        const server = servers.find((s) => s.id === params.serverId)
        if (!server?.oauthClientId) return { success: false, error: 'No OAuth client ID' }

        const oauthMeta = metadata as Parameters<typeof refreshTokens>[0]
        const clientSecret = await pluginManager.readServerOAuthClientSecret(params.serverId)
        const result = await refreshTokens(oauthMeta, server.oauthClientId, tokens.refresh_token, clientSecret ?? undefined)

        // Store new tokens (handles rotation)
        await pluginManager.storeServerOAuthTokens(params.serverId, result.access_token, result.refresh_token)

        // Update expiry
        const expiresAt = computeExpiresAt(result.expires_in)
        await pluginManager.updateStandaloneServer(instanceId, params.serverId, {
          oauthStatus: { connected: true, expiresAt, scope: result.scope },
        })

        return { success: true, expiresAt }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { success: false, error: message }
      }
    },
  )
}
