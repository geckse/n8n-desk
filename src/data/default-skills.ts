import type { LoadedSkill } from '@/types/plugin'

/**
 * Default skills bundled with n8n-desk.
 *
 * These ship with the app and update automatically with new releases.
 * Users can disable them (with a warning), but cannot edit or delete them.
 *
 * Each skill is optimized for the n8n MCP tool suite (13 tools) and the
 * n8n-desk conversational workflow experience.
 */
export const DEFAULT_SKILLS: readonly LoadedSkill[] = [
  {
    name: 'workflow-builder',
    description:
      'Build n8n workflows from natural language descriptions. Use when the user wants to create a new workflow, automation, or integration.',
    content: `You are building an n8n workflow from the user's description.

Follow this process strictly:

1. **Understand the requirement** — Ask clarifying questions if the request is ambiguous (trigger type, services involved, data transformations, error handling).

2. **Discover nodes** — Use \`search_nodes\` to find the right n8n nodes for each service mentioned. Use \`get_suggested_nodes\` for common patterns (e.g., "chatbot", "notification", "scheduling").

3. **Get node types** — Use \`get_node_types\` to retrieve exact parameter schemas for each node you plan to use. Never guess parameter names.

4. **Write SDK code** — Build the workflow using the n8n Workflow SDK. Include all required parameters. Set meaningful node names.

5. **Validate** — Always call \`validate_workflow\` before creating. Fix any errors reported.

6. **Create** — Use \`create_workflow_from_code\` to create the workflow. Give it a descriptive name.

7. **Summarize** — Tell the user what was created, which nodes are included, and what they need to configure (credentials, webhook URLs, etc.).

$ARGUMENTS`,
    disableModelInvocation: false,
    userInvocable: true,
    allowedTools: [
      'search_nodes', 'get_node_types', 'get_suggested_nodes',
      'validate_workflow', 'create_workflow_from_code',
    ],
    directory: '',
    source: 'built-in',
    builtIn: true,
  },
  {
    name: 'workflow-debugger',
    description:
      'Debug and fix failing n8n workflow executions. Use when the user reports a workflow error, failed execution, or unexpected output.',
    content: `You are debugging an n8n workflow execution failure.

Follow this process:

1. **Identify the workflow** — If not specified, use \`search_workflows\` to find it by name or description.

2. **Inspect the workflow** — Use \`get_workflow_details\` to understand the workflow structure, nodes, and connections.

3. **Check execution** — If the user provides an execution ID, use \`get_execution\` to see the full execution trace. Look for:
   - Which node failed
   - The error message
   - Input data that caused the failure
   - Whether previous nodes produced expected output

4. **Diagnose** — Explain the root cause clearly. Common issues:
   - Missing or expired credentials
   - Incorrect field mappings
   - API rate limits or timeouts
   - Data type mismatches
   - Missing required parameters

5. **Fix** — If a code change is needed, use \`get_node_types\` to verify correct parameters, then \`validate_workflow\` and \`update_workflow\` to apply the fix.

6. **Test** — Offer to run \`execute_workflow\` to verify the fix works.

$ARGUMENTS`,
    disableModelInvocation: false,
    userInvocable: true,
    allowedTools: [
      'search_workflows', 'get_workflow_details', 'get_execution',
      'execute_workflow', 'get_node_types', 'validate_workflow', 'update_workflow',
    ],
    directory: '',
    source: 'built-in',
    builtIn: true,
  },
  {
    name: 'workflow-optimizer',
    description:
      'Optimize and improve existing n8n workflows. Use when the user wants to make a workflow faster, cleaner, or more reliable.',
    content: `You are optimizing an existing n8n workflow.

Follow this process:

1. **Load the workflow** — Use \`get_workflow_details\` to inspect the current structure.

2. **Analyze** — Look for common optimization opportunities:
   - Redundant nodes that can be combined
   - Missing error handling (add Error Trigger nodes)
   - Inefficient polling intervals
   - Large data sets that should use pagination or batching
   - Hardcoded values that should be parameters
   - Missing retry logic on HTTP/API nodes

3. **Suggest improvements** — Present a clear list of proposed changes, explain the benefit of each.

4. **Apply changes** — After user approval, use \`get_node_types\` to verify correct parameter schemas, then \`validate_workflow\` and \`update_workflow\`.

5. **Test** — Offer to \`execute_workflow\` to verify the optimized version works correctly.

$ARGUMENTS`,
    disableModelInvocation: false,
    userInvocable: true,
    allowedTools: [
      'search_workflows', 'get_workflow_details', 'get_node_types',
      'validate_workflow', 'update_workflow', 'execute_workflow', 'get_execution',
    ],
    directory: '',
    source: 'built-in',
    builtIn: true,
  },
  {
    name: 'workflow-explorer',
    description:
      'Search and explain existing n8n workflows. Use when the user wants to find, understand, or get an overview of their workflows.',
    content: `You are helping the user explore and understand their n8n workflows.

Depending on the request:

**Finding workflows:**
- Use \`search_workflows\` with relevant keywords
- Present results as a clear list with name, status (active/inactive), and a brief description of what each does

**Explaining a workflow:**
- Use \`get_workflow_details\` to load the full workflow
- Explain the workflow step-by-step: trigger → processing → output
- Describe what each node does in plain language
- Highlight any credentials or external services required
- Note the workflow's active/inactive status

**Comparing workflows:**
- Load both workflows with \`get_workflow_details\`
- Compare structure, triggers, and processing logic
- Highlight key differences

Always be concise. Use bullet points for multi-step workflows.

$ARGUMENTS`,
    disableModelInvocation: false,
    userInvocable: true,
    allowedTools: [
      'search_workflows', 'get_workflow_details',
    ],
    directory: '',
    source: 'built-in',
    builtIn: true,
  },
  {
    name: 'workflow-publisher',
    description:
      'Manage workflow lifecycle: publish, unpublish, or archive workflows. Use when the user wants to activate, deactivate, or clean up workflows.',
    content: `You are managing workflow lifecycle operations.

**Publishing (activating):**
- Use \`get_workflow_details\` to verify the workflow exists and check its current status
- Warn the user if the workflow has a webhook or schedule trigger — activating it will start receiving events immediately
- Use \`publish_workflow\` to activate

**Unpublishing (deactivating):**
- Explain that deactivating stops the workflow from processing new events
- Use \`unpublish_workflow\` to deactivate
- Note: in-flight executions may still complete

**Archiving:**
- Warn that archiving removes the workflow from active lists (it can be restored from n8n's UI)
- Use \`archive_workflow\` to archive

**Bulk operations:**
- If the user wants to activate/deactivate multiple workflows, use \`search_workflows\` to find them, then process each one
- Always confirm before bulk operations

$ARGUMENTS`,
    disableModelInvocation: false,
    userInvocable: true,
    allowedTools: [
      'search_workflows', 'get_workflow_details',
      'publish_workflow', 'unpublish_workflow', 'archive_workflow',
    ],
    directory: '',
    source: 'built-in',
    builtIn: true,
  },
] as const
