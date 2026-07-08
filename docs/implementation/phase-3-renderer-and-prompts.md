# Phase 3 — Renderer UX & Workflow-Building Prompts

> **Recommended model: Claude Sonnet 5.** Vue components and prompt authoring — well-scoped, low blast radius, no framework-internals reasoning. Depends on Phases 1–2 (correct events to render, correct tool surface to describe).

> **IMPLEMENTED 2026-07-07.** Notes and deltas:
> - **#23 (the structural one):** both session stores were rewritten around **per-session runtimes** (`src/stores/agent-sessions.ts`, a shared factory both stores now wrap — the two ~600-line near-copies are gone). Each session owns its messages/toolCalls/todos/pendingApproval/workflowHistory/unpersisted-segment state; `isAgentRunning` is per session; events are routed by `event.sessionId` and persisted into the owning session's JSONL even when it is not active. The per-view `onEvent` listeners (which died with unmounted views and filtered to the active session) were replaced by ONE global listener in `main.ts`; each store ignores session ids it doesn't own. Switching back to a background session reuses its live runtime (no disk reload).
> - **#20:** the send button becomes a stop button while running (both panels), wired to the existing `agent:stop`.
> - **#22:** `ApprovalCard` renders the tool arguments (per-key, long strings readable, scrollable) + the shared display name.
> - **#47:** the "inline tool calls not tied to messages" loop (which re-rendered every running call) is now an orphan-only fallback — one card per call.
> - **#48:** attached folders render as chips with label, a clickable RO/RW mode badge (`setFolderMode` persists to index.json), detach ✕ while modifiable, and per-chip Show-in-Finder context menu. The action-row "locked folder" label is gone.
> - **#52:** `tool_call_start` persists `args` in the tool message meta; `workflow_preview` payloads are persisted onto the tool message (re-append + last-entry-wins dedup on load); `selectSession` reconstruction restores both, so tool cards and inline previews survive restart.
> - **Workstream B:** `todo_update` now lands in the session runtime and renders as a Plan card (status icons, spinner on in-progress) in both panels.
> - **#12:** `COWORK_DENIED_TOOLS` + `isN8nToolDenied` in approval.ts (n8n-server-scoped matcher — deliberately does NOT block same-named custom-server tools); `deniedTools` threaded through `AgentRunnerConfig` from ipc by mode. Deep Agents filters the discovered tool list (denied tools never registered); Claude SDK hides them via `disallowedTools` AND denies in `canUseTool` as the enforcement backstop.
> - **#13/#57:** workflow prompt teaches the server's mandated order (get_sdk_reference → best-practices-if-available → search_nodes → get_node_types for ALL nodes → write → validate-fix-revalidate → create_workflow_from_code → execute → publish), says the tool surface is discovered live (no frozen list), and a test suite guards against phantom-tool regressions.
> - **#36:** cowork prompt gained an Error Recovery & Results procedure (get_execution → plain-language diagnosis → concrete fix; present key output fields, no raw JSON dumps).
> - **#44:** ipc injects `## Environment` (current date via Intl, platform, instance URL); both prompts teach the Schedule-Trigger boundary for recurring asks ("you only act during this conversation").
> - **#56:** prompt guidance in both modes: `availableInMCP` gates execution; tell the user to enable MCP access in the n8n editor instead of retrying (the flag already arrives in search_workflows results — dynamic tools pass it through verbatim).
> - **#58:** `buildSkillDescriptions` now teaches the mechanism: call `invoke_skill` BEFORE attempting the task, `read_skill_file` for supporting files; skill names listed bare (no `/` prefix, which reads as user-command syntax).
> - **#62:** `src/utils/tool-display.ts` — curated labels + namespace parsing (`mcp__{server}__{tool}`, `{server}__{tool}`); n8n/n8n-desk-local servers hidden, unknown servers shown as a suffix. Used by ToolCallCard + ApprovalCard.
> - New tests: system-prompts sanity suite (16), approval deny-matcher additions, denied-tools tests against BOTH runners (real deepagents graph + mocked SDK), tool-display (9), and 12 new store cases (background routing/persistence, per-session approvals, args + workflow_preview round-trip, todos, foreign-session drop). Older suites asserting the pre-Phase-3 behavior (active-session-only filtering, writable `isAgentRunning`, `- /name` skill format) were updated to the new contracts.
> - Deferred (Phase 4 per plan): panel/store i18n (keys exist in en.json; strings still hardcoded), re-run/rename/auto-title affordances, ~1400-line panel template dedup.

## Goal

Make what the agent does **legible and controllable** from the UI, and make the agent an actually-competent n8n workflow builder by teaching it the server's mandated methodology.

---

## Workstream A — Agent controllability & event rendering (closes #20, #22, #23, #47, #48, #52)

**#20 — No stop button anywhere:** a running agent cannot be cancelled from the UI. Add a stop control (the `agent:stop` IPC already exists) to `CoworkChatPanel.vue` / `WorkflowChatPanel.vue`, shown while `isRunning`.

**#22 — Approval dialog hides tool args:** `ApprovalCard.vue` asks the user to approve destructive operations **without showing the arguments** (which workflow, what inputs). Render the tool name + formatted args so the user approves with full context. (The args already arrive in `approval_required.data.args`.)

**#23 — Non-active session events dropped:** `useCoworkAgent.ts` / `useWorkflowAgent.ts` do `if (event.sessionId !== activeSessionId) return`, so switching sessions mid-run **permanently locks the input** (no `done` ever processed) and loses the agent's output. Route events to the session they belong to (update that session's store even when it isn't active), so background sessions finish and unlock.

**#47 — Duplicate tool cards:** running tool calls render as two cards. Reconcile the `tool_call_start` message and the `toolCalls` entry so a single card updates in place.

**#48 — Attached folders invisible/undetachable:** folders remain editable but the user can't see or detach them, and their access mode isn't shown. Surface attached folders with their mode and a detach affordance.

**#52 — Persistence round-trip loses data:** tool args and injected workflow previews don't survive restart (no audit trail). Persist tool args and the `workflow_preview` payload to JSONL so a reopened session shows the same tool cards and previews.

**Files:** `src/components/.../CoworkChatPanel.vue`, `WorkflowChatPanel.vue`, `ApprovalCard.vue`, `ToolCallCard.vue`, `src/composables/useCoworkAgent.ts`, `useWorkflowAgent.ts`, session stores.

---

## Workstream B — Todo/plan rendering (pairs with Phase 2 #6)

Render the `todo_update` events (now emitted from both backends) as a visible plan/progress list in the panel or sidebar. Today the store no-ops the event.

**Files:** session stores, `CoworkChatPanel.vue` / `WorkflowChatPanel.vue` (or the sidebar).

---

## Workstream C — Workflow-building methodology in the prompts (closes #12, #13, #36, #44, #56, #57, #58)

The prompts have the right skeleton but contradict the server's mandated call order and reference tools that don't exist.

**#13 — Weak methodology:** rewrite `WORKFLOW_MODE_SYSTEM_PROMPT` to follow the n8n MCP server's mandated sequence (from `mcp-instructions.ts`): **read `get_sdk_reference` first → `search_nodes` → (optional) `get_suggested_nodes` → `get_node_types` for every node used → write code → `validate_workflow` (fix-and-revalidate loop) → `create_workflow_from_code` with a description → optionally `execute_workflow` to test → `publish_workflow`.** Warn explicitly against guessing node parameters.

**#57 — Nonexistent tools referenced:** the prompt names `create_workflow` (real: `create_workflow_from_code`) and a "Tier 4: Remote Code Sandbox" that doesn't exist — hallucination bait. Fix names to match the real (now dynamically-discovered) surface; remove the phantom tier.

**#12 — Cowork tool restrictions are prompt-only:** the prompt claims `update_workflow`/`publish`/`archive` are unavailable in Cowork, but the runner registers all tools regardless. Enforce it: pass a mode-specific allowed-tool list to the runner so Cowork actually can't call lifecycle tools (belt-and-suspenders with the prompt).

**#58 — Skill invocation never explained:** the skill block lists skills but never tells the agent to call `invoke_skill`. Add explicit instructions so lazy-loaded skills (e.g. the excellent bundled workflow-building skill) actually get used.

**#36 — Cowork lacks error-recovery/result-presentation:** add a procedure for when a workflow execution fails (inspect `get_execution`, explain, suggest a fix) and for presenting execution results cleanly.

**#44 — No date/environment/recurring guidance:** inject the current date and a short note on when to set up recurring automations (server-side schedule triggers) so "every morning…" requests are handled sensibly.

**#56 — `availableInMCP` gate invisible:** the agent can't tell which existing workflows are actually executable via MCP. Surface that in `search_workflows`/`get_workflow_details` output or prompt guidance so it doesn't try to run non-eligible workflows.

**Files:** `electron/agent/system-prompts.ts`, `electron/skill-loader.ts` (skill block text), `electron/ipc/agent.ts` (mode-specific allowed-tool list), `electron/agent/tool-definitions.ts` (surface `availableInMCP`).

---

## Workstream D — Tool display names (closes #62)

`ToolCallCard.vue` string-mangles tool names at runtime instead of using proper display names. Map tool names to human labels (and strip the `mcp__n8n__` prefix for display).

## Phase 3 exit criteria

- [ ] Stop button cancels a running agent; approval dialog shows the tool + args.
- [ ] Switching sessions mid-run doesn't lock the input; background sessions finish.
- [ ] Single tool card per call; attached folders visible + detachable with mode shown.
- [ ] Tool args and workflow previews survive restart; todos render.
- [ ] Workflow-mode prompt follows the server's mandated build sequence, references only real tools, and invokes the workflow-building skill; Cowork can't call lifecycle tools.
