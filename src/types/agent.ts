// --- Agent Event Discriminated Union ---

export interface AgentEventBase {
  sessionId: string
}

export interface AgentTextChunkEvent extends AgentEventBase {
  type: 'text_chunk'
  data: { text: string }
}

export interface AgentThinkingEvent extends AgentEventBase {
  type: 'thinking'
  data: { text: string }
}

export interface AgentToolCallStartEvent extends AgentEventBase {
  type: 'tool_call_start'
  data: { id: string; name: string; args: Record<string, unknown> }
}

export interface AgentToolCallResultEvent extends AgentEventBase {
  type: 'tool_call_result'
  data: { id: string; name: string; result: unknown; success: boolean; error?: string }
}

export interface AgentApprovalRequiredEvent extends AgentEventBase {
  type: 'approval_required'
  data: { id: string; toolName: string; args: Record<string, unknown>; description: string }
}

export interface AgentApprovalResolvedEvent extends AgentEventBase {
  type: 'approval_resolved'
  data: { id: string; decision: 'approve' | 'reject' }
}

/**
 * User decision sent to `agent:approve` (mirrors electron/agent/approval.ts).
 * `approve_always` approves the pending call and allows all future calls of
 * that tool for the rest of the session; `reject` also stops the run. The
 * `approval_resolved` EVENT stays `'approve' | 'reject'` — approve_always is
 * translated to approve inside the runner.
 */
export type ApprovalDecision = 'approve' | 'approve_always' | 'reject'

export interface AgentQuestionAskedEvent extends AgentEventBase {
  type: 'question_asked'
  data: { id: string; questions: AskUserQuestionItem[] }
}

export interface AgentQuestionAnsweredEvent extends AgentEventBase {
  type: 'question_answered'
  data: { id: string; answers: AskUserAnswers }
}

export interface AgentTodoUpdateEvent extends AgentEventBase {
  type: 'todo_update'
  data: { todos: AgentTodo[] }
}

export interface AgentErrorEvent extends AgentEventBase {
  type: 'error'
  data: { message: string; code?: string }
}

export interface AgentDoneEvent extends AgentEventBase {
  type: 'done'
  data: { reason: 'completed' | 'cancelled' | 'error' }
}

export interface AgentWorkflowPreviewEvent extends AgentEventBase {
  type: 'workflow_preview'
  data: {
    toolCallId: string
    workflowId: string
    name: string
    workflow: WorkflowJson
  }
}

export type AgentEvent =
  | AgentTextChunkEvent
  | AgentThinkingEvent
  | AgentToolCallStartEvent
  | AgentToolCallResultEvent
  | AgentApprovalRequiredEvent
  | AgentApprovalResolvedEvent
  | AgentQuestionAskedEvent
  | AgentQuestionAnsweredEvent
  | AgentTodoUpdateEvent
  | AgentErrorEvent
  | AgentDoneEvent
  | AgentWorkflowPreviewEvent

// --- Ask User Question (mirrors electron/agent/ask-user-question.ts) ---

export interface AskUserQuestionOption {
  label: string
  description?: string
}

export interface AskUserQuestionItem {
  id: string
  question: string
  options: AskUserQuestionOption[]
  multiSelect?: boolean
}

export interface AskUserAnswerItem {
  /** Selected option labels (empty when the user only used the "Other" field) */
  selected: string[]
  /** Free-text "Other" answer, when provided */
  otherText?: string
}

/** Answers keyed by question id. */
export type AskUserAnswers = Record<string, AskUserAnswerItem>

// --- Agent Todos ---

export interface AgentTodo {
  id: string
  title: string
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
}

// --- Agent Meta ---

export interface AgentMeta {
  id: string
  name: string
  description: string
  avatarColor: string
  avatarInitial: string
  pinned: boolean
}

// --- Agent Tool Call ---

export interface AgentToolCall {
  id: string
  name: string
  args: Record<string, unknown>
  status: 'pending' | 'running' | 'awaiting_approval' | 'awaiting_input' | 'completed' | 'failed'
  result?: unknown
}

// --- Workflow Types ---

export interface WorkflowJson {
  id?: string
  name: string
  nodes: Record<string, unknown>[]
  connections: Record<string, unknown>
  settings?: Record<string, unknown>
  staticData?: unknown
  tags?: string[]
  active?: boolean
  [key: string]: unknown
}

export interface WorkflowPreviewData {
  workflowId: string
  name: string
  workflow: WorkflowJson
  workflowBefore?: WorkflowJson
  theme?: 'light' | 'dark'
}
