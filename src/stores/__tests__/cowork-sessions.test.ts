/**
 * Session store agent-event handling: faithful transcript persistence
 * (audit #18) and unknown-id tool results (audit #24).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useCoworkSessionsStore } from '@/stores/cowork-sessions'
import { useWorkflowSessionsStore } from '@/stores/workflow-sessions'
import type { AgentEvent } from '@/types/agent'

const INSTANCE_ID = 'inst_test'

type AnySessionStore = ReturnType<typeof useCoworkSessionsStore> | ReturnType<typeof useWorkflowSessionsStore>

async function setupSession(store: AnySessionStore): Promise<string> {
  await store.hydrate(INSTANCE_ID)
  const sessionId = await store.createSession()
  return sessionId
}

function readJsonl(mode: 'cowork' | 'workflow', sessionId: string): Array<Record<string, unknown>> {
  const raw = localStorage.getItem(`n8n-desk:instances/${INSTANCE_ID}/sessions/${mode}/${sessionId}.jsonl`) ?? ''
  return raw.split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>)
}

function evt(sessionId: string, type: string, data: unknown): AgentEvent {
  return { sessionId, type, data } as AgentEvent
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 10))

// Both stores share identical event-handling logic — run the suite over each.
const cases = [
  { label: 'cowork-sessions', mode: 'cowork' as const, useStore: useCoworkSessionsStore },
  { label: 'workflow-sessions', mode: 'workflow' as const, useStore: useWorkflowSessionsStore },
]

for (const { label, mode, useStore } of cases) {
  describe(`${label} store — agent events`, () => {
    beforeEach(() => {
      setActivePinia(createPinia())
      localStorage.clear()
    })

    it('persists intermediate assistant segments, not just the final one (audit #18)', async () => {
      const store = useStore()
      const sessionId = await setupSession(store)

      store.handleAgentEvent(evt(sessionId, 'text_chunk', { text: 'I will create ' }))
      store.handleAgentEvent(evt(sessionId, 'text_chunk', { text: 'the workflow now.' }))
      store.handleAgentEvent(evt(sessionId, 'tool_call_start', { id: 'call_1', name: 'create_workflow_from_code', args: {} }))
      store.handleAgentEvent(evt(sessionId, 'tool_call_result', {
        id: 'call_1', name: 'create_workflow_from_code',
        result: '{"workflowId":"WF-9"}', success: true,
      }))
      store.handleAgentEvent(evt(sessionId, 'text_chunk', { text: 'Created workflow WF-9.' }))
      store.handleAgentEvent(evt(sessionId, 'done', { reason: 'completed' }))
      await flush()

      const persisted = readJsonl(mode, sessionId)
      const assistants = persisted.filter((m) => m.role === 'assistant')
      expect(assistants.map((m) => m.content)).toEqual([
        'I will create the workflow now.',
        'Created workflow WF-9.',
      ])
      // Chronological order: pre-tool text → tool result → post-tool text
      expect(persisted.map((m) => m.role)).toEqual(['assistant', 'tool', 'assistant'])
    })

    it('persists a segment split by a thinking message', async () => {
      const store = useStore()
      const sessionId = await setupSession(store)

      store.handleAgentEvent(evt(sessionId, 'text_chunk', { text: 'segment one' }))
      store.handleAgentEvent(evt(sessionId, 'thinking', { text: 'pondering' }))
      store.handleAgentEvent(evt(sessionId, 'text_chunk', { text: 'segment two' }))
      store.handleAgentEvent(evt(sessionId, 'done', { reason: 'completed' }))
      await flush()

      const assistants = readJsonl(mode, sessionId).filter((m) => m.role === 'assistant')
      expect(assistants.map((m) => m.content)).toEqual(['segment one', 'segment two'])
    })

    it('renders and persists tool results with unknown ids via a placeholder card (audit #24)', async () => {
      const store = useStore()
      const sessionId = await setupSession(store)

      // No tool_call_start ever arrived for this id
      store.handleAgentEvent(evt(sessionId, 'tool_call_result', {
        id: 'call_unseen', name: 'execute_workflow',
        result: '{"executionId":"exec-77","status":"success"}', success: true,
      }))
      await flush()

      // Placeholder card exists and carries the result
      const tc = store.toolCalls.find((t) => t.id === 'call_unseen')
      expect(tc).toBeDefined()
      expect(tc!.name).toBe('execute_workflow')
      expect(tc!.status).toBe('completed')
      expect(tc!.result).toContain('exec-77')

      // And the result is persisted
      const tools = readJsonl(mode, sessionId).filter((m) => m.role === 'tool')
      expect(tools).toHaveLength(1)
      expect(tools[0].content).toContain('exec-77')
      expect((tools[0].meta as Record<string, unknown>).toolName).toBe('execute_workflow')
    })

    it('marks failed unknown-id results as failed', async () => {
      const store = useStore()
      const sessionId = await setupSession(store)

      store.handleAgentEvent(evt(sessionId, 'tool_call_result', {
        id: 'call_x', name: '', result: 'boom', success: false, error: 'boom',
      }))
      await flush()

      const tc = store.toolCalls.find((t) => t.id === 'call_x')
      expect(tc!.status).toBe('failed')
      expect(tc!.name).toBe('unknown')
    })

    it('flushes the assistant segment before an error message (chronological JSONL)', async () => {
      const store = useStore()
      const sessionId = await setupSession(store)

      store.handleAgentEvent(evt(sessionId, 'text_chunk', { text: 'halfway there' }))
      store.handleAgentEvent(evt(sessionId, 'error', { message: 'network died' }))
      store.handleAgentEvent(evt(sessionId, 'done', { reason: 'error' }))
      await flush()

      const persisted = readJsonl(mode, sessionId)
      expect(persisted.map((m) => m.role)).toEqual(['assistant', 'system'])
      expect(persisted[0].content).toBe('halfway there')
    })

    it('does not double-persist a segment across done', async () => {
      const store = useStore()
      const sessionId = await setupSession(store)

      store.handleAgentEvent(evt(sessionId, 'text_chunk', { text: 'only once' }))
      store.handleAgentEvent(evt(sessionId, 'tool_call_start', { id: 'c1', name: 'search_nodes', args: {} }))
      store.handleAgentEvent(evt(sessionId, 'tool_call_result', { id: 'c1', name: 'search_nodes', result: '[]', success: true }))
      store.handleAgentEvent(evt(sessionId, 'done', { reason: 'completed' }))
      await flush()

      const assistants = readJsonl(mode, sessionId).filter((m) => m.role === 'assistant')
      expect(assistants).toHaveLength(1)
      expect(assistants[0].content).toBe('only once')
    })

    it('routes events to a non-active session instead of dropping them (audit #23)', async () => {
      const store = useStore()
      const backgroundId = await setupSession(store)
      store.markRunning(backgroundId)

      // Switch to a second session — the first keeps running in the background
      const activeId = await store.createSession()
      expect(store.activeSessionId).toBe(activeId)
      expect(store.isAgentRunning).toBe(false) // running state is per session

      store.handleAgentEvent(evt(backgroundId, 'text_chunk', { text: 'background output' }))
      store.handleAgentEvent(evt(backgroundId, 'tool_call_result', {
        id: 'bg_1', name: 'execute_workflow', result: '{"executionId":"exec-9"}', success: true,
      }))
      store.handleAgentEvent(evt(backgroundId, 'done', { reason: 'completed' }))
      await flush()

      // Active session untouched
      expect(store.messages).toHaveLength(0)
      // Background output persisted to ITS file, not the active session's
      const bgMessages = readJsonl(mode, backgroundId)
      expect(bgMessages.some((m) => m.role === 'assistant' && m.content === 'background output')).toBe(true)
      expect(bgMessages.some((m) => m.role === 'tool')).toBe(true)
      expect(readJsonl(mode, activeId)).toHaveLength(0)

      // Switching back shows the background run's output from its runtime
      await store.selectSession(backgroundId)
      expect(store.messages.some((m) => m.content === 'background output')).toBe(true)
      expect(store.toolCalls.find((t) => t.id === 'bg_1')?.status).toBe('completed')
    })

    it('keeps pending approvals per session across switches', async () => {
      const store = useStore()
      const firstId = await setupSession(store)
      store.markRunning(firstId)

      store.handleAgentEvent(evt(firstId, 'tool_call_start', { id: 'tc_a', name: 'execute_workflow', args: {} }))
      store.handleAgentEvent(evt(firstId, 'approval_required', {
        id: 'tc_a', toolName: 'execute_workflow', args: { workflowId: '42' }, description: 'Run?',
      }))
      expect(store.pendingApproval?.id).toBe('tc_a')

      // Switching away hides it; the new session has no pending approval
      await store.createSession()
      expect(store.pendingApproval).toBeNull()

      // Switching back restores it
      await store.selectSession(firstId)
      expect(store.pendingApproval?.id).toBe('tc_a')
      expect(store.pendingApproval?.args).toEqual({ workflowId: '42' })
    })

    it('exposes todo_update events as the session plan', async () => {
      const store = useStore()
      const sessionId = await setupSession(store)

      store.handleAgentEvent(evt(sessionId, 'todo_update', {
        todos: [
          { id: '0', title: 'Discover nodes', status: 'completed' },
          { id: '1', title: 'Write workflow code', status: 'in_progress' },
        ],
      }))

      expect(store.todos).toHaveLength(2)
      expect(store.todos[1].status).toBe('in_progress')
    })

    it('persists tool args and restores them on reload (audit #52)', async () => {
      const store = useStore()
      const sessionId = await setupSession(store)

      const args = { workflowId: 'WF-7', executionMode: 'manual' }
      store.handleAgentEvent(evt(sessionId, 'tool_call_start', { id: 'tc_args', name: 'execute_workflow', args }))
      store.handleAgentEvent(evt(sessionId, 'tool_call_result', {
        id: 'tc_args', name: 'execute_workflow', result: '{"executionId":"exec-1"}', success: true,
      }))
      store.handleAgentEvent(evt(sessionId, 'done', { reason: 'completed' }))
      await flush()

      // Simulate app restart: fresh pinia, rehydrate from disk
      setActivePinia(createPinia())
      const reloaded = useStore()
      await reloaded.hydrate(INSTANCE_ID)
      await reloaded.selectSession(sessionId)

      const tc = reloaded.toolCalls.find((t) => t.id === 'tc_args')
      expect(tc).toBeDefined()
      expect(tc!.args).toEqual(args)
      expect(tc!.result).toContain('exec-1')
    })

    it('persists workflow_preview payloads so inline previews survive restart (audit #52)', async () => {
      const store = useStore()
      const sessionId = await setupSession(store)

      const workflow = { id: 'WF-9', name: 'Digest', nodes: [{ type: 'trigger' }], connections: {} }
      store.handleAgentEvent(evt(sessionId, 'tool_call_start', { id: 'tc_wf', name: 'create_workflow_from_code', args: {} }))
      // create_workflow_from_code returns only metadata — the preview event
      // carries the fetched workflow JSON
      store.handleAgentEvent(evt(sessionId, 'tool_call_result', {
        id: 'tc_wf', name: 'create_workflow_from_code',
        result: '{"workflowId":"WF-9","name":"Digest"}', success: true,
      }))
      store.handleAgentEvent(evt(sessionId, 'workflow_preview', {
        toolCallId: 'tc_wf', workflowId: 'WF-9', name: 'Digest', workflow,
      }))
      store.handleAgentEvent(evt(sessionId, 'done', { reason: 'completed' }))
      await flush()

      // Reload from disk
      setActivePinia(createPinia())
      const reloaded = useStore()
      await reloaded.hydrate(INSTANCE_ID)
      await reloaded.selectSession(sessionId)

      const tc = reloaded.toolCalls.find((t) => t.id === 'tc_wf')
      expect(tc).toBeDefined()
      const result = tc!.result as { id: string; workflow: { nodes: unknown[] } }
      expect(result.id).toBe('WF-9')
      expect(result.workflow.nodes).toHaveLength(1)
      expect(reloaded.workflowHistory.get('WF-9')).toBeDefined()
    })

    it('renames a session and persists the index (audit #50)', async () => {
      const store = useStore()
      const sessionId = await setupSession(store)

      await store.renameSession(sessionId, 'Monthly invoice run')
      expect(store.sessions.find((s) => s.id === sessionId)?.title).toBe('Monthly invoice run')

      const index = JSON.parse(
        localStorage.getItem(`n8n-desk:instances/${INSTANCE_ID}/sessions/${mode}/index.json`) ?? '[]',
      ) as Array<{ id: string; title: string }>
      expect(index.find((s) => s.id === sessionId)?.title).toBe('Monthly invoice run')
    })

    it('auto-titles from the first user message but never clobbers a rename (audit #50)', async () => {
      const store = useStore()
      const sessionId = await setupSession(store)

      await store.appendMessage({
        id: 'msg_u1', role: 'user',
        content: 'Summarize the Q3 invoices in the attached folder please',
        ts: new Date().toISOString(),
      })
      expect(store.sessions.find((s) => s.id === sessionId)?.title)
        .toContain('Summarize the Q3 invoices')

      // A renamed session keeps its custom title
      const secondId = await store.createSession()
      await store.renameSession(secondId, 'My custom title')
      await store.appendMessage({
        id: 'msg_u2', role: 'user', content: 'do something else', ts: new Date().toISOString(),
      })
      expect(store.sessions.find((s) => s.id === secondId)?.title).toBe('My custom title')
    })

    it('returns the first user message for re-run, from runtime or disk (audit #50)', async () => {
      const store = useStore()
      const sessionId = await setupSession(store)
      await store.appendMessage({
        id: 'msg_u1', role: 'user', content: 'the original task', ts: new Date().toISOString(),
      })

      expect(await store.firstUserMessage(sessionId)).toBe('the original task')

      // From disk after a full reload
      setActivePinia(createPinia())
      const reloaded = useStore()
      await reloaded.hydrate(INSTANCE_ID)
      expect(await reloaded.firstUserMessage(sessionId)).toBe('the original task')
    })

    it('drops events for sessions this store does not own', async () => {
      const store = useStore()
      await setupSession(store)

      store.handleAgentEvent(evt('session_foreign', 'text_chunk', { text: 'not ours' }))
      await flush()

      expect(store.messages).toHaveLength(0)
      expect(localStorage.getItem(`n8n-desk:instances/${INSTANCE_ID}/sessions/${mode}/session_foreign.jsonl`)).toBeNull()
    })
  })
}
