import { ref, computed } from 'vue'
import type { AttachedFolder, SessionMeta, SessionMessage } from '@/types/session'
import type {
  AgentEvent,
  AgentToolCall,
  AgentTodo,
  AgentApprovalRequiredEvent,
  AgentQuestionAskedEvent,
  WorkflowPreviewData,
  WorkflowJson,
} from '@/types/agent'
import { localStorageService } from '@/services/local-storage'
import { generateMessageId } from '@/utils/message-id'

export type AgentSessionMode = 'cowork' | 'workflow'

/**
 * In-memory state of one session. Kept per session (not per store) so agent
 * events can be routed to the session they belong to even when it is not the
 * active one — dropping non-active events permanently locked the input and
 * lost the agent's output (audit #23).
 */
interface SessionRuntime {
  messages: SessionMessage[]
  toolCalls: AgentToolCall[]
  todos: AgentTodo[]
  pendingApproval: AgentApprovalRequiredEvent['data'] | null
  /** In-flight ask_user_question awaiting the user's answers (runtime only —
   * like pendingApproval it does not survive reload; the runner is gone). */
  pendingQuestion: AgentQuestionAskedEvent['data'] | null
  /**
   * Tool-call ids the user rejected. The rejection result arrives as a
   * SUCCESSFUL ToolMessage on the Deep Agents backend ("The user rejected…"
   * is not an error-status message) — without this set, tool_call_result
   * would flip the card from failed back to completed.
   */
  rejectedToolCallIds: Set<string>
  /** Last-seen version of each workflow by ID, for diff previews */
  workflowHistory: Map<string, WorkflowJson>
  /**
   * Id of the in-progress assistant text segment not yet persisted.
   * Segments are persisted when they COMPLETE — when the next tool call
   * starts, or on done/error. Persisting only the final segment on 'done'
   * loses every intermediate segment (the text that precedes tool calls) on
   * reload, which is exactly the context multi-turn memory needs (audit #18).
   */
  unpersistedAssistantId: string | null
  /**
   * Message of the most recent `error` event this run — used as the failure
   * reason when the terminal `done` resolves in-flight tool calls.
   */
  lastErrorMessage: string | null
}

function newRuntime(): SessionRuntime {
  return {
    messages: [],
    toolCalls: [],
    todos: [],
    pendingApproval: null,
    pendingQuestion: null,
    rejectedToolCallIds: new Set(),
    workflowHistory: new Map(),
    unpersistedAssistantId: null,
    lastErrorMessage: null,
  }
}

function generateSessionId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let id = 'session_'
  for (let i = 0; i < 12; i++) {
    id += chars[Math.floor(Math.random() * chars.length)]
  }
  return id
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
 * Shared setup for the Cowork and Workflow session stores. The two modes have
 * identical session/event semantics — a single implementation keeps every
 * renderer fix from having to be applied twice.
 *
 * `defaultTitle` is a function so titles resolve through i18n at creation
 * time (audit #65) instead of freezing the boot locale.
 */
export function createAgentSessionsStore(mode: AgentSessionMode, defaultTitle: () => string) {
  return () => {
    const sessionsDir = (instanceId: string): string =>
      `instances/${instanceId}/sessions/${mode}`
    const indexPath = (instanceId: string): string =>
      `${sessionsDir(instanceId)}/index.json`
    const sessionFilePath = (instanceId: string, sessionId: string): string =>
      `${sessionsDir(instanceId)}/${sessionId}.jsonl`
    const archivePath = (instanceId: string, sessionId: string): string =>
      `${sessionsDir(instanceId)}/.archive/${sessionId}.jsonl`

    const sessions = ref<SessionMeta[]>([])
    const activeSessionId = ref<string | null>(null)
    /** Per-session in-memory state, keyed by session id. */
    const runtimes = ref<Map<string, SessionRuntime>>(new Map())
    /** Sessions with an agent run in flight — running state is per session,
     * not global, so switching away doesn't lock the new session's input. */
    const runningSessions = ref<Set<string>>(new Set())
    const previewData = ref<WorkflowPreviewData | null>(null)
    const isPanelOpen = ref(false)
    const panelWorkflowId = ref<string | null>(null)

    let currentInstanceId: string | null = null

    const activeSession = computed(() =>
      sessions.value.find((s) => s.id === activeSessionId.value) ?? null
    )

    const activeRuntime = computed(() =>
      activeSessionId.value ? runtimes.value.get(activeSessionId.value) ?? null : null
    )

    const messages = computed<SessionMessage[]>(() => activeRuntime.value?.messages ?? [])
    const toolCalls = computed<AgentToolCall[]>(() => activeRuntime.value?.toolCalls ?? [])
    const todos = computed<AgentTodo[]>(() => activeRuntime.value?.todos ?? [])
    const pendingApproval = computed(() => activeRuntime.value?.pendingApproval ?? null)
    const pendingQuestion = computed(() => activeRuntime.value?.pendingQuestion ?? null)
    const workflowHistory = computed<Map<string, WorkflowJson>>(
      () => activeRuntime.value?.workflowHistory ?? new Map()
    )
    const isAgentRunning = computed(() =>
      activeSessionId.value !== null && runningSessions.value.has(activeSessionId.value)
    )

    function markRunning(sessionId: string): void {
      runningSessions.value.add(sessionId)
    }

    function markStopped(sessionId: string): void {
      runningSessions.value.delete(sessionId)
    }

    /**
     * Hydrate from disk for a given instance.
     */
    async function hydrate(instanceId: string): Promise<void> {
      currentInstanceId = instanceId
      runtimes.value.clear()
      runningSessions.value.clear()
      const index = await localStorageService.readJson<SessionMeta[]>(indexPath(instanceId))
      sessions.value = index ?? []

      // Load the most recent session if available
      if (sessions.value.length > 0) {
        await selectSession(sessions.value[0].id)
      } else {
        activeSessionId.value = null
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
        title: title ?? defaultTitle(),
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

      // Remove from index and drop the runtime — later agent events for this
      // session have nowhere to go and are ignored.
      sessions.value = sessions.value.filter((s) => s.id !== sessionId)
      runtimes.value.delete(sessionId)
      runningSessions.value.delete(sessionId)
      await localStorageService.writeJson(indexPath(currentInstanceId), sessions.value)

      // If we deleted the active session, select another or clear
      if (activeSessionId.value === sessionId) {
        if (sessions.value.length > 0) {
          await selectSession(sessions.value[0].id)
        } else {
          activeSessionId.value = null
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
     * Rename a session and persist the index (audit #50 — sessions were not
     * renameable, so past tasks were hard to find).
     */
    async function renameSession(sessionId: string, title: string): Promise<void> {
      if (!currentInstanceId) return
      const meta = sessions.value.find((s) => s.id === sessionId)
      const trimmed = title.trim()
      if (!meta || !trimmed) return

      meta.title = trimmed
      meta.updatedAt = new Date().toISOString()
      await localStorageService.writeJson(indexPath(currentInstanceId), sessions.value)
    }

    /**
     * First user message of a session — the "task" for re-run (audit #50).
     * Uses the live runtime when present, otherwise reads from disk.
     */
    async function firstUserMessage(sessionId: string): Promise<string | null> {
      if (!currentInstanceId) return null
      const rt = runtimes.value.get(sessionId)
      const source = rt?.messages ?? await localStorageService.readJsonl<SessionMessage>(
        sessionFilePath(currentInstanceId, sessionId)
      )
      return source.find((m) => m.role === 'user')?.content ?? null
    }

    /**
     * Change the access mode of an attached folder (audit #48 — the mode was
     * invisible and hardcoded read-write in the UI).
     */
    async function setFolderMode(sessionId: string, folderPath: string, folderMode: 'ro' | 'rw'): Promise<void> {
      if (!currentInstanceId) return

      const meta = sessions.value.find((s) => s.id === sessionId)
      const folder = meta?.attachedFolders?.find((f) => f.path === folderPath)
      if (!meta || !folder) return

      folder.mode = folderMode
      meta.updatedAt = new Date().toISOString()
      await localStorageService.writeJson(indexPath(currentInstanceId), sessions.value)
    }

    /**
     * Select a session. If it has a live runtime (an agent ran or is running
     * in the background), reuse it — it is at least as complete as the JSONL.
     * Otherwise load messages from disk and reconstruct tool cards/previews.
     */
    async function selectSession(sessionId: string): Promise<void> {
      if (!currentInstanceId) return

      activeSessionId.value = sessionId
      isPanelOpen.value = false
      panelWorkflowId.value = null
      previewData.value = null

      if (runtimes.value.has(sessionId)) return

      const rt = newRuntime()
      runtimes.value.set(sessionId, rt)

      const rawMessages = await localStorageService.readJsonl<SessionMessage>(
        sessionFilePath(currentInstanceId, sessionId)
      )

      // Deduplicate messages from old sessions that had double-write bugs, and
      // collapse re-appended tool messages (each update appends the full
      // message again; the LAST entry per toolCallId is the most complete).
      // Two sources of duplicates:
      // 1. Tool messages: backend + store both wrote entries for the same toolCallId
      // 2. Assistant/system messages: backend + store wrote separate copies with
      //    different IDs but identical or near-identical content

      // Step 1: For tool messages, keep only the last (most complete) entry per toolCallId
      const toolCallLastIndex = new Map<string, number>()
      for (let i = 0; i < rawMessages.length; i++) {
        const msg = rawMessages[i]
        if (msg.role === 'tool' && msg.meta) {
          const toolCallId = (msg.meta as Record<string, unknown>).toolCallId as string | undefined
          if (toolCallId) toolCallLastIndex.set(toolCallId, i)
        }
      }

      const deduped: SessionMessage[] = []
      const seenToolCalls = new Set<string>()
      for (let i = 0; i < rawMessages.length; i++) {
        const msg = rawMessages[i]

        if (msg.role === 'tool' && msg.meta) {
          const toolCallId = (msg.meta as Record<string, unknown>).toolCallId as string | undefined
          if (toolCallId) {
            // Only keep the last entry for this tool call
            if (toolCallLastIndex.get(toolCallId) !== i) continue
            if (seenToolCalls.has(toolCallId)) continue
            seenToolCalls.add(toolCallId)
          }
        } else if (msg.role === 'assistant' || msg.role === 'system') {
          // Skip if the previous kept message has the same role and content
          // (duplicate from backend + store both writing the same message)
          const prev = deduped[deduped.length - 1]
          if (prev && prev.role === msg.role && prev.content === msg.content) continue
          // Also skip if this is a substring of the previous (partial chunk + full)
          if (prev && prev.role === msg.role && prev.content.includes(msg.content)) continue
          // Or if the previous is a substring of this (keep the longer one)
          if (prev && prev.role === msg.role && msg.content.includes(prev.content)) {
            deduped[deduped.length - 1] = msg // replace with the more complete version
            continue
          }
        }

        deduped.push(msg)
      }
      rt.messages = deduped

      // Reconstruct toolCalls from loaded tool messages so cards render
      // properly — including persisted args and workflow previews (audit #52).
      const reconstructed: AgentToolCall[] = []
      for (const msg of rt.messages) {
        if (msg.role !== 'tool' || !msg.meta) continue
        const meta = msg.meta as Record<string, unknown>
        const toolCallId = meta.toolCallId as string | undefined
        const toolName = meta.toolName as string | undefined
        if (!toolCallId) continue

        const status = meta.status as string | undefined
        const tc: AgentToolCall = {
          id: toolCallId,
          name: toolName ?? 'unknown',
          args: (meta.args as Record<string, unknown>) ?? {},
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

        // A persisted workflow_preview payload replaces the raw result so the
        // inline preview cards render again after restart (audit #52). This is
        // needed for create_workflow_from_code / update_workflow whose
        // original results only contain metadata (no nodes/connections).
        const wp = meta.workflowPreview as
          | { workflowId: string; name: string; workflow: WorkflowJson }
          | undefined
        if (wp && wp.workflow) {
          tc.result = { id: wp.workflowId, name: wp.name, workflow: wp.workflow }
        }

        // Check if this toolCall already exists (shouldn't after dedup, but be safe)
        const existing = reconstructed.find((t) => t.id === toolCallId)
        if (existing) {
          if (tc.result !== undefined) existing.result = tc.result
          if (status) existing.status = tc.status
          if (meta.error) existing.status = 'failed'
        } else {
          reconstructed.push(tc)
        }
      }
      rt.toolCalls = reconstructed

      // Extract workflow JSON from tool results to rebuild previews
      for (const msg of rt.messages) {
        if (msg.role !== 'tool') continue

        const meta = (msg.meta ?? {}) as Record<string, unknown>
        const wp = meta.workflowPreview as
          | { workflowId: string; name: string; workflow: WorkflowJson }
          | undefined
        if (wp && wp.workflow) {
          if (wp.workflowId) {
            rt.workflowHistory.set(wp.workflowId, structuredClone(wp.workflow))
          }
          previewData.value = {
            workflowId: wp.workflowId,
            name: wp.name,
            workflow: wp.workflow,
          }
          continue
        }

        if (!msg.content) continue
        try {
          const parsed = JSON.parse(msg.content) as Record<string, unknown>
          const wf = extractWorkflowFromResult(parsed)
          if (wf) {
            const wfId = (wf.id as string) ?? ''
            if (wfId) {
              rt.workflowHistory.set(wfId, structuredClone(wf) as WorkflowJson)
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
     * Append a message to the active session and persist it.
     */
    async function appendMessage(message: SessionMessage): Promise<void> {
      if (!currentInstanceId || !activeSessionId.value) return
      const rt = runtimes.value.get(activeSessionId.value)
      if (!rt) return

      rt.messages.push(message)
      await localStorageService.appendJsonl(
        sessionFilePath(currentInstanceId, activeSessionId.value),
        message
      )

      // Update session metadata
      const meta = sessions.value.find((s) => s.id === activeSessionId.value)
      if (meta) {
        // Auto-title from the first user message (audit #50) — only while the
        // session still carries the default title (never clobber a rename).
        if (
          message.role === 'user' &&
          meta.title === defaultTitle() &&
          message.content.trim()
        ) {
          const firstLine = message.content.trim().split('\n')[0]
          meta.title = firstLine.length > 48 ? `${firstLine.slice(0, 48)}…` : firstLine
        }
        meta.updatedAt = new Date().toISOString()
        meta.messageCount = rt.messages.length
        await localStorageService.writeJson(indexPath(currentInstanceId), sessions.value)
      }
    }

    function persistMessage(sessionId: string, message: SessionMessage): void {
      if (!currentInstanceId) return
      void localStorageService.appendJsonl(
        sessionFilePath(currentInstanceId, sessionId),
        message
      )
    }

    function flushAssistantSegment(sessionId: string, rt: SessionRuntime): void {
      if (!rt.unpersistedAssistantId) return
      const msg = rt.messages.find((m) => m.id === rt.unpersistedAssistantId)
      rt.unpersistedAssistantId = null
      if (msg && msg.content) persistMessage(sessionId, msg)
    }

    /**
     * A terminal event (error/done) means no more tool_call_result events are
     * coming — resolve any tool call still in flight as failed, or its card
     * spins forever and the session looks frozen.
     */
    function failInFlightToolCalls(sessionId: string, rt: SessionRuntime, reason: string): void {
      for (const tc of rt.toolCalls) {
        if (tc.status !== 'running' && tc.status !== 'awaiting_approval' && tc.status !== 'awaiting_input' && tc.status !== 'pending') continue
        tc.status = 'failed'
        const toolMsg = [...rt.messages].reverse().find(
          (m) => m.meta && (m.meta as Record<string, unknown>).toolCallId === tc.id
        )
        if (toolMsg) {
          toolMsg.meta = { ...toolMsg.meta, status: 'failed', error: reason }
          persistMessage(sessionId, toolMsg)
        }
      }
    }

    /**
     * Handle an agent event, routed to the session it belongs to. Events for
     * non-active sessions update (and persist into) that session's runtime —
     * they are never dropped (audit #23). Events for sessions this store does
     * not own (the other mode, or deleted sessions) are ignored.
     */
    function handleAgentEvent(event: AgentEvent): void {
      const sessionId = event.sessionId
      const rt = runtimes.value.get(sessionId)
      if (!rt) {
        // The terminal event still clears the running flag even when the
        // runtime is gone (e.g. session deleted mid-run).
        if (event.type === 'done') {
          runningSessions.value.delete(sessionId)
        }
        return
      }

      // Self-healing running state: an event that implies the agent loop is
      // alive re-marks the session as running, so the spinner and stop button
      // can never disappear while results are still streaming in — whatever
      // desync (lost terminal event, race with stop) preceded it.
      // workflow_preview is excluded: it can arrive from a detached fetch
      // AFTER the run legitimately completed, and must not re-lock the input.
      switch (event.type) {
        case 'text_chunk':
        case 'thinking':
        case 'tool_call_start':
        case 'tool_call_result':
        case 'approval_required':
        case 'question_asked':
        case 'todo_update':
          runningSessions.value.add(sessionId)
          break
        default:
          break
      }

      switch (event.type) {
        case 'thinking': {
          // Accumulate thinking into the last thinking message, or create one
          const lastThinking = rt.messages[rt.messages.length - 1]
          if (lastThinking && lastThinking.role === 'thinking') {
            lastThinking.content += event.data.text
          } else {
            const msg: SessionMessage = {
              id: generateMessageId(),
              role: 'thinking',
              content: event.data.text,
              ts: new Date().toISOString(),
            }
            rt.messages.push(msg)
          }
          break
        }
        case 'text_chunk': {
          // Accumulate text into the last assistant message, or create one.
          // Segments persist when they complete (flushAssistantSegment), not
          // per chunk.
          const last = rt.messages[rt.messages.length - 1]
          if (last && last.role === 'assistant') {
            last.content += event.data.text
            rt.unpersistedAssistantId ??= last.id
          } else {
            // A thinking message may sit between two text segments — close the
            // previous segment before starting a new one or it is never persisted.
            flushAssistantSegment(sessionId, rt)
            const msg: SessionMessage = {
              id: generateMessageId(),
              role: 'assistant',
              content: event.data.text,
              ts: new Date().toISOString(),
            }
            rt.messages.push(msg)
            rt.unpersistedAssistantId = msg.id
          }
          break
        }
        case 'tool_call_start': {
          // The assistant segment that led to this tool call is complete —
          // persist it so pre-tool-call text survives reload (audit #18).
          flushAssistantSegment(sessionId, rt)

          const tc: AgentToolCall = {
            id: event.data.id,
            name: event.data.name,
            args: event.data.args,
            status: 'running',
          }
          rt.toolCalls.push(tc)

          // Add a tool message to the conversation (in-memory only).
          // Persistence happens on tool_call_result with the final state.
          // Args ride along in meta so they survive restart (audit #52).
          const toolMsg: SessionMessage = {
            id: generateMessageId(),
            role: 'tool',
            content: '',
            ts: new Date().toISOString(),
            meta: {
              toolCallId: event.data.id,
              toolName: event.data.name,
              args: event.data.args,
              status: 'running',
            },
          }
          rt.messages.push(toolMsg)
          break
        }
        case 'tool_call_result': {
          let tc = rt.toolCalls.find((t) => t.id === event.data.id)
          if (!tc) {
            // Result for a tool call we never saw start (audit #24) — results
            // of the core actions must render and persist even then, so create
            // a placeholder card instead of dropping the event.
            tc = {
              id: event.data.id,
              name: event.data.name || 'unknown',
              args: {},
              status: 'running',
            }
            rt.toolCalls.push(tc)
          }
          // A user-rejected call stays failed even when the backend reports
          // the rejection ToolMessage as success.
          const wasRejected = rt.rejectedToolCallIds.has(event.data.id)
          const failed = wasRejected || !event.data.success
          tc.status = failed ? 'failed' : 'completed'
          tc.result = event.data.result

          // Update the tool message in-memory and persist the final version
          let toolMsg = [...rt.messages].reverse().find(
            (m) => m.meta && (m.meta as Record<string, unknown>).toolCallId === event.data.id
          )
          if (!toolMsg) {
            flushAssistantSegment(sessionId, rt)
            toolMsg = {
              id: generateMessageId(),
              role: 'tool',
              content: '',
              ts: new Date().toISOString(),
              meta: { toolCallId: event.data.id, toolName: tc.name, status: 'running' },
            }
            rt.messages.push(toolMsg)
          }
          toolMsg.content = typeof event.data.result === 'string'
            ? event.data.result
            : JSON.stringify(event.data.result)
          toolMsg.meta = {
            ...toolMsg.meta,
            status: failed ? 'failed' : 'completed',
            error: event.data.error,
          }
          persistMessage(sessionId, toolMsg)
          break
        }
        case 'approval_required': {
          rt.pendingApproval = event.data
          const tc = rt.toolCalls.find((t) => t.id === event.data.id)
          if (tc) {
            tc.status = 'awaiting_approval'
          }
          break
        }
        case 'approval_resolved': {
          rt.pendingApproval = null
          if (event.data.decision === 'reject') {
            rt.rejectedToolCallIds.add(event.data.id)
          }
          const tc = rt.toolCalls.find((t) => t.id === event.data.id)
          if (tc) {
            tc.status = event.data.decision === 'approve' ? 'running' : 'failed'
          }
          break
        }
        case 'question_asked': {
          rt.pendingQuestion = event.data
          const tc = rt.toolCalls.find((t) => t.id === event.data.id)
          if (tc) {
            tc.status = 'awaiting_input'
          }
          break
        }
        case 'question_answered': {
          rt.pendingQuestion = null
          const tc = rt.toolCalls.find((t) => t.id === event.data.id)
          if (tc) {
            tc.status = 'running'
          }
          // Stamp the answers onto the tool message so the answered Q&A
          // survives reload. Re-appending is fine: load-time dedup keeps the
          // LAST entry per toolCallId (same trick as workflowPreview).
          const toolMsg = [...rt.messages].reverse().find(
            (m) => m.meta && (m.meta as Record<string, unknown>).toolCallId === event.data.id
          )
          if (toolMsg) {
            toolMsg.meta = { ...toolMsg.meta, questionAnswers: event.data.answers }
            persistMessage(sessionId, toolMsg)
          }
          break
        }
        case 'workflow_preview': {
          const wfId = event.data.workflowId
          const previousVersion = wfId ? rt.workflowHistory.get(wfId) : undefined
          const newData: WorkflowPreviewData = {
            workflowId: wfId,
            name: event.data.name,
            workflow: event.data.workflow as WorkflowJson,
            workflowBefore: previousVersion,
          }
          // Store this version as the latest for future diffs
          if (wfId) {
            rt.workflowHistory.set(wfId, structuredClone(event.data.workflow) as WorkflowJson)
          }
          if (event.data.toolCallId) {
            // Inject the full workflow JSON into the matching tool call's
            // result so the chat panel's extractWorkflowFromToolResult can
            // find it.
            const tc = rt.toolCalls.find((t) => t.id === event.data.toolCallId)
            if (tc) {
              tc.result = {
                id: wfId,
                name: event.data.name,
                workflow: event.data.workflow,
              }
            }
            // Persist the preview payload on the tool message so a reopened
            // session shows the same inline preview (audit #52). Re-appending
            // is fine: load-time dedup keeps the LAST entry per toolCallId.
            const toolMsg = [...rt.messages].reverse().find(
              (m) => m.meta && (m.meta as Record<string, unknown>).toolCallId === event.data.toolCallId
            )
            if (toolMsg) {
              toolMsg.meta = {
                ...toolMsg.meta,
                workflowPreview: {
                  workflowId: wfId,
                  name: event.data.name,
                  workflow: event.data.workflow,
                },
              }
              persistMessage(sessionId, toolMsg)
            }
          }
          // If the panel is open on this session, update it live; otherwise
          // inline cards handle display
          if (isPanelOpen.value && sessionId === activeSessionId.value) {
            previewData.value = newData
            panelWorkflowId.value = newData.workflowId
          }
          break
        }
        case 'todo_update': {
          rt.todos = event.data.todos
          break
        }
        case 'error': {
          // NOT terminal: runners emit `error` for recoverable conditions too
          // (e.g. MCP discovery failure — the run continues with local tools).
          // Every terminal error is followed by a `done` event, which is the
          // ONLY event that clears the running flag. Clearing it here hid the
          // spinner and stop button while the agent kept streaming results.
          flushAssistantSegment(sessionId, rt)
          const errorMsg: SessionMessage = {
            id: generateMessageId(),
            role: 'system',
            content: event.data.message,
            ts: new Date().toISOString(),
            meta: { error: true, code: event.data.code },
          }
          rt.messages.push(errorMsg)
          persistMessage(sessionId, errorMsg)
          rt.lastErrorMessage = event.data.message
          break
        }
        case 'done': {
          runningSessions.value.delete(sessionId)
          rt.pendingApproval = null
          rt.pendingQuestion = null
          failInFlightToolCalls(
            sessionId,
            rt,
            rt.lastErrorMessage ?? 'The run ended before this tool call completed.'
          )
          rt.lastErrorMessage = null
          // Persist the final assistant segment (accumulated text chunks)
          flushAssistantSegment(sessionId, rt)
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
      runtimes.value.clear()
      runningSessions.value.clear()
      previewData.value = null
      isPanelOpen.value = false
      panelWorkflowId.value = null
      currentInstanceId = null
    }

    return {
      sessions,
      activeSessionId,
      activeSession,
      messages,
      pendingApproval,
      pendingQuestion,
      isAgentRunning,
      toolCalls,
      todos,
      previewData,
      isPanelOpen,
      panelWorkflowId,
      workflowHistory,
      markRunning,
      markStopped,
      hydrate,
      createSession,
      deleteSession,
      renameSession,
      firstUserMessage,
      attachFolder,
      detachFolder,
      setFolderMode,
      selectSession,
      appendMessage,
      handleAgentEvent,
      openPanel,
      closePanel,
      reset,
    }
  }
}
