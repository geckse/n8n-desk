import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useCoworkSessionsStore } from '@/stores/cowork-sessions'

// Mock local-storage service
vi.mock('@/services/local-storage', () => {
  const store: Record<string, string> = {}
  return {
    localStorageService: {
      readJson: vi.fn(async <T>(path: string): Promise<T | null> => {
        const data = store[path]
        return data ? (JSON.parse(data) as T) : null
      }),
      writeJson: vi.fn(async (path: string, data: unknown) => {
        store[path] = JSON.stringify(data)
      }),
      readJsonl: vi.fn(async <T>(path: string): Promise<T[]> => {
        const data = store[path]
        if (!data) return []
        return data
          .split('\n')
          .filter(Boolean)
          .map((line: string) => JSON.parse(line) as T)
      }),
      appendJsonl: vi.fn(async (path: string, item: unknown) => {
        const existing = store[path] ?? ''
        store[path] = existing + (existing ? '\n' : '') + JSON.stringify(item)
      }),
      _store: store,
      _reset: () => {
        Object.keys(store).forEach((k) => delete store[k])
      },
    },
  }
})

// Access mock internals
import { localStorageService } from '@/services/local-storage'
const mockStore = (localStorageService as unknown as { _store: Record<string, string>; _reset: () => void })

describe('cowork-sessions store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockStore._reset()
    vi.clearAllMocks()
  })

  describe('hydrate', () => {
    it('loads sessions from index.json', async () => {
      const sessions = [
        { id: 'session_abc', title: 'Test', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', messageCount: 2 },
      ]
      mockStore._store['instances/inst_1/sessions/cowork/index.json'] = JSON.stringify(sessions)
      mockStore._store['instances/inst_1/sessions/cowork/session_abc.jsonl'] =
        '{"id":"msg_1","role":"user","content":"hello","ts":"2026-01-01T00:00:00Z"}\n{"id":"msg_2","role":"assistant","content":"hi","ts":"2026-01-01T00:00:01Z"}'

      const store = useCoworkSessionsStore()
      await store.hydrate('inst_1')

      expect(store.sessions).toHaveLength(1)
      expect(store.sessions[0].id).toBe('session_abc')
      expect(store.activeSessionId).toBe('session_abc')
      expect(store.messages).toHaveLength(2)
    })

    it('handles empty instance with no sessions', async () => {
      const store = useCoworkSessionsStore()
      await store.hydrate('inst_empty')

      expect(store.sessions).toEqual([])
      expect(store.activeSessionId).toBeNull()
      expect(store.messages).toEqual([])
    })
  })

  describe('createSession', () => {
    it('creates session and writes index + file', async () => {
      const store = useCoworkSessionsStore()
      await store.hydrate('inst_1')

      const id = await store.createSession('My Session')

      expect(id).toMatch(/^session_/)
      expect(store.sessions).toHaveLength(1)
      expect(store.sessions[0].title).toBe('My Session')
      expect(store.activeSessionId).toBe(id)

      // Verify writeJson was called for index
      expect(localStorageService.writeJson).toHaveBeenCalledWith(
        'instances/inst_1/sessions/cowork/index.json',
        expect.any(Array)
      )
    })

    it('uses default title when none provided', async () => {
      const store = useCoworkSessionsStore()
      await store.hydrate('inst_1')

      await store.createSession()
      expect(store.sessions[0].title).toBe('New task')
    })

    it('throws if no active instance', async () => {
      const store = useCoworkSessionsStore()
      await expect(store.createSession()).rejects.toThrow('No active instance')
    })
  })

  describe('deleteSession', () => {
    it('moves session to archive and removes from index', async () => {
      // Seed a session
      const sessions = [
        { id: 'session_del', title: 'Delete me', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', messageCount: 1 },
      ]
      mockStore._store['instances/inst_1/sessions/cowork/index.json'] = JSON.stringify(sessions)
      mockStore._store['instances/inst_1/sessions/cowork/session_del.jsonl'] =
        '{"id":"msg_1","role":"user","content":"test","ts":"2026-01-01T00:00:00Z"}'

      const store = useCoworkSessionsStore()
      await store.hydrate('inst_1')

      await store.deleteSession('session_del')

      expect(store.sessions).toHaveLength(0)
      expect(store.activeSessionId).toBeNull()
      // Verify archive write
      expect(localStorageService.appendJsonl).toHaveBeenCalledWith(
        'instances/inst_1/sessions/cowork/.archive/session_del.jsonl',
        expect.objectContaining({ id: 'msg_1' })
      )
    })
  })

  describe('handleAgentEvent', () => {
    let store: ReturnType<typeof useCoworkSessionsStore>

    beforeEach(async () => {
      store = useCoworkSessionsStore()
      await store.hydrate('inst_1')
      await store.createSession('Test')
      store.markRunning(store.activeSessionId!)
    })

    it('text_chunk accumulates into assistant message', () => {
      store.handleAgentEvent({
        type: 'text_chunk',
        sessionId: store.activeSessionId!,
        data: { text: 'Hello' },
      })
      store.handleAgentEvent({
        type: 'text_chunk',
        sessionId: store.activeSessionId!,
        data: { text: ' world' },
      })

      const assistantMsgs = store.messages.filter((m) => m.role === 'assistant')
      expect(assistantMsgs).toHaveLength(1)
      expect(assistantMsgs[0].content).toBe('Hello world')
    })

    it('tool_call_start adds to toolCalls and messages', () => {
      store.handleAgentEvent({
        type: 'tool_call_start',
        sessionId: store.activeSessionId!,
        data: { id: 'tc_1', name: 'execute_workflow', args: { workflowId: '42' } },
      })

      expect(store.toolCalls).toHaveLength(1)
      expect(store.toolCalls[0]).toMatchObject({
        id: 'tc_1',
        name: 'execute_workflow',
        status: 'running',
      })
      expect(store.messages.some((m) => m.role === 'tool')).toBe(true)
    })

    it('tool_call_result updates tool call status', () => {
      store.handleAgentEvent({
        type: 'tool_call_start',
        sessionId: store.activeSessionId!,
        data: { id: 'tc_2', name: 'search_workflows', args: {} },
      })
      store.handleAgentEvent({
        type: 'tool_call_result',
        sessionId: store.activeSessionId!,
        data: { id: 'tc_2', name: 'search_workflows', result: { workflows: [] }, success: true },
      })

      expect(store.toolCalls[0].status).toBe('completed')
      expect(store.toolCalls[0].result).toEqual({ workflows: [] })
    })

    it('tool_call_result marks failed on success=false', () => {
      store.handleAgentEvent({
        type: 'tool_call_start',
        sessionId: store.activeSessionId!,
        data: { id: 'tc_3', name: 'create_workflow', args: {} },
      })
      store.handleAgentEvent({
        type: 'tool_call_result',
        sessionId: store.activeSessionId!,
        data: { id: 'tc_3', name: 'create_workflow', result: null, success: false, error: 'fail' },
      })

      expect(store.toolCalls[0].status).toBe('failed')
    })

    it('approval_required sets pendingApproval', () => {
      store.handleAgentEvent({
        type: 'tool_call_start',
        sessionId: store.activeSessionId!,
        data: { id: 'tc_4', name: 'publish_workflow', args: {} },
      })
      store.handleAgentEvent({
        type: 'approval_required',
        sessionId: store.activeSessionId!,
        data: { id: 'tc_4', toolName: 'publish_workflow', args: {}, description: 'Publish?' },
      })

      expect(store.pendingApproval).toBeTruthy()
      expect(store.pendingApproval!.toolName).toBe('publish_workflow')
      expect(store.toolCalls[0].status).toBe('awaiting_approval')
    })

    it('approval_resolved clears pending and updates tool call', () => {
      store.handleAgentEvent({
        type: 'tool_call_start',
        sessionId: store.activeSessionId!,
        data: { id: 'tc_5', name: 'publish_workflow', args: {} },
      })
      store.handleAgentEvent({
        type: 'approval_required',
        sessionId: store.activeSessionId!,
        data: { id: 'tc_5', toolName: 'publish_workflow', args: {}, description: 'Publish?' },
      })
      store.handleAgentEvent({
        type: 'approval_resolved',
        sessionId: store.activeSessionId!,
        data: { id: 'tc_5', decision: 'approve' },
      })

      expect(store.pendingApproval).toBeNull()
      expect(store.toolCalls[0].status).toBe('running')
    })

    it('a rejected tool call stays failed even when a success:true result follows', () => {
      // Deep Agents surfaces the rejection ToolMessage as a SUCCESSFUL tool
      // result ("The user rejected…" has no error status) — the card must not
      // flip from failed back to completed.
      store.handleAgentEvent({
        type: 'tool_call_start',
        sessionId: store.activeSessionId!,
        data: { id: 'tc_rej', name: 'execute_workflow', args: { workflowId: '42' } },
      })
      store.handleAgentEvent({
        type: 'approval_required',
        sessionId: store.activeSessionId!,
        data: { id: 'tc_rej', toolName: 'execute_workflow', args: {}, description: 'Run?' },
      })
      store.handleAgentEvent({
        type: 'approval_resolved',
        sessionId: store.activeSessionId!,
        data: { id: 'tc_rej', decision: 'reject' },
      })
      store.handleAgentEvent({
        type: 'tool_call_result',
        sessionId: store.activeSessionId!,
        data: { id: 'tc_rej', name: 'execute_workflow', result: 'The user rejected execute_workflow.', success: true },
      })

      expect(store.toolCalls[0].status).toBe('failed')
    })

    it('done(cancelled) after a reject clears running state and pendingApproval', () => {
      store.handleAgentEvent({
        type: 'approval_required',
        sessionId: store.activeSessionId!,
        data: { id: 'tc_c1', toolName: 'execute_workflow', args: {}, description: 'Run?' },
      })
      store.handleAgentEvent({
        type: 'done',
        sessionId: store.activeSessionId!,
        data: { reason: 'cancelled' },
      })

      expect(store.isAgentRunning).toBe(false)
      expect(store.pendingApproval).toBeNull()
    })

    it('error event adds system message but keeps the agent running until done', () => {
      // Non-terminal errors (e.g. MCP discovery failure) must not hide the
      // spinner/stop button — only the terminal `done` clears running state.
      store.handleAgentEvent({
        type: 'error',
        sessionId: store.activeSessionId!,
        data: { message: 'Something broke', code: 'ERR_500' },
      })

      expect(store.isAgentRunning).toBe(true)
      const sysMsg = store.messages.find((m) => m.role === 'system')
      expect(sysMsg).toBeTruthy()
      expect(sysMsg!.content).toBe('Something broke')

      store.handleAgentEvent({
        type: 'done',
        sessionId: store.activeSessionId!,
        data: { reason: 'error' },
      })
      expect(store.isAgentRunning).toBe(false)
    })

    it('done event stops agent running', () => {
      store.handleAgentEvent({
        type: 'done',
        sessionId: store.activeSessionId!,
        data: { reason: 'completed' },
      })

      expect(store.isAgentRunning).toBe(false)
    })
  })

  describe('reset', () => {
    it('clears all state', async () => {
      const store = useCoworkSessionsStore()
      await store.hydrate('inst_1')
      await store.createSession('Test')
      store.markRunning(store.activeSessionId!)

      store.reset()

      expect(store.sessions).toEqual([])
      expect(store.activeSessionId).toBeNull()
      expect(store.messages).toEqual([])
      expect(store.pendingApproval).toBeNull()
      expect(store.isAgentRunning).toBe(false)
      expect(store.toolCalls).toEqual([])
    })
  })
})
