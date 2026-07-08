import { describe, it, expect } from 'vitest'
import {
  DESTRUCTIVE_TOOLS,
  COWORK_DENIED_TOOLS,
  requiresApproval,
  isN8nToolDenied,
  canonicalToolName,
  isToolAllowed,
} from '../approval'

describe('DESTRUCTIVE_TOOLS', () => {
  it('contains all six mutating n8n tools including unpublish_workflow', () => {
    expect([...DESTRUCTIVE_TOOLS].sort()).toEqual([
      'archive_workflow',
      'create_workflow_from_code',
      'execute_workflow',
      'publish_workflow',
      'unpublish_workflow',
      'update_workflow',
    ])
  })
})

describe('requiresApproval', () => {
  const interrupt = DESTRUCTIVE_TOOLS

  it('matches bare tool names (Deep Agents n8n tools)', () => {
    expect(requiresApproval('execute_workflow', interrupt)).toBe(true)
    expect(requiresApproval('unpublish_workflow', interrupt)).toBe(true)
  })

  it('matches Claude SDK MCP-namespaced names (mcp__{server}__{tool})', () => {
    expect(requiresApproval('mcp__n8n__execute_workflow', interrupt)).toBe(true)
    expect(requiresApproval('mcp__n8n__create_workflow_from_code', interrupt)).toBe(true)
    expect(requiresApproval('mcp__n8n__archive_workflow', interrupt)).toBe(true)
  })

  it('matches Deep Agents custom-server names ({server}__{tool})', () => {
    expect(requiresApproval('myserver__execute_workflow', interrupt)).toBe(true)
  })

  it('matches custom-server approval entries against SDK-namespaced names', () => {
    // ipc/agent.ts builds approval names as `{server}__{tool}`; the SDK
    // delivers `mcp__{server}__{tool}` — the suffix rule must bridge them.
    expect(requiresApproval('mcp__myserver__dangerous_tool', ['myserver__dangerous_tool'])).toBe(true)
  })

  it('does not match read-only tools', () => {
    expect(requiresApproval('search_workflows', interrupt)).toBe(false)
    expect(requiresApproval('mcp__n8n__get_workflow_details', interrupt)).toBe(false)
    expect(requiresApproval('validate_workflow', interrupt)).toBe(false)
  })

  it('does not match near-miss names', () => {
    // No underscore-boundary match — `myexecute_workflow` is a different tool.
    expect(requiresApproval('my_execute_workflow_helper', interrupt)).toBe(false)
    expect(requiresApproval('execute_workflows', interrupt)).toBe(false)
    expect(requiresApproval('reexecute_workflow', interrupt)).toBe(false)
  })

  it('handles an empty interrupt set', () => {
    expect(requiresApproval('execute_workflow', [])).toBe(false)
  })
})

describe('canonicalToolName', () => {
  it('keeps bare n8n tool names as-is', () => {
    expect(canonicalToolName('execute_workflow')).toBe('execute_workflow')
  })

  it('strips the SDK namespace from n8n tools', () => {
    expect(canonicalToolName('mcp__n8n__execute_workflow')).toBe('execute_workflow')
  })

  it('keeps the server prefix for custom-server tools', () => {
    // Stripping the server would collide same-named tools across servers.
    expect(canonicalToolName('mcp__myserver__some_tool')).toBe('myserver__some_tool')
    expect(canonicalToolName('myserver__some_tool')).toBe('myserver__some_tool')
  })

  it('produces the same key for all three shapes of one n8n tool', () => {
    const shapes = ['execute_workflow', 'mcp__n8n__execute_workflow']
    expect(new Set(shapes.map(canonicalToolName)).size).toBe(1)
  })
})

describe('isToolAllowed', () => {
  it('matches an n8n key against every namespacing shape', () => {
    const allow = new Set(['execute_workflow'])
    expect(isToolAllowed('execute_workflow', allow)).toBe(true)
    expect(isToolAllowed('mcp__n8n__execute_workflow', allow)).toBe(true)
  })

  it('matches a custom-server key against both delivery shapes', () => {
    const allow = new Set(['myserver__some_tool'])
    expect(isToolAllowed('myserver__some_tool', allow)).toBe(true)
    expect(isToolAllowed('mcp__myserver__some_tool', allow)).toBe(true)
  })

  it('a custom-server key never allows the bare tool name', () => {
    const allow = new Set(['myserver__some_tool'])
    expect(isToolAllowed('some_tool', allow)).toBe(false)
  })

  it('does not match different tools or near-misses', () => {
    const allow = new Set(['execute_workflow'])
    expect(isToolAllowed('publish_workflow', allow)).toBe(false)
    expect(isToolAllowed('execute_workflows', allow)).toBe(false)
    expect(isToolAllowed('reexecute_workflow', allow)).toBe(false)
  })

  it('returns false for undefined or empty allow sets', () => {
    expect(isToolAllowed('execute_workflow', undefined)).toBe(false)
    expect(isToolAllowed('execute_workflow', null)).toBe(false)
    expect(isToolAllowed('execute_workflow', new Set())).toBe(false)
  })

  it('documents the deliberate suffix collision: a bare key covers same-named server tools', () => {
    // Same conservative property requiresApproval has always had — a bare
    // `execute_workflow` key also matches `otherserver__execute_workflow`.
    const allow = new Set(['execute_workflow'])
    expect(isToolAllowed('otherserver__execute_workflow', allow)).toBe(true)
  })
})

describe('COWORK_DENIED_TOOLS / isN8nToolDenied (audit #12)', () => {
  it('denies the lifecycle tools Cowork must not manage', () => {
    expect([...COWORK_DENIED_TOOLS].sort()).toEqual([
      'archive_workflow',
      'get_suggested_nodes',
      'publish_workflow',
      'unpublish_workflow',
      'update_workflow',
    ])
  })

  it('matches bare names (Deep Agents n8n tools)', () => {
    expect(isN8nToolDenied('update_workflow', COWORK_DENIED_TOOLS)).toBe(true)
    expect(isN8nToolDenied('publish_workflow', COWORK_DENIED_TOOLS)).toBe(true)
  })

  it('matches the Claude SDK mcp__n8n__ namespaced form', () => {
    expect(isN8nToolDenied('mcp__n8n__update_workflow', COWORK_DENIED_TOOLS)).toBe(true)
    expect(isN8nToolDenied('mcp__n8n__archive_workflow', COWORK_DENIED_TOOLS)).toBe(true)
  })

  it('never blocks a custom server tool that shares a denied name', () => {
    // The deny is n8n-server-scoped — myserver__update_workflow is a
    // different tool and must stay callable.
    expect(isN8nToolDenied('myserver__update_workflow', COWORK_DENIED_TOOLS)).toBe(false)
    expect(isN8nToolDenied('mcp__myserver__update_workflow', COWORK_DENIED_TOOLS)).toBe(false)
  })

  it('does not deny allowed tools', () => {
    expect(isN8nToolDenied('execute_workflow', COWORK_DENIED_TOOLS)).toBe(false)
    expect(isN8nToolDenied('create_workflow_from_code', COWORK_DENIED_TOOLS)).toBe(false)
    expect(isN8nToolDenied('search_workflows', COWORK_DENIED_TOOLS)).toBe(false)
  })
})
