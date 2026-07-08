import { describe, it, expect } from 'vitest'
import { toolDisplayName, parseToolName } from '@/utils/tool-display'

describe('parseToolName', () => {
  it('parses bare names', () => {
    expect(parseToolName('execute_workflow')).toEqual({ server: null, name: 'execute_workflow' })
  })

  it('parses mcp__{server}__{tool} (Claude SDK)', () => {
    expect(parseToolName('mcp__n8n__execute_workflow')).toEqual({ server: 'n8n', name: 'execute_workflow' })
    expect(parseToolName('mcp__n8n-desk-local__js_compute')).toEqual({ server: 'n8n-desk-local', name: 'js_compute' })
  })

  it('parses {server}__{tool} (Deep Agents custom servers)', () => {
    expect(parseToolName('myserver__wipe_data')).toEqual({ server: 'myserver', name: 'wipe_data' })
  })
})

describe('toolDisplayName (audit #62)', () => {
  it('maps known n8n tools to curated labels', () => {
    expect(toolDisplayName('create_workflow_from_code')).toBe('Create Workflow')
    expect(toolDisplayName('execute_workflow')).toBe('Execute Workflow')
    expect(toolDisplayName('get_sdk_reference')).toBe('Read SDK Reference')
    expect(toolDisplayName('js_compute')).toBe('Run JavaScript')
  })

  it('strips the mcp__n8n__ prefix for display', () => {
    expect(toolDisplayName('mcp__n8n__execute_workflow')).toBe('Execute Workflow')
    expect(toolDisplayName('mcp__n8n__search_nodes')).toBe('Search Nodes')
  })

  it('hides the local tool server namespace', () => {
    expect(toolDisplayName('mcp__n8n-desk-local__read_csv')).toBe('Read CSV')
    expect(toolDisplayName('mcp__n8n-desk-local__edit_text')).toBe('Edit File')
  })

  it('shows unknown servers so the user can tell connectors apart', () => {
    expect(toolDisplayName('mcp__github__create_issue')).toBe('Create Issue (github)')
    expect(toolDisplayName('crm__sync_leads')).toBe('Sync Leads (crm)')
  })

  it('title-cases unknown bare tools', () => {
    expect(toolDisplayName('rename_data_table_column')).toBe('Rename Data Table Column')
  })

  it('falls back gracefully on empty input', () => {
    expect(toolDisplayName('')).toBe('Tool')
  })
})
