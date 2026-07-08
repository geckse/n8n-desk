import { randomUUID } from 'crypto'
import { spawn } from 'child_process'
import os from 'os'
import type {
  AgentRunner,
  AgentRunnerConfig,
  AgentStreamEvent,
} from './types'
import {
  DESTRUCTIVE_TOOLS,
  requiresApproval,
  isN8nToolDenied,
  isToolAllowed,
  canonicalToolName,
  type ApprovalDecision,
} from './approval'
import {
  ASK_USER_QUESTION_TOOL,
  type AskUserQuestionItem,
  type AskUserAnswers,
} from './ask-user-question'
import { AsyncEventQueue } from './event-queue'

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

/**
 * Fallback abort delay after a reject (ms). Reject stops the run, but only
 * AFTER the denied call's tool_result is pumped (so it persists to JSONL).
 * If the SDK never surfaces that result, this timer aborts anyway so the
 * session cannot hang.
 */
const REJECT_STOP_FALLBACK_MS = 3_000

/**
 * MCP tool timeout for the CLI subprocess (ms) — the ONLY timeout knob the
 * CLI exposes, and it is global across all MCP tools. Set to a "human budget"
 * (24h): ask_user_question blocks its in-process MCP handler until the user
 * answers in the UI, and a 6-minute ceiling would kill a question the user
 * left open over lunch. Server-side budgets still bound n8n calls (e.g.
 * execute_workflow's 5-minute budget returns or errors on its own), and
 * stop() remains the escape hatch for a wedged call.
 */
const MCP_TOOL_TIMEOUT_MS = 86_400_000

/**
 * Claude Agent SDK runner implementation.
 *
 * Uses the `query()` API from @anthropic-ai/claude-agent-sdk, which spawns the
 * SDK's bundled CLI as a subprocess and talks line-delimited JSON to it.
 *
 * Key behaviors:
 * - All events flow through ONE AsyncEventQueue with two producers: the SDK
 *   message pump and the canUseTool callback. This is load-bearing: while the
 *   SDK is blocked inside canUseTool awaiting a decision it emits no messages,
 *   so a queue drained only per-message would never deliver approval_required.
 * - Approval gating is namespace-aware (`mcp__{server}__{tool}`) via the
 *   shared requiresApproval matcher — a bare-name check never matches and
 *   silently allows destructive tools.
 * - The approval id is the SDK's toolUseID, so it correlates with the
 *   tool_call_start the renderer already tracks.
 * - Token-level streaming via includePartialMessages; complete assistant
 *   messages are used only for tool_use blocks (no double text).
 * - The CLI subprocess is spawned via process.execPath + ELECTRON_RUN_AS_NODE
 *   so packaged Electron apps work without a system `node` on PATH.
 */
export class ClaudeSdkRunner implements AgentRunner {
  private abortControllers = new Map<string, AbortController>()
  private pendingApprovals = new Map<string, Map<string, PendingApproval>>()
  private pendingQuestions = new Map<string, Map<string, PendingQuestion>>()
  /**
   * tool_use id of the session's latest ask_user_question call, captured in
   * canUseTool (which fires BEFORE the MCP handler runs — race-free) so
   * question_asked correlates with the tool_call_start the renderer tracked.
   */
  private lastQuestionToolUseId = new Map<string, string>()
  private activeQueries = new Map<string, { close: () => void }>()
  /** Per-session in-process MCP servers for file tools (cleanup via McpServer.close()) */
  private localMcpServers = new Map<string, { close: () => Promise<void> }>()
  /** Maps tool_use block ID → tool name so tool_call_result can include the name */
  private toolNameMap = new Map<string, string>()
  /** tool_use ids surfaced as todo_update instead of tool cards — results suppressed */
  private suppressedToolIds = new Set<string>()
  /**
   * Per-session ids of tool calls the user rejected. Reject stops the run:
   * once the denied call's tool_call_result is pumped, the runner aborts.
   */
  private rejectedToolIds = new Map<string, Set<string>>()
  /** Per-session fallback timers for the reject-stop abort. */
  private rejectFallbackTimers = new Map<string, NodeJS.Timeout>()

  async *invoke(
    sessionId: string,
    message: string,
    config: AgentRunnerConfig,
  ): AsyncIterable<AgentStreamEvent> {
    // Lazy import — the SDK is ESM-only and heavy
    let queryFn: typeof import('@anthropic-ai/claude-agent-sdk').query
    try {
      const sdk = await import('@anthropic-ai/claude-agent-sdk')
      queryFn = sdk.query
    } catch {
      yield {
        type: 'error',
        sessionId,
        data: {
          message: 'The Claude Agent SDK could not be loaded. Reinstall n8n-desk or switch to Deep Agents in Settings > AI/Agent.',
          code: 'CLAUDE_SDK_NOT_FOUND',
        },
      }
      yield { type: 'done', sessionId, data: { reason: 'error' } }
      return
    }

    const abortController = new AbortController()
    this.abortControllers.set(sessionId, abortController)
    this.pendingApprovals.set(sessionId, new Map())
    this.pendingQuestions.set(sessionId, new Map())
    this.rejectedToolIds.set(sessionId, new Set())

    const queue = new AsyncEventQueue<AgentStreamEvent>()

    const interruptTools = new Set([
      ...DESTRUCTIVE_TOOLS,
      ...(config.interruptOnTools ?? []),
    ])
    // Session allow set is the LIVE Set owned by the IPC layer — approve()
    // mutates it on approve_always and it persists across invokes.
    const sessionAllow = config.sessionAllowedTools ?? new Set<string>()
    const persistentAllow = config.alwaysAllowedTools ?? []

    const stopAfterRejectedResult = (): void => {
      const timer = this.rejectFallbackTimers.get(sessionId)
      if (timer) {
        clearTimeout(timer)
        this.rejectFallbackTimers.delete(sessionId)
      }
      abortController.abort()
      this.activeQueries.get(sessionId)?.close()
    }

    const canUseTool: import('@anthropic-ai/claude-agent-sdk').CanUseTool = async (
      toolName,
      input,
      options,
    ) => {
      // TodoWrite is the plan-tracking built-in — surface it as todo_update
      // and always allow (never a destructive operation).
      if (toolName === 'TodoWrite') {
        const todos = this.mapTodoWriteInput(input)
        if (todos) {
          queue.push({ type: 'todo_update', sessionId, data: { todos } })
        }
        return { behavior: 'allow' as const, updatedInput: input }
      }

      // ask_user_question is never approval-gated (it IS the human
      // interaction). Capture its toolUseID here — canUseTool fires before
      // the MCP handler runs, so the id is in place when askUser needs it.
      if (toolName.endsWith(`__${ASK_USER_QUESTION_TOOL}`)) {
        this.lastQuestionToolUseId.set(sessionId, options.toolUseID ?? randomUUID())
        return { behavior: 'allow' as const, updatedInput: input }
      }

      // Mode restrictions (audit #12): denied tools are hidden via
      // disallowedTools below, but the deny here is the enforcement — the
      // CLI's tool list is discovered from the live server and could drift.
      if (config.deniedTools && isN8nToolDenied(toolName, config.deniedTools)) {
        return {
          behavior: 'deny' as const,
          message: `${toolName} is not available in this mode. Workflow lifecycle management (update/publish/unpublish/archive) requires Workflow mode.`,
        }
      }

      // Deny beats allow: the mode-restriction deny above must run before the
      // allowlists. A tool prompts only when it is gated AND not covered by
      // the session grant (approve_always) or the persistent presets.
      const gated =
        requiresApproval(toolName, interruptTools) &&
        !isToolAllowed(toolName, sessionAllow) &&
        !isToolAllowed(toolName, persistentAllow)
      if (!gated) {
        return { behavior: 'allow' as const, updatedInput: input }
      }

      // Use the SDK's toolUseID so the approval correlates with the
      // tool_call_start the renderer tracked from the assistant message.
      const approvalId = options.toolUseID ?? randomUUID()

      queue.push({
        type: 'approval_required',
        sessionId,
        data: { id: approvalId, toolName, args: input, description: `Approve ${toolName}?` },
      })

      const decision = await new Promise<'approve' | 'reject'>((resolve) => {
        this.pendingApprovals.get(sessionId)?.set(approvalId, { toolName, allowSet: sessionAllow, resolve })

        const onAbort = (): void => {
          this.pendingApprovals.get(sessionId)?.delete(approvalId)
          resolve('reject')
        }
        options.signal.addEventListener('abort', onAbort, { once: true })
      })
      this.pendingApprovals.get(sessionId)?.delete(approvalId)

      queue.push({
        type: 'approval_resolved',
        sessionId,
        data: { id: approvalId, decision },
      })

      if (decision === 'approve') {
        return { behavior: 'allow' as const, updatedInput: input }
      }

      // Reject stops the run. The deny result must reach JSONL first (the
      // store persists on tool_call_result), so the abort happens when the
      // pump sees this id — with a fallback timer in case the SDK never
      // surfaces the result. Skip when the session is already aborted
      // (stop() resolves pending approvals as reject).
      if (!abortController.signal.aborted) {
        this.rejectedToolIds.get(sessionId)?.add(approvalId)
        this.rejectFallbackTimers.set(
          sessionId,
          setTimeout(stopAfterRejectedResult, REJECT_STOP_FALLBACK_MS),
        )
      }
      return { behavior: 'deny' as const, message: `The user rejected ${toolName} and stopped the run.` }
    }

    // Build the MCP servers map: n8n entry + custom servers + in-process local tools.
    const mcpServers: Record<string, unknown> = {
      'n8n': {
        type: 'http',
        url: config.mcpUrl,
        headers: {
          Authorization: `Bearer ${config.mcpAccessToken}`,
        },
      },
    }

    if (config.customMcpServers) {
      for (const [name, serverConfig] of Object.entries(config.customMcpServers)) {
        if (name === 'n8n') continue // reserved
        mcpServers[name] = {
          type: serverConfig.type,
          url: serverConfig.url,
          headers: { ...serverConfig.headers },
        }
      }
    }

    // Expose the shared local toolset (sandboxed file tools + js_compute +
    // memory + skills + ask_user_question) via an in-process MCP server —
    // identical surface to the Deep Agents backend (parity invariant). The
    // server is created unconditionally: ask_user_question is always
    // available, matching the Deep Agents backend.
    {
      // The blocking wait for the user's answer lives HERE, in the MCP tool
      // handler — canUseTool can only allow/deny, it cannot inject a tool
      // result. Events go through the shared queue so they interleave while
      // the SDK is blocked inside the tool call.
      const askUser = async (questions: AskUserQuestionItem[]): Promise<AskUserAnswers> => {
        const questionId = this.lastQuestionToolUseId.get(sessionId) ?? randomUUID()

        queue.push({
          type: 'question_asked',
          sessionId,
          data: { id: questionId, questions },
        })

        const answers = await new Promise<AskUserAnswers | null>((resolve) => {
          if (abortController.signal.aborted) {
            resolve(null)
            return
          }
          this.pendingQuestions.get(sessionId)?.set(questionId, { resolve })
          const onAbort = (): void => {
            this.pendingQuestions.get(sessionId)?.delete(questionId)
            resolve(null)
          }
          abortController.signal.addEventListener('abort', onAbort, { once: true })
        })
        this.pendingQuestions.get(sessionId)?.delete(questionId)

        if (answers === null) {
          throw new Error('The user cancelled the session before answering.')
        }

        queue.push({
          type: 'question_answered',
          sessionId,
          data: { id: questionId, answers },
        })

        return answers
      }

      try {
        const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')
        const { registerAgentTools } = await import('./agent-tool-registry')

        const mcpServer = new McpServer(
          { name: 'n8n-desk-local', version: '1.0.0' },
          { capabilities: { tools: {} } },
        )
        const registered = registerAgentTools(mcpServer, config.sandboxPolicy, config.skills ?? [], {
          memoryFilePath: config.memoryFilePath,
          askUser,
        })
        console.log(`[n8n-desk] Registered ${registered} local tools on in-process MCP server`)

        this.localMcpServers.set(sessionId, mcpServer)
        mcpServers['n8n-desk-local'] = {
          type: 'sdk',
          name: 'n8n-desk-local',
          instance: mcpServer,
        }
      } catch (err) {
        // Non-fatal: file tools won't be available, but n8n MCP tools still work
        console.error(
          '[n8n-desk] Failed to register local file tools MCP server:',
          err instanceof Error ? err.stack : String(err),
        )
      }
    }

    // Build the prompt: if we have conversation history, format it as context
    let fullPrompt = message
    if (config.conversationHistory && config.conversationHistory.length > 0) {
      const historyBlock = config.conversationHistory
        .map((m) => `${m.role === 'user' ? 'Human' : 'Assistant'}: ${m.content}`)
        .join('\n\n')
      fullPrompt = `<conversation_history>\n${historyBlock}\n</conversation_history>\n\nHuman: ${message}`
    }

    try {
      const queryInstance = queryFn({
        prompt: fullPrompt,
        options: {
          model: config.llmConfig.model,
          systemPrompt: config.systemPrompt,
          abortController,
          permissionMode: 'acceptEdits',
          canUseTool,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          mcpServers: mcpServers as any,
          // TodoWrite is the only built-in we keep — it powers todo_update
          // parity with the Deep Agents backend. Everything else comes from
          // MCP servers so the sandbox filter is the only file-access path.
          tools: ['TodoWrite'],
          // Hide mode-restricted n8n tools from the model entirely; the
          // canUseTool deny above stays as the enforcement backstop (#12).
          ...(config.deniedTools && config.deniedTools.length > 0
            ? { disallowedTools: config.deniedTools.map((t) => `mcp__n8n__${t}`) }
            : {}),
          // Token-level streaming (stream_event messages) requires this flag.
          includePartialMessages: true,
          // ONLY the servers configured above — without this the CLI also
          // loads the user's personal Claude Code MCP servers (~/.claude.json),
          // polluting the tool surface and routing n8n calls to whatever
          // connectors the user has configured globally.
          strictMcpConfig: true,
          // Never write session files into ~/.claude/projects/
          persistSession: false,
          cwd: os.homedir(),
          env: {
            ...process.env,
            ...(config.llmConfig.apiKey ? { ANTHROPIC_API_KEY: config.llmConfig.apiKey } : {}),
            // Long n8n workflow executions exceed the CLI's default MCP tool
            // timeout — align it with the server's 5-minute budget.
            MCP_TOOL_TIMEOUT: String(MCP_TOOL_TIMEOUT_MS),
          },
          // Spawn the bundled CLI through OUR executable in Node mode.
          // Packaged Electron apps have no `node` on PATH; process.execPath +
          // ELECTRON_RUN_AS_NODE works in dev (plain node ignores the var) and
          // in production builds alike.
          spawnClaudeCodeProcess: (spawnOpts) => spawn(process.execPath, spawnOpts.args, {
            cwd: spawnOpts.cwd,
            env: { ...spawnOpts.env, ELECTRON_RUN_AS_NODE: '1' },
            signal: spawnOpts.signal,
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
          }),
        },
      })

      this.activeQueries.set(sessionId, queryInstance)

      // Producer: pump SDK messages into the queue. Runs detached from the
      // consumer loop so canUseTool events interleave even while the pump is
      // blocked. Exactly one terminal done/error pair is enqueued here.
      void (async () => {
        let sawResultError = false
        try {
          for await (const sdkMessage of queryInstance) {
            if (abortController.signal.aborted) break
            const events = this.normalizeMessage(sessionId, sdkMessage)
            let sawRejectedResult = false
            for (const event of events) {
              if (event.type === 'error') sawResultError = true
              queue.push(event)
              if (
                event.type === 'tool_call_result' &&
                this.rejectedToolIds.get(sessionId)?.has(event.data.id)
              ) {
                sawRejectedResult = true
              }
            }
            // Reject-stop: the denied call's result is now in the queue (and
            // will persist to JSONL) — abort before the model reasons further.
            if (sawRejectedResult) {
              stopAfterRejectedResult()
              break
            }
          }
        } catch (err) {
          if (!abortController.signal.aborted) {
            sawResultError = true
            queue.push({
              type: 'error',
              sessionId,
              data: {
                message: err instanceof Error ? err.message : String(err),
                code: 'AGENT_ERROR',
              },
            })
          }
        } finally {
          queue.push({
            type: 'done',
            sessionId,
            data: {
              reason: abortController.signal.aborted
                ? 'cancelled'
                : sawResultError ? 'error' : 'completed',
            },
          })
          queue.close()
        }
      })()

      for await (const event of queue) {
        yield event
      }
    } catch (err) {
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

    const query = this.activeQueries.get(sessionId)
    if (query) {
      query.close()
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
    this.lastQuestionToolUseId.delete(sessionId)
    this.activeQueries.delete(sessionId)
    this.toolNameMap.clear()
    this.suppressedToolIds.clear()
    this.rejectedToolIds.delete(sessionId)
    const rejectTimer = this.rejectFallbackTimers.get(sessionId)
    if (rejectTimer) {
      clearTimeout(rejectTimer)
      this.rejectFallbackTimers.delete(sessionId)
    }

    // Close the per-session in-process MCP server (file tools + js_compute)
    const localServer = this.localMcpServers.get(sessionId)
    if (localServer) {
      localServer.close().catch(() => {})
      this.localMcpServers.delete(sessionId)
    }
  }

  /** Map a TodoWrite tool input to the todo_update event shape. */
  private mapTodoWriteInput(
    input: Record<string, unknown>,
  ): Array<{ id: string; title: string; status: 'pending' | 'in_progress' | 'completed' | 'failed' }> | null {
    const todos = input.todos
    if (!Array.isArray(todos)) return null
    return todos.map((t, index) => {
      const todo = (t ?? {}) as Record<string, unknown>
      const status = typeof todo.status === 'string' ? todo.status : 'pending'
      return {
        id: String(index),
        title: typeof todo.content === 'string' ? todo.content : '',
        status: (['pending', 'in_progress', 'completed', 'failed'].includes(status)
          ? status
          : 'pending') as 'pending' | 'in_progress' | 'completed' | 'failed',
      }
    })
  }

  /**
   * Normalize an SDK message into zero or more AgentStreamEvents.
   *
   * - stream_event (partial): token-level text_chunk / thinking deltas
   * - assistant: tool_use blocks ONLY → tool_call_start (text already streamed)
   * - user: tool_result blocks → tool_call_result (success from is_error flag)
   * - result: real error subtypes (error_during_execution / error_max_turns /
   *   error_max_budget_usd / …) → error event
   */
  private normalizeMessage(
    sessionId: string,
    msg: import('@anthropic-ai/claude-agent-sdk').SDKMessage,
  ): AgentStreamEvent[] {
    const events: AgentStreamEvent[] = []

    switch (msg.type) {
      case 'stream_event': {
        const event = (msg as Record<string, unknown>).event as Record<string, unknown> | undefined
        if (event?.type === 'content_block_delta') {
          const delta = event.delta as Record<string, unknown> | undefined
          if (delta?.type === 'text_delta' && typeof delta.text === 'string' && delta.text) {
            events.push({ type: 'text_chunk', sessionId, data: { text: delta.text } })
          } else if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string' && delta.thinking) {
            events.push({ type: 'thinking', sessionId, data: { text: delta.thinking } })
          }
        }
        break
      }

      case 'assistant': {
        // Text/thinking blocks were already streamed via stream_event deltas —
        // only extract tool_use blocks here.
        const message = (msg as Record<string, unknown>).message as { content?: unknown[] } | undefined
        if (Array.isArray(message?.content)) {
          for (const rawBlock of message.content) {
            const block = rawBlock as Record<string, unknown>
            if (block.type !== 'tool_use') continue
            const id = String(block.id ?? randomUUID())
            const name = String(block.name ?? 'unknown')
            // TodoWrite is surfaced as todo_update from canUseTool, not as a
            // tool card.
            if (name === 'TodoWrite') {
              this.suppressedToolIds.add(id)
              continue
            }
            this.toolNameMap.set(id, name)
            events.push({
              type: 'tool_call_start',
              sessionId,
              data: {
                id,
                name,
                args: (block.input as Record<string, unknown>) ?? {},
              },
            })
          }
        }
        break
      }

      case 'user': {
        // Tool results come back as 'user' messages containing tool_result blocks.
        const userMsg = msg as Record<string, unknown>
        const message = userMsg.message as { content?: unknown[] } | undefined
        if (Array.isArray(message?.content)) {
          for (const rawBlock of message.content) {
            const block = rawBlock as Record<string, unknown>
            if (block.type !== 'tool_result') continue
            const toolUseId = typeof block.tool_use_id === 'string' ? block.tool_use_id : null
            if (!toolUseId) continue
            if (this.suppressedToolIds.has(toolUseId)) {
              this.suppressedToolIds.delete(toolUseId)
              continue
            }

            const toolName = this.toolNameMap.get(toolUseId) ?? ''

            const rawContent = block.content ?? userMsg.tool_use_result
            const resultStr = typeof rawContent === 'string'
              ? rawContent
              : JSON.stringify(rawContent ?? '')
            const isError = block.is_error === true

            events.push({
              type: 'tool_call_result',
              sessionId,
              data: {
                id: toolUseId,
                name: toolName,
                result: resultStr,
                success: !isError,
                ...(isError ? { error: resultStr } : {}),
              },
            })
          }
        }
        break
      }

      case 'result': {
        // Real error subtypes are error_during_execution / error_max_turns /
        // error_max_budget_usd / error_max_structured_output_retries.
        // (`subtype === 'error'` does not exist and never matches.)
        const resultMsg = msg as Record<string, unknown>
        const subtype = String(resultMsg.subtype ?? '')
        if (subtype.startsWith('error')) {
          const errors = resultMsg.errors
          const detail = Array.isArray(errors) && errors.length > 0
            ? errors.map(String).join('; ')
            : `Agent stopped: ${subtype.replace(/^error_?/, '').replace(/_/g, ' ')}`
          events.push({
            type: 'error',
            sessionId,
            data: { message: detail, code: subtype.toUpperCase() },
          })
        }
        break
      }

      case 'system':
      case 'tool_progress':
        // init/status/progress — no renderer-visible events
        break

      default:
        break
    }

    return events
  }
}
