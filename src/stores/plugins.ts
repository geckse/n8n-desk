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

  // --- Computed ---
  const enabledPlugins = computed(() =>
    installedPlugins.value.filter((p) => p.enabled),
  )

  const enabledServers = computed(() =>
    standaloneServers.value.filter((s) => s.enabled),
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

    // Secret management
    setSecret,

    // Skills
    loadSkills,
    saveSkill,
    deleteSkill,
  }
})
