import { ipcMain, BrowserWindow, safeStorage } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import type { AgentStreamEvent, AgentRunnerConfig, LlmProviderConfig } from '../agent/types'
import { type AgentRunner } from '../agent/types'
import { createAgentRunner, resolveLlmConfig } from '../agent/factory'
import { refreshTokens } from '../oauth'
import { pluginManager } from '../plugin-manager'
import { loadAllSkills, buildSkillDescriptions } from '../skill-loader'

const BASE_DIR = path.join(os.homedir(), '.n8n-desk')

/** Built-in n8n MCP tools that always require user approval before execution. */
const DESTRUCTIVE_TOOLS = [
  'create_workflow_from_code',
  'update_workflow',
  'publish_workflow',
  'archive_workflow',
  'execute_workflow',
]

// --- Active runners ---

interface ActiveRunner {
  sessionId: string
  runner: AgentRunner
  stopped: boolean
}

const activeRunners = new Map<string, ActiveRunner>()

// --- Helpers ---

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(content) as T
  } catch {
    return null
  }
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 })
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: 0o600 })
}

interface StoredTokens {
  access_token: string
  refresh_token: string
}

async function readTokens(instanceId: string): Promise<StoredTokens | null> {
  try {
    const filePath = path.join(BASE_DIR, 'instances', instanceId, 'tokens.enc')
    const data = await fs.readFile(filePath)

    let jsonStr: string
    if (safeStorage.isEncryptionAvailable()) {
      jsonStr = safeStorage.decryptString(data)
    } else {
      jsonStr = data.toString('utf-8')
    }

    return JSON.parse(jsonStr) as StoredTokens
  } catch {
    return null
  }
}

async function storeTokens(instanceId: string, accessToken: string, refreshToken: string): Promise<void> {
  const tokenData = JSON.stringify({ access_token: accessToken, refresh_token: refreshToken })
  const filePath = path.join(BASE_DIR, 'instances', instanceId, 'tokens.enc')
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 })

  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(tokenData)
    await fs.writeFile(filePath, encrypted, { mode: 0o600 })
  } else {
    await fs.writeFile(filePath, tokenData, { encoding: 'utf-8', mode: 0o600 })
  }
}

interface AuthMetadata {
  clientId: string
  scopes: string[]
  expiresAt: string
  userRole: string
  serverMetadata: {
    token_endpoint: string
    [key: string]: unknown
  }
  [key: string]: unknown
}

/**
 * Read the active instance config and get a valid access token.
 * Auto-refreshes the token if it has expired.
 * Returns instanceId alongside url/accessToken so callers can scope
 * plugin/server resolution to the correct instance.
 */
async function readActiveInstanceConfig(): Promise<{ instanceId: string; url: string; accessToken: string } | null> {
  const config = await readJson<{ defaultInstanceId?: string }>(path.join(BASE_DIR, 'config.json'))
  if (!config?.defaultInstanceId) return null

  const instanceId = config.defaultInstanceId
  const instance = await readJson<{ url: string }>(
    path.join(BASE_DIR, 'instances', instanceId, 'instance.json')
  )
  if (!instance?.url) return null

  // Read actual tokens from encrypted storage
  let tokens = await readTokens(instanceId)
  if (!tokens?.access_token) return null

  // Check if token is expired and refresh if needed
  const authMeta = await readJson<AuthMetadata>(
    path.join(BASE_DIR, 'instances', instanceId, 'auth.json')
  )
  if (authMeta?.expiresAt) {
    const expiresAt = new Date(authMeta.expiresAt).getTime()
    const now = Date.now()
    // Refresh if expired or within 60 seconds of expiry
    if (now >= expiresAt - 60_000) {
      try {
        console.log('[n8n-desk] Access token expired, refreshing...')
        const tokenResponse = await refreshTokens(
          authMeta.serverMetadata as Parameters<typeof refreshTokens>[0],
          authMeta.clientId,
          tokens.refresh_token,
        )
        // Store new tokens
        await storeTokens(instanceId, tokenResponse.access_token, tokenResponse.refresh_token)
        // Update expiry in auth.json
        authMeta.expiresAt = new Date(Date.now() + tokenResponse.expires_in * 1000).toISOString()
        await writeJson(path.join(BASE_DIR, 'instances', instanceId, 'auth.json'), authMeta)
        tokens = { access_token: tokenResponse.access_token, refresh_token: tokenResponse.refresh_token }
        console.log('[n8n-desk] Token refreshed successfully')
      } catch (err) {
        console.error('[n8n-desk] Token refresh failed:', err)
        // Return the expired token anyway — the MCP server will return 401
        // and the user will need to re-authenticate
      }
    }
  }

  console.log('[n8n-desk] Instance config loaded, token present:', !!tokens.access_token, 'length:', tokens.access_token.length)
  return {
    instanceId,
    url: instance.url,
    accessToken: tokens.access_token,
  }
}

/**
 * Extract workflow JSON from an MCP tool result, if present.
 * Tool results from create_workflow_from_code, get_workflow_details, validate_workflow, etc.
 * may contain workflow JSON with nodes and connections — either at the top level or nested.
 */
function extractWorkflowFromResult(result: unknown): { workflowId: string; name: string; workflow: Record<string, unknown> } | null {
  if (!result || typeof result !== 'object') {
    // Try parsing if it's a JSON string
    if (typeof result === 'string') {
      try {
        return extractWorkflowFromResult(JSON.parse(result))
      } catch {
        return null
      }
    }
    return null
  }

  // MCP content block array: [{ type: "text", text: "..." }]
  if (Array.isArray(result)) {
    for (const block of result) {
      if (block && typeof block === 'object' && (block as Record<string, unknown>).type === 'text') {
        const extracted = extractWorkflowFromResult((block as Record<string, unknown>).text)
        if (extracted) return extracted
      }
    }
    return null
  }

  const r = result as Record<string, unknown>

  // Direct shape: { nodes: [...], connections: {...} }
  if (Array.isArray(r.nodes) && r.connections) {
    return {
      workflowId: (r.id as string) ?? '',
      name: (r.name as string) ?? 'Workflow',
      workflow: r,
    }
  }

  // Nested: { workflow: { nodes: [...], connections: {...} } }
  if (typeof r.workflow === 'object' && r.workflow !== null) {
    const w = r.workflow as Record<string, unknown>
    if (Array.isArray(w.nodes)) {
      return {
        workflowId: (w.id as string) ?? '',
        name: (w.name as string) ?? 'Workflow',
        workflow: w,
      }
    }
  }

  // MCP result shape: { structuredContent: { workflow: { nodes, connections } } }
  if (typeof r.structuredContent === 'object' && r.structuredContent !== null) {
    return extractWorkflowFromResult(r.structuredContent)
  }

  // MCP result shape: { content: "stringified JSON" }
  if (typeof r.content === 'string' && !r.structuredContent) {
    try {
      return extractWorkflowFromResult(JSON.parse(r.content))
    } catch {
      // not JSON
    }
  }

  return null
}

async function appendToSessionJsonl(sessionId: string, event: AgentStreamEvent): Promise<void> {
  // Find the active instance to determine the JSONL path
  const config = await readJson<{ defaultInstanceId?: string }>(path.join(BASE_DIR, 'config.json'))
  if (!config?.defaultInstanceId) return

  const jsonlPath = path.join(
    BASE_DIR,
    'instances',
    config.defaultInstanceId,
    'sessions',
    'workflow',
    `${sessionId}.jsonl`
  )

  // Only persist message-producing events
  let message: Record<string, unknown> | null = null

  switch (event.type) {
    case 'text_chunk':
      // Text chunks are accumulated in the renderer; we persist the final message on 'done'
      break
    case 'tool_call_start':
      message = {
        id: `msg_${Date.now()}`,
        role: 'tool',
        content: '',
        ts: new Date().toISOString(),
        meta: { toolCallId: event.data.id, toolName: event.data.name, status: 'running' },
      }
      break
    case 'tool_call_result':
      message = {
        id: `msg_${Date.now()}`,
        role: 'tool',
        content: typeof event.data.result === 'string' ? event.data.result : JSON.stringify(event.data.result),
        ts: new Date().toISOString(),
        meta: {
          toolCallId: event.data.id,
          toolName: event.data.name,
          status: event.data.success ? 'completed' : 'failed',
          error: event.data.error,
        },
      }
      break
    case 'error':
      message = {
        id: `msg_${Date.now()}`,
        role: 'system',
        content: event.data.message,
        ts: new Date().toISOString(),
        meta: { error: true, code: event.data.code },
      }
      break
  }

  if (message) {
    try {
      await fs.mkdir(path.dirname(jsonlPath), { recursive: true })
      await fs.appendFile(jsonlPath, JSON.stringify(message) + '\n', 'utf-8')
    } catch {
      // Non-fatal — session file may not exist yet
    }
  }
}

async function testLlmConnection(config: LlmProviderConfig): Promise<{ success: boolean; error?: string }> {
  const provider = config.provider

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
      const ollamaUrl = config.baseUrl || 'http://localhost:11434'
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

  // The workflow agent system prompt
  const workflowSystemPrompt = `You are a workflow automation assistant for n8n. You help users create, manage, and execute n8n workflows using the available MCP tools. Be concise and helpful. When creating workflows, always validate before creating. When executing workflows, explain what will happen before running.`

  ipcMain.handle('agent:invoke', async (_event, sessionId: string, message: string) => {
    try {
      const llmConfig = await resolveLlmConfig()
      if (!llmConfig) {
        const errorEvent: AgentStreamEvent = {
          sessionId,
          type: 'error',
          data: { message: 'No LLM configuration found. Please configure an LLM provider in Settings.' },
        }
        mainWindow.webContents.send('agent:event', errorEvent)
        const doneEvent: AgentStreamEvent = { sessionId, type: 'done', data: { reason: 'error' } }
        mainWindow.webContents.send('agent:event', doneEvent)
        return { success: false, error: 'No LLM configuration' }
      }

      // Read instance config for MCP connection
      const instanceConfig = await readActiveInstanceConfig()
      if (!instanceConfig) {
        const errorEvent: AgentStreamEvent = {
          sessionId,
          type: 'error',
          data: { message: 'No active n8n instance configured. Please connect to an instance first.' },
        }
        mainWindow.webContents.send('agent:event', errorEvent)
        const doneEvent: AgentStreamEvent = { sessionId, type: 'done', data: { reason: 'error' } }
        mainWindow.webContents.send('agent:event', doneEvent)
        return { success: false, error: 'No active instance' }
      }

      // Stop existing runner for this session if any
      const existing = activeRunners.get(sessionId)
      if (existing) {
        await existing.runner.stop(sessionId)
        activeRunners.delete(sessionId)
      }

      // Determine backend based on LLM provider
      const backend = llmConfig.provider === 'anthropic' ? 'claude-sdk' : 'deep-agents'
      const runner = createAgentRunner(backend)

      const active: ActiveRunner = {
        sessionId,
        runner,
        stopped: false,
      }
      activeRunners.set(sessionId, active)

      // --- Plugin & Skill Integration ---

      const { instanceId } = instanceConfig

      // Build custom MCP server configs from plugins + standalone servers.
      // For Claude SDK: passed as customMcpServers (SDK handles tool discovery).
      // For Deep Agents: pre-built as LangChain tools via buildDeepAgentsTools.
      const customMcpServers = await pluginManager.buildClaudeSdkMcpServers(instanceId)
      const customTools = backend === 'deep-agents'
        ? await pluginManager.buildDeepAgentsTools(instanceId)
        : undefined

      // Load all skills and filter to auto-invocable ones.
      // Skills with disableModelInvocation=true are only invocable via /skill-name
      // in the chat input — they are not included in the system prompt.
      const allSkills = await loadAllSkills()
      const autoInvocableSkills = allSkills.filter((s) => !s.disableModelInvocation)

      // Inject skill descriptions into the system prompt (lazy loading:
      // only names + descriptions, NOT full content — expanded on invocation).
      const skillBlock = buildSkillDescriptions(autoInvocableSkills)
      const augmentedPrompt = skillBlock
        ? `${workflowSystemPrompt}\n\n${skillBlock}`
        : workflowSystemPrompt

      // Compute extended interruptOnTools: built-in destructive tools + all tools
      // from standalone servers that have requireApproval enabled.
      // Tool names are namespaced as {serverName}__{toolName} for consistency
      // with the Deep Agents tool naming convention.
      const approvalServerNames = await pluginManager.getApprovalRequiredServerNames(instanceId)
      const approvalToolNames: string[] = []

      for (const serverName of approvalServerNames) {
        const serverConfig = customMcpServers[serverName]
        if (!serverConfig) continue
        try {
          const discoveredTools = await pluginManager.discoverTools(
            serverConfig.url,
            serverConfig.headers,
          )
          for (const t of discoveredTools) {
            approvalToolNames.push(`${serverName}__${t.name}`)
          }
        } catch {
          // Server unreachable — skip, don't block agent startup.
          // Tools from this server won't work anyway.
        }
      }

      const interruptOnTools = [
        ...DESTRUCTIVE_TOOLS,
        ...approvalToolNames,
      ]

      const runnerConfig: AgentRunnerConfig = {
        instanceUrl: instanceConfig.url,
        accessToken: instanceConfig.accessToken,
        llmConfig,
        systemPrompt: augmentedPrompt,
        interruptOnTools,
        customMcpServers,
        customTools,
        skills: autoInvocableSkills,
      }

      // Run agent and stream events
      // Use an async IIFE so we don't block the IPC return
      void (async () => {
        try {
          for await (const event of runner.invoke(sessionId, message, runnerConfig)) {
            if (active.stopped) break
            mainWindow.webContents.send('agent:event', event)
            await appendToSessionJsonl(sessionId, event)

            // Auto-emit workflow preview when a tool result contains workflow JSON
            if (event.type === 'tool_call_result' && event.data.success) {
              const extracted = extractWorkflowFromResult(event.data.result)
              if (extracted) {
                const previewEvent: AgentStreamEvent = {
                  type: 'workflow_preview',
                  sessionId,
                  data: extracted,
                }
                mainWindow.webContents.send('agent:event', previewEvent)
              }
            }
          }
        } catch (err) {
          console.error('[n8n-desk agent error]', err)
          const errMessage = err instanceof Error ? err.message : String(err)
          const errorEvent: AgentStreamEvent = {
            sessionId,
            type: 'error',
            data: { message: errMessage },
          }
          mainWindow.webContents.send('agent:event', errorEvent)
          const doneEvent: AgentStreamEvent = { sessionId, type: 'done', data: { reason: 'error' } }
          mainWindow.webContents.send('agent:event', doneEvent)
        } finally {
          activeRunners.delete(sessionId)
        }
      })()

      return { success: true }
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : String(err)
      const errorEvent: AgentStreamEvent = {
        sessionId,
        type: 'error',
        data: { message: errMessage },
      }
      mainWindow.webContents.send('agent:event', errorEvent)
      const doneEvent: AgentStreamEvent = { sessionId, type: 'done', data: { reason: 'error' } }
      mainWindow.webContents.send('agent:event', doneEvent)
      activeRunners.delete(sessionId)
      return { success: false, error: errMessage }
    }
  })

  ipcMain.handle('agent:stop', async (_event, sessionId: string) => {
    const active = activeRunners.get(sessionId)
    if (active) {
      active.stopped = true
      await active.runner.stop(sessionId)
      activeRunners.delete(sessionId)
      const doneEvent: AgentStreamEvent = { sessionId, type: 'done', data: { reason: 'cancelled' } }
      mainWindow.webContents.send('agent:event', doneEvent)
    }
    return { success: true }
  })

  ipcMain.handle('agent:approve', async (_event, sessionId: string, decision: 'approve' | 'reject') => {
    const active = activeRunners.get(sessionId)
    if (!active) {
      return { success: false, error: 'No active runner for session' }
    }

    await active.runner.approve(sessionId, decision)

    const resolvedEvent: AgentStreamEvent = {
      sessionId,
      type: 'approval_resolved',
      data: { id: 'latest', decision },
    }
    mainWindow.webContents.send('agent:event', resolvedEvent)

    return { success: true }
  })

  ipcMain.handle('agent:test-connection', async () => {
    const llmConfig = await resolveLlmConfig()
    if (!llmConfig) {
      return { success: false, error: 'No LLM configuration found' }
    }
    return testLlmConnection(llmConfig)
  })
}
