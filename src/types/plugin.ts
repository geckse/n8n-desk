// --- Standalone MCP Server (quick-add) ---

export type ServerAuthType = 'static-headers' | 'oauth'

export interface ServerOAuthStatus {
  connected: boolean
  expiresAt?: string    // ISO 8601
  scope?: string
}

export interface StandaloneMcpServer {
  id: string
  name: string
  description?: string
  url: string
  /** Auth method — defaults to 'static-headers' for back-compat (treat undefined as 'static-headers') */
  authType?: ServerAuthType
  /** Static header names whose values are stored in keychain (only when authType is 'static-headers') */
  headerNames?: string[]
  /** OAuth client ID from dynamic registration (only when authType is 'oauth') */
  oauthClientId?: string
  /** Base URL used for OAuth discovery (only when authType is 'oauth') */
  oauthDiscoveryUrl?: string
  /** OAuth connection status (only when authType is 'oauth') */
  oauthStatus?: ServerOAuthStatus
  enabled: boolean
  requireApproval: boolean
  addedAt: string
}

// --- Plugin (Claude Code plugin format) ---

export interface PluginManifest {
  name: string
  version?: string
  description?: string
  author?: { name: string; email?: string }
  homepage?: string
  keywords?: string[]
}

export interface PluginMcpServerConfig {
  url: string
  headerNames?: string[]
}

export interface InstalledPlugin {
  id: string
  name: string
  marketplace?: string
  pluginDir: string
  manifest?: PluginManifest
  mcpServers?: Record<string, PluginMcpServerConfig>
  enabled: boolean
  installedAt: string
}

// --- Marketplace ---

export interface MarketplaceSource {
  source: 'github' | 'url' | 'local'
  repo?: string
  url?: string
  ref?: string
}

export interface MarketplacePluginEntry {
  name: string
  source: string | { source: string; repo?: string; url?: string; path?: string }
  description?: string
  version?: string
  author?: { name: string }
  category?: string
  keywords?: string[]
  homepage?: string
}

export interface Marketplace {
  id: string
  name: string
  owner: { name: string; email?: string }
  source: MarketplaceSource
  plugins: MarketplacePluginEntry[]
  addedAt: string
  autoUpdate: boolean
}

// --- Skill (SKILL.md format) ---

export interface LoadedSkill {
  name: string
  description: string
  content: string
  disableModelInvocation: boolean
  userInvocable: boolean
  allowedTools?: string[]
  directory: string
  source: 'user' | 'built-in' | string
  /** True for skills bundled with the app (shipped in src/data/default-skills.ts) */
  builtIn?: boolean
}

// --- Discovered Tool ---

export interface DiscoveredTool {
  serverName: string
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}
