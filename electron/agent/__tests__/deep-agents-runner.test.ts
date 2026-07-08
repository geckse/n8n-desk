/**
 * Deep Agents runner integration tests.
 *
 * These drive the REAL deepagents graph (createDeepAgent + LangGraph HITL
 * middleware + checkpointer) with a scripted chat model and a mocked MCP
 * transport. They prove the parts the audit found broken end-to-end:
 *  - events actually stream (streamMode messages/updates normalization)
 *  - the interrupt fires BEFORE the gated tool executes
 *  - resume via Command({resume:{decisions}}) executes the tool on approve
 *  - a rejection never executes the tool and the session still completes
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AIMessage } from '@langchain/core/messages'
import type { AgentRunnerConfig, AgentStreamEvent } from '../types'
import { ScriptedChatModel } from './helpers/scripted-model'

// --- Mock the MCP client (network layer) --------------------------------------

const mcpMock = vi.hoisted(() => ({
  listTools: vi.fn(),
  callTool: vi.fn(),
}))

vi.mock('../../mcp-client', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../mcp-client')>()
  return {
    ...original,
    listToolsWithUrl: mcpMock.listTools,
    callToolWithUrl: mcpMock.callTool,
  }
})

// --- Mock the chat model factory ------------------------------------------------

// The runner constructs provider models internally; inject the scripted model
// by mocking the provider package it lazy-imports.
let scriptedModel: ScriptedChatModel

vi.mock('@langchain/anthropic', () => ({
  ChatAnthropic: class {
    constructor() {
      // eslint-disable-next-line no-constructor-return
      return scriptedModel as unknown as object
    }
  },
}))

import { DeepAgentsRunner } from '../deep-agents-runner'

// --- Helpers -------------------------------------------------------------------

function baseConfig(overrides: Partial<AgentRunnerConfig> = {}): AgentRunnerConfig {
  return {
    instanceUrl: 'https://n8n.example.com',
    accessToken: 'n8n-token',
    mcpUrl: 'https://n8n.example.com/mcp-server/http',
    mcpAccessToken: 'mcp-token',
    llmConfig: { provider: 'anthropic', model: 'claude-test', apiKey: 'sk-test' },
    systemPrompt: 'You are a test agent.',
    ...overrides,
  }
}

function n8nToolSurface() {
  return [
    {
      name: 'execute_workflow',
      description: 'Execute a workflow',
      inputSchema: {
        type: 'object',
        properties: {
          workflowId: { type: 'string' },
          executionMode: { type: 'string', enum: ['manual', 'production'] },
        },
        required: ['workflowId'],
      },
      annotations: { readOnlyHint: false },
    },
    {
      name: 'search_workflows',
      description: 'Search workflows',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' } },
      },
      annotations: { readOnlyHint: true },
    },
  ]
}

async function collect(
  runner: DeepAgentsRunner,
  sessionId: string,
  message: string,
  config: AgentRunnerConfig,
  decision?: 'approve' | 'reject',
): Promise<AgentStreamEvent[]> {
  const events: AgentStreamEvent[] = []
  for await (const event of runner.invoke(sessionId, message, config)) {
    events.push(event)
    if (event.type === 'approval_required' && decision) {
      const resolved = await runner.approve(sessionId, event.data.id, decision)
      expect(resolved).toBe(true)
    }
  }
  return events
}

let sessionCounter = 0
function freshSessionId(): string {
  sessionCounter += 1
  return `da-test-session-${Date.now()}-${sessionCounter}`
}

beforeEach(() => {
  mcpMock.listTools.mockReset()
  mcpMock.callTool.mockReset()
  mcpMock.listTools.mockResolvedValue(n8nToolSurface())
  mcpMock.callTool.mockResolvedValue({
    content: [{ type: 'text', text: '{"executionId":"exec-1","status":"success"}' }],
  })
})

// --- Tests -----------------------------------------------------------------------

describe('DeepAgentsRunner streaming', () => {
  it('streams text for a plain text turn and ends with done(completed)', async () => {
    scriptedModel = new ScriptedChatModel([new AIMessage('Hello from the agent')])

    const runner = new DeepAgentsRunner()
    const events = await collect(runner, freshSessionId(), 'hi', baseConfig())

    const types = events.map((e) => e.type)
    const text = events
      .filter((e) => e.type === 'text_chunk')
      .map((e) => (e.data as { text: string }).text)
      .join('')
    expect(text).toContain('Hello from the agent')
    expect(types[types.length - 1]).toBe('done')
    const done = events[events.length - 1]
    expect(done.type === 'done' && done.data.reason).toBe('completed')
  }, 30_000)

  it('emits tool_call_start and tool_call_result for a non-gated tool', async () => {
    scriptedModel = new ScriptedChatModel([
      new AIMessage({
        content: 'Searching…',
        tool_calls: [{ name: 'search_workflows', args: { query: 'invoices' }, id: 'call_search_1', type: 'tool_call' }],
      }),
      new AIMessage('Found nothing.'),
    ])

    const runner = new DeepAgentsRunner()
    const events = await collect(runner, freshSessionId(), 'find workflows', baseConfig())

    const types = events.map((e) => e.type)
    expect(types).toContain('tool_call_start')
    expect(types).toContain('tool_call_result')
    expect(types).not.toContain('approval_required')

    const start = events.find((e) => e.type === 'tool_call_start')
    expect(start!.type === 'tool_call_start' && start!.data.name).toBe('search_workflows')
    expect(mcpMock.callTool).toHaveBeenCalledTimes(1)
    expect(mcpMock.callTool.mock.calls[0][2]).toBe('search_workflows')
  }, 30_000)
})

describe('DeepAgentsRunner human-in-the-loop', () => {
  it('interrupts BEFORE executing a gated tool and executes it on approve', async () => {
    scriptedModel = new ScriptedChatModel([
      new AIMessage({
        content: 'Running the workflow now.',
        tool_calls: [{ name: 'execute_workflow', args: { workflowId: '42' }, id: 'call_exec_1', type: 'tool_call' }],
      }),
      new AIMessage('The workflow ran successfully.'),
    ])

    const runner = new DeepAgentsRunner()
    const events = await collect(runner, freshSessionId(), 'run workflow 42', baseConfig(), 'approve')

    const types = events.map((e) => e.type)
    expect(types).toContain('approval_required')
    expect(types).toContain('approval_resolved')
    expect(types).toContain('tool_call_result')

    // The gate must fire BEFORE the tool executes: at the moment
    // approval_required is emitted, callTool must not have run yet — verified
    // by ordering: approval_required strictly precedes tool_call_result.
    expect(types.indexOf('approval_required')).toBeLessThan(types.indexOf('tool_call_result'))

    // Approved → the MCP tool actually executed with the right args
    expect(mcpMock.callTool).toHaveBeenCalledTimes(1)
    expect(mcpMock.callTool.mock.calls[0][2]).toBe('execute_workflow')
    expect(mcpMock.callTool.mock.calls[0][3]).toEqual({ workflowId: '42' })

    // Result flowed back
    const result = events.find((e) => e.type === 'tool_call_result')
    expect(result!.type === 'tool_call_result' && String(result!.data.result)).toContain('exec-1')

    // Terminal state
    const done = events[events.length - 1]
    expect(done.type === 'done' && done.data.reason).toBe('completed')
  }, 30_000)

  it('a rejected tool NEVER executes and the run STOPS (done cancelled, no follow-up text)', async () => {
    scriptedModel = new ScriptedChatModel([
      new AIMessage({
        content: 'Running it.',
        tool_calls: [{ name: 'execute_workflow', args: { workflowId: '42' }, id: 'call_exec_2', type: 'tool_call' }],
      }),
      new AIMessage('Understood, not running it.'),
    ])

    const runner = new DeepAgentsRunner()
    const events = await collect(runner, freshSessionId(), 'run workflow 42', baseConfig(), 'reject')

    // The tool must NOT have executed
    expect(mcpMock.callTool).not.toHaveBeenCalled()

    const resolved = events.find((e) => e.type === 'approval_resolved')
    expect(resolved!.type === 'approval_resolved' && resolved!.data.decision).toBe('reject')

    // The rejected call still surfaces a tool_call_result (persists to JSONL)
    // BEFORE the abort, and no assistant text follows the rejection.
    const types = events.map((e) => e.type)
    const resolvedIdx = types.indexOf('approval_resolved')
    expect(types.indexOf('tool_call_result')).toBeGreaterThan(resolvedIdx)
    expect(types.slice(resolvedIdx + 1)).not.toContain('text_chunk')

    // Reject stops the run — the session waits for the next user message.
    const done = events[events.length - 1]
    expect(done.type === 'done' && done.data.reason).toBe('cancelled')
  }, 30_000)

  it('gates tools the server annotates as mutating even outside the static set', async () => {
    mcpMock.listTools.mockResolvedValue([
      ...n8nToolSurface(),
      {
        name: 'add_data_table_rows',
        description: 'Insert rows',
        inputSchema: { type: 'object', properties: { dataTableId: { type: 'string' } } },
        annotations: { readOnlyHint: false },
      },
    ])

    scriptedModel = new ScriptedChatModel([
      new AIMessage({
        content: 'Inserting rows.',
        tool_calls: [{ name: 'add_data_table_rows', args: { dataTableId: 'dt1' }, id: 'call_dt_1', type: 'tool_call' }],
      }),
      new AIMessage('Rows inserted.'),
    ])

    const runner = new DeepAgentsRunner()
    const events = await collect(runner, freshSessionId(), 'insert rows', baseConfig(), 'approve')

    const approval = events.find((e) => e.type === 'approval_required')
    expect(approval).toBeDefined()
    expect(approval!.type === 'approval_required' && approval!.data.toolName).toBe('add_data_table_rows')
  }, 30_000)
})

describe('DeepAgentsRunner mode restrictions (audit #12)', () => {
  it('never registers denied n8n tools — a call to one cannot reach the server', async () => {
    mcpMock.listTools.mockResolvedValue([
      ...n8nToolSurface(),
      {
        name: 'update_workflow',
        description: 'Update a workflow',
        inputSchema: { type: 'object', properties: { workflowId: { type: 'string' } }, required: ['workflowId'] },
        annotations: { readOnlyHint: false },
      },
    ])

    // The model tries the denied tool anyway; the graph reports it as an
    // invalid tool and the model recovers.
    scriptedModel = new ScriptedChatModel([
      new AIMessage({
        content: 'Updating.',
        tool_calls: [{ name: 'update_workflow', args: { workflowId: '42' }, id: 'call_denied_1', type: 'tool_call' }],
      }),
      new AIMessage('That tool is unavailable here.'),
    ])

    const runner = new DeepAgentsRunner()
    const events = await collect(
      runner,
      freshSessionId(),
      'update the workflow',
      baseConfig({ deniedTools: ['update_workflow'] }),
      'approve',
    )

    // The MCP server was never called and no approval fired — the tool
    // simply does not exist on the agent.
    expect(mcpMock.callTool).not.toHaveBeenCalled()
    expect(events.map((e) => e.type)).not.toContain('approval_required')
    const done = events[events.length - 1]
    expect(done.type).toBe('done')
  }, 30_000)

  it('keeps allowed tools callable when deniedTools is set', async () => {
    scriptedModel = new ScriptedChatModel([
      new AIMessage({
        content: 'Searching…',
        tool_calls: [{ name: 'search_workflows', args: { query: 'x' }, id: 'call_ok_1', type: 'tool_call' }],
      }),
      new AIMessage('Done.'),
    ])

    const runner = new DeepAgentsRunner()
    const events = await collect(
      runner,
      freshSessionId(),
      'search',
      baseConfig({ deniedTools: ['update_workflow', 'publish_workflow'] }),
    )

    expect(events.map((e) => e.type)).toContain('tool_call_result')
    expect(mcpMock.callTool).toHaveBeenCalledTimes(1)
    expect(mcpMock.callTool.mock.calls[0][2]).toBe('search_workflows')
  }, 30_000)
})

describe('DeepAgentsRunner ask_user_question', () => {
  const questionToolCall = {
    name: 'ask_user_question',
    args: {
      questions: [
        {
          question: 'Which format?',
          options: [{ label: 'CSV' }, { label: 'JSON', description: 'structured output' }],
        },
      ],
    },
    id: 'call_ask_1',
    type: 'tool_call' as const,
  }

  it('pauses on question_asked and resumes with the answers as the tool result', async () => {
    scriptedModel = new ScriptedChatModel([
      new AIMessage({ content: 'Let me check.', tool_calls: [questionToolCall] }),
      new AIMessage('Great, CSV it is.'),
    ])

    const runner = new DeepAgentsRunner()
    const sessionId = freshSessionId()
    const events: AgentStreamEvent[] = []
    for await (const event of runner.invoke(sessionId, 'export the data', baseConfig())) {
      events.push(event)
      if (event.type === 'question_asked') {
        // The interrupt payload carries the normalized questions
        expect(event.data.questions).toEqual([
          {
            id: 'q1',
            question: 'Which format?',
            options: [{ label: 'CSV' }, { label: 'JSON', description: 'structured output' }],
          },
        ])
        const resolved = await runner.answer(sessionId, event.data.id, {
          q1: { selected: ['CSV'], otherText: 'keep it simple' },
        })
        expect(resolved).toBe(true)
      }
    }

    const types = events.map((e) => e.type)
    expect(types).toContain('question_asked')
    expect(types).toContain('question_answered')
    // The question is never approval-gated
    expect(types).not.toContain('approval_required')
    // question_asked strictly precedes the tool result (interrupt fired first)
    expect(types.indexOf('question_asked')).toBeLessThan(types.indexOf('tool_call_result'))

    // The answers reached the model as the tool result
    const result = events.find((e) => e.type === 'tool_call_result')
    expect(result!.type === 'tool_call_result' && String(result!.data.result)).toContain('selected: CSV')
    expect(result!.type === 'tool_call_result' && String(result!.data.result)).toContain('other: keep it simple')

    const done = events[events.length - 1]
    expect(done.type === 'done' && done.data.reason).toBe('completed')
  }, 30_000)

  it('stop() during a pending question cancels cleanly without resuming', async () => {
    scriptedModel = new ScriptedChatModel([
      new AIMessage({ content: 'Asking…', tool_calls: [{ ...questionToolCall, id: 'call_ask_2' }] }),
      new AIMessage('This must never be reached.'),
    ])

    const runner = new DeepAgentsRunner()
    const sessionId = freshSessionId()
    const events: AgentStreamEvent[] = []
    for await (const event of runner.invoke(sessionId, 'export the data', baseConfig())) {
      events.push(event)
      if (event.type === 'question_asked') {
        await runner.stop(sessionId)
      }
    }

    const types = events.map((e) => e.type)
    expect(types).toContain('question_asked')
    expect(types).not.toContain('question_answered')
    const done = events[events.length - 1]
    expect(done.type === 'done' && done.data.reason).toBe('cancelled')
  }, 30_000)

  it('answer() with a wrong question id returns false', async () => {
    scriptedModel = new ScriptedChatModel([
      new AIMessage({ content: 'Asking…', tool_calls: [{ ...questionToolCall, id: 'call_ask_3' }] }),
      new AIMessage('Done.'),
    ])

    const runner = new DeepAgentsRunner()
    const sessionId = freshSessionId()
    for await (const event of runner.invoke(sessionId, 'export the data', baseConfig())) {
      if (event.type === 'question_asked') {
        expect(await runner.answer(sessionId, 'nonexistent-id', { q1: { selected: ['CSV'] } })).toBe(false)
        expect(await runner.answer(sessionId, event.data.id, { q1: { selected: ['CSV'] } })).toBe(true)
      }
    }
  }, 30_000)
})

describe('DeepAgentsRunner MCP discovery failure', () => {
  it('emits MCP_DISCOVERY_FAILED and continues with local-only tools', async () => {
    mcpMock.listTools.mockRejectedValue(new Error('connect ECONNREFUSED'))
    scriptedModel = new ScriptedChatModel([new AIMessage('Working without n8n tools.')])

    const runner = new DeepAgentsRunner()
    const events = await collect(runner, freshSessionId(), 'hello', baseConfig())

    const error = events.find((e) => e.type === 'error')
    expect(error).toBeDefined()
    expect(error!.type === 'error' && error!.data.code).toBe('MCP_DISCOVERY_FAILED')

    // Session still ran to completion
    const done = events[events.length - 1]
    expect(done.type === 'done' && done.data.reason).toBe('completed')
  }, 30_000)
})
