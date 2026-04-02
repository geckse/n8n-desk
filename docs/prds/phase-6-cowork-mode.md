# PRD: Phase 6 — Cowork Mode

## Overview

Implement the Cowork Mode frontend experience in n8n-desk: a **task-oriented** AI agent mode that combines local file operations (Excel, CSV, PDF, etc.) with existing n8n workflow execution to accomplish real-world tasks. Unlike Workflow Mode (which builds/manages workflows), Cowork Mode helps users accomplish goals like "load a local Excel file, run and process each row with an n8n workflow, save results back to the Excel." The backend is ~95% complete — this PRD covers the remaining frontend layer (view, composable, store, sidebar wiring) and a targeted system prompt expansion to support on-the-fly workflow building when no existing workflow fits.

**Key philosophy:** Cowork Mode is task-first. The user describes what they want done, and the agent figures out how — preferring local file tools, then existing n8n workflows, and only building new workflows as a last resort.

## Problem Statement

Cowork Mode exists as a placeholder view (`src/views/CoworkView.vue` shows "coming soon") despite the backend being nearly complete: the IPC handler in `electron/ipc/agent.ts` already accepts `mode: 'cowork'`, the system prompt exists in `electron/agent/system-prompts.ts`, the sandbox policy is built by `buildCoworkPolicy()`, and all file tools + `js_compute` are wired. The sidebar (`src/components/sidebar/CoworkSidebar.vue`) uses mock data. There is no composable (`useCoworkAgent.ts`), no session store (`cowork-sessions.ts`), and no chat panel component.

Additionally, the current Cowork system prompt only exposes 3 n8n MCP tools (`search_workflows`, `execute_workflow`, `get_execution`), but the vision includes the ability to build SOLID workflows on the fly as needed. This requires expanding Tier 3 with workflow-building tools while keeping the tone task-oriented (not workflow-builder-oriented).

## Goals

- Users can switch to Cowork Mode and have a fully functional chat experience on par with Workflow Mode
- Cowork sessions persist at `~/.n8n-desk/instances/{id}/sessions/cowork/` using the same JSONL format
- Sidebar shows real cowork sessions (not mock data), supports create/select/delete/search
- Users can attach folders and files with the same UX as Workflow Mode
- System prompt is updated with workflow-building MCP tools as a secondary capability (Tier 3b), while task execution remains primary
- Chat panel is tailored for task-oriented work: different empty state, different placeholder text
- All existing shared components (ToolCallCard, ApprovalCard, WorkflowInlineCard, etc.) are reused directly — no duplication

## Non-Goals

- No new backend IPC handlers or agent runner changes (backend already handles `mode: 'cowork'`)
- No new file tool implementations (all file tools already exist)
- No specialized "batch processing" UI (row-by-row pattern is handled by the agent's reasoning, not a custom widget)
- No visual file preview panel (file results appear as tool call cards in chat)
- No mobile implementation (requires Electron agent)
- No `update_workflow`, `publish_workflow`, `unpublish_workflow`, or `archive_workflow` in Cowork — lifecycle management belongs to Workflow Mode

## Technical Design

### Cowork vs Workflow Mode

| Aspect | Cowork Mode | Workflow Mode |
|---|---|---|
| **Primary purpose** | Execute tasks using workflows + local files | Build/edit/manage workflows |
| **User intent** | "Process these invoices" | "Build me a workflow that..." |
| **MCP tools (Tier 3a)** | `search_workflows`, `get_workflow_details`, `execute_workflow`, `get_execution` | All 13 MCP tools |
| **MCP tools (Tier 3b)** | `search_nodes`, `get_node_types`, `validate_workflow`, `create_workflow_from_code` (secondary) | N/A — all tools are primary |
| **File tools** | Primary focus | Available but secondary |
| **js_compute** | Primary for data transforms | Available but secondary |
| **Workflow building** | On-the-fly when needed, minimal viable workflow | Core purpose |
| **System prompt tone** | Task-oriented, "get it done" | Workflow-builder-oriented |

### Data Model Changes

None. Existing types in `src/types/session.ts` (`SessionMeta`, `SessionMessage`, `AttachedFolder`) and `src/types/agent.ts` (`AgentEvent`, `AgentToolCall`, `WorkflowPreviewData`) are fully sufficient.

### Interface Changes

**New composable: `src/composables/useCoworkAgent.ts`**
- Identical signature to `useWorkflowAgent.ts`
- Only differences: references `useCoworkSessionsStore`, passes `mode: 'cowork'` to `agent.invoke()`

**New store: `src/stores/cowork-sessions.ts`**
- Identical structure to `workflow-sessions.ts`
- Session dir: `instances/${instanceId}/sessions/cowork` (not `workflow`)
- Store ID: `'cowork-sessions'`
- Default title: `'New task'`

### System Prompt Changes

Expand `COWORK_MODE_SYSTEM_PROMPT` Tier 3 from 3 tools to two sub-tiers:

- **Tier 3a — Execute existing workflows** (prefer this first): `search_workflows`, `get_workflow_details`, `execute_workflow`, `get_execution`
- **Tier 3b — Build new workflows** (only when no existing workflow fits): `search_nodes`, `get_node_types`, `validate_workflow`, `create_workflow_from_code`

Add iterative processing guidance for the common pattern of reading file -> processing rows via workflow -> writing results back.

### Migration Strategy

None needed. No existing cowork sessions on disk. The `sessions/cowork/` directory is created on first session by `localStorageService`.

## Implementation Steps

### Step 1: Create cowork sessions store

**File:** Create `src/stores/cowork-sessions.ts` by duplicating `src/stores/workflow-sessions.ts`.

Changes from the template:
- `defineStore('cowork-sessions', ...)` instead of `'workflow-sessions'`
- `sessionsDir()` returns `instances/${instanceId}/sessions/cowork`
- `createSession()` default title: `'New task'`
- Everything else (hydrate, selectSession, appendMessage, handleAgentEvent, attachFolder, detachFolder, deleteSession, openPanel, closePanel, reset, toolCall reconstruction, workflow extraction) stays identical

### Step 2: Create cowork agent composable

**File:** Create `src/composables/useCoworkAgent.ts` by duplicating `src/composables/useWorkflowAgent.ts`.

Changes:
- Import `useCoworkSessionsStore` instead of `useWorkflowSessionsStore`
- `sendMessage()` passes `mode: 'cowork'` instead of `mode: 'workflow'`
- Export name: `useCoworkAgent()`

### Step 3: Create CoworkChatPanel component

**File:** Create `src/components/cowork/CoworkChatPanel.vue` by adapting `src/components/workflow/WorkflowChatPanel.vue`.

Changes:
- Import `useCoworkAgent` and `useCoworkSessionsStore`
- Empty state title: `"Cowork Agent"`
- Empty state hint: `"Describe a task — the agent will use your files and n8n workflows to get it done."`
- Textarea placeholder: `"Describe a task to accomplish..."`
- **Reuse** `ToolCallCard`, `ApprovalCard`, `WorkflowInlineCard`, `PlusMenu` by importing from `@/components/workflow/` — do NOT duplicate

### Step 4: Update CoworkView with real layout

**File:** Replace placeholder in `src/views/CoworkView.vue` with split-panel layout matching `src/views/WorkflowView.vue`.

- Import `useCoworkSessionsStore` and `CoworkChatPanel`
- Reuse `WorkflowPreviewPanel` from `@/components/workflow/` (it's mode-agnostic)
- Include `usePluginsStore().hydrate()` on mount
- Same resizable preview panel behavior

### Step 5: Wire CoworkSidebar to real store

**File:** Modify `src/components/sidebar/CoworkSidebar.vue`.

- Remove `import { mockCoworkSessions } from '@/mocks/sidebar'`
- Import `useCoworkSessionsStore`
- Replace `mockCoworkSessions` with `store.sessions`
- Replace `activeSessionId` ref with `computed(() => store.activeSessionId)`
- Wire `newTask()` -> `store.createSession()`
- Wire `selectSession()` -> `store.selectSession(sessionId)`
- Wire `deleteSession()` -> `store.deleteSession(sessionId)`

### Step 6: Hydrate cowork store on startup and instance switch

**File:** `src/main.ts` — Add cowork store hydration alongside workflow store (line ~52):
```ts
const coworkSessionsStore = useCoworkSessionsStore()
await coworkSessionsStore.hydrate(instancesStore.activeInstanceId)
```

**File:** `src/components/instance/InstanceSwitcher.vue` — Add cowork store reset + rehydrate alongside workflow store (line ~32-35):
```ts
coworkSessionsStore.reset()
// ... after setActive + authStore.hydrate ...
await coworkSessionsStore.hydrate(instanceId)
```

### Step 7: Expand Cowork system prompt for on-the-fly workflow building

**File:** `electron/agent/system-prompts.ts` — Replace the Tier 3 section in `COWORK_MODE_SYSTEM_PROMPT`.

Current (3 tools):
```
### Tier 3: n8n Workflows (remote, approval required)
- search_workflows, execute_workflow, get_execution
```

Replace with:
```
### Tier 3a: Execute Existing Workflows (remote, prefer this first)
Before building anything new, search for existing workflows that can do the job.
- **search_workflows** — Find workflows by name, description, or tag.
- **get_workflow_details** — Inspect a workflow's configuration, inputs, and purpose.
- **execute_workflow** — Run a workflow with input data. Requires user approval.
- **get_execution** — Check execution results and output data.

### Tier 3b: Build New Workflows (remote, only when no existing workflow fits)
If no existing workflow covers the task, you can build one on the fly.
- **search_nodes** — Find n8n node types by service name or function.
- **get_node_types** — Get exact parameter definitions for nodes.
- **validate_workflow** — Validate workflow SDK code before creating. Always validate first.
- **create_workflow_from_code** — Create a new workflow from validated code. Requires user approval.

### Workflow Building Protocol (Tier 3b only)
1. Search for existing workflows first (Tier 3a). If one exists, use it.
2. If you must build: use search_nodes -> get_node_types -> validate -> create.
3. Keep workflows focused — build the minimum viable workflow for the task.
```

Also add to Guidelines section:
```
- For iterative processing (e.g., processing each row of a spreadsheet through a workflow):
  1. Read the file with the appropriate Tier 1 tool (read_excel, read_csv, etc.)
  2. Transform data with js_compute (Tier 2) if needed
  3. Execute the workflow once per item or in batches using execute_workflow
  4. Collect results and write them back with the appropriate write tool
  5. Report a summary to the user when done
```

### Step 8: Update i18n locale

**File:** `src/i18n/locales/en.json` — Remove or repurpose `views.coworkComingSoon`. Add keys for the new empty state (e.g., `cowork.emptyTitle`, `cowork.emptyHint`, `cowork.inputPlaceholder`).

### Step 9: Ensure Cowork tool set includes Tier 3b tools in agent runner

**File:** `electron/agent/tool-definitions.ts` — Verify that when `mode === 'cowork'`, the tool set includes `search_nodes`, `get_node_types`, `validate_workflow`, and `create_workflow_from_code` in addition to the existing 3 tools. If these are currently only provided for `mode === 'workflow'`, add them to the cowork tool set.

**File:** `electron/ipc/agent.ts` — Verify the destructive tools list for cowork includes `create_workflow_from_code` (requires approval) alongside the existing `execute_workflow`.

## Validation Criteria

- [ ] Navigating to Cowork shows a functional chat panel (not "coming soon")
- [ ] Creating a new cowork session persists to `~/.n8n-desk/instances/{id}/sessions/cowork/index.json`
- [ ] Sending a message invokes the agent with `mode: 'cowork'` (verify in Electron console log)
- [ ] Attaching a folder before first message works and persists to session metadata
- [ ] Attaching files via paperclip or drag-and-drop works identically to Workflow Mode
- [ ] Tool call cards render for file tools (read_excel, write_csv) and MCP tools (search_workflows, execute_workflow)
- [ ] Approval card appears for `execute_workflow` and `create_workflow_from_code` calls
- [ ] If the agent builds a workflow on the fly, inline preview card renders correctly
- [ ] Session switching in sidebar loads correct message history
- [ ] Session deletion archives the JSONL file to `.archive/`
- [ ] System prompt includes both Tier 3a and Tier 3b tools
- [ ] Skills autocomplete (typing `/`) works in cowork input
- [ ] Stopping a running agent works
- [ ] App restart preserves cowork sessions and messages
- [ ] Instance switch properly resets and rehydrates cowork sessions

## Anti-Patterns to Avoid

- **Do NOT duplicate ToolCallCard, ApprovalCard, WorkflowInlineCard, or WorkflowEmbed.** Import from `@/components/workflow/`. Add a prop if mode-specific behavior is needed.
- **Do NOT create a separate agent event handler.** The `handleAgentEvent()` in cowork sessions store should be identical to the workflow store's version — same event types, only session directory differs.
- **Do NOT add new IPC channels.** `agent:invoke/stop/approve/event` already support `mode: 'cowork'`.
- **Do NOT give Cowork access to `update_workflow`, `publish_workflow`, `unpublish_workflow`, or `archive_workflow`.** Lifecycle management is Workflow Mode's domain. Cowork can only create new workflows, not modify existing ones.
- **Do NOT use `get_suggested_nodes` in Cowork.** That tool is for exploratory workflow building. Cowork should be direct: search for the node, get types, build.

## Patterns to Follow

- **Store pattern:** Mirror `src/stores/workflow-sessions.ts` exactly. Same JSONL persistence, same index.json structure, same lifecycle methods. Only the store ID and directory path differ.
- **Composable pattern:** Mirror `src/composables/useWorkflowAgent.ts`. Same computed properties, same event listener lifecycle, same `sendMessage()` flow. Only the store import and `mode` parameter differ.
- **View pattern:** Mirror `src/views/WorkflowView.vue` for the split-panel layout with resizable preview.
- **Sidebar pattern:** Mirror `src/components/sidebar/WorkflowSidebar.vue` for wiring store to `SessionList`.
- **Component reuse:** `ToolCallCard`, `ApprovalCard`, `WorkflowInlineCard`, `WorkflowEmbed`, `WorkflowPreviewPanel`, `PlusMenu` are all mode-agnostic — reuse directly.

## Critical Files

| File | Action |
|---|---|
| `src/stores/cowork-sessions.ts` | **Create** (from `workflow-sessions.ts`) |
| `src/composables/useCoworkAgent.ts` | **Create** (from `useWorkflowAgent.ts`) |
| `src/components/cowork/CoworkChatPanel.vue` | **Create** (from `WorkflowChatPanel.vue`) |
| `src/views/CoworkView.vue` | **Replace** placeholder |
| `src/components/sidebar/CoworkSidebar.vue` | **Modify** — wire to real store |
| `src/main.ts` | **Modify** — add cowork store hydration |
| `src/components/instance/InstanceSwitcher.vue` | **Modify** — add cowork reset/hydrate |
| `electron/agent/system-prompts.ts` | **Modify** — expand Tier 3 |
| `electron/agent/tool-definitions.ts` | **Verify/Modify** — ensure Tier 3b tools for cowork |
| `electron/ipc/agent.ts` | **Verify** — destructive tools list for cowork |
| `src/i18n/locales/en.json` | **Modify** — add/update cowork keys |
