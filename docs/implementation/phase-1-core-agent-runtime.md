# Phase 1 — Core Agent Runtime Rebuild

> **Recommended model: Claude Opus 4.8 (1M context).** This phase is the hard core: the two runners' execution model, the human-in-the-loop approval subsystem, sandbox enforcement, and the MCP tool surface. The work is deeply interdependent and security-critical — the failures here are *silent* (destructive tools running unapproved, secrets readable, a whole backend emitting nothing), so they need the strongest reasoning and the widest context to hold both runners + IPC + the n8n MCP ground truth in view at once.

## Goal

After Phase 1, both backends (**Deep Agents SDK** for OpenAI/Ollama, **Claude Agent SDK** for Anthropic) must:
- Actually stream events and run tools.
- Gate every destructive n8n tool behind real user approval.
- Enforce the filesystem sandbox identically (no secret reads, no writes through read-only mounts).
- Talk to the current n8n MCP server with correct schemas and the server's mandated build tools.
- Never let agent-authored JS hang the Electron main process.

## Prerequisites

- A live n8n instance with MCP enabled, plus at least one OpenAI/Ollama key and one Anthropic key, to exercise both backends.
- Read the real server first: `n8n-master/packages/cli/src/modules/mcp/` (tool names, schemas, `mcp-instructions.ts`, the stateless controller). It is the authority — the local wrappers drifted from it.

---

## Workstream A — Rebuild the Deep Agents runner (closes #1, #9, #39)

**Root cause (#1):** `deep-agents-runner.ts` calls `agent.stream(input, …)` and then `normalizeEvent()` expects `streamEvents`-v2 shapes (`on_chat_model_stream`, `on_tool_start`, `on_tool_end`, `on_chain_end`). `.stream()` with the default mode yields **state deltas**, not those events — so *nothing* is normalized: no text, no tool calls, no todos, no approvals. Separately, `interruptOn` + `MemorySaver` are configured but the interrupt is **never resumed** with a `Command`, and the checkpointer is recreated per `invoke`, so approved tools never execute.

**Approach:**
1. Switch the event source to `agent.streamEvents(input, { version: 'v2', configurable: { thread_id }, signal })`, or adopt `streamMode: ['messages','updates']` and rewrite `normalizeEvent` to match whichever you pick. Pick one and make `normalizeEvent` match it exactly; add a unit test that feeds recorded events and asserts the emitted `AgentStreamEvent[]`.
2. Implement real interrupt resume: when LangGraph interrupts for an approval-gated tool, surface `approval_required`, await the decision, then resume the graph with `new Command({ resume: decision })` on the **same** `thread_id`. The `MemorySaver` must persist across the invoke for the life of the session (store it per-session, not per-call).
3. **#9 — LangChain version skew:** the project pins a v0.3 model (`@langchain/anthropic` 0.3) but a v0.2 `@langchain/langgraph` checkpointer. Align these (bump langgraph to the version deepagents 1.8 expects, or pin the model line to match) — a mismatched checkpointer is a prime suspect for interrupts not resuming. Verify `deepagents`' peer expectations and make the installed set coherent.
4. **#39 — `stop()` must cancel in-flight work:** the `AbortController.signal` is passed to `.stream()`, but confirm in-flight MCP HTTP calls and `js_compute` actually observe it. Thread the signal into `callTool`/`callToolWithUrl` (see Workstream E) and into the JS sandbox execution so a stop aborts them, not just the graph loop.

**Files:** `electron/agent/deep-agents-runner.ts`, `package.json` (dep alignment).

**Decision to make explicitly:** if a correct, resumable Deep Agents integration proves unstable against `deepagents@1.8`, the fallback is to route **all** providers through the Claude Agent SDK and retire the Deep Agents runner. Document the call either way — but if you keep it, parity (below) is mandatory.

---

## Workstream B — Unify the approval subsystem (closes #0, #4, #42, #14)

This is the highest-risk area: right now, on the **default Anthropic path, destructive tools run with no approval at all.**

**#0 — Namespace-aware gating (Claude SDK):** `canUseTool` compares against bare names (`execute_workflow`), but the SDK delivers `mcp__n8n__execute_workflow` (and `mcp__{server}__{tool}` for custom servers). The repo already knows this — `ipc/agent.ts:307` uses `endsWith('__'+t)`. Apply the same normalization in `claude-sdk-runner.ts`'s `interruptTools.has(...)` check: match when `toolName === t || toolName.endsWith('__' + t)`. Do the same for custom-server approval names built at `ipc/agent.ts:691` (they're built as `${server}__${tool}` but arrive as `mcp__${server}__${tool}`).

**#4 — Queue deadlock:** `canUseTool` `pushEvent`s `approval_required` into `eventQueue`, but the queue is only drained inside the `for await (sdkMessage …)` loop. If the SDK is blocked *inside* `canUseTool` awaiting the decision and emits no further messages, the `approval_required` event never reaches the renderer → permanent hang. Fix by making the event channel independent of the message loop: use a signal/promise the generator awaits (`eventResolve`) so pushed events are yielded immediately, or run the query iteration and the event drain as two concurrent producers into one async queue. Add a test: a session whose first action is an approval-gated tool must surface `approval_required` before any other SDK message.

**#42 — Approval ID plumbing:** `ipc/agent.ts:826` emits a synthetic `approval_resolved` with `id: 'latest'`, and the runner emits its own — leaving the renderer with mismatched IDs and dead status-update code. Make `agent:approve` carry the real `approvalId`, and have exactly **one** component emit `approval_resolved` (the runner). Remove the IPC-side synthetic event.

**#14 — Orphaned replacement runner:** `ipc/agent.ts`'s invoke IIFE `finally` does `activeRunners.delete(sessionId)` unconditionally. If a second invoke replaced the runner, the first invoke's `finally` deletes the *replacement*, leaving a session that can't be stopped or approved. Guard the delete with an identity check (`if (activeRunners.get(sessionId) === active) activeRunners.delete(sessionId)`).

**Parity:** the Deep Agents runner's approval path (interrupt → `approval_required` → resume) and the Claude SDK path must emit the identical `AgentStreamEvent` sequence and gate the identical tool set. Factor the destructive-tool set and name-matching into one shared helper used by both.

**Files:** `electron/agent/claude-sdk-runner.ts`, `electron/agent/deep-agents-runner.ts`, `electron/ipc/agent.ts`, new `electron/agent/approval.ts` (shared matcher).

---

## Workstream C — Enforce the filesystem sandbox in both backends (closes #2, #7, #34, #35)

**#2 — Deep Agents built-ins bypass the sandbox (critical, security):** `buildBackend()` creates a `FilesystemBackend` per mount but **ignores `mount.mode`**, so read-only mounts are writable; and the deepagents **built-in** file tools (`read_file`/`write_file`/`edit_file`/`ls`/`glob`/`grep`) go straight through the backend, bypassing `sandbox-filter.ts` entirely — meaning the sensitive-file deny-list never runs and `~/.n8n-desk/llm.json` (API keys) is readable. The Claude SDK backend sets `tools: []` (no built-ins) and only exposes the sandbox-filtered custom tools, so the two backends enforce **different security and expose different toolsets** — a direct parity violation (#7).

**Approach — pick one architecture and apply to both backends:**
- **Preferred:** disable deepagents built-in file tools (don't grant them) and expose the **same** `createFileTools(policy)` set the Claude SDK backend uses, so *all* file access flows through `resolveAndValidatePath` / `isReadDenied` / `isWriteAllowed`. This gives true parity for free and closes #7. Add the missing partial-edit capability (`edit_file` equivalent) to the shared `file-tools.ts` so neither backend loses it.
- **If built-ins are kept:** wrap the `FilesystemBackend` so every operation first passes through the sandbox filter and honors `mount.mode` (reject writes on `ro`). This is more code and easier to get subtly wrong — prefer the first option.

**#34 — Read-only folder mode dropped in IPC:** the user can attach a folder as read-only, but `ipc/agent.ts` builds all attached-folder mounts as `rw` (`sandbox-policy.ts` `buildAttachedFolderMounts` hardcodes `mode: 'rw'`). Thread the user's chosen `mode` from the renderer through to the mount.

**#35 — Whole `~/.n8n-desk` mounted:** every session read-only-mounts the entire `~/.n8n-desk` (minus the deny-list). Narrow this to only what the agent needs (e.g. `skills/`), rather than exposing all instances' session data and configs by default.

**Files:** `electron/agent/deep-agents-runner.ts` (backend construction / tool grant), `electron/agent/file-tools.ts` (add partial edit), `electron/agent/sandbox-policy.ts`, `electron/ipc/agent.ts`.

**Verification:** attempt, on **both** backends: read `~/.n8n-desk/llm.json` (must be denied), write to a `ro` mount (denied), write to a `rw` mount (allowed), and `edit_file` a file in a `rw` mount (allowed, partial edit works).

---

## Workstream D — Correct & modernize the n8n MCP tool surface (closes #3, #37, #38, #19)

**#3 — Schema drift (critical):** three of the 13 hardcoded wrappers in `tool-definitions.ts` no longer match the server:
- `search_nodes`: sends `{ query: string }`; server requires `{ queries: string[] }` (min 1) → rejected every call.
- `get_suggested_nodes`: sends `{ category: string }`; server requires `{ categories: string[] }` → rejected.
- `execute_workflow`: sends `{ workflowId, inputData? }`; server requires `{ workflowId, executionMode?, inputs: discriminatedUnion(chat|form|webhook) }` → **all input data is silently dropped**, and drafts can't be tested (`executionMode: 'manual'`).

**Approach:** replace the 13 hardcoded wrappers with **dynamic discovery** for the Deep Agents backend — call `listTools()` (already implemented as `listToolsWithUrl`) against the n8n MCP server and wrap each discovered tool via the existing `createDynamicMcpTools` path. This closes the drift permanently *and* exposes the server's full (~30) tool surface instead of a frozen 13. The Claude SDK backend already discovers dynamically; this brings Deep Agents to parity. Keep the human-approval set defined by name-match (Workstream B) so newly-discovered destructive tools are still gated.

**#37 — `get_sdk_reference` missing:** the server *mandates* calling `get_sdk_reference` before writing SDK code (see `mcp-instructions.ts`). Once discovery is dynamic it appears automatically; ensure it isn't filtered out, and (Phase 3) teach the prompt to call it first.

**#38 — `jsonSchemaToZod` corrupts schemas:** the converter collapses `anyOf`/`oneOf`/`allOf` and mishandles numeric enums and nested optionals, corrupting custom-server tool schemas. Harden it (handle union constructs, preserve descriptions/defaults, support numeric enums) — this matters more once dynamic discovery leans on it for the full surface.

**#19 — Client timeout:** `mcp-client.ts` never sets a request timeout, so every call inherits the MCP SDK's 60s default — but the server's `execute_workflow` has a **5-minute** budget, so long workflow runs are killed at 60s. Set a per-call timeout aligned with the server (≥5 min for execution tools; shorter for discovery). Thread the abort signal (Workstream A #39) so `stop()` also cancels.

**Files:** `electron/agent/tool-definitions.ts`, `electron/mcp-client.ts`, `electron/agent/deep-agents-runner.ts` (consume discovered tools).

**Verification:** on the Deep Agents backend, `search_nodes(["gmail"])` returns results; `execute_workflow` with `inputs: {type:'chat', chatInput:'…'}` actually passes the input and returns an execution; a >60s execution completes instead of timing out.

---

## Workstream E — Harden the JS sandbox (closes #11)

**#11 (security):** `executeInSandbox` bounds only **synchronous** execution via the `vm` timeout. An async microtask bomb — e.g. `Promise.resolve().then(function b(){ Promise.resolve().then(b) })` — returns from `runInContext` instantly (success), then its microtasks drain forever and **starve the Electron main-process event loop** (empirically confirmed). No `setTimeout` is exposed, so the vector is promise/microtask recursion.

**Approach:** move `js_compute` execution off the main thread into a `worker_threads` Worker (or child process) with a hard wall-clock kill (terminate the worker on timeout) and a memory cap. The `vm` context stays for isolation, but the worker gives you a real timeout that covers async work and lets `stop()` terminate it. Keep the existing prototype-freeze/`codeGeneration:false`/deny-list protections. Add a test that the microtask bomb is killed at the timeout and the host stays responsive.

**Files:** `electron/agent/js-sandbox.ts` (+ a worker entry), wired into both runners identically.

---

## Phase 1 exit criteria

- [ ] Both backends stream text/tool/approval events for a real workflow-build session.
- [ ] Every destructive n8n tool (`create_workflow_from_code`, `update_workflow`, `execute_workflow`, `publish_workflow`, `archive_workflow`) triggers `approval_required` and only runs on approve — verified on **both** backends.
- [ ] `~/.n8n-desk/llm.json` unreadable and `ro` mounts unwritable on **both** backends; file toolset identical.
- [ ] Deep Agents uses dynamic MCP discovery; `search_nodes`/`get_suggested_nodes`/`execute_workflow` succeed with correct inputs; `get_sdk_reference` reachable; a >60s execution survives.
- [ ] A JS microtask bomb is killed at timeout without hanging the app.
- [ ] New tests cover: event normalization, approval gating + name-matching, sandbox deny/allow, MCP schema round-trip, and the sandbox worker timeout.
