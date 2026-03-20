// --- Standalone MCP Server (quick-add) ---

export interface StandaloneMcpServer {
  id: string
  name: string
  description?: string
  url: string
  headerNames?: string[]
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
  source: 'user' | string
}

// --- Discovered Tool ---

export interface DiscoveredTool {
  serverName: string
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}
