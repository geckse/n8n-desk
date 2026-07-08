import type { AskUserQuestionItem, AskUserAnswers } from './ask-user-question'
import type { ApprovalDecision } from './approval'

// --- Agent Stream Event (main process side, mirrors src/types/agent.ts AgentEvent) ---

export interface AgentStreamEventBase {
  sessionId: string
}

export interface AgentStreamTextChunk extends AgentStreamEventBase {
  type: 'text_chunk'
  data: { text: string }
}

export interface AgentStreamThinking extends AgentStreamEventBase {
  type: 'thinking'
  data: { text: string }
}

export interface AgentStreamToolCallStart extends AgentStreamEventBase {
  type: 'tool_call_start'
  data: { id: string; name: string; args: Record<string, unknown> }
}

export interface AgentStreamToolCallResult extends AgentStreamEventBase {
  type: 'tool_call_result'
  data: { id: string; name: string; result: unknown; success: boolean; error?: string }
}

export interface AgentStreamApprovalRequired extends AgentStreamEventBase {
  type: 'approval_required'
  data: { id: string; toolName: string; args: Record<string, unknown>; description: string }
}

export interface AgentStreamApprovalResolved extends AgentStreamEventBase {
  type: 'approval_resolved'
  data: { id: string; decision: 'approve' | 'reject' }
}

export interface AgentStreamQuestionAsked extends AgentStreamEventBase {
  type: 'question_asked'
  data: { id: string; questions: AskUserQuestionItem[] }
}

export interface AgentStreamQuestionAnswered extends AgentStreamEventBase {
  type: 'question_answered'
  data: { id: string; answers: AskUserAnswers }
}

export interface AgentStreamTodoUpdate extends AgentStreamEventBase {
  type: 'todo_update'
  data: { todos: Array<{ id: string; title: string; status: 'pending' | 'in_progress' | 'completed' | 'failed' }> }
}

export interface AgentStreamError extends AgentStreamEventBase {
  type: 'error'
  data: { message: string; code?: string }
}

export interface AgentStreamDone extends AgentStreamEventBase {
  type: 'done'
  data: { reason: 'completed' | 'cancelled' | 'error' }
}

export interface AgentStreamWorkflowPreview extends AgentStreamEventBase {
  type: 'workflow_preview'
  data: {
    toolCallId: string
    workflowId: string
    name: string
    workflow: Record<string, unknown>
  }
}

export type AgentStreamEvent =
  | AgentStreamTextChunk
  | AgentStreamThinking
  | AgentStreamToolCallStart
  | AgentStreamToolCallResult
  | AgentStreamApprovalRequired
  | AgentStreamApprovalResolved
  | AgentStreamQuestionAsked
  | AgentStreamQuestionAnswered
  | AgentStreamTodoUpdate
  | AgentStreamError
  | AgentStreamDone
  | AgentStreamWorkflowPreview

// --- LLM Configuration ---

export interface LlmProviderConfig {
  provider: 'anthropic' | 'openai' | 'ollama'
  model: string
  apiKey?: string
  baseUrl?: string
}

// --- Custom MCP Server Configuration ---

export interface CustomMcpServerConfig {
  type: 'http'
  url: string
  headers: Record<string, string>
}

// --- Loaded Skill (mirrors src/types/plugin.ts LoadedSkill) ---

export interface LoadedSkill {
  name: string
  description: string
  content: string
  disableModelInvocation: boolean
  userInvocable: boolean
  allowedTools?: string[]
  directory: string
  source: 'user' | 'built-in' | string
  builtIn?: boolean
}

// --- Conversation History Message ---

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'tool'
  content: string
}

// --- Filesystem Sandbox ---

/** A folder mounted into the agent's sandbox with a specific access mode. */
export interface SandboxFolderMount {
  /** Absolute path on the host filesystem */
  hostPath: string
  /**
   * Route prefix the mount exposes to the deepagents built-in file tools.
   * Since the path unification (audit #31) this is the host path itself
   * (with a trailing slash) — ONE path convention for built-ins, shared
   * tools, and the prompt.
   */
  virtualPrefix: string
  /** Access mode: 'ro' for read-only, 'rw' for read-write */
  mode: 'ro' | 'rw'
}

/** Per-session filesystem sandbox policy controlling which folders the agent can access. */
export interface FilesystemSandboxPolicy {
  /** Folder mounts granted to this session */
  mounts: SandboxFolderMount[]
  /** Absolute path to the ~/.n8n-desk/ directory (always mounted as ro, minus sensitive files) */
  n8nDeskDir: string
}

// --- Agent Runner Configuration ---

export interface AgentRunnerConfig {
  instanceUrl: string
  accessToken: string
  /**
   * Resolved MCP endpoint URL. Either the default `${instanceUrl}/mcp-server/http`
   * or a per-instance custom MCP server URL. Runners must NOT re-derive the URL.
   */
  mcpUrl: string
  /**
   * Bearer token to use against `mcpUrl`. Either the n8n OAuth access token (default)
   * or a separately-issued custom MCP OAuth token.
   */
  mcpAccessToken: string
  /**
   * Force-refresh the MCP access token when a mid-session call returns 401
   * (audit #41). Returns the new access token or null when re-auth is needed.
   *
   * Honored by the Deep Agents backend (our own MCP client makes the calls).
   * The Claude SDK backend cannot rotate headers mid-session — its CLI
   * subprocess holds the MCP connection — so it relies on the proactive
   * refresh at invoke time.
   */
  refreshMcpToken?: () => Promise<string | null>
  llmConfig: LlmProviderConfig
  systemPrompt: string
  interruptOnTools?: string[]
  /**
   * Bare names of n8n server tools that are NOT available in this mode
   * (audit #12 — e.g. lifecycle tools in Cowork). Both runners must enforce
   * this: prompt-only restrictions are not restrictions.
   */
  deniedTools?: readonly string[]
  /** Previous conversation messages for multi-turn memory */
  conversationHistory?: ConversationMessage[]
  /** Custom MCP servers from plugins and standalone servers, keyed by server name */
  customMcpServers?: Record<string, CustomMcpServerConfig>
  /** Pre-built LangChain tools from PluginManager.buildDeepAgentsTools() */
  customTools?: unknown[]
  /** Loaded skills for Deep Agents invoke_skill tool */
  skills?: LoadedSkill[]
  /** Per-session filesystem sandbox policy for file access control */
  sandboxPolicy?: FilesystemSandboxPolicy
  /**
   * Per-instance persistent memory file (audit #45). When set, both backends
   * register memory_read/memory_append bound to this path.
   */
  memoryFilePath?: string
  /**
   * LIVE per-session allow set of canonical tool names (see canonicalToolName),
   * owned by the IPC layer and shared across invokes of the same session —
   * runners MUTATE it on an `approve_always` decision. The SAME Set instance
   * is passed on every invoke, which is what lets a mid-run grant survive the
   * per-invoke runner recreation and reach the in-flight Deep Agents
   * interrupt loop (its interruptOn map is frozen at agent creation).
   */
  sessionAllowedTools?: Set<string>
  /**
   * Snapshot of the persistent per-instance always-allow presets
   * (tool-approvals.json), canonical tool names. Read fresh at each invoke.
   */
  alwaysAllowedTools?: readonly string[]
}

// --- Agent Runner Interface ---

export interface AgentRunner {
  /** Start or continue an agent session with a user message. Yields stream events. */
  invoke(
    sessionId: string,
    message: string,
    config: AgentRunnerConfig,
  ): AsyncIterable<AgentStreamEvent>

  /** Cancel a running agent session. */
  stop(sessionId: string): Promise<void>

  /**
   * Resolve a human-in-the-loop approval request. `approve_always` also adds
   * the tool to the session allow set before approving; `reject` stops the
   * whole run after the rejection result is recorded.
   * @param approvalId - The id from the matching `approval_required` event.
   * @returns true when a pending approval was resolved, false when nothing matched.
   */
  approve(sessionId: string, approvalId: string, decision: ApprovalDecision): Promise<boolean>

  /**
   * Resolve a pending `ask_user_question` with the user's answers.
   * @param questionId - The id from the matching `question_asked` event.
   * @returns true when a pending question was resolved, false when nothing matched.
   */
  answer(sessionId: string, questionId: string, answers: AskUserAnswers): Promise<boolean>
}

// --- Agent Backend Selection ---

export type AgentBackend = 'claude-sdk' | 'deep-agents'
