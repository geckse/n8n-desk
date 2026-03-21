# PRD: Phase 5 — Plugins, Custom MCP Servers & Skills Marketplace

## Overview

Extend n8n-desk's Workflow mode with a **plugin system**, **custom MCP server support**, and a **skills engine** so the agent can use tools beyond n8n's built-in 13 MCP tools. Users browse a marketplace to install pre-built plugins (GitHub, Slack, Linear, Notion, etc.), quick-add standalone HTTP MCP servers, and create reusable prompt-based skills — all from a unified Settings UI and an in-chat popover. The system adopts the **Claude Code plugin format** (`.claude-plugin/plugin.json` + `.mcp.json` + `marketplace.json`) for ecosystem compatibility. Both agent backends — Claude Agent SDK and Deep Agents/LangChain — consume the same plugin and skill configurations through a unified `PluginManager` in the Electron main process.

**Security posture:** HTTP-only. No local code execution. No stdio/SSE transports. Plugin auth secrets stored per-plugin in the OS keychain. n8n OAuth tokens are never exposed to plugin servers.

## Problem Statement

After Phase 4, users can build and manage n8n workflows conversationally — but the agent's toolset is limited to n8n's 13 built-in MCP tools. To create a GitHub issue from a workflow result, check a Slack channel, query a database, or search the web, users must leave n8n-desk and perform those actions manually. There is no way to extend the agent with additional tools, and no mechanism for reusable prompt templates (skills) that encode domain knowledge for recurring tasks.

The Claude Code ecosystem already has a mature plugin system with an official marketplace containing integrations for GitHub, Slack, Linear, Notion, Figma, Sentry, and more. Rather than building a proprietary plugin format, n8n-desk should adopt this standard to gain immediate access to the existing catalog and ensure forward compatibility.

## Goals

- Users can browse and install plugins from marketplaces (including the official Anthropic marketplace) via a Discover tab in Settings
- Users can quick-add standalone HTTP MCP servers by entering a URL and auth headers, without needing the full plugin ceremony
- Users can toggle plugins and servers on/off from an in-chat popover without leaving the conversation
- Installed plugin tools are available to the agent alongside n8n's built-in tools — same behavior on both Claude SDK and Deep Agents backends
- Users can create, edit, and delete **skills** (reusable prompt templates) via a form-based Settings UI
- Skills use **lazy context expansion**: only descriptions are in the system prompt; full content loads on-demand when the agent invokes the skill
- Users can manually invoke skills via `/skill-name` with autocomplete in the chat input
- All plugin auth secrets (Bearer tokens, API keys) are stored in the OS keychain, never in plaintext config files
- The n8n MCP OAuth token is never sent to any plugin server — complete credential isolation
- Plugins declaring stdio/SSE transports are rejected with a clear warning (HTTP-only enforcement)
- On first launch, the official Anthropic marketplace is auto-seeded so users have immediate access to curated integrations

## Non-Goals

- No stdio or SSE MCP transport support — HTTP only, no local code execution
- No plugin hooks execution (the `hooks/hooks.json` from Claude Code plugin format is parsed but not executed in n8n-desk)
- No plugin agents (the `agents/` directory from Claude Code plugins is not used — n8n-desk has its own agent system)
- No LSP server support from plugins
- No auto-update of plugins (manual refresh via UI in MVP)
- No plugin creation UI (users who want to create plugins author them as directories; n8n-desk only consumes them)
- No cross-instance plugin configs — plugins are global, standalone MCP servers are per-instance
- No Cowork mode integration (Cowork mode will use the same plugin infrastructure in a future phase)
- No mobile support — plugins require Electron main process for keychain access and MCP HTTP calls

## Technical Design

### Data Model Changes

**New file: `src/types/plugin.ts`** — All plugin, marketplace, server, skill, and tool types:

```ts
// --- Standalone MCP Server (quick-add) ---

export interface StandaloneMcpServer {
  id: string                    // nanoid
  name: string                  // user-visible label
  description?: string
  url: string                   // MCP server HTTP endpoint URL
  headerNames?: string[]        // auth header names (values stored in OS keychain)
  enabled: boolean
  requireApproval: boolean      // gate ALL tools from this server behind approval
  addedAt: string               // ISO 8601
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
  url: string                   // HTTP endpoint URL
  headerNames?: string[]        // header names (values in keychain)
}

export interface InstalledPlugin {
  id: string                    // derived from name@marketplace
  name: string
  marketplace?: string          // marketplace name if installed from one
  pluginDir: string             // absolute path to cached plugin directory
  manifest?: PluginManifest
  mcpServers?: Record<string, PluginMcpServerConfig>  // parsed from .mcp.json (HTTP only)
  enabled: boolean
  installedAt: string           // ISO 8601
}

// --- Marketplace (Claude Code marketplace format) ---

export interface MarketplaceSource {
  source: 'github' | 'url' | 'local'
  repo?: string                 // for github: "owner/repo"
  url?: string                  // for url/local
  ref?: string                  // branch/tag
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
  id: string                    // derived from kebab-case name
  name: string
  owner: { name: string; email?: string }
  source: MarketplaceSource
  plugins: MarketplacePluginEntry[]
  addedAt: string               // ISO 8601
  autoUpdate: boolean
}

// --- Skill (Agent Skills open standard — SKILL.md format) ---

export interface LoadedSkill {
  name: string                  // kebab-case, becomes /skill-name
  description: string           // injected into system prompt for auto-invocation
  content: string               // full SKILL.md body (after frontmatter)
  disableModelInvocation: boolean  // true = manual only
  userInvocable: boolean           // false = agent-only (hidden from / menu)
  allowedTools?: string[]          // restrict agent tool access when skill is active
  directory: string                // absolute path to skill dir (for supporting files)
  source: 'user' | string         // 'user' or plugin name
}

// --- Discovered tool (from any MCP server) ---

export interface DiscoveredTool {
  serverName: string            // plugin name or standalone server name
  name: string                  // original tool name from MCP listTools()
  description?: string
  inputSchema?: Record<string, unknown>  // JSON Schema from MCP
}
```

**Expand `electron/agent/types.ts`** — Add fields to `AgentRunnerConfig`:

```ts
export interface AgentRunnerConfig {
  instanceUrl: string
  accessToken: string
  llmConfig: LlmProviderConfig
  systemPrompt: string
  interruptOnTools?: string[]
  // NEW: custom plugin tools
  customMcpServers?: Record<string, { type: 'http'; url: string; headers: Record<string, string> }>
  customTools?: unknown[]       // pre-built LangChain tools for Deep Agents
  skills?: LoadedSkill[]        // loaded skills for Deep Agents invoke_skill tool
}
```

### Persistence Layout

```
~/.n8n-desk/
├── plugins/
│   ├── installed.json                    # Array<InstalledPlugin>
│   ├── marketplaces.json                 # Array<Marketplace>
│   └── cache/
│       ├── github@claude-plugins-official/   # cached plugin directory
│       │   ├── .claude-plugin/plugin.json
│       │   ├── .mcp.json
│       │   └── skills/
│       └── slack@claude-plugins-official/
├── skills/                               # user-created skills (global)
│   ├── invoice-processor/
│   │   └── SKILL.md
│   └── code-reviewer/
│       ├── SKILL.md
│       └── examples.md
├── instances/
│   └── {instance-id}/
│       └── mcp-servers.json              # Array<StandaloneMcpServer> (per-instance)
```

**Keychain entries** (per-plugin, namespaced):
```
n8n-desk:plugin:{pluginId}:{headerName} → header value
n8n-desk:server:{serverId}:{headerName} → header value
```

### Interface Changes

**New IPC channels** (registered in `electron/ipc/plugins.ts`):

| Channel | Direction | Purpose |
|---|---|---|
| `plugins:marketplace-list` | renderer → main | List added marketplaces |
| `plugins:marketplace-add` | renderer → main | Add marketplace by source |
| `plugins:marketplace-remove` | renderer → main | Remove marketplace + its plugins |
| `plugins:marketplace-refresh` | renderer → main | Re-fetch marketplace catalog |
| `plugins:browse` | renderer → main | List available plugins from marketplaces |
| `plugins:installed-list` | renderer → main | List installed plugins |
| `plugins:install` | renderer → main | Install plugin from marketplace |
| `plugins:uninstall` | renderer → main | Uninstall plugin + delete keychain secrets |
| `plugins:enable` | renderer → main | Enable a disabled plugin |
| `plugins:disable` | renderer → main | Disable plugin without uninstalling |
| `plugins:preview-install` | renderer → main | Parse plugin, return URLs + required headers + tool count |
| `plugins:servers-list` | renderer → main | List standalone servers for active instance |
| `plugins:servers-add` | renderer → main | Add standalone MCP server |
| `plugins:servers-update` | renderer → main | Update standalone server config |
| `plugins:servers-remove` | renderer → main | Remove standalone server |
| `plugins:servers-test` | renderer → main | Discover tools from a server URL |
| `plugins:set-secret` | renderer → main | Store header value in keychain |
| `plugins:delete-secrets` | renderer → main | Delete all keychain entries for a plugin |
| `plugins:list-skills` | renderer → main | List all available skills (plugins + user-created) |
| `plugins:save-skill` | renderer → main | Save a user-created skill to disk |
| `plugins:delete-skill` | renderer → main | Delete a user-created skill |

**Preload bridge addition** (`electron/preload.ts`):

```ts
plugins: {
  listMarketplaces: () => ipcRenderer.invoke('plugins:marketplace-list'),
  addMarketplace: (source) => ipcRenderer.invoke('plugins:marketplace-add', source),
  removeMarketplace: (id) => ipcRenderer.invoke('plugins:marketplace-remove', id),
  refreshMarketplace: (id) => ipcRenderer.invoke('plugins:marketplace-refresh', id),
  browse: (marketplaceId?) => ipcRenderer.invoke('plugins:browse', marketplaceId),
  listInstalled: () => ipcRenderer.invoke('plugins:installed-list'),
  install: (name, marketplace) => ipcRenderer.invoke('plugins:install', name, marketplace),
  uninstall: (id) => ipcRenderer.invoke('plugins:uninstall', id),
  enable: (id) => ipcRenderer.invoke('plugins:enable', id),
  disable: (id) => ipcRenderer.invoke('plugins:disable', id),
  previewInstall: (name, marketplace) => ipcRenderer.invoke('plugins:preview-install', name, marketplace),
  listServers: () => ipcRenderer.invoke('plugins:servers-list'),
  addServer: (config) => ipcRenderer.invoke('plugins:servers-add', config),
  updateServer: (id, updates) => ipcRenderer.invoke('plugins:servers-update', id, updates),
  removeServer: (id) => ipcRenderer.invoke('plugins:servers-remove', id),
  testServer: (url, headers) => ipcRenderer.invoke('plugins:servers-test', url, headers),
  setSecret: (namespace, key, value) => ipcRenderer.invoke('plugins:set-secret', namespace, key, value),
  listSkills: () => ipcRenderer.invoke('plugins:list-skills'),
  saveSkill: (skill) => ipcRenderer.invoke('plugins:save-skill', skill),
  deleteSkill: (name) => ipcRenderer.invoke('plugins:delete-skill', name),
},
```

### Security Architecture

**HTTP-only enforcement:**
- Only `StreamableHTTPClientTransport` is used for plugin MCP servers
- If `.mcp.json` declares a `command` field (stdio), skip that server and emit a warning to the renderer
- No child process spawning, no `StdioClientTransport`, no `SSEClientTransport`

**Credential isolation:**
- n8n MCP Bearer token → only sent to `{instanceUrl}/mcp-server/http`
- Plugin auth headers → stored in keychain under `n8n-desk:plugin:{pluginId}:{headerName}`, only sent to that plugin's HTTP URL
- Standalone server auth headers → stored under `n8n-desk:server:{serverId}:{headerName}`, only sent to that server's URL
- No cross-contamination: the `PluginManager.buildClaudeSdkMcpServers()` and `buildDeepAgentsTools()` functions assemble per-server header maps that never mix credentials

**Install-time transparency:**
- Before confirming install, the UI calls `plugins:preview-install` which returns: HTTP URLs, required header names, and discovered tool count
- The `InstallConfirmDialog` shows this information with an info callout: "Plugins connect to remote HTTP servers only. No code runs locally."

### Dual-Backend Bridge

The `PluginManager` produces two outputs from the same plugin/server configs:

**For Claude SDK** (`buildClaudeSdkMcpServers`): Returns a `Record<string, object>` merged into `query()`'s `mcpServers` config:
```ts
{
  'n8n': { type: 'http', url: '...', headers: { Authorization: 'Bearer ...' } },
  'github': { type: 'http', url: 'https://...', headers: { Authorization: 'Bearer ghp_xxx' } },
  'my-api': { type: 'http', url: 'https://...', headers: { 'X-API-Key': 'sk-xxx' } },
}
```

**For Deep Agents** (`buildDeepAgentsTools`): Calls `listToolsWithUrl()` on each server, wraps discovered tools as LangChain `tool()` objects with Zod schemas (via `jsonSchemaToZod()`), namespaced as `{serverName}__{toolName}`.

### Skills Engine

Skills are **lazy context expansion** — the agent only sees short descriptions in its system prompt. Full skill content loads on-demand when the agent decides to invoke a skill.

**Claude SDK backend**: Skills are native. Plugin directories containing `skills/` are passed via `--plugin-dir` flags. The Claude Code subprocess handles auto-invocation, description matching, `$ARGUMENTS` substitution.

**Deep Agents backend**: Skills are bridged via an `invoke_skill` LangChain tool:
1. At invocation time, all SKILL.md files are parsed (frontmatter + content)
2. Auto-invocable skill **descriptions** are appended to the system prompt
3. An `invoke_skill` tool is added that returns the full skill content when called
4. The agent calls `invoke_skill({ skillName, arguments })` → receives expanded prompt instructions
5. User-invoked skills (via `/skill-name args`) are resolved in the renderer and sent as the user message

### New UI Components

| Component | File | Purpose |
|---|---|---|
| `PluginSettings` | `src/components/settings/PluginSettings.vue` | 4-tab settings: Installed / Discover / Marketplaces / Skills |
| `PluginCard` | `src/components/plugins/PluginCard.vue` | Marketplace plugin card with Install button |
| `McpServerCard` | `src/components/plugins/McpServerCard.vue` | Standalone server card with toggle and edit |
| `AddServerForm` | `src/components/plugins/AddServerForm.vue` | Form for quick-adding HTTP MCP servers |
| `InstallConfirmDialog` | `src/components/plugins/InstallConfirmDialog.vue` | Security confirmation before plugin install |
| `PluginPopover` | `src/components/plugins/PluginPopover.vue` | In-chat popover for toggling plugins/servers |
| `SkillEditor` | `src/components/plugins/SkillEditor.vue` | Form UI for creating/editing skills |
| `SkillCard` | `src/components/plugins/SkillCard.vue` | Skill display card with mode badge |

### Migration Strategy

No data migration needed. This is additive:
- New `~/.n8n-desk/plugins/` directory created on first access
- New `~/.n8n-desk/skills/` directory created on first skill save
- New `mcp-servers.json` created per-instance on first server add
- Official Anthropic marketplace auto-seeded on first launch
- Existing Phase 4 Workflow mode continues working unchanged — n8n's 13 built-in MCP tools remain the default, plugins add alongside them

## Implementation Steps

1. **Create type definitions** — Create `src/types/plugin.ts` with all interfaces: `StandaloneMcpServer`, `PluginManifest`, `PluginMcpServerConfig`, `InstalledPlugin`, `MarketplaceSource`, `MarketplacePluginEntry`, `Marketplace`, `LoadedSkill`, `DiscoveredTool`. Update `src/env.d.ts` to add `plugins` to the `N8nDeskBridge` interface.

2. **Generalize MCP client** — Modify `electron/mcp-client.ts` to add `callToolWithUrl(url, headers, toolName, args)` and `listToolsWithUrl(url, headers)`. These are thin wrappers around the existing `withClient` pattern using `StreamableHTTPClientTransport` with configurable URL + headers instead of the hardcoded n8n endpoint. Keep existing `callTool()` and `listTools()` unchanged.

3. **Add JSON Schema → Zod converter** — In `electron/agent/tool-definitions.ts`, add `jsonSchemaToZod(schema)` that converts MCP `listTools()` JSON Schema responses to Zod objects. Handle string, number, integer, boolean, array, object (with properties), enum, required fields. Fall back to `z.any()` for complex types. Add `createDynamicMcpTools(servers)` that calls `listToolsWithUrl()` on each server and wraps discovered tools as LangChain `tool()` objects with namespaced names (`{serverName}__{toolName}`).

4. **Build Plugin Manager** — Create `electron/plugin-manager.ts` as the central module. Implement: marketplace CRUD (`addMarketplace`, `removeMarketplace`, `listMarketplaces`, `refreshMarketplace`, `browsePlugins`), plugin lifecycle (`installPlugin`, `uninstallPlugin`, `enablePlugin`, `disablePlugin`, `listInstalledPlugins`), standalone server CRUD (`listStandaloneServers`, `addStandaloneServer`, `updateStandaloneServer`, `removeStandaloneServer`), tool discovery (`discoverTools`), and backend builders (`buildClaudeSdkMcpServers`, `buildDeepAgentsTools`). For `installPlugin`: clone/copy plugin dir to `~/.n8n-desk/plugins/cache/`, parse `.claude-plugin/plugin.json` and `.mcp.json`, reject stdio servers with warning, return install preview. On first access, auto-seed the official Anthropic marketplace from `{ source: 'github', repo: 'anthropics/claude-code' }`.

5. **Build Skill Loader** — Create `electron/skill-loader.ts` with: `parseSkillMd(filePath)` to parse YAML frontmatter + markdown content, `loadAllSkills()` to scan plugins' `skills/` dirs and `~/.n8n-desk/skills/`, `buildSkillDescriptions(skills)` to create the compact description block for the system prompt, `substituteArguments(content, args)` for `$ARGUMENTS`, `$0`, `$1` replacement, and `readSupportingFile(skill, relativePath)` for loading referenced files.

6. **Extend agent runner config** — Modify `electron/agent/types.ts` to add `customMcpServers`, `customTools`, and `skills` fields to `AgentRunnerConfig`.

7. **Update Claude SDK runner** — In `electron/agent/claude-sdk-runner.ts` (line ~147), merge `config.customMcpServers ?? {}` into the `mcpServers` object alongside the `'n8n'` entry. For plugins with skills, pass their directories via additional entries if the SDK supports `--plugin-dir`.

8. **Update Deep Agents runner** — In `electron/agent/deep-agents-runner.ts` (line ~111), merge `config.customTools ?? []` into the tools array alongside `createMcpTools()`. If `config.skills` is provided and non-empty, create the `invoke_skill` LangChain tool and add it to the tool array.

9. **Create IPC handlers** — Create `electron/ipc/plugins.ts` registering all `plugins:*` IPC handlers that delegate to `plugin-manager.ts` and `skill-loader.ts`. Include secret management handlers that delegate to the existing keychain IPC. Register handlers in `electron/main.ts`.

10. **Update preload bridge** — Add the full `plugins` namespace to `electron/preload.ts` with all IPC methods.

11. **Update agent invocation** — Modify `electron/ipc/agent.ts`: after loading LLM + instance config, import `pluginManager` and `skillLoader`. Build backend-specific tool configs. Compute `interruptOnTools` (built-in destructive tools + all tools from `requireApproval` servers). Load skills and inject descriptions into the system prompt. Pass `customMcpServers`/`customTools`/`skills` in `AgentRunnerConfig`.

12. **Create Pinia store** — Create `src/stores/plugins.ts` with refs for `marketplaces`, `installedPlugins`, `standaloneServers`, `availablePlugins`, `skills`, and `loading`. Add computed properties for `enabledPlugins`, `enabledServers`, `userInvocableSkills`. Implement `hydrate()`, marketplace ops, plugin ops, server ops, skill ops — all delegating to `window.n8nDesk.plugins.*`.

13. **Build PluginSettings component** — Create `src/components/settings/PluginSettings.vue` with 4 tabs using `IonSegment` (mode="ios"): **Installed** (plugins + standalone servers with toggles), **Discover** (marketplace browser with search/filter and install buttons), **Marketplaces** (add/remove marketplace sources), **Skills** (user-created + plugin skills with create/edit/delete). Import and use `PluginCard`, `McpServerCard`, `AddServerForm`, `SkillEditor`, `SkillCard`.

14. **Build plugin sub-components** — Create `PluginCard.vue` (name, description, category badge, version, Install/Installed button), `McpServerCard.vue` (name, HTTP badge, tool count, IonToggle, edit/trash), `AddServerForm.vue` (name, URL, auth headers key-value pairs with keychain storage, requireApproval toggle, Test Connection button), `InstallConfirmDialog.vue` (security confirmation with URL display, header inputs, tool count, info callout).

15. **Build skill sub-components** — Create `SkillEditor.vue` with form fields: name (ion-input), description (ion-textarea), instructions (ion-textarea, large), invocation mode (ion-segment: Auto+Manual / Manual only / Agent only), allowed tools (ion-select, multiple), SKILL.md preview (read-only code block). Create `SkillCard.vue` with name, description, mode badge, source badge, edit/delete.

16. **Integrate into AppSettings** — Modify `src/components/settings/AppSettings.vue`: add `Plug` icon import from lucide-vue-next, add `SettingsNavItem` for "Plugins" in the Preferences group (between "AI / Agent" and Instances). Add content section rendering `<PluginSettings />` when `activeSection === 'plugins'`.

17. **Build in-chat popover** — Create `src/components/plugins/PluginPopover.vue`: lightweight IonPopover showing enabled plugins/servers with toggles, quick-add URL input, "Open Settings" link. Modify `src/components/workflow/WorkflowChatPanel.vue`: add Plug icon button in chat toolbar that opens the popover. Add `/` skill autocomplete: when user types `/`, show popover with user-invocable skills. On send with `/skill-name args`, resolve skill, substitute `$ARGUMENTS`, send processed content.

18. **Add i18n strings** — Add all new translation keys to the i18n locale files for plugin settings labels, marketplace UI, skill editor placeholders, confirmation dialogs, and error messages.

## Validation Criteria

- [ ] Official Anthropic marketplace auto-seeded on first launch — visible in Marketplaces tab
- [ ] Can browse plugins from marketplace in Discover tab with search/filter
- [ ] Installing an HTTP-based plugin shows security confirmation dialog with URL and required headers
- [ ] Plugin auth headers stored in OS keychain, not in any JSON config file
- [ ] Installed plugin tools available to Claude SDK backend alongside n8n tools
- [ ] Same installed plugin tools available to Deep Agents backend (via LangChain wrappers)
- [ ] Quick-add standalone HTTP MCP server via Settings form — Test Connection discovers tools
- [ ] Standalone server tools available to both agent backends
- [ ] In-chat popover shows enabled plugins/servers with toggle — toggling off removes tools from next invocation
- [ ] Marketplace plugin declaring stdio server is skipped with clear warning
- [ ] n8n OAuth token never sent to any plugin/standalone server URL
- [ ] Plugin A's auth headers never sent to Plugin B's URL
- [ ] Uninstalling a plugin deletes its keychain secrets and cache directory
- [ ] Skill created via SkillEditor form is saved as valid SKILL.md and appears in skill list
- [ ] Skill with `disable-model-invocation: false` — agent auto-invokes it when context matches (Deep Agents: via `invoke_skill` tool; Claude SDK: native)
- [ ] Skill with `disable-model-invocation: true` — only invocable via `/skill-name` in chat input
- [ ] System prompt contains ONLY skill descriptions (1-2 lines each), NOT full skill content — lazy loading verified
- [ ] `/skill-name args` autocomplete works in chat input — substitutes `$ARGUMENTS` correctly
- [ ] `requireApproval: true` on a standalone server gates ALL its tools behind the approval card
- [ ] Adding a custom marketplace via GitHub `owner/repo` works — plugins browsable after refresh
- [ ] Graceful degradation: unreachable plugin server doesn't prevent n8n tools or other servers from working
- [ ] All existing Phase 4 Workflow mode tests still pass (no regression)

## Anti-Patterns to Avoid

- **Do NOT support stdio or SSE transports** — Only HTTP MCP servers. stdio enables arbitrary local code execution which is a security risk. If the Claude Code plugin format declares a `command` field, skip that server entry. Do NOT import `StdioClientTransport` or spawn child processes.

- **Do NOT store auth header values in JSON config files** — Header names go in `mcp-servers.json` / `installed.json`. Actual secret values go ONLY in the OS keychain via `safeStorage`. This mirrors the existing pattern for n8n OAuth tokens in `tokens.enc`.

- **Do NOT send n8n tokens to plugin servers** — The `buildClaudeSdkMcpServers()` and `buildDeepAgentsTools()` functions must assemble per-server header maps. Never include the n8n Bearer token in a plugin server's headers.

- **Do NOT load full skill content into the system prompt** — Only inject the short `description` field. Full content must load lazily when the agent calls `invoke_skill` (Deep Agents) or the SDK auto-invokes it (Claude SDK). Loading all skill content upfront wastes context window.

- **Do NOT create persistent MCP connections for plugin servers** — Follow the existing stateless pattern in `electron/mcp-client.ts`: fresh `StreamableHTTPClientTransport` per call, close after. This avoids connection lifecycle management and is consistent with how n8n's MCP server is called.

- **Do NOT put plugin components inside `.claude-plugin/` directory** — When parsing plugins, only `plugin.json` lives inside `.claude-plugin/`. Skills, agents, hooks, and `.mcp.json` are at the plugin root. Follow the Claude Code plugin directory structure.

- **Do NOT mix global and per-instance state** — Plugins and marketplaces are global (`~/.n8n-desk/plugins/`). Standalone MCP servers are per-instance (`~/.n8n-desk/instances/{id}/mcp-servers.json`). Skills are global (`~/.n8n-desk/skills/`). Do not conflate these scopes.

- **Do NOT use `any` for LangChain tool types in new code** — The existing `tool-definitions.ts` uses `type LangChainTool = any` as a workaround. For new `createDynamicMcpTools`, import the actual `StructuredTool` type from `@langchain/core/tools` if possible, or at minimum add `eslint-disable` comments explaining why.

## Patterns to Follow

- **IPC handler pattern:** Follow `electron/ipc/agent.ts` — register handlers in a `registerPluginHandlers(mainWindow)` function, use `ipcMain.handle()` for request-response, read config from `~/.n8n-desk/` via `fs.readFile`, handle errors gracefully and return `{ success, error? }` objects.

- **Preload bridge pattern:** Follow `electron/preload.ts` — each IPC namespace is a plain object with methods mapping to `ipcRenderer.invoke()`. Typed via `contextBridge.exposeInMainWorld()`.

- **MCP client pattern:** Follow `electron/mcp-client.ts` `withClient()` — create transport + client, execute callback, close in `finally`. Detect 401 and throw `McpUnauthorizedError`. Keep calls stateless.

- **LangChain tool wrapping pattern:** Follow `electron/agent/tool-definitions.ts` `mcpTool()` — use `tool()` from `@langchain/core/tools` with Zod schema. Call through `callToolWithUrl()` instead of `callTool()` for custom servers.

- **Pinia store pattern:** Follow `src/stores/settings.ts` — Composition API with `ref`, `computed`, `async function`. Hydrate from IPC on mount, flush changes via IPC on mutation. No Pinia persistence plugins.

- **Settings UI pattern:** Follow `src/components/settings/AppSettings.vue` + `LlmSettings.vue` — use `SettingsNavItem` for sidebar navigation, `ion-segment` (mode="ios") for tabs, `ion-input` with `fill="outline"` and `label-placement="stacked"` for form fields, `ion-button` for actions.

- **Component naming:** Follow existing structure — settings components in `src/components/settings/`, feature components in `src/components/plugins/`. PascalCase component names, kebab-case file names.

- **Keychain usage:** Follow existing pattern in `electron/ipc/agent.ts` `readTokens()` / `storeTokens()` — use `safeStorage.encryptString()` / `safeStorage.decryptString()` with namespaced keys. The existing `window.n8nDesk.keychain.*` IPC bridge handles the Electron ↔ renderer boundary.

- **Error handling in renderers:** Follow existing Vue composable pattern — wrap IPC calls in try/catch, surface errors via reactive `ref<string>('')` state shown in the UI, never throw unhandled promises.
