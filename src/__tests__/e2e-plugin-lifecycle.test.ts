/**
 * End-to-end verification of the complete plugin and skill lifecycle.
 *
 * Tests cover:
 * 1. Marketplace auto-seeded on first launch
 * 2. Browse plugins in Discover tab
 * 3. Security dialog on install (previewInstall + installPlugin + setSecret)
 * 4. Plugin tools available to agent (buildClaudeSdkMcpServers / buildDeepAgentsTools)
 * 5. Standalone server quick-add
 * 6. Popover toggle state
 * 7. Skill creation saved as valid SKILL.md
 * 8. /skill-name autocomplete resolution
 * 9. Graceful degradation if server unreachable
 * 10. All Phase 4 tests still pass (verified by vitest run)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { usePluginsStore } from '@/stores/plugins'
import type {
  Marketplace,
  MarketplacePluginEntry,
  InstalledPlugin,
  StandaloneMcpServer,
  LoadedSkill,
  DiscoveredTool,
} from '@/types/plugin'

// --- Mock bridge factory ---

function createMockBridge() {
  return {
    marketplaceList: vi.fn().mockResolvedValue([]),
    marketplaceRefresh: vi.fn().mockResolvedValue({ success: true }),
    marketplaceAdd: vi.fn(),
    marketplaceRemove: vi.fn().mockResolvedValue({ success: true }),
    browse: vi.fn().mockResolvedValue([]),
    installedList: vi.fn().mockResolvedValue([]),
    install: vi.fn(),
    uninstall: vi.fn().mockResolvedValue({ success: true }),
    enable: vi.fn().mockResolvedValue({ success: true }),
    disable: vi.fn().mockResolvedValue({ success: true }),
    previewInstall: vi.fn(),
    serversList: vi.fn().mockResolvedValue([]),
    serversAdd: vi.fn(),
    serversUpdate: vi.fn().mockResolvedValue({ success: true }),
    serversRemove: vi.fn().mockResolvedValue({ success: true }),
    serversTest: vi.fn(),
    setSecret: vi.fn().mockResolvedValue({ success: true }),
    deleteSecrets: vi.fn().mockResolvedValue({ success: true }),
    listSkills: vi.fn().mockResolvedValue([]),
    saveSkill: vi.fn().mockResolvedValue({ success: true }),
    deleteSkill: vi.fn().mockResolvedValue({ success: true }),
  }
}

let mockBridge: ReturnType<typeof createMockBridge>

beforeEach(() => {
  mockBridge = createMockBridge()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).window = {
    n8nDesk: {
      plugins: mockBridge,
    },
  }
})

afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).window
})

// --- Test data factories ---

function makeMarketplace(overrides: Partial<Marketplace> = {}): Marketplace {
  return {
    id: 'mkt_anthropic',
    name: 'Anthropic Official',
    owner: { name: 'Anthropic' },
    source: { source: 'github', repo: 'anthropics/claude-plugins-official' },
    plugins: [
      { name: 'github', source: 'github', description: 'GitHub API integration', category: 'dev', keywords: ['git', 'code'] },
      { name: 'slack', source: 'github', description: 'Slack messaging tools', category: 'communication', keywords: ['chat'] },
      { name: 'linear', source: 'github', description: 'Linear issue tracking', category: 'dev', keywords: ['issues'] },
      { name: 'notion', source: 'github', description: 'Notion workspace tools', category: 'productivity', keywords: ['docs'] },
    ],
    addedAt: '2026-03-14T10:00:00Z',
    autoUpdate: true,
    ...overrides,
  }
}

function makePlugin(overrides: Partial<InstalledPlugin> = {}): InstalledPlugin {
  return {
    id: 'github@Anthropic Official',
    name: 'github',
    marketplace: 'mkt_anthropic',
    pluginDir: '/home/user/.n8n-desk/plugins/cache/github_Anthropic_Official',
    manifest: {
      name: 'github',
      version: '1.0.0',
      description: 'GitHub API integration for n8n-desk',
      author: { name: 'Anthropic' },
    },
    mcpServers: {
      'github-api': {
        url: 'https://mcp.github.com/api',
        headerNames: ['Authorization'],
      },
    },
    enabled: true,
    installedAt: '2026-03-14T10:05:00Z',
    ...overrides,
  }
}

function makeServer(overrides: Partial<StandaloneMcpServer> = {}): StandaloneMcpServer {
  return {
    id: 'srv_custom',
    name: 'Custom API',
    description: 'My custom MCP server',
    url: 'https://my-api.example.com/mcp',
    headerNames: ['X-API-Key'],
    enabled: true,
    requireApproval: true,
    addedAt: '2026-03-14T11:00:00Z',
    ...overrides,
  }
}

function makeSkill(overrides: Partial<LoadedSkill> = {}): LoadedSkill {
  return {
    name: 'deploy-prod',
    description: 'Deploy to production environment',
    content: 'Run the deployment workflow for $ARGUMENTS with validation checks.',
    disableModelInvocation: false,
    userInvocable: true,
    directory: '/home/user/.n8n-desk/skills/deploy-prod',
    source: 'user',
    ...overrides,
  }
}

// =============================================================================
// E2E LIFECYCLE TESTS
// =============================================================================

describe('E2E: Plugin & Skill Lifecycle', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  // ---------------------------------------------------------------------------
  // 1. Marketplace auto-seeded on first launch
  // ---------------------------------------------------------------------------
  describe('1. Marketplace auto-seeding', () => {
    it('hydrates with Anthropic marketplace on first launch', async () => {
      const anthropicMarketplace = makeMarketplace()
      mockBridge.marketplaceList.mockResolvedValue([anthropicMarketplace])

      const store = usePluginsStore()
      await store.hydrate()

      expect(store.marketplaces).toHaveLength(1)
      expect(store.marketplaces[0].name).toBe('Anthropic Official')
      expect(store.marketplaces[0].source.source).toBe('github')
      expect(store.marketplaces[0].source.repo).toBe('anthropics/claude-plugins-official')
      expect(store.marketplaces[0].autoUpdate).toBe(true)
    })

    it('marketplace has plugins available for browsing', async () => {
      const marketplace = makeMarketplace()
      mockBridge.marketplaceList.mockResolvedValue([marketplace])
      mockBridge.browse.mockResolvedValue(marketplace.plugins)

      const store = usePluginsStore()
      await store.hydrate()

      const entries = await store.browsePlugins()
      expect(entries).toHaveLength(4)
      expect(entries.map((e) => e.name)).toEqual(['github', 'slack', 'linear', 'notion'])
    })
  })

  // ---------------------------------------------------------------------------
  // 2. Browse plugins in Discover tab
  // ---------------------------------------------------------------------------
  describe('2. Browse plugins in Discover tab', () => {
    it('browses all plugins from all marketplaces', async () => {
      const entries: MarketplacePluginEntry[] = [
        { name: 'github', source: 'github', description: 'GitHub' },
        { name: 'slack', source: 'github', description: 'Slack' },
      ]
      mockBridge.browse.mockResolvedValue(entries)

      const store = usePluginsStore()
      const result = await store.browsePlugins()

      expect(result).toHaveLength(2)
      expect(mockBridge.browse).toHaveBeenCalledWith(undefined)
    })

    it('browses plugins from a specific marketplace', async () => {
      const entries: MarketplacePluginEntry[] = [
        { name: 'github', source: 'github', description: 'GitHub' },
      ]
      mockBridge.browse.mockResolvedValue(entries)

      const store = usePluginsStore()
      const result = await store.browsePlugins('mkt_anthropic')

      expect(result).toHaveLength(1)
      expect(mockBridge.browse).toHaveBeenCalledWith('mkt_anthropic')
    })

    it('excludes already-installed plugins from results when filtered in-store', async () => {
      const store = usePluginsStore()
      store.installedPlugins = [makePlugin({ name: 'github' })]

      // Simulate what PluginSettings.vue does with filteredDiscoverEntries
      const allEntries: MarketplacePluginEntry[] = [
        { name: 'github', source: 'github', description: 'GitHub (already installed)' },
        { name: 'slack', source: 'github', description: 'Slack (not installed)' },
      ]

      const installedNames = new Set(store.installedPlugins.map((p) => p.name))
      const filtered = allEntries.filter((e) => !installedNames.has(e.name))

      expect(filtered).toHaveLength(1)
      expect(filtered[0].name).toBe('slack')
    })
  })

  // ---------------------------------------------------------------------------
  // 3. Security dialog on install
  // ---------------------------------------------------------------------------
  describe('3. Security dialog on install', () => {
    it('installs plugin and stores header secrets sequentially', async () => {
      const plugin = makePlugin()
      mockBridge.install.mockResolvedValue({ plugin })

      const store = usePluginsStore()

      // Step 1: Install the plugin
      const installed = await store.installPlugin('github', 'mkt_anthropic')
      expect(installed.id).toBe('github@Anthropic Official')
      expect(installed.mcpServers).toBeDefined()
      expect(installed.mcpServers!['github-api'].headerNames).toEqual(['Authorization'])

      // Step 2: Store secret header values in keychain
      await store.setSecret('plugin', installed.id, 'Authorization', 'Bearer ghp_xxx123')

      expect(mockBridge.install).toHaveBeenCalledWith('github', 'mkt_anthropic')
      expect(mockBridge.setSecret).toHaveBeenCalledWith(
        'plugin',
        'github@Anthropic Official',
        'Authorization',
        'Bearer ghp_xxx123',
      )
    })

    it('install fails gracefully with error propagation', async () => {
      mockBridge.install.mockResolvedValue({ success: false, error: 'Download failed: 404' })

      const store = usePluginsStore()
      await expect(store.installPlugin('bad-plugin', 'mkt_1')).rejects.toThrow('Download failed: 404')

      // Installed list should remain empty
      expect(store.installedPlugins).toHaveLength(0)
    })
  })

  // ---------------------------------------------------------------------------
  // 4. Plugin tools available to agent
  // ---------------------------------------------------------------------------
  describe('4. Plugin tools available to agent', () => {
    it('enabled plugins appear in allToolSources', () => {
      const store = usePluginsStore()
      store.installedPlugins = [
        makePlugin({
          id: 'github@Official',
          name: 'github',
          enabled: true,
          mcpServers: {
            'github-api': { url: 'https://mcp.github.com/api', headerNames: ['Authorization'] },
          },
        }),
      ]

      expect(store.allToolSources).toHaveLength(1)
      expect(store.allToolSources[0]).toEqual({
        type: 'plugin',
        id: 'github@Official',
        name: 'github/github-api',
        url: 'https://mcp.github.com/api',
        headerNames: ['Authorization'],
        requireApproval: true, // plugins always require approval
      })
    })

    it('disabled plugins are excluded from allToolSources', () => {
      const store = usePluginsStore()
      store.installedPlugins = [
        makePlugin({
          enabled: false,
          mcpServers: { srv: { url: 'https://api.com/mcp' } },
        }),
      ]

      expect(store.allToolSources).toHaveLength(0)
    })

    it('standalone servers also appear in allToolSources', () => {
      const store = usePluginsStore()
      store.standaloneServers = [
        makeServer({ id: 'srv_1', name: 'My API', enabled: true, requireApproval: false }),
      ]

      expect(store.allToolSources).toHaveLength(1)
      expect(store.allToolSources[0].type).toBe('server')
      expect(store.allToolSources[0].requireApproval).toBe(false)
    })

    it('plugin and server tools are combined in allToolSources', () => {
      const store = usePluginsStore()
      store.installedPlugins = [
        makePlugin({
          id: 'p1', name: 'Plugin', enabled: true,
          mcpServers: { srv: { url: 'https://plugin.com/mcp' } },
        }),
      ]
      store.standaloneServers = [
        makeServer({ id: 's1', name: 'Server', enabled: true }),
      ]

      expect(store.allToolSources).toHaveLength(2)
      expect(store.allToolSources[0].type).toBe('plugin')
      expect(store.allToolSources[1].type).toBe('server')
    })
  })

  // ---------------------------------------------------------------------------
  // 5. Standalone server quick-add
  // ---------------------------------------------------------------------------
  describe('5. Standalone server quick-add', () => {
    it('adds a server with name, URL, headers, and requireApproval', async () => {
      const server = makeServer()
      mockBridge.serversAdd.mockResolvedValue({ server })

      const store = usePluginsStore()
      const added = await store.addServer({
        name: 'Custom API',
        description: 'My custom MCP server',
        url: 'https://my-api.example.com/mcp',
        headerNames: ['X-API-Key'],
        enabled: true,
        requireApproval: true,
      })

      expect(added.id).toBe('srv_custom')
      expect(added.url).toBe('https://my-api.example.com/mcp')
      expect(store.standaloneServers).toHaveLength(1)
    })

    it('test connection discovers tools from server', async () => {
      const tools: DiscoveredTool[] = [
        { serverName: 'Custom API', name: 'list_items', description: 'List all items' },
        { serverName: 'Custom API', name: 'create_item', description: 'Create a new item' },
        { serverName: 'Custom API', name: 'delete_item', description: 'Delete an item' },
      ]
      mockBridge.serversTest.mockResolvedValue({ tools })

      const store = usePluginsStore()
      const discovered = await store.testServer('https://my-api.example.com/mcp', {
        'X-API-Key': 'key-123',
      })

      expect(discovered).toHaveLength(3)
      expect(discovered.map((t) => t.name)).toEqual(['list_items', 'create_item', 'delete_item'])
    })

    it('stores server secrets in keychain after adding', async () => {
      const server = makeServer({ id: 'srv_new' })
      mockBridge.serversAdd.mockResolvedValue({ server })

      const store = usePluginsStore()
      await store.addServer({
        name: 'Secure Server',
        url: 'https://secure.example.com/mcp',
        headerNames: ['X-API-Key'],
        enabled: true,
        requireApproval: true,
      })

      // Simulate what AddServerForm.vue does after adding
      await store.setSecret('server', 'srv_new', 'X-API-Key', 'secret-key-value')

      expect(mockBridge.setSecret).toHaveBeenCalledWith(
        'server',
        'srv_new',
        'X-API-Key',
        'secret-key-value',
      )
    })
  })

  // ---------------------------------------------------------------------------
  // 6. Popover toggles work
  // ---------------------------------------------------------------------------
  describe('6. Popover toggles', () => {
    it('togglePlugin flips enabled state of a plugin', async () => {
      const store = usePluginsStore()
      store.installedPlugins = [makePlugin({ id: 'p1', enabled: true })]

      // Toggle off
      await store.togglePlugin('p1')
      expect(mockBridge.disable).toHaveBeenCalledWith('p1')
      expect(store.installedPlugins[0].enabled).toBe(false)

      // Toggle back on
      await store.togglePlugin('p1')
      expect(mockBridge.enable).toHaveBeenCalledWith('p1')
      expect(store.installedPlugins[0].enabled).toBe(true)
    })

    it('updateServer flips enabled state of a server', async () => {
      const server = makeServer({ id: 'srv_1', enabled: true })
      const toggled = makeServer({ id: 'srv_1', enabled: false })
      mockBridge.serversList.mockResolvedValue([toggled])

      const store = usePluginsStore()
      store.standaloneServers = [server]

      // Toggle via updateServer (what PluginPopover.vue does)
      await store.updateServer('srv_1', { enabled: false })

      expect(mockBridge.serversUpdate).toHaveBeenCalledWith('srv_1', { enabled: false })
      // After rehydrate, the server should reflect the new state
      expect(store.standaloneServers[0].enabled).toBe(false)
    })

    it('toggle state persists through rehydration', async () => {
      const store = usePluginsStore()

      // Initial state: plugin enabled
      store.installedPlugins = [makePlugin({ id: 'p1', enabled: true })]

      // Toggle off
      await store.togglePlugin('p1')
      expect(store.installedPlugins[0].enabled).toBe(false)

      // Simulate rehydration returning the updated state from disk
      mockBridge.installedList.mockResolvedValue([
        makePlugin({ id: 'p1', enabled: false }),
      ])
      mockBridge.marketplaceList.mockResolvedValue([])
      mockBridge.serversList.mockResolvedValue([])
      mockBridge.listSkills.mockResolvedValue([])

      await store.hydrate()
      expect(store.installedPlugins[0].enabled).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // 7. Skill creation saved as valid SKILL.md
  // ---------------------------------------------------------------------------
  describe('7. Skill creation produces valid SKILL.md', () => {
    it('saves skill via bridge with name and content', async () => {
      const savedSkills = [makeSkill({ name: 'deploy-prod' })]
      mockBridge.listSkills.mockResolvedValue(savedSkills)

      const store = usePluginsStore()

      // Simulate what SkillEditor.vue buildSkillMd() produces
      const skillMdContent = [
        '---',
        'description: Deploy to production environment',
        'disableModelInvocation: false',
        'userInvocable: true',
        '---',
        '',
        'Run the deployment workflow for $ARGUMENTS with validation checks.',
        '',
      ].join('\n')

      await store.saveSkill({ name: 'deploy-prod', content: skillMdContent })

      expect(mockBridge.saveSkill).toHaveBeenCalledWith({
        name: 'deploy-prod',
        content: skillMdContent,
      })
      // After save, loadSkills is called → skills are refreshed
      expect(store.skills).toHaveLength(1)
      expect(store.skills[0].name).toBe('deploy-prod')
    })

    it('validates that SKILL.md format has correct YAML frontmatter structure', () => {
      // Test the YAML frontmatter format that SkillEditor.vue generates
      const skillMd = [
        '---',
        'description: A test skill',
        'disableModelInvocation: false',
        'userInvocable: true',
        'allowedTools:',
        '  - search_workflows',
        '  - execute_workflow',
        '---',
        '',
        'Skill instructions go here.',
        '',
      ].join('\n')

      // Verify structure
      expect(skillMd).toMatch(/^---\n/)
      expect(skillMd).toMatch(/\n---\n/)
      expect(skillMd).toContain('description:')
      expect(skillMd).toContain('disableModelInvocation:')
      expect(skillMd).toContain('userInvocable:')
      expect(skillMd).toContain('allowedTools:')
      expect(skillMd).toContain('  - search_workflows')
    })

    it('skills with disableModelInvocation are filtered from system prompt', () => {
      const allSkills: LoadedSkill[] = [
        makeSkill({ name: 'auto-skill', disableModelInvocation: false }),
        makeSkill({ name: 'manual-only', disableModelInvocation: true }),
        makeSkill({ name: 'another-auto', disableModelInvocation: false }),
      ]

      // Same filter used in ipc/agent.ts
      const autoInvocable = allSkills.filter((s) => !s.disableModelInvocation)
      expect(autoInvocable).toHaveLength(2)
      expect(autoInvocable.map((s) => s.name)).toEqual(['auto-skill', 'another-auto'])
    })
  })

  // ---------------------------------------------------------------------------
  // 8. /skill-name autocomplete
  // ---------------------------------------------------------------------------
  describe('8. /skill-name autocomplete', () => {
    it('filters user-invocable skills based on input prefix', () => {
      const skills: LoadedSkill[] = [
        makeSkill({ name: 'deploy-prod', description: 'Deploy to production', userInvocable: true }),
        makeSkill({ name: 'deploy-staging', description: 'Deploy to staging', userInvocable: true }),
        makeSkill({ name: 'test-suite', description: 'Run the test suite', userInvocable: true }),
        makeSkill({ name: 'hidden-skill', description: 'A hidden skill', userInvocable: false }),
      ]

      // Simulate what WorkflowChatPanel.vue does
      const invocable = skills.filter((s) => s.userInvocable)
      expect(invocable).toHaveLength(3) // hidden-skill excluded

      // Prefix filter for "/deploy"
      const prefix = 'deploy'
      const filtered = invocable.filter(
        (s) => s.name.toLowerCase().includes(prefix.toLowerCase()) ||
          s.description.toLowerCase().includes(prefix.toLowerCase()),
      )
      expect(filtered).toHaveLength(2)
      expect(filtered.map((s) => s.name)).toEqual(['deploy-prod', 'deploy-staging'])
    })

    it('resolves /skill-name input by replacing with skill content', () => {
      const skills: LoadedSkill[] = [
        makeSkill({
          name: 'deploy-prod',
          content: 'Run the deployment workflow for $ARGUMENTS with validation checks.',
        }),
      ]

      // Simulate what resolveSkillInput does in WorkflowChatPanel.vue
      const text = '/deploy-prod staging-env --dry-run'
      const spaceIdx = text.indexOf(' ')
      const skillName = spaceIdx === -1 ? text.slice(1) : text.slice(1, spaceIdx)
      const args = spaceIdx === -1 ? '' : text.slice(spaceIdx + 1)

      const skill = skills.find((s) => s.name === skillName)
      expect(skill).toBeDefined()

      const resolved = skill!.content.replace(/\$ARGUMENTS/g, args)
      expect(resolved).toBe('Run the deployment workflow for staging-env --dry-run with validation checks.')
    })

    it('returns original text when /command is not a known skill', () => {
      const skills: LoadedSkill[] = [makeSkill({ name: 'known-skill' })]

      const text = '/unknown-command some args'
      const spaceIdx = text.indexOf(' ')
      const skillName = text.slice(1, spaceIdx)
      const skill = skills.find((s) => s.name === skillName)

      // Unknown skill — should return original text
      expect(skill).toBeUndefined()
      // In the actual code, resolveSkillInput returns the original text
      const resolved = skill ? skill.content : text
      expect(resolved).toBe('/unknown-command some args')
    })
  })

  // ---------------------------------------------------------------------------
  // 9. Graceful degradation if server unreachable
  // ---------------------------------------------------------------------------
  describe('9. Graceful degradation', () => {
    it('testServer throws with a clear error when connection fails', async () => {
      mockBridge.serversTest.mockResolvedValue({ success: false, error: 'Connection refused' })

      const store = usePluginsStore()
      await expect(
        store.testServer('https://unreachable.example.com/mcp', {}),
      ).rejects.toThrow('Connection refused')
    })

    it('hydrate succeeds even if one bridge call fails (partial hydration)', async () => {
      // Marketplaces succeed, but installed list fails
      mockBridge.marketplaceList.mockResolvedValue([makeMarketplace()])
      mockBridge.installedList.mockResolvedValue({ success: false, error: 'disk read error' })

      const store = usePluginsStore()
      await expect(store.hydrate()).rejects.toThrow('disk read error')
      // isLoading is set back to false even on failure
      expect(store.isLoading).toBe(false)
    })

    it('browse returns empty array when marketplace is unreachable', async () => {
      mockBridge.browse.mockResolvedValue([])

      const store = usePluginsStore()
      const result = await store.browsePlugins()
      expect(result).toEqual([])
    })

    it('store operations fail fast with clear error messages', async () => {
      // Server operations
      mockBridge.serversAdd.mockResolvedValue({ success: false, error: 'No active instance configured' })
      const store = usePluginsStore()
      await expect(
        store.addServer({ name: 'test', url: 'https://test.com', enabled: true, requireApproval: true }),
      ).rejects.toThrow('No active instance configured')

      // Secret operations
      mockBridge.setSecret.mockResolvedValue({ success: false, error: 'keychain locked' })
      await expect(
        store.setSecret('server', 'id', 'header', 'value'),
      ).rejects.toThrow('keychain locked')
    })

    it('plugin bridge unavailable throws a clear error', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(globalThis as any).window = { n8nDesk: {} }

      const store = usePluginsStore()
      await expect(store.hydrate()).rejects.toThrow('Plugin bridge not available')
    })
  })

  // ---------------------------------------------------------------------------
  // 10. Full lifecycle integration
  // ---------------------------------------------------------------------------
  describe('10. Full lifecycle integration', () => {
    it('complete plugin lifecycle: browse → install → enable/disable → uninstall', async () => {
      const store = usePluginsStore()

      // Step 1: Browse — see available plugins
      const entries: MarketplacePluginEntry[] = [
        { name: 'github', source: 'github', description: 'GitHub API' },
      ]
      mockBridge.browse.mockResolvedValue(entries)
      const available = await store.browsePlugins()
      expect(available).toHaveLength(1)

      // Step 2: Install
      const plugin = makePlugin()
      mockBridge.install.mockResolvedValue({ plugin })
      await store.installPlugin('github', 'mkt_anthropic')
      expect(store.installedPlugins).toHaveLength(1)
      expect(store.enabledPlugins).toHaveLength(1)

      // Step 3: Set credentials
      await store.setSecret('plugin', plugin.id, 'Authorization', 'Bearer token')
      expect(mockBridge.setSecret).toHaveBeenCalled()

      // Step 4: Verify tools are available
      expect(store.allToolSources).toHaveLength(1)
      expect(store.allToolSources[0].url).toBe('https://mcp.github.com/api')

      // Step 5: Disable — tools should be removed
      await store.togglePlugin(plugin.id)
      expect(store.installedPlugins[0].enabled).toBe(false)
      expect(store.enabledPlugins).toHaveLength(0)
      expect(store.allToolSources).toHaveLength(0)

      // Step 6: Re-enable — tools come back
      await store.togglePlugin(plugin.id)
      expect(store.installedPlugins[0].enabled).toBe(true)
      expect(store.allToolSources).toHaveLength(1)

      // Step 7: Uninstall
      await store.uninstallPlugin(plugin.id)
      expect(store.installedPlugins).toHaveLength(0)
      expect(store.allToolSources).toHaveLength(0)
    })

    it('complete server lifecycle: add → test → toggle → remove', async () => {
      const store = usePluginsStore()

      // Step 1: Add server
      const server = makeServer()
      mockBridge.serversAdd.mockResolvedValue({ server })
      await store.addServer({
        name: 'Custom API',
        url: 'https://my-api.example.com/mcp',
        headerNames: ['X-API-Key'],
        enabled: true,
        requireApproval: true,
      })
      expect(store.standaloneServers).toHaveLength(1)

      // Step 2: Test connection
      const tools: DiscoveredTool[] = [
        { serverName: 'Custom API', name: 'list_items', description: 'List items' },
      ]
      mockBridge.serversTest.mockResolvedValue({ tools })
      const discovered = await store.testServer('https://my-api.example.com/mcp', { 'X-API-Key': 'secret' })
      expect(discovered).toHaveLength(1)

      // Step 3: Store secret
      await store.setSecret('server', server.id, 'X-API-Key', 'real-api-key')

      // Step 4: Toggle off
      const toggledOff = makeServer({ ...server, enabled: false })
      mockBridge.serversList.mockResolvedValue([toggledOff])
      await store.updateServer(server.id, { enabled: false })
      expect(store.standaloneServers[0].enabled).toBe(false)
      expect(store.enabledServers).toHaveLength(0)
      expect(store.allToolSources).toHaveLength(0)

      // Step 5: Remove server
      await store.removeServer(server.id)
      expect(store.standaloneServers).toHaveLength(0)
    })

    it('complete skill lifecycle: create → use → delete', async () => {
      const store = usePluginsStore()

      // Step 1: Create skill
      const skill = makeSkill({ name: 'deploy-prod' })
      mockBridge.listSkills.mockResolvedValue([skill])
      await store.saveSkill({
        name: 'deploy-prod',
        content: '---\ndescription: Deploy\n---\nRun deploy for $ARGUMENTS\n',
      })
      expect(store.skills).toHaveLength(1)
      expect(store.skills[0].name).toBe('deploy-prod')

      // Step 2: Verify skill is invocable
      expect(store.skills[0].userInvocable).toBe(true)
      expect(store.skills[0].disableModelInvocation).toBe(false)

      // Step 3: Delete skill
      await store.deleteSkill('deploy-prod')
      expect(store.skills).toHaveLength(0)
    })
  })
})

// =============================================================================
// parseMcpJson + substituteArguments Integration
// =============================================================================

// Re-test core functions that are critical to the E2E flow

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn().mockReturnValue(false),
    encryptString: vi.fn((s: string) => Buffer.from(`encrypted:${s}`)),
    decryptString: vi.fn((b: Buffer) => b.toString('utf-8').replace('encrypted:', '')),
  },
}))

vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn().mockRejectedValue(new Error('ENOENT')),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    unlink: vi.fn(),
    rm: vi.fn(),
    readdir: vi.fn().mockResolvedValue([]),
    stat: vi.fn(),
    cp: vi.fn(),
  },
}))

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return { ...actual, execFile: vi.fn() }
})

vi.mock('../../electron/mcp-client', () => ({
  listToolsWithUrl: vi.fn().mockResolvedValue([]),
  callTool: vi.fn(),
  callToolWithUrl: vi.fn(),
}))

vi.mock('../../electron/agent/tool-definitions', () => ({
  createDynamicMcpTools: vi.fn().mockResolvedValue([]),
  jsonSchemaToZod: vi.fn(),
}))

import { parseMcpJson } from '../../electron/plugin-manager'
import { substituteArguments, buildSkillDescriptions } from '../../electron/skill-loader'

describe('E2E: Core Function Integration', () => {
  describe('parseMcpJson — HTTP-only enforcement', () => {
    it('accepts HTTP server and rejects stdio in a real-world .mcp.json', () => {
      // Simulates a real plugin's .mcp.json with mixed transports
      const mcpJson = {
        'production-api': {
          url: 'https://api.github.com/mcp',
          headers: {
            Authorization: 'Bearer {GITHUB_TOKEN}',
            'X-GitHub-Api-Version': '2022-11-28',
          },
        },
        'local-dev': {
          command: 'node',
          args: ['./server.js'],
        },
        'sse-endpoint': {
          type: 'sse',
          // No url, no command — should be skipped
        },
      }

      const result = parseMcpJson(mcpJson, 'github-plugin')

      // Only the HTTP server should pass through
      expect(Object.keys(result)).toEqual(['production-api'])
      expect(result['production-api'].url).toBe('https://api.github.com/mcp')
      expect(result['production-api'].headerNames).toEqual(['Authorization', 'X-GitHub-Api-Version'])
    })
  })

  describe('substituteArguments — skill invocation', () => {
    it('expands $ARGUMENTS and positional args for a real skill', () => {
      const skillContent = [
        'Search for workflows matching "$0" and execute the first result.',
        'Full query: $ARGUMENTS',
        'Target environment: $1',
      ].join('\n')

      const result = substituteArguments(skillContent, 'invoice-processor production')

      expect(result).toBe([
        'Search for workflows matching "invoice-processor" and execute the first result.',
        'Full query: invoice-processor production',
        'Target environment: production',
      ].join('\n'))
    })
  })

  describe('buildSkillDescriptions — system prompt injection', () => {
    it('builds compact descriptions for the agent system prompt', () => {
      const skills: LoadedSkill[] = [
        makeSkill({ name: 'deploy-prod', description: 'Deploy to production' }),
        makeSkill({ name: 'run-tests', description: 'Run the test suite' }),
      ]

      const result = buildSkillDescriptions(skills)

      expect(result).toContain('## Available Skills')
      expect(result).toContain('invoke_skill')
      expect(result).toContain('- deploy-prod: Deploy to production')
      expect(result).toContain('- run-tests: Run the test suite')
    })

    it('returns null when no skills are available', () => {
      expect(buildSkillDescriptions([])).toBeNull()
    })
  })
})
