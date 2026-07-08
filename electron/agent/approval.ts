/**
 * Shared approval (human-in-the-loop) definitions used by BOTH agent runners
 * and the IPC layer. There must be exactly one copy of the destructive-tool
 * set and one name matcher — per CLAUDE.md, a bare-name check silently
 * disables the approval gate on the Claude SDK backend.
 */

/**
 * n8n MCP tools that ALWAYS require user approval before execution.
 *
 * Matches the server's own annotations (`readOnlyHint: false`):
 * `unpublish_workflow` is included — deactivating a live workflow is
 * destructive (CLAUDE.md hard invariant).
 */
export const DESTRUCTIVE_TOOLS: readonly string[] = [
  'create_workflow_from_code',
  'update_workflow',
  'execute_workflow',
  'publish_workflow',
  'unpublish_workflow',
  'archive_workflow',
]

/**
 * User decision on a pending approval. `approve_always` approves the pending
 * call AND adds the tool to the session allow set so future calls in the same
 * chat session skip the prompt. It is translated to a plain `approve` inside
 * the runner's `approve()` — the `approval_resolved` event union stays
 * `'approve' | 'reject'`.
 */
export type ApprovalDecision = 'approve' | 'approve_always' | 'reject'

/**
 * Suffix-aware name matching shared by `requiresApproval` and `isToolAllowed`.
 *
 * Tool names arrive in three shapes depending on the backend:
 * - bare:              `execute_workflow`          (Deep Agents, n8n server tools)
 * - server-prefixed:   `myserver__execute_workflow` (Deep Agents, custom servers)
 * - MCP-namespaced:    `mcp__n8n__execute_workflow` (Claude Agent SDK)
 *
 * A name matches when it equals an entry or ends with `__` + entry, so
 * `mcp__{server}__{tool}` matches both the bare tool name and the
 * `{server}__{tool}` form. Deliberate consequence: a bare entry like
 * `execute_workflow` also matches `otherserver__execute_workflow` — the same
 * conservative property `requiresApproval` has always had (over-prompting is
 * safe; for allowlists it means a bare key covers same-named tools on any
 * server, which mirrors how the interrupt set already treats them).
 */
function matchesToolSet(toolName: string, set: Iterable<string>): boolean {
  for (const t of set) {
    if (toolName === t || toolName.endsWith(`__${t}`)) return true
  }
  return false
}

/**
 * Namespace-aware approval matcher — see `matchesToolSet` for the name-shape
 * rules.
 */
export function requiresApproval(toolName: string, interruptTools: Iterable<string>): boolean {
  return matchesToolSet(toolName, interruptTools)
}

/**
 * Canonical allowlist key for a tool name as delivered by either backend.
 * Strips the Claude SDK's `mcp__` namespace, then the n8n server prefix —
 * n8n tools are stored bare (`execute_workflow`), custom-server tools keep
 * their `{server}__{tool}` shape (stripping the server would collide
 * same-named tools across servers):
 * - `mcp__n8n__execute_workflow` → `execute_workflow`
 * - `mcp__myserver__tool`        → `myserver__tool`
 * - `myserver__tool`             → `myserver__tool`
 * - `execute_workflow`           → `execute_workflow`
 */
export function canonicalToolName(toolName: string): string {
  let name = toolName
  if (name.startsWith('mcp__')) name = name.slice('mcp__'.length)
  if (name.startsWith('n8n__')) name = name.slice('n8n__'.length)
  return name
}

/**
 * True when the tool (in any namespacing shape) is covered by an allow set of
 * canonical keys (see `canonicalToolName`). Used for both the per-session
 * allow set (`approve_always`) and the persistent per-instance presets.
 */
export function isToolAllowed(
  toolName: string,
  allowedTools: Iterable<string> | undefined | null,
): boolean {
  if (!allowedTools) return false
  return matchesToolSet(toolName, allowedTools)
}

/**
 * n8n MCP tools that are NOT available in Cowork mode (audit #12).
 *
 * Cowork creates workflows only as a means to accomplish a task — workflow
 * lifecycle management (update/publish/unpublish/archive) belongs to Workflow
 * mode. The system prompt says so, but a prompt-only restriction is not a
 * restriction: both runners must enforce this set (Deep Agents by filtering
 * the discovered tool list, Claude SDK via disallowedTools + a canUseTool
 * deny).
 */
export const COWORK_DENIED_TOOLS: readonly string[] = [
  'update_workflow',
  'publish_workflow',
  'unpublish_workflow',
  'archive_workflow',
  'get_suggested_nodes',
]

/**
 * Deny matcher for n8n server tools only. Unlike `requiresApproval`, this
 * deliberately does NOT suffix-match `{server}__{tool}` — a custom MCP
 * server's tool that happens to share a denied name must not be blocked.
 * Matches the bare name (Deep Agents) and the Claude SDK's `mcp__n8n__` form.
 */
export function isN8nToolDenied(toolName: string, deniedTools: Iterable<string>): boolean {
  for (const t of deniedTools) {
    if (toolName === t || toolName === `mcp__n8n__${t}`) return true
  }
  return false
}
