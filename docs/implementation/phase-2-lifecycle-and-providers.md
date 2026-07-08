# Phase 2 — Session Lifecycle, IPC Robustness & Provider Config

> **Recommended model: Claude Opus 4.8** for the concurrency/lifecycle items (A, B), **Sonnet 5** is sufficient for the provider-config one-liners (C). Depends on Phase 1 (a working runtime to stabilize).

> **IMPLEMENTED 2026-07-07.** Notes and deltas:
> - Already closed by Phase 1's coupled fixes: #17 (backend honored via `resolveLlmConfig`), #16 (single tool registration), #43 (no duplicated user message), #5 (real SDK error subtypes), #26 (`unpublish_workflow` gated), #6 emit-side (`todo_update` from both backends), #8 (`maxTokens: 8192`), #10 (`numCtx: 32768`), and the Workstream D harness (parity + runner suites).
> - **#15:** `registerAgentHandlers` now takes a live window ACCESSOR and registers once in `app.whenReady()`; every event send resolves the current window and checks `isDestroyed()`.
> - **#18:** two halves. Persist side: the session stores flush each assistant text segment when it completes (next tool call / done / error), not just the final one. Replay side: `electron/agent/conversation-history.ts` folds assistant segments + tool calls/results (name, status, result excerpt with workflow/execution IDs) into alternating user/assistant history — folding, not native tool-message replay, because providers enforce strict tool_use/tool_result pairing a cold start can't reconstruct.
> - **#24 renderer half:** unknown-id `tool_call_result` now creates a placeholder card + persisted tool message instead of being dropped (runner-side ordering was Phase 1).
> - **#41:** full mid-session 401 → single-flight refresh → retry on the Deep Agents backend (`McpAuthState` in tool-definitions.ts, `refreshMcpToken` plumbed from ipc/agent.ts, honors custom-MCP token kind). The Claude SDK backend cannot rotate headers mid-session (the CLI subprocess owns the MCP connection) — it keeps the proactive refresh at invoke.
> - **#21:** `stopAllAgentRunners()` + `agent:stop-all` IPC, called from the instances store's `setActive` before the context swap.
> - **#27:** deepagents 1.10.5 auto-wires summarization middleware; the real gap was that its 85%-of-context trigger needs `model.profile.maxInputTokens`. ChatAnthropic/ChatOpenAI ship native profiles; ChatOllama gets one stamped matching `numCtx` (otherwise a 170k-token fallback trigger never fires inside a 32k context).
> - **#28:** `checkOllamaToolSupport()` probes `POST /api/show` capabilities; hard error only on an explicit capabilities list missing `tools` (fails open on pre-0.4 servers); wired into both the runner and test-connection.
> - Backend/provider combo validation: `validateLlmConfig()` throws `LlmConfigError` with actionable messages (claude-sdk + non-Anthropic provider rejected, missing API keys, invalid provider values); surfaced via `agent:invoke` error events and test-connection.
> - **Bug found along the way:** message ids were `msg_${Date.now()}` — synchronous event bursts created colliding ids within one millisecond, breaking every id-based lookup. Replaced with `src/utils/message-id.ts` in both stores and both composables.
> - New tests: conversation-history, factory validation, token-refresh (real local MCP server enforcing bearer auth), ollama-capabilities (fake /api/show), summarization-profile (asserts the 0.85 fraction trigger via `computeSummarizationDefaults`), and a store suite run over BOTH session stores (segment persistence, unknown-id placeholders, chronological JSONL).
> - Deferred to Phase 3 as planned: renderer todo rendering, instance-switch UI affordance, store/view polish (#20, #22, #23, #47–#52).

## Goal

Sessions start, stop, resume, and switch cleanly; multi-turn memory actually carries workflow/execution context; each LLM provider runs at full capability; and the runner/IPC layer finally has test coverage.

---

## Workstream A — Lifecycle & IPC robustness (closes #15, #16, #17, #43, #5, #24, #6, #26)

**#17 — Configured backend is ignored:** `ipc/agent.ts:582` derives the backend from the provider (`anthropic ⇒ claude-sdk`, else `deep-agents`), and `resolveLlmConfig()` (`factory.ts`) drops the `backend` field from `llm.json`. So "Deep Agents + Anthropic" is impossible and the settings model lies. Preserve and honor the `backend` field end-to-end; validate combinations (e.g. claude-sdk requires Claude Code installed).

**#15 — macOS window-reopen kills agent IPC:** `registerAgentHandlers(mainWindow)` is called inside `createWindow()` but guarded by a `handlersRegistered` flag, so on macOS reopen the handlers keep `webContents.send`-ing to the **destroyed** window. Either register once against a `getMainWindow()` accessor that always returns the current window, or re-bind the window reference on reopen. (Other handlers already register once in `app.whenReady()` — follow that pattern but keep the window reference live.)

**#16 — File tools registered twice (Deep Agents):** `ipc/agent.ts:635-639` puts `fileTools + jsComputeTool` into `customTools`, and `deep-agents-runner.ts:222-224` adds them again — duplicate tool names sent to the model. Register them in exactly one place. (If Phase 1 Workstream C already routed all file access through the shared set, reconcile here so there's a single source.)

**#43 — User message duplicated in prompt:** conversation-history assembly appends the current user message into the history block *and* sends it as the prompt, duplicating it every turn. De-duplicate: history should contain only prior turns.

**#5 — SDK result errors swallowed:** `claude-sdk-runner.ts` checks `msg.subtype === 'error'` against a value the SDK doesn't emit, so real result errors never surface. Match the actual `SDKResultError` subtype and emit an `error` event.

**#24 — Tool results for unknown IDs dropped (parity):** `cowork-sessions.ts` (and the Deep Agents path) silently drop `tool_call_result` whose `id` doesn't match a known tool call — so results of the core actions (execute/create/update) can vanish. Render/persist tool results even when the id wasn't pre-registered (generate a placeholder card).

**#6 — Todo/plan nonfunctional end-to-end:** Claude SDK disables `TodoWrite` (`tools: []`) and never emits `todo_update`; Deep Agents' emission path uses the wrong event shape. Emit `todo_update` from both backends (Claude SDK: enable the todo tool or synthesize from plan output; Deep Agents: read todos from the correct stream event). Renderer rendering is Phase 3 (#… ) — this workstream is the **emit** side.

**#26 — `unpublish_workflow` not approval-gated:** it can silently deactivate a live production workflow. Add it to the destructive set (both backends, via the Phase 1 shared matcher).

**Files:** `electron/ipc/agent.ts`, `electron/agent/factory.ts`, `electron/agent/claude-sdk-runner.ts`, `electron/agent/deep-agents-runner.ts`, `electron/main.ts`.

---

## Workstream B — Multi-turn memory & token lifecycle (closes #18, #41, #21 runner-side)

**#18 — Memory corrupted:** `loadConversationHistory` skips all tool messages and flattens roles, and the store only persists the *final* assistant segment — so intermediate assistant text and every tool result (workflow IDs, execution IDs) are lost between turns. Persist and replay a faithful transcript: assistant text segments that precede tool calls, and tool calls + results (at least their key identifiers). This is what makes "continue yesterday's workflow" actually work.

**#41 — Tokens frozen at invoke:** `accessToken`/`mcpAccessToken` are captured at invoke time; a mid-session 401 is never caught or refreshed, so long sessions die silently. Catch `McpUnauthorizedError` mid-session, refresh via the existing `loadAndRefresh`, and retry (or surface a re-auth prompt).

**#21 (runner side) — Instance switch doesn't stop agents:** switching instances must stop all active runners for the old instance (the renderer affordance is Phase 3). Wire a stop-all into the instance-switch path.

**Files:** `electron/ipc/agent.ts`, `electron/mcp-client.ts`, session stores.

---

## Workstream C — LLM provider config correctness (closes #8, #10, #27, #28)

These are mostly small but each silently degrades a provider. Now reachable because Phase 2 A honors the configured backend.

- **#8 — Anthropic output hard-capped at 2048 tokens** (`deep-agents-runner.ts` `ChatAnthropic`): truncates large workflow JSON. Set `maxTokens` to the model's real max (or a high sane default).
- **#10 — Ollama `num_ctx` never set:** runs at Ollama's tiny default context. Set `num_ctx` to the model's window.
- **#27 — Auto-summarization never triggers:** the "summarize at 85% of token limit" behavior isn't wired, so long sessions overflow. Configure deepagents' summarization middleware with the model's real limit.
- **#28 — No tool-calling capability check for Ollama:** many Ollama models can't tool-call; the agent silently fails. Detect/validate tool support and surface a clear error or fallback.

**Files:** `electron/agent/deep-agents-runner.ts`, `electron/agent/factory.ts`.

---

## Workstream D — Runner & IPC test harness (closes #33)

Stand up the integration harness the whole plan leans on: instantiate each runner with a mock LLM + mock MCP server, drive `invoke/stop/approve`, and assert the `AgentStreamEvent` stream. This is the foundation for the parity guarantee — a shared test suite run against **both** runners that asserts identical event sequences for the same scripted scenario.

**Files:** `electron/agent/__tests__/` (new runner + IPC lifecycle tests).

## Phase 2 exit criteria

- [ ] `backend` field in `llm.json` is honored; invalid combos rejected with a clear message.
- [ ] macOS close/reopen keeps Cowork/Workflow modes working without restart.
- [ ] No duplicate tools; no duplicated user message; SDK errors surface; unknown-id tool results still render.
- [ ] A second-turn message can reference a workflow/execution created in turn one.
- [ ] Mid-session token expiry recovers or prompts cleanly; instance switch stops old-instance agents.
- [ ] Anthropic/Ollama run at full context/output; summarization triggers on long sessions.
- [ ] Shared parity test suite passes against both runners.
