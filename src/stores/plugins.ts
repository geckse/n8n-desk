import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import type {
  Marketplace,
  MarketplaceSource,
  MarketplacePluginEntry,
  InstalledPlugin,
  StandaloneMcpServer,
  LoadedSkill,
  DiscoveredTool,
} from '@/types/plugin'
import { DEFAULT_SKILLS } from '@/data/default-skills'

export interface ToolSource {
  type: 'plugin' | 'server'
  id: string
  name: string
  url: string
  headerNames?: string[]
  requireApproval: boolean
}

function isError(result: unknown): result is { success: false; error: string } {
  return (
    typeof result === 'object' &&
    result !== null &&
    'success' in result &&
    (result as { success: boolean }).success === false
  )
}

function getPluginsBridge() {
  if (!window.n8nDesk?.plugins) {
    throw new Error('Plugin bridge not available')
  }
  return window.n8nDesk.plugins
}

export const usePluginsStore = defineStore('plugins', () => {
  // --- Reactive state ---
  const marketplaces = ref<Marketplace[]>([])
  const installedPlugins = ref<InstalledPlugin[]>([])
  const standaloneServers = ref<StandaloneMcpServer[]>([])
  const skills = ref<LoadedSkill[]>([])
  const isLoading = ref(false)
  /** Names of built-in skills the user has explicitly disabled */
  const disabledBuiltInSkills = ref<Set<string>>(new Set())

  // --- Computed ---
  const enabledPlugins = computed(() =>
    installedPlugins.value.filter((p) => p.enabled),
  )

  const enabledServers = computed(() =>
    standaloneServers.value.filter((s) => s.enabled),
  )

  /** All skills: built-in defaults (with enabled state) + user/plugin skills */
  const allSkills = computed<LoadedSkill[]>(() => {
    const builtIn = DEFAULT_SKILLS.map((s) => ({
      ...s,
      builtIn: true,
      _disabled: disabledBuiltInSkills.value.has(s.name),
    }))
    return [...builtIn, ...skills.value]
  })

  /** Only enabled skills (for passing to the agent) */
  const enabledSkills = computed<LoadedSkill[]>(() =>
    allSkills.value.filter((s) => !('_disabled' in s && (s as LoadedSkill & { _disabled: boolean })._disabled)),
  )

  /** Built-in skills (for the Settings UI "Default Skills" group) */
  const builtInSkills = computed(() =>
    DEFAULT_SKILLS.map((s) => ({
      ...s,
      enabled: !disabledBuiltInSkills.value.has(s.name),
    })),
  )

  const allToolSources = computed<ToolSource[]>(() => {
    const sources: ToolSource[] = []

    for (const plugin of enabledPlugins.value) {
      if (plugin.mcpServers) {
        for (const [serverName, config] of Object.entries(plugin.mcpServers)) {
          sources.push({
            type: 'plugin',
            id: plugin.id,
            name: `${plugin.name}/${serverName}`,
            url: config.url,
            headerNames: config.headerNames,
            requireApproval: true,
          })
        }
      }
    }

    for (const server of enabledServers.value) {
      sources.push({
        type: 'server',
        id: server.id,
        name: server.name,
        url: server.url,
        headerNames: server.headerNames,
        requireApproval: server.requireApproval,
      })
    }

    return sources
  })

  // --- Marketplace actions ---

  async function hydrateMarketplaces(): Promise<void> {
    const bridge = getPluginsBridge()
    const result = await bridge.marketplaceList()
    if (isError(result)) {
      throw new Error(result.error)
    }
    marketplaces.value = result
  }

  async function refreshMarketplace(id: string): Promise<void> {
    const bridge = getPluginsBridge()
    const result = await bridge.marketplaceRefresh(id)
    if (isError(result)) {
      throw new Error(result.error)
    }
    await hydrateMarketplaces()
  }

  async function addMarketplace(source: MarketplaceSource): Promise<Marketplace> {
    const bridge = getPluginsBridge()
    const result = await bridge.marketplaceAdd(source)
    if (isError(result)) {
      throw new Error(result.error)
    }
    marketplaces.value.push(result.marketplace)
    return result.marketplace
  }

  async function removeMarketplace(id: string): Promise<void> {
    const bridge = getPluginsBridge()
    const result = await bridge.marketplaceRemove(id)
    if (isError(result)) {
      throw new Error(result.error)
    }
    marketplaces.value = marketplaces.value.filter((m) => m.id !== id)
  }

  // --- Browse ---

  async function browsePlugins(marketplaceId?: string): Promise<MarketplacePluginEntry[]> {
    const bridge = getPluginsBridge()
    const result = await bridge.browse(marketplaceId)
    if (isError(result)) {
      throw new Error(result.error)
    }
    return result
  }

  // --- Plugin lifecycle ---

  async function hydrateInstalledPlugins(): Promise<void> {
    const bridge = getPluginsBridge()
    const result = await bridge.installedList()
    if (isError(result)) {
      throw new Error(result.error)
    }
    installedPlugins.value = result
  }

  async function installPlugin(name: string, marketplaceId: string): Promise<InstalledPlugin> {
    const bridge = getPluginsBridge()
    const result = await bridge.install(name, marketplaceId)
    if (isError(result)) {
      throw new Error(result.error)
    }
    installedPlugins.value.push(result.plugin)
    return result.plugin
  }

  async function uninstallPlugin(id: string): Promise<void> {
    const bridge = getPluginsBridge()
    const result = await bridge.uninstall(id)
    if (isError(result)) {
      throw new Error(result.error)
    }
    installedPlugins.value = installedPlugins.value.filter((p) => p.id !== id)
  }

  async function togglePlugin(id: string): Promise<void> {
    const plugin = installedPlugins.value.find((p) => p.id === id)
    if (!plugin) return

    const bridge = getPluginsBridge()
    const result = plugin.enabled
      ? await bridge.disable(id)
      : await bridge.enable(id)

    if (isError(result)) {
      throw new Error(result.error)
    }

    const idx = installedPlugins.value.findIndex((p) => p.id === id)
    if (idx !== -1) {
      installedPlugins.value[idx] = {
        ...installedPlugins.value[idx],
        enabled: !plugin.enabled,
      }
    }
  }

  // --- Standalone MCP servers ---

  async function hydrateServers(): Promise<void> {
    const bridge = getPluginsBridge()
    const result = await bridge.serversList()
    if (isError(result)) {
      throw new Error(result.error)
    }
    standaloneServers.value = result
  }

  async function addServer(config: {
    name: string
    description?: string
    url: string
    authType?: 'static-headers' | 'oauth'
    headerNames?: string[]
    enabled: boolean
    requireApproval: boolean
  }): Promise<StandaloneMcpServer> {
    const bridge = getPluginsBridge()
    const result = await bridge.serversAdd(config)
    if (isError(result)) {
      throw new Error(result.error)
    }
    standaloneServers.value.push(result.server)
    return result.server
  }

  async function updateServer(id: string, updates: Record<string, unknown>): Promise<void> {
    const bridge = getPluginsBridge()
    const result = await bridge.serversUpdate(id, updates)
    if (isError(result)) {
      throw new Error(result.error)
    }
    await hydrateServers()
  }

  async function removeServer(id: string): Promise<void> {
    const bridge = getPluginsBridge()
    const result = await bridge.serversRemove(id)
    if (isError(result)) {
      throw new Error(result.error)
    }
    standaloneServers.value = standaloneServers.value.filter((s) => s.id !== id)
  }

  async function testServer(
    url: string,
    headers: Record<string, string>,
  ): Promise<DiscoveredTool[]> {
    const bridge = getPluginsBridge()
    const result = await bridge.serversTest(url, headers)
    if (isError(result)) {
      throw new Error(result.error)
    }
    return result.tools
  }

  /** Test connection using stored credentials (OAuth or static headers from keychain). */
  async function testServerById(serverId: string): Promise<DiscoveredTool[]> {
    const bridge = getPluginsBridge()
    const result = await bridge.serversTestById(serverId)
    if (isError(result)) {
      throw new Error(result.error)
    }
    return result.tools
  }

  // --- Secret management ---

  async function setSecret(
    namespace: 'plugin' | 'server',
    id: string,
    headerName: string,
    value: string,
  ): Promise<void> {
    const bridge = getPluginsBridge()
    const result = await bridge.setSecret(namespace, id, headerName, value)
    if (isError(result)) {
      throw new Error(result.error)
    }
  }

  // --- Server OAuth ---

  async function serverProbeOAuth(serverUrl: string): Promise<boolean> {
    const bridge = getPluginsBridge()
    const result = await bridge.serverProbeOAuth(serverUrl)
    return result?.supportsOAuth === true
  }

  async function serverOAuthConnect(
    serverId: string,
    serverUrl: string,
    clientId?: string,
    clientSecret?: string,
  ): Promise<{ success: boolean; expiresAt?: string; error?: string; needsManualClient?: boolean }> {
    const bridge = getPluginsBridge()
    const result = await bridge.serverOAuthConnect({ serverId, serverUrl, clientId, clientSecret })
    if (result.success) {
      await hydrateServers()
    }
    return result
  }

  async function serverOAuthDisconnect(serverId: string): Promise<void> {
    const bridge = getPluginsBridge()
    const result = await bridge.serverOAuthDisconnect({ serverId })
    if (isError(result)) {
      throw new Error(result.error)
    }
    await hydrateServers()
  }

  // --- Built-in skill toggle ---

  async function hydrateDisabledBuiltInSkills(): Promise<void> {
    try {
      const raw = await window.n8nDesk?.storage.read('disabled-built-in-skills.json')
      if (raw) {
        const parsed = JSON.parse(raw) as string[]
        disabledBuiltInSkills.value = new Set(parsed)
      }
    } catch {
      // No file yet — all built-in skills enabled by default
    }
  }

  async function persistDisabledBuiltInSkills(): Promise<void> {
    const data = JSON.stringify(Array.from(disabledBuiltInSkills.value))
    await window.n8nDesk?.storage.write('disabled-built-in-skills.json', data)
  }

  async function toggleBuiltInSkill(name: string): Promise<void> {
    if (disabledBuiltInSkills.value.has(name)) {
      disabledBuiltInSkills.value.delete(name)
    } else {
      disabledBuiltInSkills.value.add(name)
    }
    // Trigger reactivity
    disabledBuiltInSkills.value = new Set(disabledBuiltInSkills.value)
    await persistDisabledBuiltInSkills()
  }

  function isBuiltInSkillEnabled(name: string): boolean {
    return !disabledBuiltInSkills.value.has(name)
  }

  // --- Skills ---

  async function loadSkills(): Promise<void> {
    const bridge = getPluginsBridge()
    const result = await bridge.listSkills()
    if (isError(result)) {
      throw new Error(result.error)
    }
    skills.value = result
  }

  async function saveSkill(skill: { name: string; content: string }): Promise<void> {
    const bridge = getPluginsBridge()
    const result = await bridge.saveSkill(skill)
    if (isError(result)) {
      throw new Error(result.error)
    }
    await loadSkills()
  }

  async function deleteSkill(name: string): Promise<void> {
    const bridge = getPluginsBridge()
    const result = await bridge.deleteSkill(name)
    if (isError(result)) {
      throw new Error(result.error)
    }
    skills.value = skills.value.filter((s) => s.name !== name)
  }

  // --- Hydrate all ---

  async function hydrate(): Promise<void> {
    isLoading.value = true
    try {
      await Promise.all([
        hydrateMarketplaces(),
        hydrateInstalledPlugins(),
        hydrateServers(),
        loadSkills(),
        hydrateDisabledBuiltInSkills(),
      ])
    } finally {
      isLoading.value = false
    }
  }

  function reset(): void {
    marketplaces.value = []
    installedPlugins.value = []
    standaloneServers.value = []
    skills.value = []
    isLoading.value = false
  }

  return {
    // State
    marketplaces,
    installedPlugins,
    standaloneServers,
    skills,
    isLoading,

    // Computed
    enabledPlugins,
    enabledServers,
    allToolSources,
    allSkills,
    enabledSkills,
    builtInSkills,

    // Hydrate / reset
    hydrate,
    reset,

    // Marketplace actions
    hydrateMarketplaces,
    refreshMarketplace,
    addMarketplace,
    removeMarketplace,

    // Browse
    browsePlugins,

    // Plugin actions
    installPlugin,
    uninstallPlugin,
    togglePlugin,

    // Server actions
    addServer,
    updateServer,
    removeServer,
    testServer,
    testServerById,

    // Secret management
    setSecret,

    // Server OAuth
    serverProbeOAuth,
    serverOAuthConnect,
    serverOAuthDisconnect,

    // Skills
    loadSkills,
    saveSkill,
    deleteSkill,

    // Built-in skills
    toggleBuiltInSkill,
    isBuiltInSkillEnabled,
  }
})
