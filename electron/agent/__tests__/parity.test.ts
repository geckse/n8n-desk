/**
 * Backend parity suite (CLAUDE.md hard rule: both runners emit the same
 * AgentStreamEvent types with equivalent semantics, and gate the identical
 * destructive-tool set).
 *
 * Drives BOTH runners through equivalent scripted scenarios:
 *   1. plain text turn
 *   2. gated tool call → approve
 *   3. gated tool call → reject
 * and asserts the runners produce the same compacted event-type sequences.
 *
 * Claude SDK runs against a mocked SDK module; Deep Agents runs the REAL
 * deepagents graph with a scripted model and a mocked MCP transport.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AIMessage } from '@langchain/core/messages'
import type { AgentRunner, AgentRunnerConfig, AgentStreamEvent } from '../types'
import { ScriptedChatModel } from './helpers/scripted-model'

// --- Claude SDK mock -------------------------------------------------------------

interface SdkScenario {
  /** Leading text to stream */
  introText?: string
  /** Gated tool call to attempt */
  toolCall?: { toolName: string; input: Record<string, unknown>; toolUseID: string }
  /** Multiple sequential tool calls (used by the approve_always scenarios) */
  toolCalls?: Array<{ toolName: string; input: Record<string, unknown>; toolUseID: string }>
  /**
   * ask_user_question call — after canUseTool allows, invokes the REAL
   * handler registered on the in-process n8n-desk-local MCP server (the
   * CLI's behavior for sdk-type servers) and yields its text as tool_result.
   */
  questionCall?: { input: Record<string, unknown>; toolUseID: string }
  /** Trailing text to stream */
  outroText?: string
}

const sdkState: { scenario: SdkScenario } = { scenario: {} }

vi.mock('@anthropic-ai/claude-agent-sdk', () => {
  function query(params: {
    prompt: string
    options: Record<string, unknown>
  }): AsyncGenerator<Record<string, unknown>> & { close: () => void } {
    const abortController = params.options.abortController as AbortController
    const canUseTool = params.options.canUseTool as (
      toolName: string,
      input: Record<string, unknown>,
      options: { signal: AbortSignal; toolUseID: string },
    ) => Promise<Record<string, unknown>>

    async function* run(): AsyncGenerator<Record<string, unknown>> {
      const { introText, toolCall, questionCall, outroText } = sdkState.scenario
      if (introText) {
        yield {
          type: 'stream_event',
          event: { type: 'content_block_delta', delta: { type: 'text_delta', text: introText } },
        }
      }
      if (questionCall && !abortController.signal.aborted) {
        const namespaced = 'mcp__n8n-desk-local__ask_user_question'
        yield {
          type: 'assistant',
          message: { content: [{ type: 'tool_use', id: questionCall.toolUseID, name: namespaced, input: questionCall.input }] },
        }
        await canUseTool(namespaced, questionCall.input, {
          signal: abortController.signal,
          toolUseID: questionCall.toolUseID,
        })
        const servers = params.options.mcpServers as Record<string, { instance?: unknown }>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const registered = (servers['n8n-desk-local']!.instance as any)._registeredTools['ask_user_question']
        const result = await registered.handler(questionCall.input, {})
        yield {
          type: 'user',
          message: {
            content: [{
              type: 'tool_result',
              tool_use_id: questionCall.toolUseID,
              content: String(result.content?.[0]?.text ?? ''),
              is_error: result.isError === true,
            }],
          },
        }
      }
      const allToolCalls = sdkState.scenario.toolCalls ?? (toolCall ? [toolCall] : [])
      for (const call of allToolCalls) {
        if (abortController.signal.aborted) break
        yield {
          type: 'assistant',
          message: { content: [{ type: 'tool_use', id: call.toolUseID, name: call.toolName, input: call.input }] },
        }
        const result = await canUseTool(call.toolName, call.input, {
          signal: abortController.signal,
          toolUseID: call.toolUseID,
        })
        const denied = result.behavior === 'deny'
        yield {
          type: 'user',
          message: {
            content: [{
              type: 'tool_result',
              tool_use_id: call.toolUseID,
              content: denied ? String(result.message) : '{"ok":true}',
              is_error: denied,
            }],
          },
        }
      }
      if (outroText && !abortController.signal.aborted) {
        yield {
          type: 'stream_event',
          event: { type: 'content_block_delta', delta: { type: 'text_delta', text: outroText } },
        }
      }
      yield { type: 'result', subtype: 'success' }
    }

    const generator = run() as AsyncGenerator<Record<string, unknown>> & { close: () => void }
    generator.close = () => {}
    return generator
  }
  return { query }
})

// --- Deep Agents mocks ------------------------------------------------------------

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

let scriptedModel: ScriptedChatModel

vi.mock('@langchain/anthropic', () => ({
  ChatAnthropic: class {
    constructor() {
      // eslint-disable-next-line no-constructor-return
      return scriptedModel as unknown as object
    }
  },
}))

import { ClaudeSdkRunner } from '../claude-sdk-runner'
import { DeepAgentsRunner } from '../deep-agents-runner'

// --- Helpers -----------------------------------------------------------------------

function baseConfig(): AgentRunnerConfig {
  return {
    instanceUrl: 'https://n8n.example.com',
    accessToken: 'n8n-token',
    mcpUrl: 'https://n8n.example.com/mcp-server/http',
    mcpAccessToken: 'mcp-token',
    llmConfig: { provider: 'anthropic', model: 'claude-test', apiKey: 'sk-test' },
    systemPrompt: 'You are a test agent.',
  }
}

async function collect(
  runner: AgentRunner,
  sessionId: string,
  config: AgentRunnerConfig,
  decision?: 'approve' | 'approve_always' | 'reject',
): Promise<AgentStreamEvent[]> {
  const events: AgentStreamEvent[] = []
  for await (const event of runner.invoke(sessionId, 'go', config)) {
    events.push(event)
    if (event.type === 'approval_required' && decision) {
      await runner.approve(sessionId, event.data.id, decision)
    }
    if (event.type === 'question_asked') {
      await runner.answer(sessionId, event.data.id, { q1: { selected: ['CSV'] } })
    }
  }
  return events
}

/**
 * Compact an event stream to its semantic type sequence: collapse consecutive
 * duplicates (chunking granularity differs per backend) and drop 'thinking'.
 */
function compactTypes(events: AgentStreamEvent[]): string[] {
  const out: string[] = []
  for (const e of events) {
    if (e.type === 'thinking') continue
    if (out[out.length - 1] !== e.type) out.push(e.type)
  }
  return out
}

let sessionCounter = 0
function sid(prefix: string): string {
  sessionCounter += 1
  return `parity-${prefix}-${Date.now()}-${sessionCounter}`
}

beforeEach(() => {
  mcpMock.listTools.mockReset()
  mcpMock.callTool.mockReset()
  mcpMock.listTools.mockResolvedValue([
    {
      name: 'execute_workflow',
      description: 'Execute a workflow',
      inputSchema: { type: 'object', properties: { workflowId: { type: 'string' } }, required: ['workflowId'] },
      annotations: { readOnlyHint: false },
    },
  ])
  mcpMock.callTool.mockResolvedValue({
    content: [{ type: 'text', text: '{"ok":true}' }],
  })
})

// --- Scenarios ------------------------------------------------------------------------

describe('backend parity', () => {
  it('plain text turn produces the same event sequence on both backends', async () => {
    sdkState.scenario = { introText: 'Hello there' }
    const claudeEvents = await collect(new ClaudeSdkRunner(), sid('cs-text'), baseConfig())

    scriptedModel = new ScriptedChatModel([new AIMessage('Hello there')])
    const daEvents = await collect(new DeepAgentsRunner(), sid('da-text'), baseConfig())

    expect(compactTypes(claudeEvents)).toEqual(['text_chunk', 'done'])
    expect(compactTypes(daEvents)).toEqual(['text_chunk', 'done'])

    const lastClaude = claudeEvents[claudeEvents.length - 1]
    const lastDa = daEvents[daEvents.length - 1]
    expect(lastClaude.type === 'done' && lastClaude.data.reason).toBe('completed')
    expect(lastDa.type === 'done' && lastDa.data.reason).toBe('completed')
  }, 30_000)

  it('gated tool + approve produces the same event sequence on both backends', async () => {
    sdkState.scenario = {
      introText: 'Running it.',
      toolCall: { toolName: 'mcp__n8n__execute_workflow', input: { workflowId: '42' }, toolUseID: 'toolu_p1' },
      outroText: 'Done.',
    }
    const claudeEvents = await collect(new ClaudeSdkRunner(), sid('cs-approve'), baseConfig(), 'approve')

    scriptedModel = new ScriptedChatModel([
      new AIMessage({
        content: 'Running it.',
        tool_calls: [{ name: 'execute_workflow', args: { workflowId: '42' }, id: 'call_p1', type: 'tool_call' }],
      }),
      new AIMessage('Done.'),
    ])
    const daEvents = await collect(new DeepAgentsRunner(), sid('da-approve'), baseConfig(), 'approve')

    const expected = [
      'text_chunk',
      'tool_call_start',
      'approval_required',
      'approval_resolved',
      'tool_call_result',
      'text_chunk',
      'done',
    ]
    expect(compactTypes(claudeEvents)).toEqual(expected)
    expect(compactTypes(daEvents)).toEqual(expected)

    // Both actually executed the tool (Deep Agents via mocked MCP transport;
    // Claude SDK via the allow permission result reflected in tool_result).
    expect(mcpMock.callTool).toHaveBeenCalledTimes(1)
    const claudeResult = claudeEvents.find((e) => e.type === 'tool_call_result')
    expect(claudeResult!.type === 'tool_call_result' && claudeResult!.data.success).toBe(true)
    const daResult = daEvents.find((e) => e.type === 'tool_call_result')
    expect(daResult!.type === 'tool_call_result' && daResult!.data.success).toBe(true)
  }, 30_000)

  it('gated tool + reject STOPS the run: rejected result persists, no further output, done(cancelled)', async () => {
    sdkState.scenario = {
      introText: 'Running it.',
      toolCall: { toolName: 'mcp__n8n__execute_workflow', input: { workflowId: '42' }, toolUseID: 'toolu_p2' },
      outroText: 'Understood.',
    }
    const claudeEvents = await collect(new ClaudeSdkRunner(), sid('cs-reject'), baseConfig(), 'reject')

    scriptedModel = new ScriptedChatModel([
      new AIMessage({
        content: 'Running it.',
        tool_calls: [{ name: 'execute_workflow', args: { workflowId: '42' }, id: 'call_p2', type: 'tool_call' }],
      }),
      new AIMessage('Understood.'),
    ])
    const daEvents = await collect(new DeepAgentsRunner(), sid('da-reject'), baseConfig(), 'reject')

    // The tool never executed on either backend.
    expect(mcpMock.callTool).not.toHaveBeenCalled()

    for (const events of [claudeEvents, daEvents]) {
      const types = events.map((e) => e.type)
      expect(types).toContain('approval_required')
      expect(types).toContain('approval_resolved')
      // Exactly one approval pair per prompt.
      expect(types.filter((t) => t === 'approval_required')).toHaveLength(1)
      expect(types.filter((t) => t === 'approval_resolved')).toHaveLength(1)

      // The rejected call still gets a real result (it must persist to JSONL).
      const resolvedIdx = types.indexOf('approval_resolved')
      expect(types.indexOf('tool_call_result')).toBeGreaterThan(resolvedIdx)

      // Reject stops the run: no assistant text after the rejection (the
      // "Understood." outro must never appear) and the run ends cancelled.
      expect(types.slice(resolvedIdx + 1)).not.toContain('text_chunk')
      const done = events[events.length - 1]
      expect(done.type === 'done' && done.data.reason).toBe('cancelled')
    }
  }, 30_000)

  it('session allowlist (approve_always grant) suppresses the prompt on both backends', async () => {
    sdkState.scenario = {
      toolCall: { toolName: 'mcp__n8n__execute_workflow', input: { workflowId: '42' }, toolUseID: 'toolu_sa1' },
      outroText: 'Done.',
    }
    const csConfig = { ...baseConfig(), sessionAllowedTools: new Set(['execute_workflow']) }
    const claudeEvents = await collect(new ClaudeSdkRunner(), sid('cs-session-allow'), csConfig)

    scriptedModel = new ScriptedChatModel([
      new AIMessage({
        content: 'Running.',
        tool_calls: [{ name: 'execute_workflow', args: { workflowId: '42' }, id: 'call_sa1', type: 'tool_call' }],
      }),
      new AIMessage('Done.'),
    ])
    const daConfig = { ...baseConfig(), sessionAllowedTools: new Set(['execute_workflow']) }
    const daEvents = await collect(new DeepAgentsRunner(), sid('da-session-allow'), daConfig)

    // Executed once on the Deep Agents backend (real MCP mock).
    expect(mcpMock.callTool).toHaveBeenCalledTimes(1)

    for (const events of [claudeEvents, daEvents]) {
      const types = events.map((e) => e.type)
      expect(types).not.toContain('approval_required')
      expect(types).not.toContain('approval_resolved')
      const result = events.find((e) => e.type === 'tool_call_result')
      expect(result!.type === 'tool_call_result' && result!.data.success).toBe(true)
      const done = events[events.length - 1]
      expect(done.type === 'done' && done.data.reason).toBe('completed')
    }
  }, 30_000)

  it('persistent preset (alwaysAllowedTools) suppresses the prompt on both backends', async () => {
    sdkState.scenario = {
      toolCall: { toolName: 'mcp__n8n__execute_workflow', input: { workflowId: '42' }, toolUseID: 'toolu_pa1' },
      outroText: 'Done.',
    }
    const csConfig = { ...baseConfig(), alwaysAllowedTools: ['execute_workflow'] }
    const claudeEvents = await collect(new ClaudeSdkRunner(), sid('cs-preset-allow'), csConfig)

    scriptedModel = new ScriptedChatModel([
      new AIMessage({
        content: 'Running.',
        tool_calls: [{ name: 'execute_workflow', args: { workflowId: '42' }, id: 'call_pa1', type: 'tool_call' }],
      }),
      new AIMessage('Done.'),
    ])
    const daConfig = { ...baseConfig(), alwaysAllowedTools: ['execute_workflow'] }
    const daEvents = await collect(new DeepAgentsRunner(), sid('da-preset-allow'), daConfig)

    expect(mcpMock.callTool).toHaveBeenCalledTimes(1)

    for (const events of [claudeEvents, daEvents]) {
      const types = events.map((e) => e.type)
      expect(types).not.toContain('approval_required')
      const result = events.find((e) => e.type === 'tool_call_result')
      expect(result!.type === 'tool_call_result' && result!.data.success).toBe(true)
      const done = events[events.length - 1]
      expect(done.type === 'done' && done.data.reason).toBe('completed')
    }
  }, 30_000)

  it('approve_always is sticky within one run: second call of the tool never prompts', async () => {
    sdkState.scenario = {
      toolCalls: [
        { toolName: 'mcp__n8n__execute_workflow', input: { workflowId: '42' }, toolUseID: 'toolu_aa1' },
        { toolName: 'mcp__n8n__execute_workflow', input: { workflowId: '43' }, toolUseID: 'toolu_aa2' },
      ],
      outroText: 'Both done.',
    }
    const csAllow = new Set<string>()
    const claudeEvents = await collect(
      new ClaudeSdkRunner(),
      sid('cs-always'),
      { ...baseConfig(), sessionAllowedTools: csAllow },
      'approve_always',
    )

    scriptedModel = new ScriptedChatModel([
      new AIMessage({
        content: 'First.',
        tool_calls: [{ name: 'execute_workflow', args: { workflowId: '42' }, id: 'call_aa1', type: 'tool_call' }],
      }),
      new AIMessage({
        content: 'Second.',
        tool_calls: [{ name: 'execute_workflow', args: { workflowId: '43' }, id: 'call_aa2', type: 'tool_call' }],
      }),
      new AIMessage('Both done.'),
    ])
    const daAllow = new Set<string>()
    const daEvents = await collect(
      new DeepAgentsRunner(),
      sid('da-always'),
      { ...baseConfig(), sessionAllowedTools: daAllow },
      'approve_always',
    )

    // The grant landed in the live session Set (canonical name).
    expect(csAllow.has('execute_workflow')).toBe(true)
    expect(daAllow.has('execute_workflow')).toBe(true)
    // Deep Agents executed both calls (second one silently auto-approved even
    // though interruptOn was frozen at agent creation — the mid-run path).
    expect(mcpMock.callTool).toHaveBeenCalledTimes(2)

    for (const events of [claudeEvents, daEvents]) {
      const types = events.map((e) => e.type)
      // Exactly ONE prompt (the first call) and one resolution.
      expect(types.filter((t) => t === 'approval_required')).toHaveLength(1)
      expect(types.filter((t) => t === 'approval_resolved')).toHaveLength(1)
      // Both calls produced successful results.
      const results = events.filter((e) => e.type === 'tool_call_result')
      expect(results).toHaveLength(2)
      for (const r of results) {
        expect(r.type === 'tool_call_result' && r.data.success).toBe(true)
      }
      const done = events[events.length - 1]
      expect(done.type === 'done' && done.data.reason).toBe('completed')
    }
  }, 30_000)

  it('approve_always survives runner recreation (next invoke with the same live Set)', async () => {
    // Invoke #1: grant approve_always. The Set instance is owned by the IPC
    // layer in production; here the test owns it.
    const csAllow = new Set<string>()
    const csSession = sid('cs-recreate')
    sdkState.scenario = {
      toolCall: { toolName: 'mcp__n8n__execute_workflow', input: { workflowId: '42' }, toolUseID: 'toolu_rc1' },
    }
    await collect(new ClaudeSdkRunner(), csSession, { ...baseConfig(), sessionAllowedTools: csAllow }, 'approve_always')

    // Invoke #2: NEW runner instance, same Set → no prompt.
    sdkState.scenario = {
      toolCall: { toolName: 'mcp__n8n__execute_workflow', input: { workflowId: '43' }, toolUseID: 'toolu_rc2' },
    }
    const claudeEvents2 = await collect(new ClaudeSdkRunner(), csSession, { ...baseConfig(), sessionAllowedTools: csAllow })
    expect(claudeEvents2.map((e) => e.type)).not.toContain('approval_required')

    const daAllow = new Set<string>()
    const daSession = sid('da-recreate')
    scriptedModel = new ScriptedChatModel([
      new AIMessage({
        content: 'First.',
        tool_calls: [{ name: 'execute_workflow', args: { workflowId: '42' }, id: 'call_rc1', type: 'tool_call' }],
      }),
      new AIMessage('Done.'),
    ])
    await collect(new DeepAgentsRunner(), daSession, { ...baseConfig(), sessionAllowedTools: daAllow }, 'approve_always')

    scriptedModel = new ScriptedChatModel([
      new AIMessage({
        content: 'Second.',
        tool_calls: [{ name: 'execute_workflow', args: { workflowId: '43' }, id: 'call_rc2', type: 'tool_call' }],
      }),
      new AIMessage('Done again.'),
    ])
    const daEvents2 = await collect(new DeepAgentsRunner(), daSession, { ...baseConfig(), sessionAllowedTools: daAllow })
    expect(daEvents2.map((e) => e.type)).not.toContain('approval_required')

    // Both second invokes executed the tool without prompting.
    const csResult = claudeEvents2.find((e) => e.type === 'tool_call_result')
    expect(csResult!.type === 'tool_call_result' && csResult!.data.success).toBe(true)
    const daResult = daEvents2.find((e) => e.type === 'tool_call_result')
    expect(daResult!.type === 'tool_call_result' && daResult!.data.success).toBe(true)
  }, 60_000)

  it('ask_user_question produces the same event sequence on both backends', async () => {
    const questionInput = {
      questions: [{ question: 'Which format?', options: [{ label: 'CSV' }, { label: 'JSON' }] }],
    }

    sdkState.scenario = {
      introText: 'Let me check.',
      questionCall: { input: questionInput, toolUseID: 'toolu_q1' },
      outroText: 'CSV it is.',
    }
    const claudeEvents = await collect(new ClaudeSdkRunner(), sid('cs-question'), baseConfig())

    scriptedModel = new ScriptedChatModel([
      new AIMessage({
        content: 'Let me check.',
        tool_calls: [{ name: 'ask_user_question', args: questionInput, id: 'call_q1', type: 'tool_call' }],
      }),
      new AIMessage('CSV it is.'),
    ])
    const daEvents = await collect(new DeepAgentsRunner(), sid('da-question'), baseConfig())

    const expected = [
      'text_chunk',
      'tool_call_start',
      'question_asked',
      'question_answered',
      'tool_call_result',
      'text_chunk',
      'done',
    ]
    expect(compactTypes(claudeEvents)).toEqual(expected)
    expect(compactTypes(daEvents)).toEqual(expected)

    // The answers reached the model as the tool result on BOTH backends
    for (const events of [claudeEvents, daEvents]) {
      const result = events.find((e) => e.type === 'tool_call_result')
      expect(result!.type === 'tool_call_result' && result!.data.success).toBe(true)
      expect(result!.type === 'tool_call_result' && String(result!.data.result)).toContain('selected: CSV')
      const done = events[events.length - 1]
      expect(done.type === 'done' && done.data.reason).toBe('completed')
    }

    // Never approval-gated in any name form
    const { requiresApproval, DESTRUCTIVE_TOOLS } = await import('../approval')
    expect(requiresApproval('ask_user_question', new Set(DESTRUCTIVE_TOOLS))).toBe(false)
    expect(requiresApproval('mcp__n8n-desk-local__ask_user_question', new Set(DESTRUCTIVE_TOOLS))).toBe(false)
  }, 30_000)

  it('both backends gate the identical destructive set (shared matcher)', async () => {
    // The gate lives in ONE shared module — this asserts both runners import
    // it rather than duplicating the list (regression guard for #26/#33).
    const { DESTRUCTIVE_TOOLS } = await import('../approval')
    const claudeSrc = await import('fs/promises').then((fs) =>
      fs.readFile(new URL('../claude-sdk-runner.ts', import.meta.url), 'utf-8'))
    const daSrc = await import('fs/promises').then((fs) =>
      fs.readFile(new URL('../deep-agents-runner.ts', import.meta.url), 'utf-8'))

    expect(DESTRUCTIVE_TOOLS.length).toBeGreaterThan(0)
    for (const src of [claudeSrc, daSrc]) {
      expect(src).toContain("from './approval'")
      expect(src).not.toMatch(/const DESTRUCTIVE_TOOLS\s*=/)
    }
  })
})
