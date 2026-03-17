import { ipcMain, BrowserWindow } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'

const BASE_DIR = path.join(os.homedir(), '.n8n-desk')

// --- Types (mirrored from src/types/agent for Electron main process) ---

interface AgentEvent {
  sessionId: string
  type: 'text_chunk' | 'tool_call_start' | 'tool_call_result' | 'approval_required' | 'approval_resolved' | 'todo_update' | 'error' | 'done'
  data: Record<string, unknown>
}

interface LlmConfig {
  provider?: string
  model?: string
  apiKey?: string
  ollamaUrl?: string
}

interface AgentRunner {
  sessionId: string
  stopped: boolean
  approvalResolvers: Map<string, (decision: 'approve' | 'reject') => void>
  stop(): void
}

// --- Active runners ---

const activeRunners = new Map<string, AgentRunner>()

// --- Helpers ---

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(content) as T
  } catch {
    return null
  }
}

async function readLlmConfig(): Promise<LlmConfig | null> {
  return readJson<LlmConfig>(path.join(BASE_DIR, 'llm.json'))
}

async function testLlmConnection(config: LlmConfig): Promise<{ success: boolean; error?: string }> {
  const provider = config.provider || 'ollama'

  try {
    if (provider === 'anthropic') {
      if (!config.apiKey) return { success: false, error: 'No Anthropic API key configured' }
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: config.model || 'claude-sonnet-4-6',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        }),
      })
      if (res.status === 401) return { success: false, error: 'Invalid Anthropic API key' }
      return { success: res.ok }
    } else if (provider === 'openai') {
      if (!config.apiKey) return { success: false, error: 'No OpenAI API key configured' }
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${config.apiKey}` },
      })
      if (res.status === 401) return { success: false, error: 'Invalid OpenAI API key' }
      return { success: res.ok }
    } else if (provider === 'ollama') {
      const ollamaUrl = config.ollamaUrl || 'http://localhost:11434'
      const res = await fetch(`${ollamaUrl}/api/tags`)
      return { success: res.ok }
    }
    return { success: false, error: `Unknown provider: ${provider}` }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, error: `Connection failed: ${message}` }
  }
}

// --- IPC Handlers ---

let handlersRegistered = false

export function registerAgentHandlers(mainWindow: BrowserWindow): void {
  if (handlersRegistered) return
  handlersRegistered = true

  ipcMain.handle('agent:invoke', async (_event, sessionId: string, message: string) => {
    try {
      const llmConfig = await readLlmConfig()
      if (!llmConfig) {
        const errorEvent: AgentEvent = {
          sessionId,
          type: 'error',
          data: { message: 'No LLM configuration found. Please configure an LLM provider in Settings.' },
        }
        mainWindow.webContents.send('agent:event', errorEvent)
        const doneEvent: AgentEvent = { sessionId, type: 'done', data: { reason: 'error' } }
        mainWindow.webContents.send('agent:event', doneEvent)
        return { success: false, error: 'No LLM configuration' }
      }

      // Stop existing runner for this session if any
      const existingRunner = activeRunners.get(sessionId)
      if (existingRunner) {
        existingRunner.stop()
        activeRunners.delete(sessionId)
      }

      // Create runner
      const runner: AgentRunner = {
        sessionId,
        stopped: false,
        approvalResolvers: new Map(),
        stop() {
          this.stopped = true
          for (const [, resolver] of this.approvalResolvers) {
            resolver('reject')
          }
          this.approvalResolvers.clear()
        },
      }
      activeRunners.set(sessionId, runner)

      // TODO: Replace with actual Deep Agents SDK integration
      // The full implementation will:
      // 1. Create a deep agent via createDeepAgent() with tools based on session mode
      // 2. Iterate async events from runner.stream()
      // 3. Send each event to renderer via mainWindow.webContents.send('agent:event', event)
      // 4. Append events to JSONL session file
      if (!runner.stopped) {
        const textEvent: AgentEvent = {
          sessionId,
          type: 'text_chunk',
          data: { text: `Agent received: "${message}". Deep Agents SDK integration pending.` },
        }
        mainWindow.webContents.send('agent:event', textEvent)
      }

      if (!runner.stopped) {
        const doneEvent: AgentEvent = { sessionId, type: 'done', data: { reason: 'completed' } }
        mainWindow.webContents.send('agent:event', doneEvent)
      }

      activeRunners.delete(sessionId)
      return { success: true }
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : String(err)
      const errorEvent: AgentEvent = {
        sessionId,
        type: 'error',
        data: { message: errMessage },
      }
      mainWindow.webContents.send('agent:event', errorEvent)
      const doneEvent: AgentEvent = { sessionId, type: 'done', data: { reason: 'error' } }
      mainWindow.webContents.send('agent:event', doneEvent)
      activeRunners.delete(sessionId)
      return { success: false, error: errMessage }
    }
  })

  ipcMain.handle('agent:stop', async (_event, sessionId: string) => {
    const runner = activeRunners.get(sessionId)
    if (runner) {
      runner.stop()
      activeRunners.delete(sessionId)
      const doneEvent: AgentEvent = { sessionId, type: 'done', data: { reason: 'cancelled' } }
      mainWindow.webContents.send('agent:event', doneEvent)
    }
    return { success: true }
  })

  ipcMain.handle('agent:approve', async (_event, sessionId: string, decision: 'approve' | 'reject') => {
    const runner = activeRunners.get(sessionId)
    if (!runner) {
      return { success: false, error: 'No active runner for session' }
    }

    // Resolve the most recent pending approval
    const entries = Array.from(runner.approvalResolvers.entries())
    const approvalId = entries.length > 0 ? entries[0][0] : 'unknown'
    if (entries.length > 0) {
      const [, resolver] = entries[0]
      resolver(decision)
      runner.approvalResolvers.delete(entries[0][0])
    }

    const resolvedEvent: AgentEvent = {
      sessionId,
      type: 'approval_resolved',
      data: { id: approvalId, decision },
    }
    mainWindow.webContents.send('agent:event', resolvedEvent)

    return { success: true }
  })

  ipcMain.handle('agent:test-connection', async () => {
    const llmConfig = await readLlmConfig()
    if (!llmConfig) {
      return { success: false, error: 'No LLM configuration found' }
    }
    return testLlmConnection(llmConfig)
  })
}
