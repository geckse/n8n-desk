# Phase 4 — Product Capabilities, i18n & Polish

> **Recommended model: Claude Sonnet 5** for the product features (A, B), **Haiku 4.5** for the mechanical i18n sweep (C) and small polish (D). The one exception: the recurring/background-execution feature (#46) is a genuinely complex subsystem — consider **Opus 4.8** if you build the full desktop scheduler. Depends on Phases 1–3.

> **IMPLEMENTED 2026-07-07.** Notes, deltas, and decisions:
>
> **Workstream A — daily-task capabilities**
> - **#46 DECISION — desktop scheduler deferred.** The server-side path ships: both prompts teach Schedule-Trigger workflows with the "you only act during this conversation" boundary (Phase 3 #44) and the workflow prompt walks the publish step. The desktop path (tray runner, scheduler persistence, OS notifications, wake behavior, headless agent runs without the renderer store persisting events) is a real subsystem with its own failure modes — building it inline would have been scope creep on top of an already-large phase. If it gets built, design it as: schedule definitions in `~/.n8n-desk/instances/{id}/schedules.json`, a main-process cron loop gated on app-running (no login item in v1), headless invoke that persists JSONL directly from the main process, `Notification` on terminal events, and a schedules section in the sidebar. Until then, recurrence lives on the n8n instance — which is also the more reliable place for it (survives the laptop lid).
> - **#40:** the live server's `list_credentials` already arrives via dynamic discovery; both prompts now teach "check credentials BEFORE designing an integration; missing → user adds it in the n8n editor" (## Credentials section + Tier 3b note).
> - **#45:** `electron/agent/memory-tools.ts` — per-instance `memory.json` (capped 200 entries × 1000 chars, dedup, corrupt-file tolerant) with `memory_read`/`memory_append` registered on BOTH backends (Deep Agents direct, Claude SDK via the local MCP server). The IPC layer additionally injects a "## Saved Memory" block (4KB budget, newest first) so continuity doesn't depend on a tool call; prompts teach stable-facts-only usage.
> - **#50:** session context menu gained **Re-run** (new session with the same attached folders + the original first message re-sent), rename is now actually wired to the stores (both sidebars' handlers were TODO no-ops), and sessions **auto-title** from the first user message (never clobbering a manual rename). The session list is the task history; a dedicated n8n-execution-history/schedule surface is deferred with #46.
>
> **Workstream B — file & data capabilities**
> - **#32:** six new shared tools in file-tools.ts: `move_file`, `copy_file` (rw-mount + executable-deny on destination, read-deny on sources — renaming `.env` → `notes.txt` stays impossible; the writable-extension allowlist deliberately does NOT apply to managing existing files), `delete_file` (OS trash via `shell.trashItem`, permanent-delete fallback outside Electron), `open_path`, `clipboard_read`/`clipboard_write` (Electron clipboard, 200k/1M char caps). All flow to both backends via the shared layer.
> - **#30:** `read_text` paginates by lines (offset/limit, default 2000, total lineCount reported) and rejects binary files (NUL-byte sniff in the first 8KB) with a pointer to the format-specific readers.
> - **#31:** ONE path convention. Mount route prefixes ARE the host paths now (`buildAttachedFolderMounts` sets `virtualPrefix = hostPath + '/'`); the deepagents built-ins (CompositeBackend routes by plain string prefix), the shared tools, and the prompt-injected paths all use identical host-absolute paths — the `/workspace/…` alias layer is gone. `buildFilesystemPermissions` rules updated accordingly (n8n-desk file denies keyed on `policy.n8nDeskDir`).
> - **#54:** `XLSX.read(..., { cellDates: true })` + Date→ISO normalization; formula cells keep their cached computed value (what the user sees in Excel).
> - **#55:** `readCsv` streams through PapaParse's chunk API over a `createReadStream` — only the offset..offset+limit window is materialized, rows outside it are counted and discarded (exact `totalRows` preserved, quoted embedded newlines handled by the parser). The tool passes offset straight through instead of slice-on-top.
>
> **Workstream C — i18n**
> - All listed surfaces localized: shared panel strings incl. example prompts (#49), ApprovalCard (#51), AgentPicker (#59), ChatInput placeholders/tooltips/aria-labels (#60), ChatMessage action tooltips (#61), ToolCallCard section labels (#63), session default titles via lazy `i18n.global.t` in the store factory + new `workflow.sessions.*` key set (#65).
> - **#29:** runners keep emitting the neutral machine description; `ApprovalCard` now owns the user-facing text — per-tool localized prompts (`agentPanel.approval.prompts.*`, workflow name interpolated from args) with a generic localized fallback; a non-generic backend description (custom-server HITL text) is passed through.
> - New keys live under `agentPanel.*`, `chat.*` additions, `cowork.examples.*`/`workflow.examples.*`; `MessageSchema` derives from en.json so no manual type updates. Component tests now install the i18n plugin via a global @vue/test-utils setup file (`src/__tests__/setup/vue-test-utils.ts`).
>
> **Workstream D — polish**
> - **#53:** `registerAgentTools` takes an optional policy; the Claude SDK runner creates the local MCP server whenever policy OR skills OR memory exist — skills no longer vanish without a sandbox policy.
> - **#64:** the two ~1500-line panels collapsed into one `src/components/agent/AgentChatPanel.vue` parameterized by `mode` (selects composable/store pair + i18n namespace at setup); `CoworkChatPanel`/`WorkflowChatPanel` are 8-line wrappers so view imports stay stable. Combined with the Phase-3 store factory, every renderer fix is now written once.
>
> New tests: memory-tools (7), agent-tool-registry matrix (3), file-management/pagination/binary/CSV-offset (10 in file-tools + 3 parser-level), Excel date fidelity, prompt capability sections (6), store rename/auto-title/first-message (3 × 2 stores). Existing count-based suites (16→22 tools) and the sandbox-permission/virtual-path tests were updated to the new conventions.

## Goal

Turn a now-correct agent into a genuinely useful **daily-task** assistant, localize the agent-facing UI, and pay down the remaining polish debt.

---

## Workstream A — Daily-task capabilities (closes #40, #45, #46, #50)

**#46 — No recurring/background execution or notifications (flagship):** the mission is "every morning, do X on the desktop," but there's no way to run anything recurringly or notify the user. Two-part solution:
- **Server-side path (simpler):** teach the agent to create n8n **schedule-trigger** workflows and publish them, so recurrence runs on the n8n instance. Mostly prompt + tool work (overlaps Phase 3 #44).
- **Desktop path (complex — consider Opus 4.8):** a background/tray runner that can execute a saved task on a schedule locally, with OS notifications on completion. This is a real subsystem (tray, scheduler persistence, notification permissions, wake behavior). Scope it as its own mini-design before building.

**#40 — No credential visibility:** the agent can't check whether a Gmail/Sheets credential exists, so it guesses. Add a `list_credentials` tool (the real MCP server exposes credential listing) to the surface and teach the prompt to check before building integrations.

**#45 — No cross-session memory / preferences:** multi-day continuity has no mechanism beyond replaying one session's history. Add a lightweight per-instance memory/preferences store (e.g. a `memory.json` the agent can read/append) so it can remember recurring context and user preferences.

**#50 — No re-run / execution history / scheduling surface (UI):** `CoworkSidebar.vue` has no way to re-run a past task, see execution history, or manage schedules. Add these affordances (pairs with #46).

**Files:** `electron/agent/tool-definitions.ts` (credentials tool), new memory store + tool, `electron/main.ts` + tray (if desktop scheduler), `src/components/.../CoworkSidebar.vue`.

---

## Workstream B — File & data capabilities for real work (closes #30, #31, #32, #54, #55)

- **#32 — Missing local-context capabilities:** a desktop daily-task agent needs move/rename/delete/copy, open-in-default-app, and clipboard access. Add these as sandboxed tools (respecting the Phase 1 sandbox filter). (`edit_file` partial edit should already exist from Phase 1 Workstream C.)
- **#30 — `read_text` no pagination/binary detection:** returns whole files (up to 100 MB) and mis-handles binaries. Add offset/limit pagination and binary detection.
- **#31 — Two path conventions:** the agent sees both host-absolute paths (injected in prompt) and virtual `/workspace/...` paths (built-in tools). Unify on one convention now that Phase 1 consolidated the file-tool architecture.
- **#54 — Parser fidelity:** xlsx formulas/dates and other fidelity gaps limit real-world usefulness. Improve within reason (evaluate formulas, preserve dates).
- **#55 — CSV pagination re-parses whole file:** offset/limit re-reads the entire file each call. Stream/seek instead.

**Files:** `electron/agent/file-tools.ts`, `electron/agent/file-parsers/*`.

---

## Workstream C — Internationalize the agent UI (closes #29, #49, #51, #59, #60, #61, #63, #65)

The agent-facing renderer is hardcoded English despite existing i18n keys. Mechanical sweep — good fit for Haiku 4.5:
- **#49** CoworkChatPanel/WorkflowChatPanel: empty-state, thinking, config strings.
- **#51** ApprovalCard: 100% hardcoded (pairs with Phase 3 #22 — localize while adding the args display).
- **#59** AgentPicker modal (title, search, empty states, Unavailable badge).
- **#60** ChatInput placeholders + attach tooltips (keys exist under `chat.input.*`).
- **#61** ChatMessage action tooltips (Copy/Copied/Edit/Regenerate).
- **#63** ToolCallCard section labels ('Arguments'/'Result').
- **#65** Session default titles hardcoded in Pinia stores; workflow store lacks a title scheme.
- **#29** Approval prompt text generated English-only in **both runners** (backend side) — move user-facing approval text to a localizable layer, or keep it neutral and let the renderer localize.

Add missing keys to `src/i18n/locales/en.json`; replace literals with `t('...')`.

---

## Workstream D — Polish & refactor (closes #53, #64)

- **#53 — Skill tools only registered when a sandbox policy exists (Claude SDK):** `invoke_skill`/`read_skill_file` should register whenever skills are configured, independent of sandbox policy. Decouple.
- **#64 — ~1400-line panels/stores:** `CoworkChatPanel`/`WorkflowChatPanel` and both session stores are large near-duplicates. Extract shared logic (event handling, rendering) into composables/components to cut the duplication. Do this **after** the behavioral fixes land so you refactor known-good code.

## Phase 4 exit criteria

- [ ] Agent can list credentials and set up a recurring task (server-side schedule trigger at minimum); optional desktop scheduler + notifications scoped/decided.
- [ ] Cross-session memory works; sidebar offers re-run/history.
- [ ] File tools cover move/rename/delete/copy/open/clipboard; `read_text` paginates + detects binary; CSV pagination streams.
- [ ] All listed agent-UI strings localized; keys in `en.json`.
- [ ] Skill tools register without a sandbox policy; panel/store duplication reduced.
