/**
 * Prompt sanity checks (audits #13, #56, #57, #44, #12-text).
 *
 * The prompts must teach the n8n MCP server's mandated build order, reference
 * only tools that exist, and stay in sync with the enforced mode restrictions.
 */
import { describe, it, expect } from 'vitest'
import { WORKFLOW_MODE_SYSTEM_PROMPT, COWORK_MODE_SYSTEM_PROMPT } from '../system-prompts'
import { COWORK_DENIED_TOOLS } from '../approval'

const PROMPTS = [
  ['workflow', WORKFLOW_MODE_SYSTEM_PROMPT],
  ['cowork', COWORK_MODE_SYSTEM_PROMPT],
] as const

describe.each(PROMPTS)('%s prompt — real tool surface only (audit #57)', (_mode, prompt) => {
  it('never references the phantom create_workflow tool', () => {
    // create_workflow_from_code is real; a bare "create_workflow" call is not.
    const bareMentions = prompt.match(/create_workflow(?!_from_code)/g) ?? []
    expect(bareMentions).toEqual([])
  })

  it('never references the phantom remote code sandbox tier', () => {
    expect(prompt).not.toMatch(/remote code sandbox/i)
    expect(prompt).not.toContain('Tier 4')
  })

  it('says the tool surface is discovered from the server (no frozen list)', () => {
    expect(prompt).toMatch(/comes from the connected n8n server|tool list comes from/i)
  })

  it('explains the availableInMCP gate (audit #56)', () => {
    expect(prompt).toContain('availableInMCP')
    expect(prompt).toMatch(/enable MCP access/i)
  })

  it('teaches recurring automation via Schedule Trigger (audit #44)', () => {
    expect(prompt).toContain('Schedule Trigger')
    expect(prompt).toMatch(/cannot run anything later|only act during this conversation/i)
  })
})

describe('workflow prompt — mandated build order (audit #13)', () => {
  it('starts the build order with get_sdk_reference', () => {
    const buildOrder = WORKFLOW_MODE_SYSTEM_PROMPT.slice(
      WORKFLOW_MODE_SYSTEM_PROMPT.indexOf('## Build Order'),
    )
    const positions = [
      'get_sdk_reference',
      'search_nodes',
      'get_node_types',
      'validate_workflow',
      'create_workflow_from_code',
      'execute_workflow',
      'publish_workflow',
    ].map((tool) => buildOrder.indexOf(tool))

    // Every step present, in the server's order
    for (const pos of positions) expect(pos).toBeGreaterThan(-1)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it('warns against guessing node parameters', () => {
    expect(WORKFLOW_MODE_SYSTEM_PROMPT).toMatch(/NEVER guess parameter names/i)
  })

  it('mandates the validate → fix → re-validate loop', () => {
    expect(WORKFLOW_MODE_SYSTEM_PROMPT).toMatch(/fix them and validate again|re-validate/i)
  })

  it('lists all six destructive tools as approval-gated', () => {
    const approvalSection = WORKFLOW_MODE_SYSTEM_PROMPT.slice(
      WORKFLOW_MODE_SYSTEM_PROMPT.indexOf('## Approval Flow'),
    )
    for (const tool of [
      'create_workflow_from_code', 'update_workflow', 'execute_workflow',
      'publish_workflow', 'unpublish_workflow', 'archive_workflow',
    ]) {
      expect(approvalSection).toContain(tool)
    }
  })
})

describe.each(PROMPTS)('%s prompt — daily-task capabilities (phase 4)', (_mode, prompt) => {
  it('teaches the persistent memory tools (audit #45)', () => {
    expect(prompt).toContain('memory_append')
    expect(prompt).toContain('memory_read')
    expect(prompt).toMatch(/STABLE facts/i)
  })

  it('teaches the credential check before building integrations (audit #40)', () => {
    expect(prompt).toContain('list_credentials')
    expect(prompt).toMatch(/credentials cannot be created/i)
  })

  it('lists the file-management and clipboard tools (audit #32)', () => {
    for (const tool of ['move_file', 'copy_file', 'delete_file', 'open_path', 'clipboard_read', 'clipboard_write']) {
      expect(prompt).toContain(tool)
    }
  })
})

describe('cowork prompt — mode restrictions stay in sync (audit #12)', () => {
  it('names every enforced denied tool in the "Not available" text', () => {
    for (const tool of COWORK_DENIED_TOOLS) {
      expect(COWORK_MODE_SYSTEM_PROMPT).toContain(tool)
    }
    expect(COWORK_MODE_SYSTEM_PROMPT).toContain('Not available in Cowork mode')
  })

  it('has an error-recovery and result-presentation procedure (audit #36)', () => {
    expect(COWORK_MODE_SYSTEM_PROMPT).toContain('## Error Recovery & Results')
    expect(COWORK_MODE_SYSTEM_PROMPT).toContain('get_execution')
    expect(COWORK_MODE_SYSTEM_PROMPT).toMatch(/present the result/i)
  })
})
