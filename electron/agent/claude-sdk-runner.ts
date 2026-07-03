import { randomUUID } from 'crypto'
import os from 'os'
import type {
  AgentRunner,
  AgentRunnerConfig,
  AgentStreamEvent,
} from './types'

// Destructive MCP tools that require user approval before execution
const DESTRUCTIVE_TOOLS = new Set([
  'create_workflow_from_code',
  'update_workflow',
  'publish_workflow',
  'archive_workflow',
  'execute_workflow',
])

/** Deferred promise that can be resolved externally */
interface PendingApproval {
  id: string
  toolName: string
  args: Record<string, unknown>
  resolve: (decision: 'approve' | 'reject') => void
}

/**
 * Claude Agent SDK runner implementation.
 *
 * Uses the `query()` API from @anthropic-ai/claude-agent-sdk to run an agent
 * with native MCP server support. The SDK spawns a Claude Code subprocess,
 * so it requires the Claude Code CLI to be installed on the system.
 *
 * Key behaviors:
 * - Passes mcpServers config pointing to n8n's /mcp-server/http with Bearer auth
 * - Uses canUseTool callback to intercept destructive MCP tools and emit approval_required events
 * - Normalizes SDK messages to AgentStreamEvent format
 * - Uses AbortController for stop() support
 * - Tracks pending approvals via a Map of deferred promises resolved by approve()
 */
export class ClaudeSdkRunner implements AgentRunner {
  private abortControllers = new Map<string, AbortController>()
  private pendingApprovals = new Map<string, PendingApproval>()
  private activeQueries = new Map<string, { close: () => void }>()
  /** Per-session in-process MCP servers for file tools (cleanup via McpServer.close()) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private localMcpServers = new Map<string, { close: () => Promise<void> }>()
  /** Maps tool_use block ID → tool name so tool_call_result can include the name */
  private toolNameMap = new Map<string, string>()

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
          message: 'Claude Code is required for the Claude Agent SDK backend. Install it or switch to Deep Agents in Settings > AI/Agent.',
          code: 'CLAUDE_CODE_NOT_FOUND',
        },
      }
      yield { type: 'done', sessionId, data: { reason: 'error' } }
      return
    }

    const abortController = new AbortController()
    this.abortControllers.set(sessionId, abortController)

    // Build the event channel — we yield from a queue since canUseTool is called
    // asynchronously by the SDK and needs to emit events into our stream.
    const eventQueue: AgentStreamEvent[] = []
    let eventResolve: (() => void) | null = null

    const pushEvent = (event: AgentStreamEvent): void => {
      eventQueue.push(event)
      if (eventResolve) {
        eventResolve()
        eventResolve = null
      }
    }

    // canUseTool callback — intercept destructive tools for approval.
    // Must return the full PermissionResult type the SDK expects.
    // Always include built-in destructive tools, plus any additional tools from
    // approval-required custom MCP servers (populated by the IPC handler via
    // PluginManager.getApprovalRequiredServerNames() + tool discovery).
    const interruptTools = new Set([
      ...DESTRUCTIVE_TOOLS,
      ...(config.interruptOnTools ?? []),
    ])
    const canUseTool: import('@anthropic-ai/claude-agent-sdk').CanUseTool = async (
      toolName,
      input,
      options,
    ) => {
      // Only intercept tools that require approval
      if (!interruptTools.has(toolName)) {
        return { behavior: 'allow' as const, updatedInput: input }
      }

      const approvalId = randomUUID()
      const description = `Approve ${toolName}?`

      pushEvent({
        type: 'approval_required',
        sessionId,
        data: { id: approvalId, toolName, args: input, description },
      })

      // Wait for user decision
      const decision = await new Promise<'approve' | 'reject'>((resolve) => {
        this.pendingApprovals.set(sessionId, {
          id: approvalId,
          toolName,
          args: input,
          resolve,
        })

        // If abort is signaled while waiting, reject
        const onAbort = (): void => {
          this.pendingApprovals.delete(sessionId)
          resolve('reject')
        }
        options.signal.addEventListener('abort', onAbort, { once: true })
      })

      pushEvent({
        type: 'approval_resolved',
        sessionId,
        data: { id: approvalId, decision },
      })

      if (decision === 'approve') {
        return { behavior: 'allow' as const, updatedInput: input }
      }
      return { behavior: 'deny' as const, message: `User rejected ${toolName}` }
    }

    // Use the resolved MCP endpoint + token (default n8n MCP or per-instance custom override)
    const mcpServerUrl = config.mcpUrl

    // Build the MCP servers map: n8n entry + any custom servers from plugins/standalone.
    // Credential isolation: MCP Bearer token only in the 'n8n' entry, each custom server
    // only gets its own headers. Server names must be unique — 'n8n' is reserved.
    const mcpServers: Record<string, { type: 'http'; url: string; headers: Record<string, string> }> = {
      'n8n': {
        type: 'http',
        url: mcpServerUrl,
        headers: {
          Authorization: `Bearer ${config.mcpAccessToken}`,
        },
      },
    }

    if (config.customMcpServers) {
      for (const [name, serverConfig] of Object.entries(config.customMcpServers)) {
        // Skip if name collides with the reserved 'n8n' entry
        if (name === 'n8n') continue
        mcpServers[name] = {
          type: serverConfig.type,
          url: serverConfig.url,
          headers: { ...serverConfig.headers },
        }
      }
    }

    // Expose sandboxed file tools + js_compute via an in-process MCP server
    // using the SDK's native McpSdkServerConfigWithInstance. This avoids the
    // HTTP localhost server entirely — the SDK talks to our McpServer instance
    // directly in-process, which is faster and more reliable.
    if (config.sandboxPolicy) {
      try {
        const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')
        const { createFileTools } = await import('./file-tools')
        const { jsComputeTool } = await import('./js-sandbox')

        const mcpServer = new McpServer(
          { name: 'n8n-desk-local', version: '1.0.0' },
          { capabilities: { tools: {} } },
        )

        // Register all file tools + js_compute as MCP tools on the in-process server
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const allTools: any[] = [...createFileTools(config.sandboxPolicy), jsComputeTool]
        for (const lcTool of allTools) {
          const zodShape = lcTool.schema?.shape
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const handler = async (args: Record<string, unknown>): Promise<any> => {
            try {
              const result = await lcTool.invoke(args)
              return {
                content: [{
                  type: 'text' as const,
                  text: typeof result === 'string' ? result : JSON.stringify(result),
                }],
              }
            } catch (err: unknown) {
              const message = err instanceof Error ? err.message : String(err)
              return {
                content: [{
                  type: 'text' as const,
                  text: JSON.stringify({ success: false, error: message }),
                }],
                isError: true,
              }
            }
          }
          if (zodShape) {
            mcpServer.tool(lcTool.name, lcTool.description ?? '', zodShape, handler)
          } else {
            mcpServer.tool(lcTool.name, lcTool.description ?? '', handler)
          }
        }

        // Register skill tools (invoke_skill + read_skill_file) when skills are configured
        if (config.skills && config.skills.length > 0) {
          const { substituteArguments, readSupportingFile } = await import('../skill-loader')
          const { z } = await import('zod')
          const skills = config.skills

          mcpServer.tool(
            'invoke_skill',
            'Load a skill by name. Returns the full instructions with arguments substituted. If the content references additional files (e.g., [PATTERNS.md](PATTERNS.md)), use read_skill_file to load them.',
            {
              skillName: z.string().describe('The kebab-case name of the skill to invoke'),
              arguments: z.string().optional().describe('Arguments to substitute into the skill content'),
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            async (args: { skillName: string; arguments?: string }): Promise<any> => {
              const skill = skills.find((s) => s.name === args.skillName)
              if (!skill) {
                return { content: [{ type: 'text' as const, text: `Skill "${args.skillName}" not found.` }], isError: true }
              }
              return { content: [{ type: 'text' as const, text: substituteArguments(skill.content, args.arguments ?? '') }] }
            },
          )

          mcpServer.tool(
            'read_skill_file',
            'Read a supporting file referenced by a skill (e.g., PATTERNS.md, SDK-API.md). Use when invoke_skill returns content that references additional files.',
            {
              skillName: z.string().describe('The skill name that owns this file'),
              filePath: z.string().describe('Relative path within the skill directory (e.g., "PATTERNS.md")'),
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            async (args: { skillName: string; filePath: string }): Promise<any> => {
              const skill = skills.find((s) => s.name === args.skillName)
              if (!skill) {
                return { content: [{ type: 'text' as const, text: `Skill "${args.skillName}" not found.` }], isError: true }
              }
              const content = await readSupportingFile(skill, args.filePath)
              if (content === null) {
                return { content: [{ type: 'text' as const, text: `File "${args.filePath}" not found in skill "${args.skillName}".` }], isError: true }
              }
              return { content: [{ type: 'text' as const, text: content }] }
            },
          )

          console.log(`[n8n-desk] Registered invoke_skill + read_skill_file for ${skills.length} skills on in-process MCP server`)
        }

        console.log(`[n8n-desk] Registered ${allTools.length} file tools on in-process MCP server`)
        this.localMcpServers.set(sessionId, mcpServer)

        // Use SDK-native in-process server — no HTTP, no port, no transport issues
        mcpServers['n8n-desk-local'] = {
          type: 'sdk',
          name: 'n8n-desk-local',
          instance: mcpServer,
        } as Record<string, unknown> as typeof mcpServers[string]
      } catch (err) {
        // Non-fatal: file tools won't be available, but n8n MCP tools still work
        console.error(
          '[n8n-desk] Failed to register local file tools MCP server:',
          err instanceof Error ? err.stack : String(err),
        )
      }
    }

    try {
      // Build the prompt: if we have conversation history, format it as context
      let fullPrompt = message
      if (config.conversationHistory && config.conversationHistory.length > 0) {
        const historyBlock = config.conversationHistory
          .map((m) => `${m.role === 'user' ? 'Human' : 'Assistant'}: ${m.content}`)
          .join('\n\n')
        fullPrompt = `<conversation_history>\n${historyBlock}\n</conversation_history>\n\nHuman: ${message}`
      }

      const queryInstance = queryFn({
        prompt: fullPrompt,
        options: {
          model: config.llmConfig.model,
          systemPrompt: config.systemPrompt,
          abortController,
          permissionMode: 'acceptEdits',
          canUseTool,
          mcpServers,
          // Disable all built-in tools — we only want MCP tools
          tools: [],
          // Set working directory explicitly to avoid undefined path errors
          cwd: os.homedir(),
          // Pass API key to the spawned Claude Code subprocess
          env: {
            ...process.env,
            ...(config.llmConfig.apiKey ? { ANTHROPIC_API_KEY: config.llmConfig.apiKey } : {}),
          },
        },
      })

      this.activeQueries.set(sessionId, queryInstance)

      // Process SDK messages and normalize to AgentStreamEvent
      for await (const sdkMessage of queryInstance) {
        if (abortController.signal.aborted) break

        const events = this.normalizeMessage(sessionId, sdkMessage)
        for (const event of events) {
          yield event
        }

        // Also yield any events pushed by canUseTool callback
        while (eventQueue.length > 0) {
          yield eventQueue.shift()!
        }
      }

      // Drain any remaining queued events
      while (eventQueue.length > 0) {
        yield eventQueue.shift()!
      }

      yield {
        type: 'done',
        sessionId,
        data: { reason: abortController.signal.aborted ? 'cancelled' : 'completed' },
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

    // Reject any pending approval
    const pending = this.pendingApprovals.get(sessionId)
    if (pending) {
      pending.resolve('reject')
    }

    this.cleanup(sessionId)
  }

  async approve(sessionId: string, decision: 'approve' | 'reject'): Promise<void> {
    const pending = this.pendingApprovals.get(sessionId)
    if (!pending) {
      return
    }

    pending.resolve(decision)
    this.pendingApprovals.delete(sessionId)
  }

  private cleanup(sessionId: string): void {
    this.abortControllers.delete(sessionId)
    this.pendingApprovals.delete(sessionId)
    this.activeQueries.delete(sessionId)
    this.toolNameMap.clear()

    // Close the per-session in-process MCP server (file tools + js_compute)
    const localServer = this.localMcpServers.get(sessionId)
    if (localServer) {
      localServer.close().catch(() => {})
      this.localMcpServers.delete(sessionId)
    }
  }

  /**
   * Normalize an SDK message into zero or more AgentStreamEvents.
   *
   * SDK message types we care about:
   * - assistant: contains content blocks (text, tool_use)
   * - stream_event: partial streaming events
   * - result: final result with success/error
   * - system (init): session initialization info
   * - tool_progress: tool execution progress
   */
  private normalizeMessage(
    sessionId: string,
    msg: import('@anthropic-ai/claude-agent-sdk').SDKMessage,
  ): AgentStreamEvent[] {
    const events: AgentStreamEvent[] = []

    // Debug: log all SDK messages with content summary
    const msgAny = msg as Record<string, unknown>
    const debugInfo: Record<string, unknown> = { type: msg.type }
    if (msg.type === 'assistant' && msgAny.message) {
      const m = msgAny.message as Record<string, unknown>
      if (Array.isArray(m.content)) {
        debugInfo.blocks = (m.content as Array<Record<string, unknown>>).map((b) => b.type)
      }
    } else if (msg.type === 'user') {
      debugInfo.parent_tool_use_id = msgAny.parent_tool_use_id
      debugInfo.hasResult = msgAny.tool_use_result !== undefined
    } else if (msg.type === 'tool_progress') {
      debugInfo.tool = msgAny.tool_name ?? msgAny.name
      debugInfo.progress = typeof msgAny.data === 'string' ? msgAny.data.slice(0, 100) : undefined
    } else if (msg.type === 'result') {
      debugInfo.subtype = msgAny.subtype
    }
    console.log('[n8n-desk SDK msg]', JSON.stringify(debugInfo))

    switch (msg.type) {
      case 'assistant': {
        // BetaMessage contains content blocks (text + tool_use).
        // Extract both: text blocks as text_chunk events, tool_use blocks as tool_call_start.
        const message = msg.message
        if (message?.content) {
          for (const block of message.content) {
            if (block.type === 'thinking' && (block as Record<string, unknown>).thinking) {
              events.push({
                type: 'thinking',
                sessionId,
                data: { text: (block as Record<string, unknown>).thinking as string },
              })
            } else if (block.type === 'text' && block.text) {
              events.push({
                type: 'text_chunk',
                sessionId,
                data: { text: block.text },
              })
            } else if (block.type === 'tool_use') {
              // Track tool name for later lookup in tool_call_result
              this.toolNameMap.set(block.id, block.name)
              events.push({
                type: 'tool_call_start',
                sessionId,
                data: {
                  id: block.id,
                  name: block.name,
                  args: (block.input as Record<string, unknown>) ?? {},
                },
              })
            }
          }
        }
        break
      }

      case 'stream_event': {
        // Partial streaming — map content_block_delta events
        const event = msg.event
        if (event.type === 'content_block_delta') {
          const delta = event.delta as Record<string, unknown>
          if (delta.type === 'text_delta' && typeof delta.text === 'string') {
            events.push({
              type: 'text_chunk',
              sessionId,
              data: { text: delta.text },
            })
          }
        }
        break
      }

      case 'result': {
        if (msg.subtype === 'error') {
          const errorMsg = msg as import('@anthropic-ai/claude-agent-sdk').SDKResultError
          events.push({
            type: 'error',
            sessionId,
            data: {
              message: errorMsg.errors?.join('; ') ?? 'Agent execution failed',
              code: 'AGENT_RESULT_ERROR',
            },
          })
        }
        // Success results contain final text — already streamed via assistant messages
        break
      }

      case 'user': {
        // Tool results come back as 'user' messages.
        // parent_tool_use_id may be null — extract tool_use_id from content blocks instead.
        const userMsg = msg as import('@anthropic-ai/claude-agent-sdk').SDKUserMessage

        // Try to find the tool_use_id and result content
        let toolUseId: string | null = userMsg.parent_tool_use_id
        let resultContent: unknown = userMsg.tool_use_result

        // Extract from message content blocks (tool_result blocks have tool_use_id)
        if (userMsg.message?.content && Array.isArray(userMsg.message.content)) {
          for (const block of userMsg.message.content) {
            const b = block as Record<string, unknown>
            if (b.type === 'tool_result') {
              if (!toolUseId && typeof b.tool_use_id === 'string') {
                toolUseId = b.tool_use_id
              }
              if (!resultContent) {
                resultContent = b.content ?? b.output
              }
              break
            }
          }
        }

        // If we still don't have a result but tool_use_result exists, use it
        if (!resultContent && userMsg.tool_use_result !== undefined) {
          resultContent = userMsg.tool_use_result
        }

        if (toolUseId) {
          const resultStr = typeof resultContent === 'string'
            ? resultContent
            : JSON.stringify(resultContent ?? '')

          // Check if the result indicates an error
          const isError = typeof resultContent === 'string'
            && (resultContent.includes('"error"') || resultContent.includes('Error'))

          // Look up the tool name from the earlier tool_call_start
          const toolName = this.toolNameMap.get(toolUseId) ?? ''

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
        } else if (resultContent !== undefined) {
          // Tool result without a matching tool_use_id — emit with a generated id
          const generatedId = randomUUID()
          const resultStr = typeof resultContent === 'string'
            ? resultContent
            : JSON.stringify(resultContent ?? '')
          events.push({
            type: 'tool_call_result',
            sessionId,
            data: {
              id: generatedId,
              name: 'tool',
              result: resultStr,
              success: true,
            },
          })
        }
        break
      }

      case 'tool_progress': {
        // Tool is still executing — emit progress as text so user sees activity
        const progressMsg = msg as Record<string, unknown>
        const progressData = progressMsg.data ?? progressMsg.content ?? progressMsg.output
        if (progressData && typeof progressData === 'string' && progressData.trim()) {
          events.push({
            type: 'text_chunk',
            sessionId,
            data: { text: progressData },
          })
        }
        break
      }

      case 'system': {
        // Init message — could emit session info if needed
        break
      }

      default:
        // Other message types (auth_status, compact_boundary, etc.) — log for debugging
        console.log('[n8n-desk SDK msg] unhandled type:', msg.type, JSON.stringify(msg).slice(0, 300))
        break
    }

    return events
  }
}
