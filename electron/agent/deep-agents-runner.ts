import { randomUUID } from 'crypto'
import { z } from 'zod'
import { tool } from '@langchain/core/tools'
import type {
  AgentRunner,
  AgentRunnerConfig,
  AgentStreamEvent,
  LlmProviderConfig,
  LoadedSkill,
} from './types'
import {
  DESTRUCTIVE_TOOLS,
  requiresApproval,
  isToolAllowed,
  canonicalToolName,
  type ApprovalDecision,
} from './approval'
import {
  createAskUserQuestionTool,
  isQuestionInterrupt,
  ASK_USER_QUESTION_TOOL,
  type QuestionInterruptValue,
  type AskUserAnswers,
} from './ask-user-question'
import { discoverN8nMcpTools } from './tool-definitions'
import { createFileTools } from './file-tools'
import { jsComputeTool } from './js-sandbox'
import { buildFilesystemPermissions } from './sandbox-policy'
import { substituteArguments, readSupportingFile } from '../skill-loader'

// --- Session state that must outlive a single invoke ---
//
// The IPC layer constructs a fresh runner per invoke, so per-instance fields
// would lose the LangGraph checkpoint between turns. Checkpointers live in a
// module-level registry keyed by sessionId (capped, LRU-ish eviction).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sessionCheckpointers = new Map<string, any>()
const MAX_CHECKPOINTERS = 50

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getOrCreateCheckpointer(sessionId: string, MemorySaverCtor: new () => any): { saver: any; isNew: boolean } {
  const existing = sessionCheckpointers.get(sessionId)
  if (existing) {
    // Re-insert for LRU ordering
    sessionCheckpointers.delete(sessionId)
    sessionCheckpointers.set(sessionId, existing)
    return { saver: existing, isNew: false }
  }
  const saver = new MemorySaverCtor()
  sessionCheckpointers.set(sessionId, saver)
  while (sessionCheckpointers.size > MAX_CHECKPOINTERS) {
    const oldest = sessionCheckpointers.keys().next().value
    if (oldest === undefined) break
    sessionCheckpointers.delete(oldest)
  }
  return { saver, isNew: true }
}

/** Deferred approval decision, keyed by approval id. */
interface PendingApproval {
  toolName: string
  /**
   * LIVE session allow set (config.sessionAllowedTools) — `approve_always`
   * adds the canonical tool name here before resolving with a plain approve.
   */
  allowSet: Set<string>
  resolve: (decision: 'approve' | 'reject') => void
}

/** Deferred ask_user_question answers, keyed by question id (`null` = cancelled). */
interface PendingQuestion {
  resolve: (answers: AskUserAnswers | null) => void
}

/** Context window configured for Ollama models (numCtx). */
export const OLLAMA_NUM_CTX = 32_768

/**
 * Create a LangChain ChatModel based on the provider configuration.
 * Lazy-imports the provider-specific package to avoid loading all providers.
 *
 * Exported for tests (summarization-profile wiring).
 */
export async function createChatModel(config: LlmProviderConfig): Promise<unknown> {
  switch (config.provider) {
    case 'anthropic': {
      const { ChatAnthropic } = await import('@langchain/anthropic')
      return new ChatAnthropic({
        model: config.model,
        apiKey: config.apiKey,
        // The provider default (a few thousand tokens) truncates workflow SDK
        // code mid-generation — raise it.
        maxTokens: 8192,
        ...(config.baseUrl ? { anthropicApiUrl: config.baseUrl } : {}),
      })
    }
    case 'openai': {
      const { ChatOpenAI } = await import('@langchain/openai')
      return new ChatOpenAI({
        model: config.model,
        apiKey: config.apiKey,
        ...(config.baseUrl ? { configuration: { baseURL: config.baseUrl } } : {}),
      })
    }
    case 'ollama': {
      const { ChatOllama } = await import('@langchain/ollama')
      const model = new ChatOllama({
        model: config.model,
        // Ollama's default context (~2048 tokens) is smaller than the system
        // prompt + tool schemas — it would silently truncate. 32k is a safe
        // floor for tool-calling models.
        numCtx: OLLAMA_NUM_CTX,
        ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
      })
      // deepagents' auto-wired summarization middleware reads
      // `model.profile.maxInputTokens` to compute its 85%-of-context trigger.
      // ChatAnthropic/ChatOpenAI expose real profiles; ChatOllama does not —
      // without one the middleware falls back to a 170k-token trigger that
      // NEVER fires inside a 32k context, so long sessions overflow instead
      // of summarizing (audit #27). The base class defines `profile` as a
      // prototype getter, so shadow it with an instance property.
      Object.defineProperty(model, 'profile', {
        value: { maxInputTokens: OLLAMA_NUM_CTX },
        configurable: true,
      })
      return model
    }
    default:
      throw new Error(`Unsupported LLM provider: ${config.provider}`)
  }
}

/**
 * Create the `invoke_skill` LangChain tool for Deep Agents.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createInvokeSkillTool(skills: LoadedSkill[]): any {
  return tool(
    async ({ skillName, arguments: skillArgs }: { skillName: string; arguments?: string }) => {
      const skill = skills.find((s) => s.name === skillName)
      if (!skill) return `Skill "${skillName}" not found.`
      return substituteArguments(skill.content, skillArgs ?? '')
    },
    {
      name: 'invoke_skill',
      description: 'Load a skill by name. Returns the full instructions with arguments substituted. If the content references additional files (e.g., [PATTERNS.md](PATTERNS.md)), use read_skill_file to load them.',
      schema: z.object({
        skillName: z.string().describe('The kebab-case name of the skill to invoke'),
        arguments: z.string().optional().describe('Arguments to substitute into the skill content'),
      }),
    },
  )
}

/**
 * Create the `read_skill_file` LangChain tool for Deep Agents.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createReadSkillFileTool(skills: LoadedSkill[]): any {
  return tool(
    async ({ skillName, filePath }: { skillName: string; filePath: string }) => {
      const skill = skills.find((s) => s.name === skillName)
      if (!skill) return `Skill "${skillName}" not found.`
      const content = await readSupportingFile(skill, filePath)
      if (content === null) return `File "${filePath}" not found in skill "${skillName}".`
      return content
    },
    {
      name: 'read_skill_file',
      description: 'Read a supporting file referenced by a skill (e.g., PATTERNS.md, SDK-API.md). Use when invoke_skill returns content that references additional files.',
      schema: z.object({
        skillName: z.string().describe('The skill name that owns this file'),
        filePath: z.string().describe('Relative path within the skill directory (e.g., "PATTERNS.md")'),
      }),
    },
  )
}

/** Shape of the HITL interrupt payload surfaced by langchain's middleware. */
interface HitlActionRequest {
  name: string
  args: Record<string, unknown>
  description?: string
}
interface HitlInterruptValue {
  actionRequests: HitlActionRequest[]
}

/**
 * Deep Agents SDK runner implementation.
 *
 * Streams via `agent.stream(input, { streamMode: ['messages', 'updates'] })`:
 * - 'messages' → token-level text/thinking chunks
 * - 'updates'  → tool calls, tool results, todos, and `__interrupt__` payloads
 *
 * Human-in-the-loop is REAL interrupt/resume: when the graph pauses on an
 * approval-gated tool, the runner emits `approval_required`, awaits the
 * user's decision, and resumes the SAME thread with
 * `new Command({ resume: { decisions } })` (positional per actionRequest).
 * A rejection is fed back to the model by LangGraph as the tool outcome —
 * the runner never fakes tool results.
 *
 * The per-session MemorySaver lives in a module-level registry so the
 * checkpoint (and with it multi-turn state) survives across invokes.
 */
export class DeepAgentsRunner implements AgentRunner {
  private abortControllers = new Map<string, AbortController>()
  private pendingApprovals = new Map<string, Map<string, PendingApproval>>()
  private pendingQuestions = new Map<string, Map<string, PendingQuestion>>()

  async *invoke(
    sessionId: string,
    message: string,
    config: AgentRunnerConfig,
  ): AsyncIterable<AgentStreamEvent> {
    // Lazy imports for ESM-only packages
    let createDeepAgent: typeof import('deepagents').createDeepAgent
    let StateBackend: typeof import('deepagents').StateBackend
    let CompositeBackend: typeof import('deepagents').CompositeBackend
    let FilesystemBackend: typeof import('deepagents').FilesystemBackend
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let MemorySaver: new () => any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let Command: any
    let interruptFn: (value: unknown) => unknown

    try {
      const deepagents = await import('deepagents')
      createDeepAgent = deepagents.createDeepAgent
      StateBackend = deepagents.StateBackend
      CompositeBackend = deepagents.CompositeBackend
      FilesystemBackend = deepagents.FilesystemBackend
      // Post-dependency-alignment this resolves to the SAME langgraph line the
      // agent graph runs on — a cross-major checkpointer breaks interrupt/resume.
      const langgraph = await import('@langchain/langgraph')
      MemorySaver = langgraph.MemorySaver
      Command = langgraph.Command
      interruptFn = langgraph.interrupt as (value: unknown) => unknown
    } catch (err) {
      yield {
        type: 'error',
        sessionId,
        data: {
          message: `Failed to load Deep Agents SDK: ${err instanceof Error ? err.message : String(err)}`,
          code: 'DEEP_AGENTS_LOAD_FAILED',
        },
      }
      yield { type: 'done', sessionId, data: { reason: 'error' } }
      return
    }

    const abortController = new AbortController()
    this.abortControllers.set(sessionId, abortController)
    this.pendingApprovals.set(sessionId, new Map())
    this.pendingQuestions.set(sessionId, new Map())

    // Session allow set is the LIVE Set owned by the IPC layer — approve()
    // mutates it on approve_always and it persists across invokes. The
    // persistent list is the per-instance tool-approvals.json snapshot.
    const sessionAllow = config.sessionAllowedTools ?? new Set<string>()
    const persistentAllow = config.alwaysAllowedTools ?? []

    try {
      // Many Ollama models cannot tool-call — probing up front turns a
      // confusing provider error deep in the agent loop into an actionable
      // message. Fails open on old/unreachable servers (audit #28).
      if (config.llmConfig.provider === 'ollama') {
        const { checkOllamaToolSupport } = await import('./ollama-capabilities')
        const support = await checkOllamaToolSupport(
          config.llmConfig.baseUrl,
          config.llmConfig.model,
          abortController.signal,
        )
        if (support.supported === false) {
          yield {
            type: 'error',
            sessionId,
            data: { message: support.detail ?? 'The configured Ollama model does not support tool calling.', code: 'OLLAMA_NO_TOOL_SUPPORT' },
          }
          yield { type: 'done', sessionId, data: { reason: 'error' } }
          return
        }
      }

      const chatModel = await createChatModel(config.llmConfig)

      // --- Tool assembly -------------------------------------------------

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tools: any[] = []

      if (config.sandboxPolicy) {
        tools.push(...createFileTools(config.sandboxPolicy))
        tools.push(jsComputeTool)
      }

      // ask_user_question — always available, never approval-gated (it IS the
      // human interaction). The handler pauses the graph via interrupt(); the
      // resume loop below turns that into question_asked/question_answered.
      tools.push(createAskUserQuestionTool(interruptFn))

      // Interrupt set: static destructive floor + IPC-provided custom-server
      // approval names. Extended below with server-annotated mutating tools.
      const interruptToolNames = new Set<string>([
        ...DESTRUCTIVE_TOOLS,
        ...(config.interruptOnTools ?? []),
      ])

      // n8n MCP tools — discovered dynamically from the server (names,
      // schemas, and count drift; the server is the authority).
      try {
        const discovery = await discoverN8nMcpTools(config.mcpUrl, config.mcpAccessToken, {
          signal: abortController.signal,
          // Mid-session 401s refresh the token and retry instead of dying
          // silently (audit #41).
          refreshToken: config.refreshMcpToken,
        })
        // Mode restrictions are enforced here, not just in the prompt: tools
        // denied for this mode (e.g. lifecycle tools in Cowork) are never
        // registered on the agent (audit #12). n8n tools use bare names.
        const denied = new Set(config.deniedTools ?? [])
        tools.push(...discovery.tools.filter(
          (t: { name: string }) => !denied.has(t.name),
        ))
        // Every tool the n8n server marks non-read-only is approval-gated,
        // even ones that shipped after this code was written.
        for (const name of discovery.mutatingToolNames) {
          interruptToolNames.add(name)
        }
        console.log(`[n8n-desk] Discovered ${discovery.tools.length} n8n MCP tools (${discovery.mutatingToolNames.length} mutating)`)
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err)
        yield {
          type: 'error',
          sessionId,
          data: {
            message: `Could not discover tools from the n8n MCP server (${detail}). Continuing with local tools only.`,
            code: 'MCP_DISCOVERY_FAILED',
          },
        }
      }

      // Pre-built LangChain tools from PluginManager.buildDeepAgentsTools()
      if (config.customTools && config.customTools.length > 0) {
        tools.push(...config.customTools)
      }

      if (config.skills && config.skills.length > 0) {
        tools.push(createInvokeSkillTool(config.skills))
        tools.push(createReadSkillFileTool(config.skills))
      }

      // Cross-session memory (audit #45) — same tools on both backends.
      if (config.memoryFilePath) {
        const { createMemoryTools } = await import('./memory-tools')
        tools.push(...createMemoryTools(config.memoryFilePath))
      }

      // interruptOn keys must be actual tool names present on the agent —
      // match the assembled tools against the interrupt set (suffix-aware for
      // namespaced custom-server tools). Tools already allowed for this
      // session (approve_always) or by the persistent presets never interrupt.
      // NOTE: interruptOn is frozen at agent creation — a MID-RUN
      // approve_always grant is honored by the silent auto-approve in the
      // interrupt loop below, not here.
      const interruptOn: Record<string, { allowedDecisions: Array<'approve' | 'reject'> }> = {}
      for (const t of tools) {
        const name = (t as { name?: string }).name
        if (
          name &&
          requiresApproval(name, interruptToolNames) &&
          !isToolAllowed(name, sessionAllow) &&
          !isToolAllowed(name, persistentAllow)
        ) {
          interruptOn[name] = { allowedDecisions: ['approve', 'reject'] }
        }
      }

      // --- Backend + built-in tool permissions ----------------------------

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let backend: any
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let permissions: any[] | undefined
      if (config.sandboxPolicy) {
        const routes: Record<string, InstanceType<typeof FilesystemBackend>> = {}
        for (const mount of config.sandboxPolicy.mounts) {
          routes[mount.virtualPrefix] = new FilesystemBackend({
            rootDir: mount.hostPath,
            virtualMode: true,
          })
        }
        backend = new CompositeBackend(new StateBackend(), routes)
        // deepagents' built-in file tools (ls/read_file/write_file/edit_file/
        // glob/grep) cannot be disabled — these rules make them enforce the
        // SAME policy as sandbox-filter.ts (ro mounts, secret deny-list,
        // write allowlist).
        permissions = buildFilesystemPermissions(config.sandboxPolicy)
      } else {
        backend = new StateBackend()
      }

      // --- Agent construction ---------------------------------------------

      const { saver: checkpointer, isNew: isNewThread } = getOrCreateCheckpointer(sessionId, MemorySaver)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const agent = createDeepAgent({
        name: 'n8n-desk-agent',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        model: chatModel as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tools: tools as any,
        systemPrompt: config.systemPrompt,
        backend,
        checkpointer,
        interruptOn,
        ...(permissions ? { permissions } : {}),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)

      // --- Input ----------------------------------------------------------

      // A fresh checkpointer (cold start / app restart) needs the history
      // replayed as messages; an existing checkpoint already holds it.
      const messages: Array<{ role: string; content: string }> = []
      if (isNewThread && config.conversationHistory) {
        for (const m of config.conversationHistory) {
          if (m.role === 'user' || m.role === 'assistant') {
            messages.push({ role: m.role, content: m.content })
          }
        }
      }
      messages.push({ role: 'user', content: message })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let input: any = { messages }

      const streamConfig = {
        configurable: { thread_id: sessionId },
        signal: abortController.signal,
        streamMode: ['messages', 'updates'] as const,
      }

      // --- Stream / interrupt-resume loop ----------------------------------

      /** tool_call_id by tool name from the most recent AI message — used to
       * correlate interrupts (which carry name+args, not ids) with the
       * tool_call_start events already emitted. */
      const lastToolCallIdByName = new Map<string, string>()
      /** Resuming after an interrupt re-delivers the agent node's AIMessage —
       * dedupe tool_call_start by id so the renderer sees each call once. */
      const seenToolCallIds = new Set<string>()

      /** Reject stops the run: set when the user rejects an approval. The
       * graph is still resumed (the rejection ToolMessage must commit to the
       * checkpoint or the thread stays suspended and poisons the next turn),
       * then aborted once the rejected results have been yielded — or, as a
       * fallback, when the model starts its next LLM call. */
      let stopOnReject = false
      /** tool_call ids rejected by the user — abort once all are yielded. */
      const rejectedToolCallIds = new Set<string>()

      for (;;) {
        let interruptValue: HitlInterruptValue | null = null
        let questionInterrupt: QuestionInterruptValue | null = null

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const stream = await (agent.stream as any)(input, streamConfig)

        for await (const chunk of stream) {
          if (abortController.signal.aborted) break

          const [mode, payload] = Array.isArray(chunk) && chunk.length === 2
            ? (chunk as [string, unknown])
            : ['updates', chunk] as [string, unknown]

          if (mode === 'messages') {
            const messageEvents = this.normalizeMessageChunk(sessionId, payload)
            // Reject-stop fallback: an AI token chunk means the tool superstep
            // (including the rejection ToolMessage) already committed and the
            // model started reasoning about the rejection — abort before any
            // post-reject text reaches the renderer. ToolMessages also flow
            // through 'messages' mode (normalized to zero events) and must
            // NOT trigger the abort, or the rejection result would be lost.
            if (stopOnReject && messageEvents.length > 0) {
              abortController.abort()
              break
            }
            for (const evt of messageEvents) {
              yield evt
            }
          } else if (mode === 'updates') {
            const { events, interrupt, question } = this.normalizeUpdate(sessionId, payload, lastToolCallIdByName)
            for (const evt of events) {
              if (evt.type === 'tool_call_start') {
                if (seenToolCallIds.has(evt.data.id)) continue
                seenToolCallIds.add(evt.data.id)
              }
              yield evt
              // Reject-stop: the rejection result is now yielded (and will
              // persist to JSONL) — abort once all rejected calls reported.
              if (
                stopOnReject &&
                evt.type === 'tool_call_result' &&
                rejectedToolCallIds.delete(evt.data.id) &&
                rejectedToolCallIds.size === 0
              ) {
                abortController.abort()
              }
            }
            if (interrupt) {
              interruptValue = interrupt
            }
            if (question) {
              questionInterrupt = question
            }
          }
        }

        if (abortController.signal.aborted) break

        // --- ask_user_question: collect answers and resume the tool ---------
        if (questionInterrupt) {
          const questionId = lastToolCallIdByName.get(ASK_USER_QUESTION_TOOL) ?? randomUUID()

          // Register BEFORE yielding — same ordering rule as approvals.
          const answersPromise = this.waitForAnswers(sessionId, questionId, abortController.signal)

          yield {
            type: 'question_asked',
            sessionId,
            data: { id: questionId, questions: questionInterrupt.questions },
          }

          const answers = await answersPromise
          if (abortController.signal.aborted || answers === null) break

          yield {
            type: 'question_answered',
            sessionId,
            data: { id: questionId, answers },
          }

          // Resume the SAME thread — interrupt() inside the tool handler
          // returns the answers and the tool result is the formatted string.
          input = new Command({ resume: answers })
          continue
        }

        if (!interruptValue) break

        // --- Human-in-the-loop: collect a decision per actionRequest --------
        const decisions: Array<{ type: 'approve' } | { type: 'reject'; message: string }> = []
        for (const action of interruptValue.actionRequests) {
          // Silent auto-approve: interruptOn was frozen at agent creation, so
          // a tool granted approve_always EARLIER IN THIS RUN still
          // interrupts — approve it here without emitting any approval
          // events. This is the load-bearing mid-run allowlist path.
          if (isToolAllowed(action.name, sessionAllow) || isToolAllowed(action.name, persistentAllow)) {
            decisions.push({ type: 'approve' })
            continue
          }

          // A reject stops the run — auto-reject the rest of the batch
          // without prompting.
          if (stopOnReject) {
            decisions.push({ type: 'reject', message: 'Cancelled by user.' })
            const remainingId = lastToolCallIdByName.get(action.name)
            if (remainingId) rejectedToolCallIds.add(remainingId)
            continue
          }

          const approvalId = lastToolCallIdByName.get(action.name) ?? randomUUID()

          // Register BEFORE yielding: the consumer may call approve() the
          // moment it receives the event, while this generator is still
          // suspended at the yield.
          const decisionPromise = this.waitForApproval(sessionId, approvalId, action.name, sessionAllow, abortController.signal)

          yield {
            type: 'approval_required',
            sessionId,
            data: {
              id: approvalId,
              toolName: action.name,
              args: action.args ?? {},
              description: action.description ?? `Approve ${action.name}?`,
            },
          }

          const decision = await decisionPromise

          yield {
            type: 'approval_resolved',
            sessionId,
            data: { id: approvalId, decision },
          }

          if (decision === 'approve') {
            decisions.push({ type: 'approve' })
          } else {
            decisions.push({ type: 'reject', message: `The user rejected ${action.name} and stopped the run.` })
            // Only a USER rejection stops the run — an abort-driven one (via
            // stop()) is already stopping.
            if (!abortController.signal.aborted) {
              stopOnReject = true
              rejectedToolCallIds.add(approvalId)
            }
          }
        }

        if (abortController.signal.aborted) break

        // Resume the SAME thread — LangGraph feeds rejections back to the
        // model as the tool outcome; approvals execute the tool for real.
        // On reject-stop the resume is still REQUIRED: it commits the
        // rejection ToolMessage into the checkpoint (a skipped resume leaves
        // the thread suspended on a pending interrupt and poisons the next
        // turn). The abort follows once the rejected results are yielded.
        input = new Command({ resume: { decisions } })
      }

      yield {
        type: 'done',
        sessionId,
        data: { reason: abortController.signal.aborted ? 'cancelled' : 'completed' },
      }
    } catch (err) {
      // Aborting the stream signal (stop() or reject-stop) can surface as an
      // AbortError from LangGraph — that is a cancellation, not a failure.
      if (abortController.signal.aborted) {
        yield { type: 'done', sessionId, data: { reason: 'cancelled' } }
        return
      }
      const errorMessage = err instanceof Error ? err.message : String(err)
      yield {
        type: 'error',
        sessionId,
        data: { message: errorMessage, code: 'AGENT_ERROR' },
      }
      yield { type: 'done', sessionId, data: { reason: 'error' } }
    } finally {
      this.cleanup(sessionId)
    }
  }

  async stop(sessionId: string): Promise<void> {
    const controller = this.abortControllers.get(sessionId)
    if (controller) {
      controller.abort()
    }

    // Reject all pending approvals for this session
    const pending = this.pendingApprovals.get(sessionId)
    if (pending) {
      for (const approval of pending.values()) {
        approval.resolve('reject')
      }
      pending.clear()
    }

    // Cancel all pending questions for this session
    const questions = this.pendingQuestions.get(sessionId)
    if (questions) {
      for (const question of questions.values()) {
        question.resolve(null)
      }
      questions.clear()
    }

    this.cleanup(sessionId)
  }

  async approve(sessionId: string, approvalId: string, decision: ApprovalDecision): Promise<boolean> {
    const pending = this.pendingApprovals.get(sessionId)
    if (!pending || pending.size === 0) {
      return false
    }

    const approval = pending.get(approvalId)
    if (approval) {
      pending.delete(approvalId)
      if (decision === 'approve_always') {
        // Grant future calls of this tool for the rest of the session, then
        // approve the pending one. The allow set is the live IPC-owned Set,
        // so the grant survives runner recreation on the next invoke.
        approval.allowSet.add(canonicalToolName(approval.toolName))
        approval.resolve('approve')
      } else {
        approval.resolve(decision)
      }
      return true
    }

    return false
  }

  async answer(sessionId: string, questionId: string, answers: AskUserAnswers): Promise<boolean> {
    const pending = this.pendingQuestions.get(sessionId)
    if (!pending || pending.size === 0) {
      return false
    }

    const question = pending.get(questionId)
    if (question) {
      pending.delete(questionId)
      question.resolve(answers)
      return true
    }

    return false
  }

  private cleanup(sessionId: string): void {
    this.abortControllers.delete(sessionId)
    this.pendingApprovals.delete(sessionId)
    this.pendingQuestions.delete(sessionId)
    // NOTE: the session checkpointer is intentionally kept — it carries
    // multi-turn state for the next invoke on this session.
  }

  private waitForApproval(
    sessionId: string,
    approvalId: string,
    toolName: string,
    allowSet: Set<string>,
    signal: AbortSignal,
  ): Promise<'approve' | 'reject'> {
    return new Promise<'approve' | 'reject'>((resolve) => {
      if (signal.aborted) {
        resolve('reject')
        return
      }
      this.pendingApprovals.get(sessionId)?.set(approvalId, { toolName, allowSet, resolve })

      const onAbort = (): void => {
        this.pendingApprovals.get(sessionId)?.delete(approvalId)
        resolve('reject')
      }
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  private waitForAnswers(
    sessionId: string,
    questionId: string,
    signal: AbortSignal,
  ): Promise<AskUserAnswers | null> {
    return new Promise<AskUserAnswers | null>((resolve) => {
      if (signal.aborted) {
        resolve(null)
        return
      }
      this.pendingQuestions.get(sessionId)?.set(questionId, { resolve })

      const onAbort = (): void => {
        this.pendingQuestions.get(sessionId)?.delete(questionId)
        resolve(null)
      }
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  /**
   * Normalize a 'messages'-mode chunk ([AIMessageChunk, metadata]) into
   * text_chunk / thinking events.
   */
  private normalizeMessageChunk(sessionId: string, payload: unknown): AgentStreamEvent[] {
    const events: AgentStreamEvent[] = []
    if (!Array.isArray(payload) || payload.length === 0) return events

    const messageChunk = payload[0] as Record<string, unknown> | undefined
    if (!messageChunk) return events

    // Only surface LLM token chunks (AIMessageChunk) — tool messages also
    // flow through 'messages' mode but are handled via 'updates'.
    const getType = (messageChunk as { getType?: () => string }).getType
    const msgType = typeof getType === 'function' ? getType.call(messageChunk) : undefined
    if (msgType !== undefined && msgType !== 'ai' && msgType !== 'AIMessageChunk') return events

    const content = messageChunk.content
    let text = ''
    let thinking = ''
    if (typeof content === 'string') {
      text = content
    } else if (Array.isArray(content)) {
      for (const rawBlock of content) {
        if (!rawBlock || typeof rawBlock !== 'object') continue
        const block = rawBlock as Record<string, unknown>
        if (block.type === 'thinking' && typeof block.thinking === 'string') {
          thinking += block.thinking
        } else if ((block.type === 'text' || block.type === 'text_delta') && typeof block.text === 'string') {
          text += block.text
        }
      }
    }

    if (thinking) {
      events.push({ type: 'thinking', sessionId, data: { text: thinking } })
    }
    if (text) {
      events.push({ type: 'text_chunk', sessionId, data: { text } })
    }
    return events
  }

  /**
   * Normalize an 'updates'-mode chunk (Record<nodeName, stateUpdate>) into
   * tool_call_start / tool_call_result / todo_update events and capture
   * `__interrupt__` payloads for the resume loop.
   */
  private normalizeUpdate(
    sessionId: string,
    payload: unknown,
    lastToolCallIdByName: Map<string, string>,
  ): { events: AgentStreamEvent[]; interrupt: HitlInterruptValue | null; question: QuestionInterruptValue | null } {
    const events: AgentStreamEvent[] = []
    let interrupt: HitlInterruptValue | null = null
    let question: QuestionInterruptValue | null = null

    if (!payload || typeof payload !== 'object') return { events, interrupt, question }

    for (const [key, update] of Object.entries(payload as Record<string, unknown>)) {
      if (key === '__interrupt__') {
        // Array of Interrupt objects. Two shapes reach us here:
        // - HITL approval: the middleware bundles all pending tool calls into
        //   ONE interrupt whose value is a HITLRequest ({ actionRequests }).
        // - ask_user_question: the tool handler's interrupt() carries our
        //   QuestionInterruptValue ({ kind, questions }).
        const interrupts = update as Array<{ value?: unknown }> | undefined
        const value = interrupts?.[0]?.value as HitlInterruptValue | undefined
        if (value && Array.isArray(value.actionRequests)) {
          interrupt = value
        } else if (isQuestionInterrupt(value)) {
          question = value
        }
        continue
      }

      if (!update || typeof update !== 'object') continue
      const stateUpdate = update as Record<string, unknown>

      // Messages produced by this node (AI tool calls / tool results)
      const messages = stateUpdate.messages
      if (Array.isArray(messages)) {
        for (const rawMsg of messages) {
          if (!rawMsg || typeof rawMsg !== 'object') continue
          const m = rawMsg as Record<string, unknown>
          const getType = (m as { getType?: () => string }).getType
          const msgType = typeof getType === 'function' ? getType.call(m) : undefined

          // Tool result (ToolMessage)
          if (msgType === 'tool' || typeof m.tool_call_id === 'string') {
            const id = String(m.tool_call_id ?? randomUUID())
            const name = typeof m.name === 'string' ? m.name : ''
            const rawContent = m.content
            const resultStr = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent ?? '')
            const isError = m.status === 'error'
            events.push({
              type: 'tool_call_result',
              sessionId,
              data: {
                id,
                name,
                result: resultStr,
                success: !isError,
                ...(isError ? { error: resultStr } : {}),
              },
            })
            continue
          }

          // AI message with tool calls
          const toolCalls = m.tool_calls
          if ((msgType === 'ai' || msgType === undefined) && Array.isArray(toolCalls)) {
            for (const rawCall of toolCalls) {
              if (!rawCall || typeof rawCall !== 'object') continue
              const call = rawCall as Record<string, unknown>
              const name = typeof call.name === 'string' ? call.name : 'unknown'
              const id = typeof call.id === 'string' && call.id ? call.id : randomUUID()
              lastToolCallIdByName.set(name, id)
              events.push({
                type: 'tool_call_start',
                sessionId,
                data: {
                  id,
                  name,
                  args: (call.args as Record<string, unknown>) ?? {},
                },
              })
            }
          }
        }
      }

      // Todo updates (deepagents todo middleware state: { content, status })
      const todos = stateUpdate.todos
      if (Array.isArray(todos)) {
        events.push({
          type: 'todo_update',
          sessionId,
          data: {
            todos: todos.map((rawTodo, index) => {
              const todo = (rawTodo ?? {}) as Record<string, unknown>
              const status = typeof todo.status === 'string' ? todo.status : 'pending'
              return {
                id: String(index),
                title: typeof todo.content === 'string' ? todo.content : '',
                status: (['pending', 'in_progress', 'completed', 'failed'].includes(status)
                  ? status
                  : 'pending') as 'pending' | 'in_progress' | 'completed' | 'failed',
              }
            }),
          },
        })
      }
    }

    return { events, interrupt, question }
  }
}
