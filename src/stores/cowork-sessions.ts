import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import type { AttachedFolder, SessionMeta, SessionMessage } from '@/types/session'
import type { AgentEvent, AgentToolCall, AgentApprovalRequiredEvent, WorkflowPreviewData, WorkflowJson } from '@/types/agent'
import { localStorageService } from '@/services/local-storage'

function sessionsDir(instanceId: string): string {
  return `instances/${instanceId}/sessions/cowork`
}

function indexPath(instanceId: string): string {
  return `${sessionsDir(instanceId)}/index.json`
}

function sessionFilePath(instanceId: string, sessionId: string): string {
  return `${sessionsDir(instanceId)}/${sessionId}.jsonl`
}

function archivePath(instanceId: string, sessionId: string): string {
  return `${sessionsDir(instanceId)}/.archive/${sessionId}.jsonl`
}

function generateSessionId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let id = 'session_'
  for (let i = 0; i < 12; i++) {
    id += chars[Math.floor(Math.random() * chars.length)]
  }
  return id
}

export const useCoworkSessionsStore = defineStore('cowork-sessions', () => {
  const sessions = ref<SessionMeta[]>([])
  const activeSessionId = ref<string | null>(null)
  const messages = ref<SessionMessage[]>([])
  const pendingApproval = ref<AgentApprovalRequiredEvent['data'] | null>(null)
  const isAgentRunning = ref(false)
  const toolCalls = ref<AgentToolCall[]>([])
  const previewData = ref<WorkflowPreviewData | null>(null)
  const isPanelOpen = ref(false)
  const panelWorkflowId = ref<string | null>(null)
  /** Tracks the last-seen version of each workflow by ID, for diff previews */
  const workflowHistory = ref<Map<string, WorkflowJson>>(new Map())

  let currentInstanceId: string | null = null

  const activeSession = computed(() =>
    sessions.value.find((s) => s.id === activeSessionId.value) ?? null
  )

  /**
   * Hydrate from disk for a given instance.
   */
  async function hydrate(instanceId: string): Promise<void> {
    currentInstanceId = instanceId
    const index = await localStorageService.readJson<SessionMeta[]>(indexPath(instanceId))
    sessions.value = index ?? []

    // Load the most recent session if available
    if (sessions.value.length > 0) {
      await selectSession(sessions.value[0].id)
    } else {
      activeSessionId.value = null
      messages.value = []
    }
  }

  /**
   * Create a new session and persist it.
   */
  async function createSession(title?: string, initialFolders?: AttachedFolder[]): Promise<string> {
    if (!currentInstanceId) throw new Error('No active instance')

    const now = new Date().toISOString()
    const id = generateSessionId()

    const meta: SessionMeta = {
      id,
      title: title ?? 'New task',
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      ...(initialFolders && initialFolders.length > 0 ? { attachedFolders: initialFolders } : {}),
    }

    sessions.value.unshift(meta)
    await localStorageService.writeJson(indexPath(currentInstanceId), sessions.value)
    // JSONL file will be created on first appendJsonl call — no need to pre-create

    await selectSession(id)
    return id
  }

  /**
   * Delete a session by moving it to .archive/.
   */
  async function deleteSession(sessionId: string): Promise<void> {
    if (!currentInstanceId) return

    // Read the session file and write it to archive
    const msgs = await localStorageService.readJsonl<SessionMessage>(
      sessionFilePath(currentInstanceId, sessionId)
    )
    if (msgs.length > 0) {
      for (const msg of msgs) {
        await localStorageService.appendJsonl(archivePath(currentInstanceId, sessionId), msg)
      }
    }

    // Remove from index
    sessions.value = sessions.value.filter((s) => s.id !== sessionId)
    await localStorageService.writeJson(indexPath(currentInstanceId), sessions.value)

    // If we deleted the active session, select another or clear
    if (activeSessionId.value === sessionId) {
      if (sessions.value.length > 0) {
        await selectSession(sessions.value[0].id)
      } else {
        activeSessionId.value = null
        messages.value = []
      }
    }
  }

  /**
   * Attach a folder to a session's metadata and persist to index.json.
   */
  async function attachFolder(sessionId: string, folder: AttachedFolder): Promise<void> {
    if (!currentInstanceId) return

    const meta = sessions.value.find((s) => s.id === sessionId)
    if (!meta) return

    if (!meta.attachedFolders) {
      meta.attachedFolders = []
    }

    // Avoid duplicates — check by path
    const alreadyAttached = meta.attachedFolders.some((f) => f.path === folder.path)
    if (alreadyAttached) return

    meta.attachedFolders.push(folder)
    meta.updatedAt = new Date().toISOString()
    await localStorageService.writeJson(indexPath(currentInstanceId), sessions.value)
  }

  /**
   * Detach a folder from a session's metadata and persist to index.json.
   */
  async function detachFolder(sessionId: string, folderPath: string): Promise<void> {
    if (!currentInstanceId) return

    const meta = sessions.value.find((s) => s.id === sessionId)
    if (!meta || !meta.attachedFolders) return

    meta.attachedFolders = meta.attachedFolders.filter((f) => f.path !== folderPath)

    // Clean up empty array
    if (meta.attachedFolders.length === 0) {
      delete meta.attachedFolders
    }

    meta.updatedAt = new Date().toISOString()
    await localStorageService.writeJson(indexPath(currentInstanceId), sessions.value)
  }

  /**
   * Select a session and load its messages from JSONL.
   */
  async function selectSession(sessionId: string): Promise<void> {
    if (!currentInstanceId) return

    activeSessionId.value = sessionId
    messages.value = await localStorageService.readJsonl<SessionMessage>(
      sessionFilePath(currentInstanceId, sessionId)
    )
    pendingApproval.value = null
    isPanelOpen.value = false
    panelWorkflowId.value = null
    workflowHistory.value.clear()

    // Reconstruct toolCalls from loaded tool messages so cards render properly
    const reconstructed: AgentToolCall[] = []
    for (const msg of messages.value) {
      if (msg.role !== 'tool' || !msg.meta) continue
      const meta = msg.meta as Record<string, unknown>
      const toolCallId = meta.toolCallId as string | undefined
      const toolName = meta.toolName as string | undefined
      if (!toolCallId) continue

      const status = meta.status as string | undefined
      const tc: AgentToolCall = {
        id: toolCallId,
        name: toolName ?? 'unknown',
        args: {},
        status: status === 'completed' ? 'completed'
          : status === 'failed' ? 'failed'
            : 'completed', // default to completed for old sessions
      }

      if (msg.content) {
        tc.result = msg.content
      }
      if (meta.error) {
        tc.status = 'failed'
      }

      // Check if this toolCall already exists (tool_call_start + tool_call_result produce 2 messages)
      const existing = reconstructed.find((t) => t.id === toolCallId)
      if (existing) {
        // Update with result data
        if (msg.content) existing.result = msg.content
        if (status) existing.status = tc.status
        if (meta.error) existing.status = 'failed'
      } else {
        reconstructed.push(tc)
      }
    }
    toolCalls.value = reconstructed

    // Extract workflow JSON from tool results to rebuild previews
    previewData.value = null
    for (const msg of messages.value) {
      if (msg.role !== 'tool' || !msg.content) continue
      try {
        const parsed = JSON.parse(msg.content) as Record<string, unknown>
        // Look for workflow JSON in tool results
        const wf = extractWorkflowFromResult(parsed)
        if (wf) {
          const wfId = (wf.id as string) ?? ''
          if (wfId) {
            workflowHistory.value.set(wfId, structuredClone(wf) as WorkflowJson)
          }
          // Keep the last workflow as the preview
          previewData.value = {
            workflowId: wfId,
            name: (wf.name as string) ?? 'Workflow',
            workflow: wf as WorkflowJson,
          }
        }
      } catch {
        // Not JSON or no workflow — skip
      }
    }
  }

  /**
   * Try to extract a workflow JSON object from a tool result.
   * Tool results may contain workflow data directly or nested in a response wrapper.
   */
  function extractWorkflowFromResult(data: Record<string, unknown>): Record<string, unknown> | null {
    // Direct workflow object (has nodes + connections)
    if (data.nodes && data.connections) return data

    // Wrapped in a response (e.g., { workflow: { ... } })
    if (data.workflow && typeof data.workflow === 'object') {
      const wf = data.workflow as Record<string, unknown>
      if (wf.nodes && wf.connections) return wf
    }

    // Some MCP tools return stringified JSON in a text content block
    if (typeof data.text === 'string') {
      try {
        const parsed = JSON.parse(data.text) as Record<string, unknown>
        if (parsed.nodes && parsed.connections) return parsed
      } catch { /* not JSON */ }
    }

    return null
  }

  /**
   * Append a message to the active session and persist it.
   */
  async function appendMessage(message: SessionMessage): Promise<void> {
    if (!currentInstanceId || !activeSessionId.value) return

    messages.value.push(message)
    await localStorageService.appendJsonl(
      sessionFilePath(currentInstanceId, activeSessionId.value),
      message
    )

    // Update session metadata
    const meta = sessions.value.find((s) => s.id === activeSessionId.value)
    if (meta) {
      meta.updatedAt = new Date().toISOString()
      meta.messageCount = messages.value.length
      await localStorageService.writeJson(indexPath(currentInstanceId), sessions.value)
    }
  }

  /**
   * Handle an agent event and dispatch by type.
   */
  function persistMessage(message: SessionMessage): void {
    if (!currentInstanceId || !activeSessionId.value) return
    void localStorageService.appendJsonl(
      sessionFilePath(currentInstanceId, activeSessionId.value),
      message
    )
  }

  function handleAgentEvent(event: AgentEvent): void {
    switch (event.type) {
      case 'thinking': {
        // Accumulate thinking into the last thinking message, or create one
        const lastThinking = messages.value[messages.value.length - 1]
        if (lastThinking && lastThinking.role === 'thinking') {
          lastThinking.content += event.data.text
        } else {
          const msg: SessionMessage = {
            id: `msg_${Date.now()}`,
            role: 'thinking',
            content: event.data.text,
            ts: new Date().toISOString(),
          }
          messages.value.push(msg)
        }
        break
      }
      case 'text_chunk': {
        // Accumulate text into the last assistant message, or create one
        const last = messages.value[messages.value.length - 1]
        if (last && last.role === 'assistant') {
          last.content += event.data.text
        } else {
          const msg: SessionMessage = {
            id: `msg_${Date.now()}`,
            role: 'assistant',
            content: event.data.text,
            ts: new Date().toISOString(),
          }
          messages.value.push(msg)
          // Persist new assistant message immediately
          persistMessage(msg)
        }
        break
      }
      case 'tool_call_start': {
        const tc: AgentToolCall = {
          id: event.data.id,
          name: event.data.name,
          args: event.data.args,
          status: 'running',
        }
        toolCalls.value.push(tc)

        // Add a tool message to the conversation and persist
        const toolMsg: SessionMessage = {
          id: `msg_${Date.now()}`,
          role: 'tool',
          content: '',
          ts: new Date().toISOString(),
          meta: { toolCallId: event.data.id, toolName: event.data.name, status: 'running' },
        }
        messages.value.push(toolMsg)
        persistMessage(toolMsg)
        break
      }
      case 'tool_call_result': {
        const tc = toolCalls.value.find((t) => t.id === event.data.id)
        if (tc) {
          tc.status = event.data.success ? 'completed' : 'failed'
          tc.result = event.data.result
        }

        // Update the tool message and persist the updated version
        const toolMsg = [...messages.value].reverse().find(
          (m) => m.meta && (m.meta as Record<string, unknown>).toolCallId === event.data.id
        )
        if (toolMsg) {
          toolMsg.content = typeof event.data.result === 'string'
            ? event.data.result
            : JSON.stringify(event.data.result)
          toolMsg.meta = {
            ...toolMsg.meta,
            status: event.data.success ? 'completed' : 'failed',
            error: event.data.error,
          }
          persistMessage(toolMsg)
        }
        break
      }
      case 'approval_required': {
        pendingApproval.value = event.data
        const tc = toolCalls.value.find((t) => t.id === event.data.id)
        if (tc) {
          tc.status = 'awaiting_approval'
        }
        break
      }
      case 'approval_resolved': {
        pendingApproval.value = null
        const tc = toolCalls.value.find((t) => t.id === event.data.id)
        if (tc) {
          tc.status = event.data.decision === 'approve' ? 'running' : 'failed'
        }
        break
      }
      case 'workflow_preview': {
        const wfId = event.data.workflowId
        const previousVersion = wfId ? workflowHistory.value.get(wfId) : undefined
        const newData: WorkflowPreviewData = {
          workflowId: wfId,
          name: event.data.name,
          workflow: event.data.workflow,
          workflowBefore: previousVersion,
        }
        // Store this version as the latest for future diffs
        if (wfId) {
          workflowHistory.value.set(wfId, structuredClone(event.data.workflow))
        }
        // If panel is open, update it live; otherwise inline cards handle display
        if (isPanelOpen.value) {
          previewData.value = newData
          panelWorkflowId.value = newData.workflowId
        }
        break
      }
      case 'todo_update': {
        // Todo updates are informational — could be surfaced in UI
        break
      }
      case 'error': {
        const errorMsg: SessionMessage = {
          id: `msg_${Date.now()}`,
          role: 'system',
          content: event.data.message,
          ts: new Date().toISOString(),
          meta: { error: true, code: event.data.code },
        }
        messages.value.push(errorMsg)
        persistMessage(errorMsg)
        isAgentRunning.value = false
        break
      }
      case 'done': {
        isAgentRunning.value = false
        // Persist the final assistant message (accumulated text chunks)
        const lastMsg = messages.value[messages.value.length - 1]
        if (lastMsg && lastMsg.role === 'assistant') {
          // The assistant message was persisted on creation but text was accumulated,
          // so persist the final version with complete content
          persistMessage(lastMsg)
        }
        break
      }
    }
  }

  function openPanel(data: WorkflowPreviewData): void {
    previewData.value = data
    isPanelOpen.value = true
    panelWorkflowId.value = data.workflowId
  }

  function closePanel(): void {
    isPanelOpen.value = false
    panelWorkflowId.value = null
    previewData.value = null
  }

  function reset(): void {
    sessions.value = []
    activeSessionId.value = null
    messages.value = []
    pendingApproval.value = null
    isAgentRunning.value = false
    toolCalls.value = []
    previewData.value = null
    isPanelOpen.value = false
    panelWorkflowId.value = null
    workflowHistory.value.clear()
    currentInstanceId = null
  }

  return {
    sessions,
    activeSessionId,
    activeSession,
    messages,
    pendingApproval,
    isAgentRunning,
    toolCalls,
    previewData,
    isPanelOpen,
    panelWorkflowId,
    workflowHistory,
    hydrate,
    createSession,
    deleteSession,
    attachFolder,
    detachFolder,
    selectSession,
    appendMessage,
    handleAgentEvent,
    openPanel,
    closePanel,
    reset,
  }
})
