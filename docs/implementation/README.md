# Local Agent — Implementation Plan (Index)

This directory turns the verified findings in [`../agent-revalidation-findings.md`](../agent-revalidation-findings.md) into an ordered, executable implementation plan, split into four phases. Phases are ordered by **dependency and difficulty**, not just severity — later phases assume the runtime from earlier phases is correct.

## Phasing philosophy

Phase 1 is deliberately the **hard, interdependent, security-critical** work: the two agent runners' execution model, the approval subsystem, sandbox enforcement, and the MCP tool surface. These cannot be fixed in isolation — approval touches both runners and the IPC layer; sandbox enforcement forces a decision about the file-tool architecture that both backends share. This is where a mistake is most expensive, so it runs on the strongest coding model. Each subsequent phase is more mechanical and can move to a cheaper model.

| Phase | Doc | Scope | Recommended model | Why |
|---|---|---|---|---|
| **1** | [phase-1-core-agent-runtime.md](phase-1-core-agent-runtime.md) | Runner rebuild, approval subsystem, sandbox enforcement, MCP surface, JS-sandbox hardening | **Claude Opus 4.8 (1M context)** | Deep async/streaming/framework-internals reasoning; interdependent; security-critical. Mistakes here are silent and dangerous. |
| **2** | [phase-2-lifecycle-and-providers.md](phase-2-lifecycle-and-providers.md) | Session lifecycle races, IPC robustness, multi-turn memory, LLM-provider config correctness, runner/IPC test coverage | **Opus 4.8**, or **Sonnet 5** for the config one-liners | Concurrency correctness still matters, but each fix is more localized. |
| **3** | [phase-3-renderer-and-prompts.md](phase-3-renderer-and-prompts.md) | Renderer UX (stop button, approval args, session events), workflow-building prompts/methodology | **Sonnet 5** | Vue components + prompt authoring; well-scoped, low blast radius. |
| **4** | [phase-4-product-i18n-polish.md](phase-4-product-i18n-polish.md) | Daily-task product features, credential visibility, cross-session memory, file capabilities, i18n, refactors | **Sonnet 5** (features) / **Haiku 4.5** (i18n batch) | Mostly additive and mechanical; the i18n sweep is repetitive. |

## Cross-cutting requirements (apply in every phase)

1. **Both backends stay in sync (CLAUDE.md rule).** Every behavioral change to tools, sandbox, approval, or prompts must land in **both** `deep-agents-runner.ts` and `claude-sdk-runner.ts` (the latter via the in-process MCP server / `local-mcp-server.ts`). Implement shared logic once in the shared layer.
2. **Tests are part of the change, not a later phase.** Finding #33 (zero tests instantiate either runner) is closed incrementally: each phase adds unit/integration tests for the code it touches. Phase 2 stands up the runner/IPC harness the others build on.
3. **No emojis in UI; Lucide icons only. Inputs `fill="outline"` + `label-placement="stacked"`. `<ion-segment mode="ios">`.** (Repo UI rules.)
4. **Verify end-to-end, not just typecheck.** Each doc has a Verification section that drives the real flow (invoke → tool call → approval → result) against a live n8n instance where possible.

## Finding-to-phase map

- **Phase 1:** #0, #1, #2, #3, #4, #7, #9, #11, #14, #19, #34, #35, #37, #38, #39, #42
- **Phase 2:** #5, #6, #8, #10, #15, #16, #17, #18, #21(runner side), #24, #26, #27, #28, #33, #41, #43
- **Phase 3:** #12, #13, #20, #22, #23, #36, #44, #47, #48, #50(UI), #52, #56, #57, #58, #62
- **Phase 4:** #29, #30, #31, #32, #40, #45, #46, #49, #51, #53, #54, #55, #59, #60, #61, #63, #64, #65

(Numbers reference the ordered list in the findings report. Three findings were **refuted** and are intentionally excluded.)
