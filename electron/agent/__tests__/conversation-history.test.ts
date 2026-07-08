import { describe, it, expect } from 'vitest'
import { buildConversationHistory, parseSessionJsonl } from '../conversation-history'

function line(role: string, content: string, meta?: Record<string, unknown>): string {
  return JSON.stringify({ id: `msg_${Math.random()}`, role, content, ts: '2026-07-07T10:00:00Z', ...(meta ? { meta } : {}) })
}

describe('parseSessionJsonl', () => {
  it('parses lines and skips malformed ones', () => {
    const content = [
      line('user', 'hello'),
      'NOT JSON {{{',
      '',
      line('assistant', 'hi'),
    ].join('\n')
    const lines = parseSessionJsonl(content)
    expect(lines).toHaveLength(2)
    expect(lines[0].role).toBe('user')
    expect(lines[1].role).toBe('assistant')
  })
})

describe('buildConversationHistory (audit #18)', () => {
  it('folds tool calls and results into the assistant turn, preserving identifiers', () => {
    const lines = parseSessionJsonl([
      line('user', 'Create an invoice workflow'),
      line('assistant', 'I will create the workflow now.'),
      line('tool', '{"workflowId":"WF-9","name":"Invoice Extractor"}', {
        toolCallId: 'call_1', toolName: 'create_workflow_from_code', status: 'completed',
      }),
      line('assistant', 'Created workflow WF-9.'),
    ].join('\n'))

    const history = buildConversationHistory(lines)

    expect(history).toHaveLength(2)
    expect(history[0]).toEqual({ role: 'user', content: 'Create an invoice workflow' })
    expect(history[1].role).toBe('assistant')
    // Intermediate assistant text survives
    expect(history[1].content).toContain('I will create the workflow now.')
    // Tool call + key identifiers survive
    expect(history[1].content).toContain('create_workflow_from_code')
    expect(history[1].content).toContain('WF-9')
    // Final assistant text survives
    expect(history[1].content).toContain('Created workflow WF-9.')
  })

  it('produces strictly alternating user/assistant messages across turns', () => {
    const lines = parseSessionJsonl([
      line('user', 'turn one'),
      line('assistant', 'answer one'),
      line('tool', '{"executionId":"exec-42"}', { toolCallId: 'c1', toolName: 'execute_workflow', status: 'completed' }),
      line('user', 'turn two'),
      line('assistant', 'answer two'),
    ].join('\n'))

    const history = buildConversationHistory(lines)
    expect(history.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
    expect(history[1].content).toContain('exec-42')
  })

  it('marks failed tool calls', () => {
    const lines = parseSessionJsonl([
      line('user', 'run it'),
      line('tool', 'validation error: missing trigger', { toolCallId: 'c1', toolName: 'validate_workflow', status: 'failed' }),
    ].join('\n'))

    const history = buildConversationHistory(lines)
    expect(history[1].content).toContain('validate_workflow — failed')
    expect(history[1].content).toContain('validation error: missing trigger')
  })

  it('truncates oversized tool results but keeps the head', () => {
    const big = 'x'.repeat(10_000)
    const lines = parseSessionJsonl([
      line('user', 'go'),
      line('tool', `{"workflowId":"WF-1","data":"${big}"}`, { toolCallId: 'c1', toolName: 'get_workflow_details', status: 'completed' }),
    ].join('\n'))

    const history = buildConversationHistory(lines)
    expect(history[1].content).toContain('WF-1')
    expect(history[1].content).toContain('[truncated')
    expect(history[1].content.length).toBeLessThan(2_500)
  })

  it('skips thinking and system messages', () => {
    const lines = parseSessionJsonl([
      line('user', 'hello'),
      line('thinking', 'pondering deeply'),
      line('system', 'MCP discovery failed', { error: true }),
      line('assistant', 'hi there'),
    ].join('\n'))

    const history = buildConversationHistory(lines)
    expect(history).toHaveLength(2)
    expect(history[1].content).toBe('hi there')
    expect(JSON.stringify(history)).not.toContain('pondering')
    expect(JSON.stringify(history)).not.toContain('MCP discovery failed')
  })

  it('drops the trailing user message matching the current prompt (audit #43)', () => {
    const lines = parseSessionJsonl([
      line('user', 'first'),
      line('assistant', 'reply'),
      line('user', 'current message'),
    ].join('\n'))

    const history = buildConversationHistory(lines, 'current message')
    expect(history).toHaveLength(2)
    expect(history[history.length - 1].role).toBe('assistant')
  })

  it('keeps a trailing user message that does NOT match the current prompt', () => {
    const lines = parseSessionJsonl([
      line('user', 'first'),
      line('assistant', 'reply'),
      line('user', 'unrelated earlier message'),
    ].join('\n'))

    const history = buildConversationHistory(lines, 'current message')
    expect(history).toHaveLength(3)
  })

  it('ignores tool messages without a toolCallId (not agent activity)', () => {
    const lines = parseSessionJsonl([
      line('user', 'go'),
      line('tool', 'stray content', {}),
    ].join('\n'))

    const history = buildConversationHistory(lines)
    expect(history).toHaveLength(1)
  })

  it('returns empty history for an empty transcript', () => {
    expect(buildConversationHistory([])).toEqual([])
    expect(buildConversationHistory(parseSessionJsonl(''))).toEqual([])
  })
})
