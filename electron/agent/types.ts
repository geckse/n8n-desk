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

// --- Agent Runner Configuration ---

export interface AgentRunnerConfig {
  instanceUrl: string
  accessToken: string
  llmConfig: LlmProviderConfig
  systemPrompt: string
  interruptOnTools?: string[]
  /** Previous conversation messages for multi-turn memory */
  conversationHistory?: ConversationMessage[]
  /** Custom MCP servers from plugins and standalone servers, keyed by server name */
  customMcpServers?: Record<string, CustomMcpServerConfig>
  /** Pre-built LangChain tools from PluginManager.buildDeepAgentsTools() */
  customTools?: unknown[]
  /** Loaded skills for Deep Agents invoke_skill tool */
  skills?: LoadedSkill[]
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

  /** Resolve a human-in-the-loop approval request. */
  approve(sessionId: string, decision: 'approve' | 'reject'): Promise<void>
}

// --- Agent Backend Selection ---

export type AgentBackend = 'claude-sdk' | 'deep-agents'
