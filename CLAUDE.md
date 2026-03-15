# CLAUDE.md — n8n-desk Build Guide

> Technical instructions for building n8n-desk. Read this before writing any code.

---

## Project State

This is a **greenfield project** — no source code exists yet. The `n8n-master/` directory is a read-only reference copy of the n8n monorepo (gitignored). All spec docs (`PROJECT.md`, `AUTHFLOW_AND_MCPTOOLS.md`, `CHATHUB.md`, `COMPONENT_AND_DESIGN.md`, `WORKFLOW_EMBED.md`) describe what to build. This file describes **how**.

---

## Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Framework | **Ionic 8 + Vue 3** (`<script setup>`, Composition API) | Single codebase for all platforms |
| Language | **TypeScript** (strict mode) | No `any` — use proper types |
| Build | **Vite** | Via `@ionic/vue` toolchain |
| Desktop | **Electron** (via Capacitor or Electron Forge) | Working directory model for Cowork/Workflow modes |
| Mobile | **Capacitor** (iOS/Android) | Native shell for Ionic app |
| State | **Pinia** | In-memory reactive state, hydrated from local storage |
| Local storage | **`~/.n8n-desk/`** | All persistent data — config, sessions, tokens |
| Routing | **Vue Router** with Ionic's `IonRouterOutlet` | Tab-based top-level nav (Chat/Cowork/Workflow) |
| Agent | **Deep Agents SDK** (`deepagents` + `langchain` + `@langchain/core`) | Local agent for Cowork and Workflow modes |
| HTTP | **ofetch** or **ky** | Lightweight, TypeScript-first fetch wrapper |
| WebSocket | Native WebSocket or **reconnecting-websocket** | For Chat-Hub streaming |
| Styling | **SCSS** with n8n design tokens + Ionic CSS variables | See theming section |
| Testing | **Vitest** (unit), **Cypress** (e2e) | |

---

## Project Structure

```
n8n-desk/
├── CLAUDE.md
├── PROJECT.md, AUTHFLOW_AND_MCPTOOLS.md, etc.
├── package.json
├── tsconfig.json
├── vite.config.ts
├── ionic.config.json
├── capacitor.config.ts
├── index.html
├── src/
│   ├── main.ts                        # App entry, Ionic + Pinia + Router setup
│   ├── App.vue                        # Root component with IonApp
│   ├── router/
│   │   └── index.ts                   # Tab-based routing (Chat/Cowork/Workflow)
│   ├── views/
│   │   ├── OnboardingView.vue         # First-run wizard (connect → login → done)
│   │   ├── ChatView.vue               # Chat mode — thin client to Chat-Hub
│   │   ├── CoworkView.vue             # Cowork mode — local agent + workflow tools
│   │   ├── WorkflowView.vue           # Workflow mode — MCP CRUD agent
│   │   └── SettingsView.vue           # Connection, auth, LLM provider config
│   ├── components/
│   │   ├── chat/                      # Chat UI (forked from n8n AskAssistant)
│   │   │   ├── ChatMessageList.vue
│   │   │   ├── ChatMessage.vue
│   │   │   ├── ChatInput.vue
│   │   │   └── AgentSidebar.vue
│   │   ├── workflow/                  # Workflow visualization
│   │   │   └── WorkflowPreview.vue    # Wraps <n8n-demo> web component
│   │   ├── instance/                  # Instance management
│   │   │   └── InstanceSwitcher.vue   # Header instance indicator + switcher popover
│   │   └── ui/                        # Shared UI components
│   ├── composables/
│   │   ├── useAuth.ts                 # OAuth2 PKCE flow
│   │   ├── useChatHub.ts              # Chat-Hub REST + WebSocket
│   │   ├── useMcp.ts                  # MCP tool calls
│   │   ├── useCoworkAgent.ts          # Cowork mode deep agent (read-only workflows as tools)
│   │   ├── useWorkflowAgent.ts        # Workflow mode deep agent (MCP CRUD tools)
│   │   ├── useConnection.ts           # Connection state (online/offline/reconnecting)
│   │   └── useTheme.ts               # Light/dark theme sync
│   ├── stores/
│   │   ├── instances.ts               # Registered n8n instances, active instance
│   │   ├── auth.ts                    # Token state, user role, scopes (per active instance)
│   │   ├── chat.ts                    # Sessions, messages, agents (hydrated from JSONL)
│   │   ├── workflows.ts              # Workflow cache, search results
│   │   └── settings.ts               # Global app config (hydrated from config.json)
│   ├── services/
│   │   ├── local-storage.ts           # Read/write ~/.n8n-desk/ files (JSONL, JSON)
│   │   ├── n8n-api.ts                 # Base HTTP client (auth headers, refresh)
│   │   ├── chathub.ts                 # Chat-Hub REST endpoints
│   │   ├── chathub-stream.ts          # WebSocket streaming client
│   │   └── mcp.ts                     # MCP tool invocations
│   ├── types/
│   │   ├── chathub.ts                 # Chat-Hub API types (mirrored from n8n)
│   │   ├── mcp.ts                     # MCP tool request/response types
│   │   └── agent.ts                   # Agent message, plan, tool-call types
│   ├── theme/
│   │   ├── n8n-tokens.scss            # Copied from n8n design system
│   │   ├── variables.scss             # Ionic CSS variable overrides
│   │   └── global.scss                # App-wide styles
│   └── utils/
│       ├── markdown.ts                # Markdown rendering (from n8n)
│       └── sanitize.ts                # HTML sanitization (from n8n v-n8n-html)
├── electron/                          # Electron main process (desktop)
│   ├── main.ts                        # App lifecycle, window management
│   ├── preload.ts                     # contextBridge — exposes IPC to renderer
│   ├── ipc/                           # IPC handler registration
│   │   ├── agent.ts                   # agent:invoke, agent:stop, agent:approve
│   │   ├── api-proxy.ts              # api:fetch — CORS-free HTTP proxy for renderer
│   │   ├── auth.ts                    # auth:login, auth:logout, auth:refresh
│   │   ├── storage.ts                 # storage:read, storage:write, storage:append
│   │   └── keychain.ts               # keychain:get, keychain:set, keychain:delete
│   └── agent-runner.ts               # Creates and runs Deep Agents in main process
├── n8n-master/                        # Reference only — gitignored
└── public/
```

---

## Critical Patterns

### Ionic Vue — Use Platform-Adaptive Components

Always use Ionic components (`IonPage`, `IonContent`, `IonHeader`, `IonToolbar`, `IonTabs`, `IonList`, etc.) for layout and navigation. They handle iOS/Android/desktop styling automatically. Do NOT build custom layout primitives.

```vue
<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-title>Chat</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <!-- content here -->
    </ion-content>
  </ion-page>
</template>
```

### Vue 3 Composition API Only

All components use `<script setup lang="ts">`. No Options API. No `defineComponent()` unless needed for dynamic components.

### Pinia Stores — In-Memory, Hydrated from Disk

Pinia holds reactive state in memory. On startup, stores hydrate from `~/.n8n-desk/`. On mutation, they flush changes back via `local-storage.ts`. No Pinia persistence plugins — we control the format (JSONL for sessions, JSON for config).

```ts
export const useAuthStore = defineStore('auth', () => {
  const accessToken = ref<string | null>(null)
  const userRole = ref<UserRole>('unknown')
  const scopes = ref<string[]>([])

  const isFullAccess = computed(() => userRole.value !== 'chatUser')

  async function hydrate() {
    const authMeta = await localStore.readJson('auth.json')
    // tokens loaded from OS keychain, not from disk
  }

  return { accessToken, userRole, scopes, isFullAccess, hydrate }
})
```

### Service Layer — Keep API Calls Out of Components

Components call composables. Composables call services. Services make HTTP/WebSocket calls. Never put `fetch()` directly in a component.

```
Component → Composable → Service → IPC api:fetch proxy → n8n API
                           ↕
                     local-storage.ts → ~/.n8n-desk/
```

**Important:** Never use native `fetch()` for n8n API calls in the renderer — it will fail with CORS errors. Always use `N8nApiClient` (which routes through `api:fetch` IPC) or `window.n8nDesk.api.fetch()` directly.

---

## Two API Channels

n8n-desk communicates with n8n through two separate channels. Both share the same OAuth2 bearer token.

### 1. Chat-Hub API (Chat mode)

- **REST**: `POST /chat/conversations/send`, `GET /chat/conversations`, etc.
- **WebSocket**: Push events for streaming (`ChatHubStreamChunk`, etc.)
- Handles: conversations, agents, models, streaming responses
- See `CHATHUB.md` for full endpoint list and types

### 2. MCP Tools (Cowork + Workflow modes)

- 13 tools for workflow lifecycle: search, build, validate, create, execute, manage
- Called via the n8n MCP server with bearer token auth
- See `AUTHFLOW_AND_MCPTOOLS.md` for full tool list and scope mapping

### Shared Concerns

- **Base HTTP client** (`services/n8n-api.ts`): attach bearer token, handle 401 → refresh token, base URL from active instance config
- **CORS proxy**: all REST calls from the renderer are proxied through `api:fetch` IPC — n8n does not set CORS headers on its API endpoints
- **Instance-scoped**: all API clients are parameterized by instance — switching instances swaps the base URL and token
- **Connection state**: track online/offline for both channels, surface in UI
- **Error handling**: normalize errors from both APIs into a consistent format

---

## Electron IPC Architecture

The agent (Deep Agents SDK) requires Node.js APIs, so it runs in the **main process**. The Vue UI runs in the **renderer** (sandboxed, `nodeIntegration: false`). All cross-boundary communication goes through typed IPC channels via `contextBridge`.

### Channel-Per-Domain Pattern

Use one IPC channel per domain. Each channel has typed request/response shapes:

| Channel | Direction | Purpose |
|---|---|---|
| `agent:invoke` | renderer → main | Start an agent session with a user message |
| `agent:event` | main → renderer | Stream agent events (text chunks, tool calls, todos) |
| `agent:stop` | renderer → main | Cancel a running agent session |
| `agent:approve` | renderer → main | Approve/reject a human-in-the-loop interrupt |
| `auth:login` | renderer → main | Initiate OAuth flow for an instance |
| `auth:logout` | renderer → main | Revoke tokens and clear keychain |
| `auth:refresh` | renderer → main | Force token refresh |
| `storage:read` | renderer → main | Read from `~/.n8n-desk/` |
| `storage:write` | renderer → main | Write to `~/.n8n-desk/` |
| `storage:append` | renderer → main | Append to JSONL session file |
| `api:fetch` | renderer → main | **HTTP proxy — all n8n API calls from renderer go through this** |
| `keychain:get` | renderer → main | Read secret from OS keychain |
| `keychain:set` | renderer → main | Store secret in OS keychain |

### Preload Script

```ts
// electron/preload.ts
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('n8nDesk', {
  agent: {
    invoke: (sessionId: string, message: string) =>
      ipcRenderer.invoke('agent:invoke', sessionId, message),
    stop: (sessionId: string) =>
      ipcRenderer.invoke('agent:stop', sessionId),
    approve: (sessionId: string, decision: 'approve' | 'reject') =>
      ipcRenderer.invoke('agent:approve', sessionId, decision),
    onEvent: (callback: (event: AgentEvent) => void) =>
      ipcRenderer.on('agent:event', (_, event) => callback(event)),
  },
  storage: {
    read: (path: string) => ipcRenderer.invoke('storage:read', path),
    write: (path: string, data: string) => ipcRenderer.invoke('storage:write', path, data),
    append: (path: string, line: string) => ipcRenderer.invoke('storage:append', path, line),
  },
  // ... auth, keychain
})
```

### What Runs Where

| Process | Responsibilities |
|---|---|
| **Main** | Deep Agents execution, OS keychain access, file I/O (`~/.n8n-desk/`), OAuth redirect handling, MCP tool calls (for agent), **HTTP proxy for all n8n REST API calls** |
| **Renderer** | Vue UI, Pinia stores (in-memory), Chat-Hub WebSocket (direct), theme, routing |

### CORS Constraint — All REST Calls Go Through Main

**n8n does NOT set CORS headers on most API endpoints** (only on OAuth discovery). This means the renderer (`localhost:5173` in dev, `file://` in prod) **cannot directly `fetch()` any n8n REST endpoint** — the browser blocks it.

**Solution:** All n8n HTTP calls from the renderer are proxied through the `api:fetch` IPC channel. The main process makes the actual `fetch()` (Node.js has no CORS restrictions), then returns `{ status, headers, body }` to the renderer.

- `N8nApiClient` (`src/services/n8n-api.ts`) automatically uses `window.n8nDesk.api.fetch()` when running in Electron
- `useConnection` composable uses the same proxy for health checks
- The **only exception** is WebSocket connections — these go direct from the renderer (WebSocket is not subject to the same CORS preflight as fetch)

---

## WebSocket Connection Management

Chat-Hub streams responses via WebSocket push events. One persistent connection per n8n instance.

### Connection Lifecycle

```
App start → connect WebSocket to active instance
         → authenticate with bearer token
         → listen for push events
         → route events by sessionId to the correct chat view

Instance switch → close old WebSocket → open new one
Disconnect → auto-reconnect with exponential backoff
Token refresh → reconnect with new token
```

### Reconnection Strategy

- Use `reconnecting-websocket` with exponential backoff (1s, 2s, 4s, 8s, max 30s)
- On reconnect, call `POST /chat/conversations/:sessionId/reconnect` for any active session to replay missed chunks
- Show a **subtle connection indicator** in the header (green dot = connected, yellow = reconnecting)
- Show a **banner** only if disconnected for more than 3 seconds: "Reconnecting to {instance label}..."
- On permanent failure (e.g., 401 after refresh fails): show "Session expired. Sign in again."

### Event Routing

```ts
// Renderer — single WebSocket, route by sessionId
ws.onMessage((event: ChatHubPushEvent) => {
  const chatStore = useChatStore()
  switch (event.type) {
    case 'ChatHubStreamChunk':
      chatStore.appendChunk(event.sessionId, event.data)
      break
    case 'ChatHubStreamEnd':
      chatStore.finalizeMessage(event.sessionId)
      break
    case 'ChatHubStreamError':
      chatStore.setError(event.sessionId, event.error)
      break
  }
})
```

---

## Multi-Instance UX

### Instance Switcher

- **Top-level indicator** in the header toolbar — shows active instance label + color dot
- Tap/click to open instance list (popover on desktop, action sheet on mobile)
- If only one instance is registered, show a subtle label — no switcher affordance
- "Add instance" option at the bottom of the list → triggers onboarding flow for new instance

### Switching Behavior

Switching instances is a **full context swap**:

1. Close active Chat-Hub WebSocket
2. Reset all Pinia stores (auth, chat, workflows)
3. Rehydrate from `~/.n8n-desk/instances/{new-id}/`
4. Load tokens from keychain (`n8n-desk:{new-id}`)
5. Open new WebSocket to the new instance
6. Land on the last-used mode/session for that instance

Active agent sessions are **stopped** on switch — you cannot run agents against two instances simultaneously in MVP.

### Instance Identity

Each instance has:

```json
{
  "id": "inst_a1b2c3",
  "label": "Production",
  "url": "https://n8n.company.com",
  "color": "#ff6d5a",
  "addedAt": "2026-03-14T10:00:00Z"
}
```

`id` is derived from a hash of the URL at registration time. `label` and `color` are user-editable.

---

## Offline / Disconnected Behavior

### Per-Mode Degradation

| Mode | Online | Offline |
|---|---|---|
| **Chat** | Full functionality | Disabled — input locked, "Can't reach {instance}" message |
| **Cowork** | Full functionality | Partial — works if using Ollama (local LLM), file tools work, n8n workflow tools fail with clear error per call |
| **Workflow** | Full functionality | Disabled — all MCP tools require n8n |
| **Settings** | Full functionality | Always available |

### Session History is Always Readable

Past sessions are stored locally in JSONL. They are **always browsable offline** — read-only, with the input field disabled and a "Reconnect to continue" hint.

### No Action Queuing

Failed API calls fail fast with a clear error. No retry queue, no offline buffer. The user retries manually when reconnected. This avoids stale-state bugs from queued mutations.

### Connection Detection

- **Heartbeat**: ping the n8n instance health endpoint every 30s when the app is focused
- **WebSocket state**: `onclose` / `onerror` events for immediate detection
- **Renderer**: `navigator.onLine` as a fast hint, confirmed by actual API reach
- Store connection state in a `useConnection()` composable — all views react to it

---

## Session Lifecycle

### Creation

A session is created when the user sends the first message in a new conversation. This:
1. Generates a session ID (`session_{nanoid}`)
2. Creates the JSONL file (`{session-id}.jsonl`)
3. Appends the entry to `index.json`

### Growth and Soft Limits

JSONL files are append-only and will grow. Strategy:

- **No hard cutoff** — sessions are never forcibly split or truncated
- **Soft prompt at 5,000 messages**: "This session is getting long. Start a new one to keep things fast?"
- The Deep Agents SDK handles its own context summarization (auto-summarizes at 85% of model's token limit), so long sessions don't break the agent — they just make JSONL files larger on disk

### Deletion

Deleted sessions are **moved to archive**, not hard-deleted:

```
~/.n8n-desk/instances/{id}/sessions/{mode}/.archive/{session-id}.jsonl
```

- Archived sessions are **auto-purged after 30 days** (checked on app startup)
- The archive directory is hidden (dotfile) and not shown in the UI
- "Delete all sessions" moves all to archive, same 30-day retention

### Session Metadata Updates

The `index.json` entry is updated on:
- New message → `updatedAt` and `messageCount`
- Title change (user rename or auto-generated from first message)
- Session delete → entry removed from index, file moved to archive

---

## Onboarding Flow

First-run experience when `~/.n8n-desk/` has no instances configured.

### 3-Step Wizard

```
Step 1: "Connect to n8n"
  → Text input: n8n instance URL (e.g., https://n8n.company.com)
  → "Connect" button
  → Validate URL by hitting /.well-known/oauth-authorization-server

Step 2: "Sign in"
  → Redirect to n8n login page (OAuth2 PKCE flow)
  → User authenticates in n8n's UI
  → Callback returns to n8n-desk with auth code
  → Exchange for tokens, detect role/scopes

Step 3: "You're connected!"
  → Show instance label (editable, defaults to hostname)
  → Show discovered agents count: "Found 5 Workflow Agents"
  → "Get started" → land in Chat mode with agent sidebar populated
```

### Design Constraints

- **Under 30 seconds** from launch to first chat
- **No auto-discovery** (mDNS/Bonjour) in MVP — manual URL entry only
- **No demo/sandbox mode** — connecting to a real instance is fast enough
- After first instance is added, the wizard is accessible via "Add instance" in the instance switcher
- If OAuth fails, show the error inline in Step 2 with a "Try again" button — don't restart the wizard

---

## Auth Flow

OAuth2 Authorization Code + PKCE against n8n's built-in OAuth server.

1. Dynamic client registration → `POST /mcp-oauth/register`
2. Redirect to n8n login → `POST /mcp-oauth/authorize` (with PKCE challenge)
3. Callback with auth code → exchange at `POST /mcp-oauth/token`
4. Store tokens securely (Electron: OS keychain via `safeStorage`; mobile: Capacitor Preferences or Keychain plugin)
5. Refresh on 401 via refresh token grant
6. Detect user role from token scopes → adapt UI (chatUser = Chat mode only, member+ = all modes)

**Platform redirects:**
- Desktop: `http://localhost:{port}/callback`
- Mobile: `n8ndesk://callback` (deep link / custom URL scheme)

---

## Local Agent — Deep Agents SDK

Cowork and Workflow modes each run a **local deep agent** powered by the `deepagents` SDK. Chat mode does NOT use a local agent — it's a thin client to Chat-Hub.

### Three Modes, Two Agent Configs

```
Chat mode       → No local agent. Thin client → Chat-Hub API.
Cowork mode     → Deep agent + n8n workflows as tools + local file tools
Workflow mode   → Deep agent + n8n MCP CRUD tools + <n8n-demo> rendering
```

### Installation

```bash
npm install deepagents langchain @langchain/core
```

### Agent Creation Pattern

Both agents use `createDeepAgent` with different tool sets:

```ts
import { createDeepAgent } from 'deepagents'
import { tool } from 'langchain'
import { z } from 'zod'

// Cowork agent — executes existing workflows, reads/writes local files
const coworkAgent = createDeepAgent({
  name: 'n8n-desk-cowork',
  model: `anthropic:${selectedModel}`,  // or openai:..., ollama:...
  tools: [
    executeWorkflowTool,     // runs n8n workflows by ID
    getExecutionResultTool,  // fetches execution output
    searchWorkflowsTool,     // finds workflows to use
    ...localFileTools,       // read/write in working directory
  ],
  systemPrompt: coworkSystemPrompt,
  backend: coworkBackend,
})

// Workflow agent — creates/edits workflows via MCP
const workflowAgent = createDeepAgent({
  name: 'n8n-desk-workflow',
  model: `anthropic:${selectedModel}`,
  tools: [
    searchNodesTool,         // discover n8n nodes
    getNodeTypesTool,        // get node type definitions
    getSuggestedNodesTool,   // curated node recommendations
    validateWorkflowTool,    // validate SDK code
    createWorkflowTool,      // create from validated code
    updateWorkflowTool,      // update existing workflow
    searchWorkflowsTool,     // find workflows
    getWorkflowDetailsTool,  // inspect workflow
    executeWorkflowTool,     // test execution
    getExecutionTool,        // check execution results
    publishWorkflowTool,     // activate
    unpublishWorkflowTool,   // deactivate
    archiveWorkflowTool,     // archive
  ],
  systemPrompt: workflowSystemPrompt,
  backend: workflowBackend,
})
```

### Wrapping n8n MCP Tools as LangChain Tools

Each of the 13 MCP tools gets wrapped as a LangChain `tool()` with a Zod schema. The wrapper calls the n8n MCP server via HTTP with the bearer token:

```ts
const executeWorkflowTool = tool(
  async ({ workflowId, inputData }) => {
    const result = await mcpService.call('execute_workflow', {
      workflowId,
      inputData,
    })
    return JSON.stringify(result)
  },
  {
    name: 'execute_workflow',
    description: 'Execute an n8n workflow by ID. Supports chat, form, and webhook inputs.',
    schema: z.object({
      workflowId: z.string().describe('The workflow ID to execute'),
      inputData: z.record(z.any()).optional().describe('Input data for the workflow'),
    }),
  }
)
```

### Filesystem Backends

Use `CompositeBackend` to route the agent's file access:

```ts
import { CompositeBackend, FilesystemBackend, StateBackend } from 'deepagents'

// Cowork: working directory + ephemeral scratch
const coworkBackend = (rt) => new CompositeBackend({
  default: new StateBackend(rt),           // scratch/planning files
  routes: {
    '/workspace/': new FilesystemBackend({
      root_dir: workingDirectory,          // user's chosen folder
      virtual_mode: true,                  // sandbox — no escaping root
    }),
  },
})

// Workflow: ephemeral only (no local files needed for MCP CRUD)
const workflowBackend = (rt) => new StateBackend(rt)
```

### Streaming Agent Responses to the UI

The agent runs in Electron's main process (or a worker). Stream events to the Vue renderer via IPC:

```ts
// Main process — run agent and stream events
for await (const event of agent.stream(input, { configurable: { thread_id: sessionId } })) {
  mainWindow.webContents.send('agent:event', event)
}

// Renderer (Vue composable) — receive and render
const { messages, isRunning } = useAgentStream(sessionId)
```

Events to handle in the UI:
- **Tool calls** — show which n8n workflow is being executed, with status
- **Tool results** — display execution output, workflow previews (via `<n8n-demo>`)
- **Text chunks** — stream assistant text into the chat view
- **Todo updates** — show the agent's plan/progress in a sidebar or inline

### Built-in Capabilities (Free from Deep Agents)

These are included automatically — do NOT reimplement them:

| Capability | What it does | How n8n-desk uses it |
|---|---|---|
| `write_todos` | Task planning and progress tracking | Agent breaks complex tasks into steps, shown in UI |
| `ls`, `read_file`, `write_file`, `edit_file` | Virtual filesystem access | Cowork mode: agent reads/writes user's working directory |
| `glob`, `grep` | File search and content search | Cowork mode: agent finds files in working directory |
| Subagent spawning (`task` tool) | Delegate subtasks to isolated agents | Agent can spin up a subtask for parallel work |
| Summarization | Auto-summarizes when context gets large | Prevents context overflow on long sessions |
| Prompt caching | Anthropic prompt caching middleware | Reduces token cost on repeated tool patterns |

### Human-in-the-Loop

Gate destructive operations behind user approval via the UI:

```ts
const agent = createDeepAgent({
  // ...
  checkpointer: new MemorySaver(),
  interruptOn: {
    'execute_workflow': true,       // confirm before running workflows
    'create_workflow': true,        // confirm before creating
    'update_workflow': true,        // confirm before modifying
    'publish_workflow': true,       // confirm before activating
    'archive_workflow': true,       // confirm before archiving
  },
})
```

When an interrupt fires, the agent pauses. The Vue UI shows an approval dialog. On approve/reject, resume the agent with the decision.

### LLM Provider Configuration

The model string is `"provider:model"` format. Supported providers:

| Provider | Model string example | Env var |
|---|---|---|
| Anthropic | `"anthropic:claude-sonnet-4-6"` | `ANTHROPIC_API_KEY` |
| OpenAI | `"openai:gpt-4.1"` | `OPENAI_API_KEY` |
| Ollama (local) | `"ollama:devstral-2"` | None (local) |

API keys are stored in `~/.n8n-desk/llm.json` and set as env vars before agent creation. For Ollama, no key is needed — just a running local server.

### What the Agent is NOT

- **Not a code executor.** The agent does not run arbitrary code. It calls n8n workflows as tools and reads/writes files.
- **Not always-on.** Each agent session starts fresh (or resumes from a checkpointed thread). There is no background agent loop.
- **Not shared.** The agent runs locally per user. It does not communicate with other users' agents.

---

## Local Data Directory — `~/.n8n-desk/`

All persistent local data lives in `~/.n8n-desk/`. This is the single source of truth for user state across sessions. Pinia stores are in-memory only — they hydrate from this directory on startup and flush back on changes.

### Directory Layout

```
~/.n8n-desk/
├── config.json                        # Global app settings (theme, default instance)
├── instances/
│   ├── {instance-id}/                 # One directory per n8n instance
│   │   ├── instance.json              # Instance config (URL, name, label, color)
│   │   ├── auth.json                  # OAuth client registration, token metadata (NOT secrets)
│   │   ├── sessions/
│   │   │   ├── chat/
│   │   │   │   ├── index.json         # Session index (id, title, agent, timestamps)
│   │   │   │   ├── {session-id}.jsonl # Chat messages, one JSON object per line
│   │   │   │   ├── .archive/          # Deleted sessions (auto-purged after 30 days)
│   │   │   │   └── ...
│   │   │   ├── cowork/
│   │   │   │   ├── index.json
│   │   │   │   ├── {session-id}.jsonl
│   │   │   │   ├── .archive/
│   │   │   │   └── ...
│   │   │   └── workflow/
│   │   │       ├── index.json
│   │   │       ├── {session-id}.jsonl
│   │   │       ├── .archive/
│   │   │       └── ...
│   │   └── cache/
│   │       └── workflows.json         # Cached workflow list (ephemeral)
│   └── {another-instance-id}/
│       └── ...
└── llm.json                           # LLM provider config (API keys for Cowork/Workflow)
```

### Why `~/.n8n-desk/`

- Survives app reinstalls and updates
- Inspectable and portable — users can back up, sync, or move their data
- Same model as `~/.n8n/`, `~/.claude/`, `~/.config/` conventions
- On mobile: map to the app's sandboxed documents directory instead

### JSONL Format for Sessions

Each session file is append-only JSONL — one JSON object per line. This is efficient for chat history: append new messages without rewriting the file, stream-parse large sessions without loading everything into memory.

```jsonl
{"id":"msg_01","role":"user","content":"Process the invoices in ./inbox","ts":"2026-03-14T10:00:00Z"}
{"id":"msg_02","role":"assistant","content":"I'll scan the inbox folder...","ts":"2026-03-14T10:00:01Z","meta":{"toolCalls":["execute_workflow"]}}
{"id":"msg_03","role":"tool","content":"{\"status\":\"success\",\"items\":12}","ts":"2026-03-14T10:00:03Z","meta":{"toolName":"execute_workflow","workflowId":"42"}}
{"id":"msg_04","role":"assistant","content":"Found 12 invoices. Processing...","ts":"2026-03-14T10:00:04Z"}
```

**Message schema:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | Unique message ID |
| `role` | `"user"` \| `"assistant"` \| `"tool"` \| `"system"` | yes | Message sender |
| `content` | string | yes | Message text or serialized tool result |
| `ts` | ISO 8601 string | yes | Timestamp |
| `meta` | object | no | Optional metadata (tool calls, workflow IDs, execution IDs, agent info) |

### Session Index (`index.json`)

Each instance's sessions are scoped under its directory, so no instance ID is needed in the index itself.

```json
[
  {
    "id": "session_abc123",
    "title": "Invoice processing",
    "agentId": "workflow_42",
    "agentName": "Invoice Extractor",
    "createdAt": "2026-03-14T10:00:00Z",
    "updatedAt": "2026-03-14T10:05:00Z",
    "messageCount": 24
  }
]
```

### Read/Write Pattern

```
App start → local-storage.ts reads ~/.n8n-desk/ → hydrates Pinia stores
User action → Pinia store updates → local-storage.ts appends/writes to disk
```

- **Chat messages**: append to JSONL (never rewrite the whole file for new messages)
- **Session index**: rewrite on session create/update/delete (small file, infrequent)
- **Instance/auth config**: rewrite on change (small files, rare)
- **Cache**: write-through, treat as ephemeral (can be deleted without data loss)
- **Instance switching**: change active instance ID → rehydrate stores from that instance's directory

### Platform Mapping

| Platform | `~/.n8n-desk/` resolves to |
|---|---|
| macOS/Linux | `$HOME/.n8n-desk/` |
| Windows | `%USERPROFILE%\.n8n-desk\` |
| iOS/Android | App sandboxed documents directory (via Capacitor Filesystem API) |

### Security

- **Tokens go in the OS keychain** (Electron `safeStorage`, Capacitor secure storage) — NOT in `auth.json`. Key per instance (e.g., `n8n-desk:{instance-id}`)
- `auth.json` stores only non-secret metadata: client ID, token expiry, scopes
- `llm.json` may contain API keys for LLM providers (Cowork/Workflow modes) — file permissions should be `0600` on desktop

---

## Theming

### Token Architecture

n8n's design system has three layers of color tokens. n8n-desk adds a fourth app-specific layer:

1. **Primitives** (`_primitives.scss`) — raw color palette: `--color--neutral-950` through `--color--neutral-50`, orange, green, etc.
2. **Semantic tokens** (`_tokens.scss`) — generic mappings: `--color--foreground`, `--color--background`, `--color--text`
3. **App-specific tokens** (`_tokens.scss`) — n8n UI chrome: `--menu--color--background`, `--canvas--color--background`
4. **n8n-desk surface tokens** (`global.scss`) — our Ionic-compatible layer: `--n8n-desk--sidebar-bg`, `--n8n-desk--content-bg`, etc.

### Why `--n8n-desk--` Tokens Exist

The generic semantic tokens (`--color--foreground`, `--color--background`) are **too light for dark mode**. They map to neutral-800 (24%) and neutral-700 (30%), but n8n 2.0's actual dark UI uses the deeper end: neutral-900 (13%) for sidebar, neutral-950 (9%) for canvas. The `--n8n-desk--` tokens bridge this gap.

### Surface Token Reference

| Token | Dark mode value | Light mode value | Use for |
|---|---|---|---|
| `--n8n-desk--sidebar-bg` | `neutral-900` (13%) | `foreground--tint-2` (white) | Side menu background |
| `--n8n-desk--content-bg` | `neutral-950` (9%) | `background` (96%) | Main content area, segment track |
| `--n8n-desk--surface-bg` | `neutral-850` (17%) | `foreground` (88%) | Cards, lists, inputs, overlays |
| `--n8n-desk--surface-raised-bg` | `neutral-800` (24%) | `foreground--tint-2` (white) | Hover states, toggles, skeleton |

**Always use `--n8n-desk--` tokens for component surfaces.** Do not use `--color--foreground` or `--color--background` directly — they produce incorrect contrast in dark mode.

### Theme File Structure

```
src/theme/
├── _primitives.scss     # Raw color palette (copied from n8n)
├── _tokens.scss         # Semantic + app tokens with light/dark mixins (copied from n8n)
├── global.scss          # ionic-theme-bridge mixin, --n8n-desk-- tokens, Ionic component overrides
└── variables.scss       # Deprecated — consolidated into global.scss
```

### How Themes Are Applied

```scss
// global.scss structure:
:root            { @include primitives; }           // raw colors always available
body[data-theme='light'] { @include theme; @include ionic-theme-bridge; }
body[data-theme='dark']  { @include theme-dark; @include ionic-theme-bridge; + dark overrides }
body:not([data-theme])   { light fallback + @media dark fallback }
```

The `ionic-theme-bridge` mixin maps n8n semantic tokens → Ionic CSS variables (`--ion-color-primary`, `--ion-background-color`, etc.). It must be applied **after** the theme mixin so tokens are defined.

### Dark Mode

- Controlled via `body[data-theme="dark"]` attribute (set by `useTheme` composable)
- Syncs with `prefers-color-scheme` when theme is set to `"system"`
- `<n8n-demo>` web component: pass `theme="dark"` or `theme="light"` to match

---

## The `<n8n-demo>` Web Component

Register as custom element in Vite config:

```ts
// vite.config.ts
vue({
  template: {
    compilerOptions: {
      isCustomElement: (tag) => tag === 'n8n-demo',
    },
  },
})
```

Install: `npm i @n8n_io/n8n-demo-component`

Use in Workflow mode to render workflow previews inline. Always set:
- `disableinteractivity="true"` for inline chat previews
- `clicktointeract="true"` for expandable previews
- `tidyup="true"` for clean auto-layout
- `theme` synced to app theme

---

## n8n-master Reference

The `n8n-master/` directory contains the full n8n monorepo. It is **gitignored** and **read-only** — never modify it.

### Package Map

| Package | Path | What to find there |
|---|---|---|
| **Design System** | `packages/frontend/@n8n/design-system/` | 84+ Vue 3 components, CSS tokens, SCSS themes, utilities, directives |
| ↳ Components | `…/design-system/src/components/` | `AskAssistant*` (chat UI), `N8nMarkdown`, `N8nButton`, `N8nCallout`, `N8nCard`, `N8nInput`, `N8nSelect`, `N8nSpinner`, `N8nBadge`, `N8nTag`, `N8nCommandBar`, `N8nScrollArea`, `N8nPromptInput`, `N8nSendStopButton`, `BlinkingCursor`, etc. |
| ↳ V2 Components | `…/design-system/src/v2/components/` | Modern reka-ui based: `Badge`, `Checkbox`, `DropdownMenu`, `Select`, `Switch`, `Loading`, `Pagination`, `Tree` |
| ↳ CSS Tokens | `…/design-system/src/css/` | `_primitives.scss` (raw palette), `_tokens.scss` (semantic + dark mode), `fonts.scss` |
| ↳ Utils | `…/design-system/src/utils/` | `cn.ts` (class merge), `markdown.ts` (MD→HTML), `uid.ts` (unique IDs), `colorUtils.ts` |
| ↳ Directives | `…/design-system/src/directives/` | `n8n-html.ts` (XSS-safe HTML), `n8n-truncate.ts`, `n8n-smart-decimal.ts` |
| ↳ Composables | `…/design-system/src/composables/` | `useI18n`, `useCharacterLimit`, `useParentScroll` |
| **@n8n/chat** | `packages/frontend/@n8n/chat/` | Embeddable chat widget — `Chat.vue`, `Message.vue`, `MessagesList.vue`, `Input.vue`, `MarkdownRenderer.vue`, `MessageActions.vue` |
| **Editor UI** | `packages/frontend/editor-ui/` | Full n8n editor — `src/app/` (views), `src/features/` (feature modules) |
| **API Types** | `packages/@n8n/api-types/` | `chat-hub.ts` (Chat-Hub API types), `push/` (WebSocket event types), `dto/` (request/response DTOs) |
| **Chat-Hub** | `packages/@n8n/chat-hub/` | `parser.ts` (message parsing), `artifact.ts` (artifact collection), `constants.ts` |
| **Client OAuth2** | `packages/@n8n/client-oauth2/` | OAuth2 client implementation — `code-flow.ts`, `credentials-flow.ts`, types |
| **Permissions** | `packages/@n8n/permissions/` | Role & scope definitions, permission checks |
| **Constants** | `packages/@n8n/constants/` | Shared constants across n8n packages |
| **Workflow SDK** | `packages/@n8n/workflow-sdk/` | SDK for building workflows programmatically |
| **CLI / Backend** | `packages/cli/` | n8n server — `src/modules/mcp/` (OAuth + MCP server), `src/modules/chat-hub/` (Chat-Hub backend) |
| **Core** | `packages/core/` | Workflow execution engine, node execution |
| **Workflow** | `packages/workflow/` | Workflow data model, expression evaluation |
| **Nodes Base** | `packages/nodes-base/` | All built-in n8n node implementations |
| **Nodes LangChain** | `packages/@n8n/nodes-langchain/` | AI/LangChain node implementations |

### Most relevant for n8n-desk

- **Design tokens & theming** → `design-system/src/css/`
- **Chat UI components** → `design-system/src/components/AskAssistant*/` + `@n8n/chat/src/components/`
- **Chat-Hub API types** → `@n8n/api-types/src/chat-hub.ts` + `push/chat-hub.ts`
- **Chat-Hub parsing** → `@n8n/chat-hub/src/parser.ts` + `artifact.ts`
- **OAuth flow** → `cli/src/modules/mcp/` + `@n8n/client-oauth2/`
- **Markdown rendering** → `design-system/src/utils/markdown.ts`
- **HTML sanitization** → `design-system/src/directives/n8n-html.ts`

---

## Code Conventions

- **File naming**: kebab-case for files (`chat-message.vue`), PascalCase for components (`ChatMessage`)
- **No barrel exports**: import directly from the file, not via `index.ts` re-exports
- **Props**: use `defineProps<T>()` with interface, not runtime prop validation
- **Emits**: use `defineEmits<T>()` with typed events
- **CSS**: SCSS with CSS Modules (`<style lang="scss" module>`) for component styles, global tokens via SCSS imports
- **Async**: `async/await` everywhere, no `.then()` chains
- **Error boundaries**: use Vue's `onErrorCaptured` at view level to catch component errors gracefully

---

## Dev Workflow

```bash
# Install dependencies
npm install

# Dev server (browser)
npm run dev

# Dev server (Electron)
npm run dev:electron

# Build for production
npm run build

# Build Electron app
npm run build:electron

# Build mobile (after Capacitor sync)
npx cap sync
npx cap open ios    # or android
```

---

## Rules

- **Check n8n source before creating new components.** Before building any new component, composable, utility, or type — search `n8n-master/` first. n8n likely already has a solution (component, util, type, directive) that can be copied or adapted. Use the package map above to find the right location. Copy what you need into `src/`, never import from `n8n-master/` at build time.
- **`<ion-segment>` must always use `mode="ios"`** — gives the pill-style switcher on all platforms.
- **Do NOT set `mode: 'ios'` globally on `IonicVue`.** Only apply `mode="ios"` on individual components where explicitly required.
- **Navigation is side menu, never bottom tabs.** Use `IonMenu` + `IonSplitPane` + `IonSegment` for mode switching. No `IonTabs` or `IonTabBar`.
- **Inputs always use `fill="outline"` and `label-placement="stacked"`** — label above, outlined border. This matches n8n's form style. Applies to `<ion-input>`, `<ion-textarea>`, and `<ion-select>`.

---

## What NOT To Do

- **Don't replicate n8n's workflow editor.** n8n-desk is a conversational interface, not a visual canvas builder.
- **Don't manage LLM connections in Chat mode.** Chat-Hub handles providers server-side. n8n-desk just sends messages and streams responses.
- **Don't build a custom component library.** Use Ionic components for layout/forms/nav. Fork n8n's AskAssistant only for the chat UI.
- **Don't store secrets in localStorage.** Use OS keychain (Electron `safeStorage`) or Capacitor secure storage.
- **Don't import from `n8n-master/` at build time.** Copy what you need into `src/`. The reference dir is for reading, not linking.
- **Don't use Options API or `defineComponent()`.** `<script setup lang="ts">` only.
