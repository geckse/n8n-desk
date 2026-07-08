/**
 * Claude SDK runner tests against a mocked @anthropic-ai/claude-agent-sdk.
 *
 * The mock reproduces the SDK's REAL blocking behavior: between yielding
 * messages it calls canUseTool and AWAITS the decision — exactly the state in
 * which the old implementation deadlocked (approval_required was queued but
 * only drained per-message, and no message could arrive while canUseTool was
 * pending).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AgentRunnerConfig, AgentStreamEvent } from '../types'

// --- SDK mock ----------------------------------------------------------------

interface MockScriptStep {
  /** SDK message to yield as-is */
  message?: Record<string, unknown>
  /** Call canUseTool with these args and (optionally) yield the tool_result */
  toolCall?: {
    toolName: string
    input: Record<string, unknown>
    toolUseID: string
  }
  /**
   * Like toolCall, but after canUseTool allows, actually invokes the handler
   * registered on the in-process `n8n-desk-local` MCP server (the CLI's real
   * behavior for sdk-type servers) and yields its text as the tool_result.
   */
  localToolCall?: {
    /** Bare tool name as registered on the local server */
    toolName: string
    input: Record<string, unknown>
    toolUseID: string
  }
}

interface CapturedQuery {
  prompt: string
  options: Record<string, unknown>
}

const mockState: {
  script: MockScriptStep[]
  captured: CapturedQuery | null
  permissionResults: Array<Record<string, unknown>>
} = {
  script: [],
  captured: null,
  permissionResults: [],
}

vi.mock('@anthropic-ai/claude-agent-sdk', () => {
  function query(params: CapturedQuery): AsyncGenerator<Record<string, unknown>> & { close: () => void } {
    mockState.captured = params
    const abortController = params.options.abortController as AbortController
    const canUseTool = params.options.canUseTool as (
      toolName: string,
      input: Record<string, unknown>,
      options: { signal: AbortSignal; toolUseID: string },
    ) => Promise<Record<string, unknown>>

    async function* run(): AsyncGenerator<Record<string, unknown>> {
      for (const step of mockState.script) {
        if (abortController.signal.aborted) return
        if (step.message) {
          yield step.message
        }
        if (step.toolCall) {
          const { toolName, input, toolUseID } = step.toolCall
          // Assistant message announcing the tool_use block
          yield {
            type: 'assistant',
            message: {
              content: [{ type: 'tool_use', id: toolUseID, name: toolName, input }],
            },
          }
          // The SDK now blocks inside the permission request — no further
          // messages until the decision resolves.
          const result = await canUseTool(toolName, input, {
            signal: abortController.signal,
            toolUseID,
          })
          mockState.permissionResults.push(result)
          const denied = result.behavior === 'deny'
          yield {
            type: 'user',
            message: {
              content: [{
                type: 'tool_result',
                tool_use_id: toolUseID,
                content: denied ? String(result.message) : '{"ok":true}',
                is_error: denied,
              }],
            },
          }
        }
        if (step.localToolCall) {
          const { toolName, input, toolUseID } = step.localToolCall
          const namespaced = `mcp__n8n-desk-local__${toolName}`
          yield {
            type: 'assistant',
            message: {
              content: [{ type: 'tool_use', id: toolUseID, name: namespaced, input }],
            },
          }
          const permission = await canUseTool(namespaced, input, {
            signal: abortController.signal,
            toolUseID,
          })
          mockState.permissionResults.push(permission)
          let content: string
          let isError: boolean
          if (permission.behavior === 'deny') {
            content = String(permission.message)
            isError = true
          } else {
            // Invoke the REAL registered handler on the in-process MCP server
            // — this is what the CLI does for sdk-type servers.
            const servers = mockState.captured!.options.mcpServers as Record<string, { instance?: unknown }>
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const registered = (servers['n8n-desk-local']!.instance as any)._registeredTools[toolName]
            const result = await registered.handler(input, {})
            content = String(result.content?.[0]?.text ?? '')
            isError = result.isError === true
          }
          yield {
            type: 'user',
            message: {
              content: [{
                type: 'tool_result',
                tool_use_id: toolUseID,
                content,
                is_error: isError,
              }],
            },
          }
        }
      }
    }

    const generator = run() as AsyncGenerator<Record<string, unknown>> & { close: () => void }
    generator.close = () => { /* subprocess kill — no-op in mock */ }
    return generator
  }

  return { query }
})

import { ClaudeSdkRunner } from '../claude-sdk-runner'

// --- Helpers -------------------------------------------------------------------

function baseConfig(overrides: Partial<AgentRunnerConfig> = {}): AgentRunnerConfig {
  return {
    instanceUrl: 'https://n8n.example.com',
    accessToken: 'n8n-token',
    mcpUrl: 'https://n8n.example.com/mcp-server/http',
    mcpAccessToken: 'mcp-token',
    llmConfig: { provider: 'anthropic', model: 'claude-test', apiKey: 'sk-test' },
    systemPrompt: 'test prompt',
    ...overrides,
  }
}

/**
 * Consume the runner's event stream; when approval_required arrives, resolve
 * it with the given decision (after asserting it surfaced at all).
 */
async function collectWithApproval(
  runner: ClaudeSdkRunner,
  sessionId: string,
  config: AgentRunnerConfig,
  decision: 'approve' | 'reject',
): Promise<AgentStreamEvent[]> {
  const events: AgentStreamEvent[] = []
  for await (const event of runner.invoke(sessionId, 'do it', config)) {
    events.push(event)
    if (event.type === 'approval_required') {
      const resolved = await runner.approve(sessionId, event.data.id, decision)
      expect(resolved).toBe(true)
    }
  }
  return events
}

beforeEach(() => {
  mockState.script = []
  mockState.captured = null
  mockState.permissionResults = []
})

// --- Tests ---------------------------------------------------------------------

describe('ClaudeSdkRunner approval gating', () => {
  it('surfaces approval_required while the SDK is blocked inside canUseTool (no deadlock)', async () => {
    // FIRST action is the gated tool — the old implementation hung here
    // because the queue only drained after the next SDK message.
    mockState.script = [
      { toolCall: { toolName: 'mcp__n8n__execute_workflow', input: { workflowId: '42' }, toolUseID: 'toolu_1' } },
    ]

    const runner = new ClaudeSdkRunner()
    const events = await collectWithApproval(runner, 's1', baseConfig(), 'approve')

    const types = events.map((e) => e.type)
    expect(types).toContain('approval_required')
    // approval_required must precede the tool result
    expect(types.indexOf('approval_required')).toBeLessThan(types.indexOf('tool_call_result'))
    // and the permission result the SDK saw was allow
    expect(mockState.permissionResults[0]?.behavior).toBe('allow')
  }, 10_000)

  it('gates by namespace-aware matching (mcp__n8n__ prefix)', async () => {
    mockState.script = [
      { toolCall: { toolName: 'mcp__n8n__publish_workflow', input: { workflowId: '42' }, toolUseID: 'toolu_2' } },
    ]

    const runner = new ClaudeSdkRunner()
    const events = await collectWithApproval(runner, 's2', baseConfig(), 'approve')

    const approval = events.find((e) => e.type === 'approval_required')
    expect(approval).toBeDefined()
    expect(approval!.type === 'approval_required' && approval!.data.toolName).toBe('mcp__n8n__publish_workflow')
    // The approval id is the SDK's toolUseID (correlates with tool_call_start)
    expect(approval!.type === 'approval_required' && approval!.data.id).toBe('toolu_2')
  })

  it('does NOT gate read-only tools', async () => {
    mockState.script = [
      { toolCall: { toolName: 'mcp__n8n__search_workflows', input: { query: 'x' }, toolUseID: 'toolu_3' } },
    ]

    const runner = new ClaudeSdkRunner()
    const events: AgentStreamEvent[] = []
    for await (const event of runner.invoke('s3', 'find', baseConfig())) {
      events.push(event)
    }

    expect(events.map((e) => e.type)).not.toContain('approval_required')
    expect(mockState.permissionResults[0]?.behavior).toBe('allow')
  })

  it('gates custom-server tools flagged requireApproval', async () => {
    mockState.script = [
      { toolCall: { toolName: 'mcp__myserver__wipe_data', input: {}, toolUseID: 'toolu_4' } },
    ]

    const runner = new ClaudeSdkRunner()
    const config = baseConfig({ interruptOnTools: ['myserver__wipe_data'] })
    const events = await collectWithApproval(runner, 's4', config, 'approve')

    expect(events.map((e) => e.type)).toContain('approval_required')
  })

  it('reject returns deny to the SDK, persists the error result, and STOPS the run', async () => {
    mockState.script = [
      { toolCall: { toolName: 'mcp__n8n__execute_workflow', input: { workflowId: '42' }, toolUseID: 'toolu_5' } },
    ]

    const runner = new ClaudeSdkRunner()
    const events = await collectWithApproval(runner, 's5', baseConfig(), 'reject')

    expect(mockState.permissionResults[0]?.behavior).toBe('deny')
    const resolved = events.find((e) => e.type === 'approval_resolved')
    expect(resolved!.type === 'approval_resolved' && resolved!.data.decision).toBe('reject')
    // The denied result is pumped BEFORE the abort so it persists to JSONL...
    const result = events.find((e) => e.type === 'tool_call_result')
    expect(result!.type === 'tool_call_result' && result!.data.success).toBe(false)
    // ...then the run stops instead of letting the model keep reasoning.
    const done = events[events.length - 1]
    expect(done.type === 'done' && done.data.reason).toBe('cancelled')
  })
})

describe('ClaudeSdkRunner mode restrictions (audit #12)', () => {
  it('denies mode-restricted tools without any approval flow', async () => {
    mockState.script = [
      { toolCall: { toolName: 'mcp__n8n__update_workflow', input: { workflowId: '42' }, toolUseID: 'toolu_d1' } },
    ]

    const runner = new ClaudeSdkRunner()
    const config = baseConfig({ deniedTools: ['update_workflow', 'publish_workflow'] })
    const events: AgentStreamEvent[] = []
    for await (const event of runner.invoke('sd1', 'update it', config)) {
      events.push(event)
    }

    // Denied outright — never surfaced to the user as an approval
    expect(events.map((e) => e.type)).not.toContain('approval_required')
    expect(mockState.permissionResults[0]?.behavior).toBe('deny')
    const result = events.find((e) => e.type === 'tool_call_result')
    expect(result!.type === 'tool_call_result' && result!.data.success).toBe(false)
  })

  it('passes disallowedTools to the SDK so denied tools are hidden from the model', async () => {
    mockState.script = [{ message: { type: 'result', subtype: 'success' } }]

    const runner = new ClaudeSdkRunner()
    const config = baseConfig({ deniedTools: ['update_workflow', 'archive_workflow'] })
    for await (const event of runner.invoke('sd2', 'hi', config)) {
      void event
    }

    expect(mockState.captured?.options.disallowedTools).toEqual([
      'mcp__n8n__update_workflow',
      'mcp__n8n__archive_workflow',
    ])
  })

  it('still gates (not denies) destructive tools that are allowed in the mode', async () => {
    mockState.script = [
      { toolCall: { toolName: 'mcp__n8n__execute_workflow', input: { workflowId: '42' }, toolUseID: 'toolu_d3' } },
    ]

    const runner = new ClaudeSdkRunner()
    const config = baseConfig({ deniedTools: ['update_workflow'] })
    const events = await collectWithApproval(runner, 'sd3', config, 'approve')

    expect(events.map((e) => e.type)).toContain('approval_required')
    expect(mockState.permissionResults[0]?.behavior).toBe('allow')
  })
})

describe('ClaudeSdkRunner streaming + results', () => {
  it('emits text from stream_event deltas and skips assistant text blocks', async () => {
    mockState.script = [
      {
        message: {
          type: 'stream_event',
          event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello ' } },
        },
      },
      {
        message: {
          type: 'stream_event',
          event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'world' } },
        },
      },
      {
        // Complete assistant message repeats the text — must NOT double-emit
        message: {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'Hello world' }] },
        },
      },
    ]

    const runner = new ClaudeSdkRunner()
    const events: AgentStreamEvent[] = []
    for await (const event of runner.invoke('s6', 'hi', baseConfig())) {
      events.push(event)
    }

    const textEvents = events.filter((e) => e.type === 'text_chunk')
    const fullText = textEvents.map((e) => (e.data as { text: string }).text).join('')
    expect(fullText).toBe('Hello world')
  })

  it('maps real result error subtypes to error events and done(error)', async () => {
    mockState.script = [
      { message: { type: 'result', subtype: 'error_max_turns' } },
    ]

    const runner = new ClaudeSdkRunner()
    const events: AgentStreamEvent[] = []
    for await (const event of runner.invoke('s7', 'hi', baseConfig())) {
      events.push(event)
    }

    const error = events.find((e) => e.type === 'error')
    expect(error).toBeDefined()
    expect(error!.type === 'error' && error!.data.code).toBe('ERROR_MAX_TURNS')
    const done = events.find((e) => e.type === 'done')
    expect(done!.type === 'done' && done!.data.reason).toBe('error')
  })

  it('surfaces TodoWrite as todo_update, never as a tool card', async () => {
    mockState.script = [
      { toolCall: { toolName: 'TodoWrite', input: { todos: [{ content: 'step 1', status: 'pending', activeForm: 'doing step 1' }] }, toolUseID: 'toolu_8' } },
    ]

    const runner = new ClaudeSdkRunner()
    const events: AgentStreamEvent[] = []
    for await (const event of runner.invoke('s8', 'plan', baseConfig())) {
      events.push(event)
    }

    const todo = events.find((e) => e.type === 'todo_update')
    expect(todo).toBeDefined()
    expect(todo!.type === 'todo_update' && todo!.data.todos[0].title).toBe('step 1')
    expect(events.map((e) => e.type)).not.toContain('tool_call_start')
    expect(events.map((e) => e.type)).not.toContain('tool_call_result')
    expect(events.map((e) => e.type)).not.toContain('approval_required')
  })

  it('every session ends with exactly one terminal done event', async () => {
    mockState.script = [
      { message: { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'x' } } } },
      { message: { type: 'result', subtype: 'success' } },
    ]

    const runner = new ClaudeSdkRunner()
    const events: AgentStreamEvent[] = []
    for await (const event of runner.invoke('s9', 'hi', baseConfig())) {
      events.push(event)
    }

    const dones = events.filter((e) => e.type === 'done')
    expect(dones).toHaveLength(1)
    expect(events[events.length - 1].type).toBe('done')
    expect(dones[0].type === 'done' && dones[0].data.reason).toBe('completed')
  })

  it('tool result success comes from the is_error flag, not substring sniffing', async () => {
    mockState.script = [
      {
        message: {
          type: 'assistant',
          message: { content: [{ type: 'tool_use', id: 'toolu_10', name: 'mcp__n8n__get_workflow_details', input: {} }] },
        },
      },
      {
        message: {
          type: 'user',
          message: {
            content: [{
              type: 'tool_result',
              tool_use_id: 'toolu_10',
              // Contains the word "Error" but is NOT an error (old heuristic false positive)
              content: '{"name":"Error Trigger workflow","onError":"continue"}',
              is_error: false,
            }],
          },
        },
      },
    ]

    const runner = new ClaudeSdkRunner()
    const events: AgentStreamEvent[] = []
    for await (const event of runner.invoke('s10', 'inspect', baseConfig())) {
      events.push(event)
    }

    const result = events.find((e) => e.type === 'tool_call_result')
    expect(result!.type === 'tool_call_result' && result!.data.success).toBe(true)
  })
})

describe('ClaudeSdkRunner ask_user_question', () => {
  const questionInput = {
    questions: [
      { question: 'Which format?', options: [{ label: 'CSV' }, { label: 'JSON' }] },
    ],
  }

  it('surfaces question_asked while the handler is blocked and returns the answers as the tool result', async () => {
    mockState.script = [
      { localToolCall: { toolName: 'ask_user_question', input: questionInput, toolUseID: 'toolu_q1' } },
    ]

    const runner = new ClaudeSdkRunner()
    const events: AgentStreamEvent[] = []
    for await (const event of runner.invoke('sq1', 'export the data', baseConfig())) {
      events.push(event)
      if (event.type === 'question_asked') {
        // The id is the SDK's toolUseID (correlates with tool_call_start)
        expect(event.data.id).toBe('toolu_q1')
        expect(event.data.questions).toEqual([
          { id: 'q1', question: 'Which format?', options: [{ label: 'CSV' }, { label: 'JSON' }] },
        ])
        const resolved = await runner.answer('sq1', event.data.id, {
          q1: { selected: ['CSV'], otherText: 'keep it simple' },
        })
        expect(resolved).toBe(true)
      }
    }

    const types = events.map((e) => e.type)
    expect(types).toContain('question_asked')
    expect(types).toContain('question_answered')
    // Never approval-gated
    expect(types).not.toContain('approval_required')
    expect(mockState.permissionResults[0]?.behavior).toBe('allow')
    // question_asked strictly precedes the tool result
    expect(types.indexOf('question_asked')).toBeLessThan(types.indexOf('tool_call_result'))

    const result = events.find((e) => e.type === 'tool_call_result')
    expect(result!.type === 'tool_call_result' && result!.data.success).toBe(true)
    expect(result!.type === 'tool_call_result' && String(result!.data.result)).toContain('selected: CSV')
    expect(result!.type === 'tool_call_result' && String(result!.data.result)).toContain('other: keep it simple')

    const done = events[events.length - 1]
    expect(done.type === 'done' && done.data.reason).toBe('completed')
  }, 10_000)

  it('stop() during a pending question cancels cleanly (handler errors, session ends cancelled)', async () => {
    mockState.script = [
      { localToolCall: { toolName: 'ask_user_question', input: questionInput, toolUseID: 'toolu_q2' } },
    ]

    const runner = new ClaudeSdkRunner()
    const events: AgentStreamEvent[] = []
    for await (const event of runner.invoke('sq2', 'export the data', baseConfig())) {
      events.push(event)
      if (event.type === 'question_asked') {
        await runner.stop('sq2')
      }
    }

    const types = events.map((e) => e.type)
    expect(types).toContain('question_asked')
    expect(types).not.toContain('question_answered')
    const done = events.find((e) => e.type === 'done')
    expect(done!.type === 'done' && done!.data.reason).toBe('cancelled')
  }, 10_000)

  it('answer() with a wrong question id returns false', async () => {
    mockState.script = [
      { localToolCall: { toolName: 'ask_user_question', input: questionInput, toolUseID: 'toolu_q3' } },
    ]

    const runner = new ClaudeSdkRunner()
    for await (const event of runner.invoke('sq3', 'export', baseConfig())) {
      if (event.type === 'question_asked') {
        expect(await runner.answer('sq3', 'nonexistent', { q1: { selected: ['CSV'] } })).toBe(false)
        expect(await runner.answer('sq3', event.data.id, { q1: { selected: ['CSV'] } })).toBe(true)
      }
    }
  }, 10_000)

  it('sets MCP_TOOL_TIMEOUT to a human-scale budget (a pending question outlives 6 minutes)', async () => {
    mockState.script = [{ message: { type: 'result', subtype: 'success' } }]

    const runner = new ClaudeSdkRunner()
    for await (const event of runner.invoke('sq4', 'hi', baseConfig())) {
      void event
    }

    const env = mockState.captured?.options.env as Record<string, string>
    expect(Number(env.MCP_TOOL_TIMEOUT)).toBeGreaterThanOrEqual(86_400_000)
  })
})

describe('ClaudeSdkRunner stop', () => {
  it('stop rejects a pending approval and ends with done(cancelled)', async () => {
    mockState.script = [
      { toolCall: { toolName: 'mcp__n8n__execute_workflow', input: {}, toolUseID: 'toolu_11' } },
    ]

    const runner = new ClaudeSdkRunner()
    const events: AgentStreamEvent[] = []
    for await (const event of runner.invoke('s11', 'go', baseConfig())) {
      events.push(event)
      if (event.type === 'approval_required') {
        await runner.stop('s11')
      }
    }

    expect(mockState.permissionResults[0]?.behavior).toBe('deny')
    const done = events.find((e) => e.type === 'done')
    expect(done).toBeDefined()
    expect(done!.type === 'done' && done!.data.reason).toBe('cancelled')
  }, 10_000)
})
