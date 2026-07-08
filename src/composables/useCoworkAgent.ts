import { computed } from 'vue'
import { useCoworkSessionsStore } from '@/stores/cowork-sessions'
import { generateMessageId } from '@/utils/message-id'

/**
 * Cowork agent facade over the session store.
 *
 * Agent events are NOT subscribed here: a single global listener (registered
 * in main.ts) routes every event to the owning store/session, so background
 * sessions keep receiving output even when no panel is mounted (audit #23).
 */
export function useCoworkAgent() {
  const sessionStore = useCoworkSessionsStore()

  const messages = computed(() => sessionStore.messages)
  const isRunning = computed(() => sessionStore.isAgentRunning)
  const pendingApproval = computed(() => sessionStore.pendingApproval)
  const pendingQuestion = computed(() => sessionStore.pendingQuestion)
  const activeSession = computed(() => sessionStore.activeSession)
  const toolCalls = computed(() => sessionStore.toolCalls)
  const todos = computed(() => sessionStore.todos)
  const previewData = computed(() => sessionStore.previewData)

  /**
   * Send a message to the cowork agent.
   * Creates a session if none is active.
   */
  async function sendMessage(text: string, attachedFilePaths?: string[]): Promise<void> {
    if (!window.n8nDesk) {
      throw new Error('n8nDesk bridge not available')
    }

    // Create session if needed
    if (!sessionStore.activeSessionId) {
      await sessionStore.createSession()
    }

    const sessionId = sessionStore.activeSessionId!

    // Append user message to store
    await sessionStore.appendMessage({
      id: generateMessageId(),
      role: 'user',
      content: text,
      ts: new Date().toISOString(),
    })

    sessionStore.markRunning(sessionId)

    // Pass attached folders so the agent's sandbox policy scopes file access.
    // Also pass directly attached file paths — these are individually granted
    // by the user and added as individual file mounts in the sandbox.
    const attachedFolders = sessionStore.activeSession?.attachedFolders ?? []
    const result = await window.n8nDesk.agent.invoke(sessionId, text, {
      attachedFolders: attachedFolders.map((f) => ({ path: f.path, label: f.label, mode: f.mode })),
      attachedFiles: attachedFilePaths,
      mode: 'cowork',
    })
    if (!result.success) {
      sessionStore.markStopped(sessionId)
      await sessionStore.appendMessage({
        id: generateMessageId(),
        role: 'system',
        content: result.error ?? 'Agent invocation failed',
        ts: new Date().toISOString(),
        meta: { error: true },
      })
    }
  }

  /**
   * Stop the currently running agent session.
   */
  async function stopAgent(): Promise<void> {
    if (!window.n8nDesk || !sessionStore.activeSessionId) return
    await window.n8nDesk.agent.stop(sessionStore.activeSessionId)
  }

  /**
   * Resolve a pending human-in-the-loop action: approve, approve + always
   * allow this tool for the session, or reject (which also stops the run).
   * Carries the real approval id so the runner resolves the matching request.
   */
  async function approveAction(decision: import('@/types/agent').ApprovalDecision): Promise<void> {
    if (!window.n8nDesk || !sessionStore.activeSessionId) return
    const approvalId = sessionStore.pendingApproval?.id
    if (!approvalId) return
    await window.n8nDesk.agent.approve(sessionStore.activeSessionId, approvalId, decision)
  }

  /**
   * Answer a pending ask_user_question. Carries the real question id so the
   * runner resolves the matching request and resumes the agent.
   */
  async function answerQuestion(answers: import('@/types/agent').AskUserAnswers): Promise<void> {
    if (!window.n8nDesk || !sessionStore.activeSessionId) return
    const questionId = sessionStore.pendingQuestion?.id
    if (!questionId) return
    await window.n8nDesk.agent.answer(sessionStore.activeSessionId, questionId, answers)
  }

  /**
   * Test the LLM connection with current settings.
   */
  async function testConnection(): Promise<{ success: boolean; error?: string }> {
    if (!window.n8nDesk) {
      return { success: false, error: 'n8nDesk bridge not available' }
    }
    return window.n8nDesk.agent.testConnection()
  }

  return {
    messages,
    isRunning,
    pendingApproval,
    pendingQuestion,
    activeSession,
    toolCalls,
    todos,
    previewData,
    sendMessage,
    stopAgent,
    approveAction,
    answerQuestion,
    testConnection,
  }
}
