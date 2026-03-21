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
import { createMcpTools } from './tool-definitions'
import { substituteArguments } from '../skill-loader'

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
 * Create a LangChain ChatModel based on the provider configuration.
 * Lazy-imports the provider-specific package to avoid loading all providers.
 */
async function createChatModel(config: LlmProviderConfig): Promise<unknown> {
  switch (config.provider) {
    case 'anthropic': {
      const { ChatAnthropic } = await import('@langchain/anthropic')
      return new ChatAnthropic({
        model: config.model,
        anthropicApiKey: config.apiKey,
        ...(config.baseUrl ? { anthropicApiUrl: config.baseUrl } : {}),
      })
    }
    case 'openai': {
      const { ChatOpenAI } = await import('@langchain/openai')
      return new ChatOpenAI({
        model: config.model,
        openAIApiKey: config.apiKey,
        ...(config.baseUrl ? { configuration: { baseURL: config.baseUrl } } : {}),
      })
    }
    case 'ollama': {
      const { ChatOllama } = await import('@langchain/ollama')
      return new ChatOllama({
        model: config.model,
        ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
      })
    }
    default:
      throw new Error(`Unsupported LLM provider: ${config.provider}`)
  }
}

/**
 * Create the `invoke_skill` LangChain tool for Deep Agents.
 *
 * Accepts a skill name and optional arguments string. Returns the full
 * skill content with `$ARGUMENTS` / `$0` / `$1` / etc. substituted.
 * This enables lazy loading: the system prompt contains only short
 * descriptions, and full skill content is expanded on invocation.
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
      description: 'Load and invoke a skill by name. Returns the full skill instructions with arguments substituted.',
      schema: z.object({
        skillName: z.string().describe('The kebab-case name of the skill to invoke'),
        arguments: z.string().optional().describe('Arguments to substitute into the skill content'),
      }),
    },
  )
}

/**
 * Deep Agents SDK runner implementation.
 *
 * Uses createDeepAgent from the deepagents package with LangChain ChatModel
 * objects and MCP tool wrappers. Uses StateBackend for ephemeral storage
 * and MemorySaver as checkpointer with interruptOn for destructive tools.
 * Streams events via agent.stream() and normalizes LangGraph events to
 * AgentStreamEvent format.
 */
export class DeepAgentsRunner implements AgentRunner {
  private abortControllers = new Map<string, AbortController>()
  private pendingApprovals = new Map<string, PendingApproval>()

  async *invoke(
    sessionId: string,
    message: string,
    config: AgentRunnerConfig,
  ): AsyncIterable<AgentStreamEvent> {
    // Lazy imports for ESM-only packages
    let createDeepAgent: typeof import('deepagents').createDeepAgent
    let StateBackend: typeof import('deepagents').StateBackend
    let MemorySaver: typeof import('@langchain/langgraph').MemorySaver

    try {
      const deepagents = await import('deepagents')
      createDeepAgent = deepagents.createDeepAgent
      StateBackend = deepagents.StateBackend
      const langgraph = await import('@langchain/langgraph')
      MemorySaver = langgraph.MemorySaver
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

    try {
      // Create the LLM chat model
      const chatModel = await createChatModel(config.llmConfig)

      // Create MCP tool wrappers and merge custom tools
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tools: any[] = [
        ...createMcpTools(config.instanceUrl, config.accessToken),
      ]

      // Merge pre-built LangChain tools from PluginManager.buildDeepAgentsTools()
      if (config.customTools && config.customTools.length > 0) {
        tools.push(...config.customTools)
      }

      // Add invoke_skill tool when skills are configured
      if (config.skills && config.skills.length > 0) {
        tools.push(createInvokeSkillTool(config.skills))
      }

      // Determine which tools require approval (includes approval-required server tools)
      const interruptTools = config.interruptOnTools ?? [...DESTRUCTIVE_TOOLS]
      const interruptToolSet = new Set(interruptTools)

      // Create the deep agent
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const agent = createDeepAgent({
        name: 'n8n-desk-workflow',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        model: chatModel as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tools: tools as any,
        systemPrompt: config.systemPrompt,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        backend: (rt: any) => new StateBackend(rt),
        checkpointer: new MemorySaver(),
        interruptOn: Object.fromEntries(interruptTools.map((t) => [t, true])),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)

      // Build input: include conversation history for cold starts (app restart)
      let input = message
      if (config.conversationHistory && config.conversationHistory.length > 0) {
        const historyBlock = config.conversationHistory
          .map((m) => `${m.role === 'user' ? 'Human' : 'Assistant'}: ${m.content}`)
          .join('\n\n')
        input = `<conversation_history>\n${historyBlock}\n</conversation_history>\n\nHuman: ${message}`
      }

      // Stream agent events
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stream = await (agent.stream as any)(input, {
        configurable: { thread_id: sessionId },
        signal: abortController.signal,
      })

      for await (const event of stream) {
        if (abortController.signal.aborted) break

        const normalized = this.normalizeEvent(sessionId, event, interruptToolSet)
        for (const evt of normalized) {
          // Handle approval interrupts
          if (evt.type === 'approval_required') {
            yield evt

            // Wait for user decision
            const decision = await this.waitForApproval(sessionId, evt.data, abortController.signal)

            yield {
              type: 'approval_resolved',
              sessionId,
              data: { id: evt.data.id, decision },
            }

            if (decision === 'reject') {
              yield {
                type: 'tool_call_result',
                sessionId,
                data: {
                  id: evt.data.id,
                  name: evt.data.toolName,
                  result: null,
                  success: false,
                  error: `User rejected ${evt.data.toolName}`,
                },
              }
            }
            continue
          }

          yield evt
        }
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
  }

  private waitForApproval(
    sessionId: string,
    data: { id: string; toolName: string; args: Record<string, unknown> },
    signal: AbortSignal,
  ): Promise<'approve' | 'reject'> {
    return new Promise<'approve' | 'reject'>((resolve) => {
      this.pendingApprovals.set(sessionId, {
        id: data.id,
        toolName: data.toolName,
        args: data.args,
        resolve,
      })

      const onAbort = (): void => {
        this.pendingApprovals.delete(sessionId)
        resolve('reject')
      }
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  /**
   * Normalize a LangGraph stream event into AgentStreamEvents.
   *
   * LangGraph events come in various shapes depending on the node:
   * - Agent node outputs: messages with content (text or tool_use blocks)
   * - Tool node outputs: tool results
   * - Interrupt events: tool calls requiring approval
   */
  private normalizeEvent(
    sessionId: string,
    event: Record<string, unknown>,
    interruptToolSet: Set<string>,
  ): AgentStreamEvent[] {
    const events: AgentStreamEvent[] = []

    // Handle different LangGraph event structures
    const eventType = typeof event.event === 'string' ? event.event : undefined

    if (eventType === 'on_chat_model_stream' || eventType === 'on_llm_stream') {
      // Streaming text chunk from the LLM
      const chunk = event.data as Record<string, unknown> | undefined
      const content = chunk?.chunk as Record<string, unknown> | undefined
      if (content?.content) {
        // content.content can be a string (OpenAI/Ollama) or an array of content blocks (Anthropic)
        let text = ''
        let thinking = ''
        if (typeof content.content === 'string') {
          text = content.content
        } else if (Array.isArray(content.content)) {
          for (const block of content.content) {
            if (block && typeof block === 'object') {
              const b = block as Record<string, unknown>
              if (b.type === 'thinking' && typeof b.thinking === 'string') {
                thinking += b.thinking
              } else if (b.type === 'text' && typeof b.text === 'string') {
                text += b.text
              }
            }
          }
        }
        if (thinking) {
          events.push({
            type: 'thinking',
            sessionId,
            data: { text: thinking },
          })
        }
        if (text) {
          events.push({
            type: 'text_chunk',
            sessionId,
            data: { text },
          })
        }
      }
    } else if (eventType === 'on_tool_start') {
      // Tool execution starting
      const data = event.data as Record<string, unknown> | undefined
      const input = data?.input as Record<string, unknown> | undefined
      const name = typeof event.name === 'string' ? event.name : 'unknown'
      const id = typeof event.run_id === 'string' ? event.run_id : randomUUID()

      // Check if this tool requires approval (includes custom server approval-required tools)
      if (interruptToolSet.has(name)) {
        events.push({
          type: 'approval_required',
          sessionId,
          data: {
            id,
            toolName: name,
            args: input ?? {},
            description: `Approve ${name}?`,
          },
        })
      } else {
        events.push({
          type: 'tool_call_start',
          sessionId,
          data: { id, name, args: input ?? {} },
        })
      }
    } else if (eventType === 'on_tool_end') {
      // Tool execution completed
      const data = event.data as Record<string, unknown> | undefined
      const output = data?.output
      const name = typeof event.name === 'string' ? event.name : 'unknown'
      const id = typeof event.run_id === 'string' ? event.run_id : randomUUID()

      events.push({
        type: 'tool_call_result',
        sessionId,
        data: {
          id,
          name,
          result: output,
          success: true,
        },
      })
    } else if (eventType === 'on_chain_end') {
      // Check for todo updates in the output
      const data = event.data as Record<string, unknown> | undefined
      const output = data?.output as Record<string, unknown> | undefined
      if (output?.todos && Array.isArray(output.todos)) {
        events.push({
          type: 'todo_update',
          sessionId,
          data: {
            todos: output.todos as Array<{
              id: string
              title: string
              status: 'pending' | 'in_progress' | 'completed' | 'failed'
            }>,
          },
        })
      }
    }

    return events
  }
}
