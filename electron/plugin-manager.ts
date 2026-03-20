import { safeStorage } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import crypto from 'crypto'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { listToolsWithUrl } from './mcp-client'
import { createDynamicMcpTools } from './agent/tool-definitions'

const execFileAsync = promisify(execFile)

// --- Types (mirrored from src/types/plugin.ts for electron main process isolation) ---

interface StandaloneMcpServer {
  id: string
  name: string
  description?: string
  url: string
  headerNames?: string[]
  enabled: boolean
  requireApproval: boolean
  addedAt: string
}

interface PluginManifest {
  name: string
  version?: string
  description?: string
  author?: { name: string; email?: string }
  homepage?: string
  keywords?: string[]
}

interface PluginMcpServerConfig {
  url: string
  headerNames?: string[]
}

interface InstalledPlugin {
  id: string
  name: string
  marketplace?: string
  pluginDir: string
  manifest?: PluginManifest
  mcpServers?: Record<string, PluginMcpServerConfig>
  enabled: boolean
  installedAt: string
}

interface MarketplaceSource {
  source: 'github' | 'url' | 'local'
  repo?: string
  url?: string
  ref?: string
}

interface MarketplacePluginEntry {
  name: string
  source: string | { source: string; repo?: string; url?: string; path?: string }
  description?: string
  version?: string
  author?: { name: string }
  category?: string
  keywords?: string[]
  homepage?: string
}

interface Marketplace {
  id: string
  name: string
  owner: { name: string; email?: string }
  source: MarketplaceSource
  plugins: MarketplacePluginEntry[]
  addedAt: string
  autoUpdate: boolean
}

interface DiscoveredTool {
  serverName: string
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

/** Raw marketplace.json shape from a marketplace source */
interface RawMarketplaceJson {
  name?: string
  owner?: { name: string; email?: string }
  plugins?: MarketplacePluginEntry[]
}

/** Raw .mcp.json entry — may be HTTP (url) or stdio (command) */
interface RawMcpJsonEntry {
  type?: string
  url?: string
  command?: string
  args?: string[]
  headers?: Record<string, string>
  env?: Record<string, string>
  [key: string]: unknown
}

// --- Constants ---

const BASE_DIR = path.join(os.homedir(), '.n8n-desk')
const PLUGINS_DIR = path.join(BASE_DIR, 'plugins')
const INSTALLED_PATH = path.join(PLUGINS_DIR, 'installed.json')
const MARKETPLACES_PATH = path.join(PLUGINS_DIR, 'marketplaces.json')
const CACHE_DIR = path.join(PLUGINS_DIR, 'cache')

/** Official Anthropic marketplace — auto-seeded on first launch */
const OFFICIAL_MARKETPLACE_SOURCE: MarketplaceSource = {
  source: 'github',
  repo: 'anthropics/claude-plugins-official',
}

// --- JSON Read/Write Helpers ---

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(content) as T
  } catch {
    return null
  }
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 })
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: 0o600 })
}

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true, mode: 0o700 })
}

// --- Keychain Helpers ---

/**
 * Map a keychain key to an encrypted file path.
 * Keys are namespaced: `n8n-desk:plugin:{pluginId}:{headerName}` or
 * `n8n-desk:server:{serverId}:{headerName}`.
 */
function keychainPath(key: string): string {
  const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, '_')
  return path.join(BASE_DIR, 'keychain', `${safeKey}.enc`)
}

async function readSecret(key: string): Promise<string | null> {
  try {
    const filePath = keychainPath(key)
    const data = await fs.readFile(filePath)
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(data)
    }
    return data.toString('utf-8')
  } catch {
    return null
  }
}

async function writeSecret(key: string, value: string): Promise<void> {
  const filePath = keychainPath(key)
  await ensureDir(path.dirname(filePath))
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(value)
    await fs.writeFile(filePath, encrypted, { mode: 0o600 })
  } else {
    await fs.writeFile(filePath, value, { encoding: 'utf-8', mode: 0o600 })
  }
}

async function deleteSecret(key: string): Promise<void> {
  try {
    await fs.unlink(keychainPath(key))
  } catch {
    // File doesn't exist — nothing to delete
  }
}

// --- Marketplace Fetching ---

/**
 * Fetch and parse marketplace.json from a marketplace source.
 * Supports github (raw.githubusercontent.com), url (direct fetch), and local (file read).
 */
async function fetchMarketplaceJson(source: MarketplaceSource): Promise<RawMarketplaceJson> {
  let fetchUrl: string

  switch (source.source) {
    case 'github': {
      if (!source.repo) throw new Error('GitHub marketplace source requires a repo field')
      const ref = source.ref || 'main'
      fetchUrl = `https://raw.githubusercontent.com/${source.repo}/${ref}/marketplace.json`
      break
    }
    case 'url': {
      if (!source.url) throw new Error('URL marketplace source requires a url field')
      fetchUrl = source.url
      break
    }
    case 'local': {
      if (!source.url) throw new Error('Local marketplace source requires a url field (local path)')
      const content = await fs.readFile(source.url, 'utf-8')
      return JSON.parse(content) as RawMarketplaceJson
    }
    default:
      throw new Error(`Unsupported marketplace source type: ${source.source}`)
  }

  const res = await fetch(fetchUrl)
  if (!res.ok) {
    throw new Error(`Failed to fetch marketplace: ${res.status} ${res.statusText}`)
  }
  return (await res.json()) as RawMarketplaceJson
}

// --- Plugin Source Resolution ---

/**
 * Resolve a plugin entry's source to a GitHub repo owner/repo/ref.
 * Handles both string and object source formats.
 * Returns null if the source can't be resolved to a GitHub repo.
 */
function resolvePluginRepoInfo(
  entry: MarketplacePluginEntry,
  marketplace: Marketplace,
): { owner: string; repo: string; ref: string; subdir?: string } | null {
  const src = entry.source

  if (typeof src === 'object') {
    if (src.source === 'github' && src.repo) {
      const parts = src.repo.split('/')
      if (parts.length >= 2) {
        return { owner: parts[0], repo: parts[1], ref: 'main' }
      }
    }
    return null
  }

  // String source formats
  if (typeof src === 'string') {
    // "github:owner/repo" format
    if (src.startsWith('github:')) {
      const repoPath = src.slice('github:'.length)
      const parts = repoPath.split('/')
      if (parts.length >= 2) {
        return { owner: parts[0], repo: parts[1], ref: 'main' }
      }
    }

    // Simple name — assume subdirectory of the marketplace repo
    if (marketplace.source.source === 'github' && marketplace.source.repo) {
      const parts = marketplace.source.repo.split('/')
      if (parts.length >= 2) {
        return {
          owner: parts[0],
          repo: parts[1],
          ref: marketplace.source.ref || 'main',
          subdir: src,
        }
      }
    }
  }

  return null
}

// --- .mcp.json Parsing ---

/**
 * Parse .mcp.json into HTTP-only server configs.
 * Entries with a `command` field (stdio transport) are silently skipped with a warning.
 * Entries without a `url` field are skipped.
 * Header names are extracted — values must be stored separately in the keychain.
 */
function parseMcpJson(
  mcpJson: Record<string, RawMcpJsonEntry>,
  pluginId: string,
): Record<string, PluginMcpServerConfig> {
  const httpServers: Record<string, PluginMcpServerConfig> = {}

  for (const [serverName, entry] of Object.entries(mcpJson)) {
    // HTTP-only enforcement: skip entries with 'command' field (stdio)
    if (entry.command) {
      console.warn(
        `[n8n-desk] Skipping stdio MCP server "${serverName}" in plugin "${pluginId}" — HTTP only`,
      )
      continue
    }

    // Must have a URL for HTTP transport
    if (!entry.url) {
      console.warn(
        `[n8n-desk] Skipping MCP server "${serverName}" in plugin "${pluginId}" — no URL`,
      )
      continue
    }

    // Extract header names (values are stored in keychain, not here)
    const headerNames: string[] = []
    if (entry.headers) {
      for (const headerName of Object.keys(entry.headers)) {
        headerNames.push(headerName)
      }
    }

    httpServers[serverName] = {
      url: entry.url,
      headerNames: headerNames.length > 0 ? headerNames : undefined,
    }
  }

  return httpServers
}

// --- PluginManager Class ---

/**
 * Central plugin/marketplace/server management module.
 *
 * Manages persistence to ~/.n8n-desk/plugins/ (installed.json, marketplaces.json, cache/)
 * and per-instance mcp-servers.json. Produces backend-specific tool configs for both
 * Claude Agent SDK and Deep Agents/LangChain runners.
 *
 * Key invariants:
 * - HTTP-only: .mcp.json entries with `command` field (stdio) are silently skipped
 * - Credential isolation: per-server header maps — n8n token never included in plugin headers
 * - Secrets in OS keychain via safeStorage — never in JSON config files
 */
class PluginManager {
  /** Guard concurrent marketplace refreshes */
  private refreshingMarketplaces = new Set<string>()

  // --- Marketplace Methods ---

  /**
   * Auto-seed the official Anthropic marketplace on first launch.
   * No-op if marketplaces already exist.
   */
  async autoSeedIfNeeded(): Promise<void> {
    const marketplaces = await readJson<Marketplace[]>(MARKETPLACES_PATH)
    if (marketplaces && marketplaces.length > 0) return

    try {
      await this.addMarketplace(OFFICIAL_MARKETPLACE_SOURCE)
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : String(err)
      console.error(`[n8n-desk] Failed to auto-seed official marketplace: ${errMessage}`)
    }
  }

  /**
   * Add a new marketplace by fetching its marketplace.json from the source.
   * Supports github, url, and local source types.
   */
  async addMarketplace(source: MarketplaceSource): Promise<Marketplace> {
    const raw = await fetchMarketplaceJson(source)

    const id = crypto.randomUUID()
    const marketplace: Marketplace = {
      id,
      name: raw.name || (source.repo ? source.repo.split('/').pop() || 'Unknown' : 'Unknown'),
      owner: raw.owner || { name: 'Unknown' },
      source,
      plugins: raw.plugins || [],
      addedAt: new Date().toISOString(),
      autoUpdate: true,
    }

    const existing = (await readJson<Marketplace[]>(MARKETPLACES_PATH)) || []
    existing.push(marketplace)
    await writeJson(MARKETPLACES_PATH, existing)

    return marketplace
  }

  /**
   * Remove a marketplace and uninstall all plugins that came from it.
   */
  async removeMarketplace(id: string): Promise<void> {
    const marketplaces = (await readJson<Marketplace[]>(MARKETPLACES_PATH)) || []
    const filtered = marketplaces.filter((m) => m.id !== id)
    await writeJson(MARKETPLACES_PATH, filtered)

    // Uninstall all plugins from this marketplace
    const installed = (await readJson<InstalledPlugin[]>(INSTALLED_PATH)) || []
    const toRemove = installed.filter((p) => p.marketplace === id)
    for (const plugin of toRemove) {
      await this.uninstallPlugin(plugin.id)
    }
  }

  /**
   * Re-fetch a marketplace's catalog from its source.
   * Debounced: only one refresh per marketplace at a time.
   */
  async refreshMarketplace(id: string): Promise<void> {
    if (this.refreshingMarketplaces.has(id)) return
    this.refreshingMarketplaces.add(id)

    try {
      const marketplaces = (await readJson<Marketplace[]>(MARKETPLACES_PATH)) || []
      const marketplace = marketplaces.find((m) => m.id === id)
      if (!marketplace) throw new Error(`Marketplace not found: ${id}`)

      const raw = await fetchMarketplaceJson(marketplace.source)
      marketplace.plugins = raw.plugins || []
      if (raw.name) marketplace.name = raw.name
      if (raw.owner) marketplace.owner = raw.owner

      await writeJson(MARKETPLACES_PATH, marketplaces)
    } finally {
      this.refreshingMarketplaces.delete(id)
    }
  }

  /** Get all registered marketplaces. */
  async getMarketplaces(): Promise<Marketplace[]> {
    return (await readJson<Marketplace[]>(MARKETPLACES_PATH)) || []
  }

  /**
   * Browse available plugins from all or a specific marketplace.
   * Returns plugin entries (not installed plugins).
   */
  async browsePlugins(marketplaceId?: string): Promise<MarketplacePluginEntry[]> {
    const marketplaces = (await readJson<Marketplace[]>(MARKETPLACES_PATH)) || []

    if (marketplaceId) {
      const marketplace = marketplaces.find((m) => m.id === marketplaceId)
      return marketplace?.plugins || []
    }

    return marketplaces.flatMap((m) => m.plugins)
  }

  // --- Plugin Lifecycle ---

  /**
   * Install a plugin from a marketplace.
   * Downloads the plugin source, parses .claude-plugin/plugin.json and .mcp.json,
   * enforces HTTP-only (skips stdio entries), and persists to installed.json.
   */
  async installPlugin(name: string, marketplaceId: string): Promise<InstalledPlugin> {
    const marketplaces = (await readJson<Marketplace[]>(MARKETPLACES_PATH)) || []
    const marketplace = marketplaces.find((m) => m.id === marketplaceId)
    if (!marketplace) throw new Error(`Marketplace not found: ${marketplaceId}`)

    const entry = marketplace.plugins.find((p) => p.name === name)
    if (!entry) throw new Error(`Plugin not found in marketplace: ${name}`)

    const pluginId = `${name}@${marketplace.name}`
    // Sanitize path to prevent directory traversal
    const safeDirName = pluginId.replace(/[^a-zA-Z0-9@._-]/g, '_')
    const cacheDir = path.join(CACHE_DIR, safeDirName)

    // Download and extract plugin
    await this.downloadPlugin(entry, marketplace, cacheDir)

    // Parse .claude-plugin/plugin.json
    const manifest = await readJson<PluginManifest>(
      path.join(cacheDir, '.claude-plugin', 'plugin.json'),
    )

    // Parse .mcp.json — HTTP-only enforcement
    const rawMcpJson = await readJson<Record<string, RawMcpJsonEntry>>(
      path.join(cacheDir, '.mcp.json'),
    )
    const mcpServers = rawMcpJson ? parseMcpJson(rawMcpJson, pluginId) : undefined

    const plugin: InstalledPlugin = {
      id: pluginId,
      name,
      marketplace: marketplaceId,
      pluginDir: cacheDir,
      manifest: manifest || undefined,
      mcpServers: mcpServers && Object.keys(mcpServers).length > 0 ? mcpServers : undefined,
      enabled: true,
      installedAt: new Date().toISOString(),
    }

    // Persist — replace existing entry if re-installing
    const installed = (await readJson<InstalledPlugin[]>(INSTALLED_PATH)) || []
    const filtered = installed.filter((p) => p.id !== pluginId)
    filtered.push(plugin)
    await writeJson(INSTALLED_PATH, filtered)

    return plugin
  }

  /**
   * Uninstall a plugin: delete cache directory, remove keychain secrets, update installed.json.
   */
  async uninstallPlugin(id: string): Promise<void> {
    const installed = (await readJson<InstalledPlugin[]>(INSTALLED_PATH)) || []
    const plugin = installed.find((p) => p.id === id)
    if (!plugin) return

    // Delete cache directory
    try {
      await fs.rm(plugin.pluginDir, { recursive: true, force: true })
    } catch {
      // Best-effort cleanup
    }

    // Delete keychain secrets for all headers across all servers
    if (plugin.mcpServers) {
      for (const serverConfig of Object.values(plugin.mcpServers)) {
        if (serverConfig.headerNames) {
          for (const headerName of serverConfig.headerNames) {
            await deleteSecret(`n8n-desk:plugin:${id}:${headerName}`)
          }
        }
      }
    }

    // Remove from installed.json
    const filtered = installed.filter((p) => p.id !== id)
    await writeJson(INSTALLED_PATH, filtered)
  }

  /** Enable an installed plugin. */
  async enablePlugin(id: string): Promise<void> {
    const installed = (await readJson<InstalledPlugin[]>(INSTALLED_PATH)) || []
    const plugin = installed.find((p) => p.id === id)
    if (!plugin) throw new Error(`Plugin not found: ${id}`)
    plugin.enabled = true
    await writeJson(INSTALLED_PATH, installed)
  }

  /** Disable an installed plugin. */
  async disablePlugin(id: string): Promise<void> {
    const installed = (await readJson<InstalledPlugin[]>(INSTALLED_PATH)) || []
    const plugin = installed.find((p) => p.id === id)
    if (!plugin) throw new Error(`Plugin not found: ${id}`)
    plugin.enabled = false
    await writeJson(INSTALLED_PATH, installed)
  }

  /** Get all installed plugins. */
  async getInstalledPlugins(): Promise<InstalledPlugin[]> {
    return (await readJson<InstalledPlugin[]>(INSTALLED_PATH)) || []
  }

  /**
   * Preview what a plugin install would look like without persisting.
   * Fetches .mcp.json from the source repo and returns URLs, header names, and tool count.
   */
  async previewInstall(
    name: string,
    marketplaceId: string,
  ): Promise<{ urls: string[]; headerNames: string[]; toolCount: number }> {
    const marketplaces = (await readJson<Marketplace[]>(MARKETPLACES_PATH)) || []
    const marketplace = marketplaces.find((m) => m.id === marketplaceId)
    if (!marketplace) throw new Error(`Marketplace not found: ${marketplaceId}`)

    const entry = marketplace.plugins.find((p) => p.name === name)
    if (!entry) throw new Error(`Plugin not found in marketplace: ${name}`)

    const repoInfo = resolvePluginRepoInfo(entry, marketplace)
    if (!repoInfo) {
      return { urls: [], headerNames: [], toolCount: 0 }
    }

    try {
      // Fetch .mcp.json directly from source (lightweight preview without full download)
      const mcpJsonUrl = repoInfo.subdir
        ? `https://raw.githubusercontent.com/${repoInfo.owner}/${repoInfo.repo}/${repoInfo.ref}/${repoInfo.subdir}/.mcp.json`
        : `https://raw.githubusercontent.com/${repoInfo.owner}/${repoInfo.repo}/${repoInfo.ref}/.mcp.json`

      const res = await fetch(mcpJsonUrl)
      if (!res.ok) return { urls: [], headerNames: [], toolCount: 0 }

      const rawMcpJson = (await res.json()) as Record<string, RawMcpJsonEntry>
      const servers = parseMcpJson(rawMcpJson, `${name}@preview`)

      const urls: string[] = []
      const allHeaderNames: string[] = []
      let toolCount = 0

      for (const config of Object.values(servers)) {
        urls.push(config.url)
        if (config.headerNames) {
          allHeaderNames.push(...config.headerNames)
        }
        // Try to discover tools (may fail if auth is required)
        try {
          const tools = await listToolsWithUrl(config.url, {})
          toolCount += tools.length
        } catch {
          // Server may require auth — count as 0 for preview
        }
      }

      return { urls, headerNames: allHeaderNames, toolCount }
    } catch {
      return { urls: [], headerNames: [], toolCount: 0 }
    }
  }

  // --- Standalone Server CRUD (per-instance) ---

  /** Path to the standalone MCP servers file for a given instance. */
  private serversPath(instanceId: string): string {
    return path.join(BASE_DIR, 'instances', instanceId, 'mcp-servers.json')
  }

  /** Get all standalone MCP servers for an instance. */
  async getStandaloneServers(instanceId: string): Promise<StandaloneMcpServer[]> {
    return (await readJson<StandaloneMcpServer[]>(this.serversPath(instanceId))) || []
  }

  /** Add a new standalone MCP server for an instance. */
  async addStandaloneServer(
    instanceId: string,
    config: Omit<StandaloneMcpServer, 'id' | 'addedAt'>,
  ): Promise<StandaloneMcpServer> {
    const server: StandaloneMcpServer = {
      ...config,
      id: crypto.randomUUID(),
      addedAt: new Date().toISOString(),
    }

    const servers = await this.getStandaloneServers(instanceId)
    servers.push(server)
    await writeJson(this.serversPath(instanceId), servers)

    return server
  }

  /** Update a standalone MCP server for an instance. */
  async updateStandaloneServer(
    instanceId: string,
    id: string,
    updates: Partial<StandaloneMcpServer>,
  ): Promise<void> {
    const servers = await this.getStandaloneServers(instanceId)
    const server = servers.find((s) => s.id === id)
    if (!server) throw new Error(`Server not found: ${id}`)

    // Apply updates but preserve id and addedAt
    const preservedId = server.id
    const preservedAddedAt = server.addedAt
    Object.assign(server, updates)
    server.id = preservedId
    server.addedAt = preservedAddedAt

    await writeJson(this.serversPath(instanceId), servers)
  }

  /**
   * Remove a standalone MCP server and all its keychain secrets.
   */
  async removeStandaloneServer(instanceId: string, id: string): Promise<void> {
    const servers = await this.getStandaloneServers(instanceId)
    const server = servers.find((s) => s.id === id)

    // Delete keychain secrets for all headers
    if (server?.headerNames) {
      for (const headerName of server.headerNames) {
        await deleteSecret(`n8n-desk:server:${id}:${headerName}`)
      }
    }

    const filtered = servers.filter((s) => s.id !== id)
    await writeJson(this.serversPath(instanceId), filtered)
  }

  // --- Tool Discovery ---

  /**
   * Discover tools from an arbitrary HTTP MCP server.
   * Useful for "Test Connection" in the Add Server form.
   */
  async discoverTools(
    url: string,
    headers: Record<string, string>,
  ): Promise<DiscoveredTool[]> {
    const tools = await listToolsWithUrl(url, headers)
    return tools.map((t) => ({
      serverName: '',
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }))
  }

  // --- Secret Management ---

  /**
   * Store an auth header value in the OS keychain.
   * Keys are namespaced: `n8n-desk:{namespace}:{id}:{headerName}`.
   */
  async setSecret(
    namespace: 'plugin' | 'server',
    id: string,
    headerName: string,
    value: string,
  ): Promise<void> {
    await writeSecret(`n8n-desk:${namespace}:${id}:${headerName}`, value)
  }

  /**
   * Delete all keychain secrets for a plugin or server.
   * For plugins, reads header names from installed.json.
   * For servers, requires instanceId to read from mcp-servers.json.
   */
  async deleteSecrets(
    namespace: 'plugin' | 'server',
    id: string,
    instanceId?: string,
  ): Promise<void> {
    if (namespace === 'plugin') {
      const plugins = await this.getInstalledPlugins()
      const plugin = plugins.find((p) => p.id === id)
      if (plugin?.mcpServers) {
        for (const config of Object.values(plugin.mcpServers)) {
          if (config.headerNames) {
            for (const headerName of config.headerNames) {
              await deleteSecret(`n8n-desk:plugin:${id}:${headerName}`)
            }
          }
        }
      }
    } else if (namespace === 'server' && instanceId) {
      const servers = await this.getStandaloneServers(instanceId)
      const server = servers.find((s) => s.id === id)
      if (server?.headerNames) {
        for (const headerName of server.headerNames) {
          await deleteSecret(`n8n-desk:server:${id}:${headerName}`)
        }
      }
    }
  }

  // --- Backend Builders ---

  /**
   * Resolve headers for a plugin's MCP server from the keychain.
   * Credential isolation: only returns headers for the specified plugin.
   */
  private async resolvePluginHeaders(
    pluginId: string,
    headerNames: string[],
  ): Promise<Record<string, string>> {
    const headers: Record<string, string> = {}
    for (const name of headerNames) {
      const value = await readSecret(`n8n-desk:plugin:${pluginId}:${name}`)
      if (value) headers[name] = value
    }
    return headers
  }

  /**
   * Resolve headers for a standalone server from the keychain.
   * Credential isolation: only returns headers for the specified server.
   */
  private async resolveServerHeaders(
    serverId: string,
    headerNames: string[],
  ): Promise<Record<string, string>> {
    const headers: Record<string, string> = {}
    for (const name of headerNames) {
      const value = await readSecret(`n8n-desk:server:${serverId}:${name}`)
      if (value) headers[name] = value
    }
    return headers
  }

  /**
   * Build a unified server config map from all enabled plugins + standalone servers.
   * Each server gets only its own headers — never mixed.
   * Handles duplicate server names by appending -2, -3, etc.
   */
  private async resolveAllServerConfigs(
    instanceId: string,
  ): Promise<Record<string, { url: string; headers: Record<string, string> }>> {
    const configs: Record<string, { url: string; headers: Record<string, string> }> = {}

    // Enabled plugins — each plugin server gets its own credential scope
    const plugins = await this.getInstalledPlugins()
    for (const plugin of plugins) {
      if (!plugin.enabled || !plugin.mcpServers) continue

      for (const [serverName, serverConfig] of Object.entries(plugin.mcpServers)) {
        const headers = serverConfig.headerNames
          ? await this.resolvePluginHeaders(plugin.id, serverConfig.headerNames)
          : {}

        // Deduplicate server names with suffix
        let name = serverName
        let counter = 2
        while (configs[name]) {
          name = `${serverName}-${counter++}`
        }

        configs[name] = { url: serverConfig.url, headers }
      }
    }

    // Enabled standalone servers — each server gets its own credential scope
    const servers = await this.getStandaloneServers(instanceId)
    for (const server of servers) {
      if (!server.enabled) continue

      const headers = server.headerNames
        ? await this.resolveServerHeaders(server.id, server.headerNames)
        : {}

      // Deduplicate server names with suffix
      let name = server.name
      let counter = 2
      while (configs[name]) {
        name = `${server.name}-${counter++}`
      }

      configs[name] = { url: server.url, headers }
    }

    return configs
  }

  /**
   * Build MCP server configs for the Claude SDK backend.
   * Returns Record<string, { type: 'http'; url; headers }> to merge into `mcpServers` config.
   *
   * Credential isolation: n8n Bearer token is NOT included — only plugin/server-specific headers.
   * The n8n 'n8n' entry is managed separately by the Claude SDK runner.
   */
  async buildClaudeSdkMcpServers(
    instanceId: string,
  ): Promise<Record<string, { type: 'http'; url: string; headers: Record<string, string> }>> {
    const serverConfigs = await this.resolveAllServerConfigs(instanceId)
    const result: Record<string, { type: 'http'; url: string; headers: Record<string, string> }> = {}

    for (const [name, config] of Object.entries(serverConfigs)) {
      result[name] = {
        type: 'http',
        url: config.url,
        headers: config.headers,
      }
    }

    return result
  }

  /**
   * Build LangChain tools for the Deep Agents backend.
   * Discovers tools from all enabled plugin + standalone servers and wraps each
   * as a LangChain tool with a dynamically built Zod schema.
   *
   * Credential isolation: each server only gets its own headers via createDynamicMcpTools.
   */
  async buildDeepAgentsTools(instanceId: string): Promise<unknown[]> {
    const serverConfigs = await this.resolveAllServerConfigs(instanceId)
    return createDynamicMcpTools(serverConfigs)
  }

  /**
   * Get names of standalone servers that require approval.
   * Used to extend the interruptOnTools set with tool names from these servers.
   */
  async getApprovalRequiredServerNames(instanceId: string): Promise<string[]> {
    const names: string[] = []
    const servers = await this.getStandaloneServers(instanceId)
    for (const server of servers) {
      if (server.enabled && server.requireApproval) {
        names.push(server.name)
      }
    }
    return names
  }

  // --- Private Helpers ---

  /**
   * Download a plugin from its source (GitHub tarball) and extract to the cache directory.
   * For marketplace plugins with a subdirectory source, extracts the full repo then copies
   * only the subdirectory.
   */
  private async downloadPlugin(
    entry: MarketplacePluginEntry,
    marketplace: Marketplace,
    destDir: string,
  ): Promise<void> {
    const repoInfo = resolvePluginRepoInfo(entry, marketplace)
    if (!repoInfo) {
      throw new Error(`Cannot resolve plugin source for "${entry.name}"`)
    }

    const tarballUrl =
      `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/tarball/${repoInfo.ref}`

    const res = await fetch(tarballUrl, {
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (!res.ok) {
      throw new Error(
        `Failed to download plugin "${entry.name}": ${res.status} ${res.statusText}`,
      )
    }

    const buffer = Buffer.from(await res.arrayBuffer())
    const tmpFile = path.join(os.tmpdir(), `n8n-desk-plugin-${crypto.randomUUID()}.tar.gz`)

    try {
      await fs.writeFile(tmpFile, buffer)
      await ensureDir(destDir)

      if (repoInfo.subdir) {
        // Plugin is a subdirectory of the repo — extract full repo to temp, then copy subdir
        const tmpExtract = path.join(os.tmpdir(), `n8n-desk-extract-${crypto.randomUUID()}`)
        await ensureDir(tmpExtract)

        await execFileAsync('tar', ['-xzf', tmpFile, '-C', tmpExtract, '--strip-components=1'])

        const srcSubdir = path.join(tmpExtract, repoInfo.subdir)
        try {
          await fs.cp(srcSubdir, destDir, { recursive: true })
        } catch {
          // If subdir doesn't exist, copy the full extraction
          await fs.cp(tmpExtract, destDir, { recursive: true })
        }

        // Cleanup temp extraction
        await fs.rm(tmpExtract, { recursive: true, force: true }).catch(() => {})
      } else {
        // Plugin is the entire repo — extract directly
        await execFileAsync('tar', ['-xzf', tmpFile, '-C', destDir, '--strip-components=1'])
      }
    } finally {
      // Cleanup temp tarball file
      await fs.unlink(tmpFile).catch(() => {})
    }
  }
}

// --- Singleton Export ---

export const pluginManager = new PluginManager()
