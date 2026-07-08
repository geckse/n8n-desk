/**
 * Human-readable display names for agent tool calls (audit #62).
 *
 * Tool names arrive in three shapes depending on the backend:
 * - bare:            `execute_workflow`             (Deep Agents, n8n server tools)
 * - server-prefixed: `myserver__execute_workflow`   (Deep Agents, custom servers)
 * - MCP-namespaced:  `mcp__n8n__execute_workflow`   (Claude Agent SDK)
 */

/** Servers whose names are implementation detail — never shown to the user. */
const HIDDEN_SERVERS = new Set(['n8n', 'n8n-desk-local'])

/** Curated labels for the tools n8n-desk ships or the n8n server provides. */
const TOOL_LABELS: Record<string, string> = {
  // n8n MCP — discovery
  search_nodes: 'Search Nodes',
  get_node_types: 'Get Node Types',
  get_suggested_nodes: 'Get Suggested Nodes',
  get_sdk_reference: 'Read SDK Reference',
  get_workflow_best_practices: 'Get Best Practices',
  explore_node_resources: 'Explore Node Resources',
  list_credentials: 'List Credentials',
  list_tags: 'List Tags',
  // n8n MCP — workflow lifecycle
  search_workflows: 'Search Workflows',
  get_workflow_details: 'Get Workflow Details',
  validate_workflow: 'Validate Workflow',
  validate_node_config: 'Validate Node Config',
  create_workflow_from_code: 'Create Workflow',
  update_workflow: 'Update Workflow',
  publish_workflow: 'Publish Workflow',
  unpublish_workflow: 'Unpublish Workflow',
  archive_workflow: 'Archive Workflow',
  // n8n MCP — execution
  execute_workflow: 'Execute Workflow',
  test_workflow: 'Test Workflow',
  get_execution: 'Get Execution',
  search_executions: 'Search Executions',
  prepare_test_pin_data: 'Prepare Test Data',
  // local tools
  js_compute: 'Run JavaScript',
  invoke_skill: 'Load Skill',
  read_skill_file: 'Read Skill File',
  memory_read: 'Recall Memory',
  memory_append: 'Save to Memory',
  list_files: 'List Files',
  search_files: 'Search Files',
  move_file: 'Move File',
  copy_file: 'Copy File',
  delete_file: 'Delete File',
  open_path: 'Open in App',
  clipboard_read: 'Read Clipboard',
  clipboard_write: 'Copy to Clipboard',
  edit_text: 'Edit File',
  read_text: 'Read File',
  write_text: 'Write File',
  read_json: 'Read JSON',
  write_json: 'Write JSON',
  read_yaml: 'Read YAML',
  write_yaml: 'Write YAML',
  read_csv: 'Read CSV',
  write_csv: 'Write CSV',
  read_excel: 'Read Excel',
  write_excel: 'Write Excel',
  read_pdf: 'Read PDF',
  read_docx: 'Read Word Document',
  write_docx: 'Write Word Document',
}

/** Split a raw tool name into its bare name and (optional) server prefix. */
export function parseToolName(raw: string): { name: string; server: string | null } {
  const parts = raw.split('__')
  if (parts.length >= 3 && parts[0] === 'mcp') {
    // mcp__{server}__{tool} — the tool itself may contain no `__`, the server may
    return { server: parts[1], name: parts.slice(2).join('__') }
  }
  if (parts.length >= 2 && parts[0] !== '') {
    // {server}__{tool} (Deep Agents custom-server namespacing)
    return { server: parts[0], name: parts.slice(1).join('__') }
  }
  return { server: null, name: raw }
}

function titleCase(name: string): string {
  return name.replace(/[_-]+/g, ' ').trim().replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * Map a raw tool name to a human label: strip the namespace, use the curated
 * label when known, otherwise title-case the bare name. Unknown servers are
 * shown as a suffix so the user can tell which connector a tool came from.
 */
export function toolDisplayName(raw: string): string {
  if (!raw) return 'Tool'
  const { name, server } = parseToolName(raw)
  const label = TOOL_LABELS[name] ?? titleCase(name)
  if (server && !HIDDEN_SERVERS.has(server)) {
    return `${label} (${server})`
  }
  return label
}
