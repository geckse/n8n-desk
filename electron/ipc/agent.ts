import { ipcMain, BrowserWindow, safeStorage } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import type { AgentStreamEvent, AgentRunnerConfig, LlmProviderConfig, ConversationMessage } from '../agent/types'
import { type AgentRunner } from '../agent/types'
import { createAgentRunner, resolveLlmConfig } from '../agent/factory'
import { refreshTokens } from '../oauth'
import { pluginManager } from '../plugin-manager'
import { loadAllSkills, buildSkillDescriptions } from '../skill-loader'
import { buildCoworkPolicy, buildWorkflowPolicy } from '../agent/sandbox-policy'
import { createFileTools } from '../agent/file-tools'
import { jsComputeTool } from '../agent/js-sandbox'
import { WORKFLOW_MODE_SYSTEM_PROMPT, COWORK_MODE_SYSTEM_PROMPT } from '../agent/system-prompts'
import { callToolWithUrl } from '../mcp-client'

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

type TokenKind = 'n8n' | 'mcp'

function tokensPath(instanceId: string, kind: TokenKind): string {
  const file = kind === 'n8n' ? 'tokens.enc' : 'mcp-tokens.enc'
  return path.join(BASE_DIR, 'instances', instanceId, file)
}

function authMetaPath(instanceId: string, kind: TokenKind): string {
  const file = kind === 'n8n' ? 'auth.json' : 'mcp-auth.json'
  return path.join(BASE_DIR, 'instances', instanceId, file)
}

async function readTokensFor(instanceId: string, kind: TokenKind): Promise<StoredTokens | null> {
  try {
    const data = await fs.readFile(tokensPath(instanceId, kind))

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

async function storeTokensFor(
  instanceId: string,
  kind: TokenKind,
  accessToken: string,
  refreshToken: string,
): Promise<void> {
  const tokenData = JSON.stringify({ access_token: accessToken, refresh_token: refreshToken })
  const filePath = tokensPath(instanceId, kind)
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
 * Load tokens for a given kind and refresh proactively if within 60s of expiry.
 * Returns the (possibly refreshed) access token or null if unavailable.
 */
async function loadAndRefresh(instanceId: string, kind: TokenKind): Promise<string | null> {
  let tokens = await readTokensFor(instanceId, kind)
  if (!tokens?.access_token) return null

  const authMeta = await readJson<AuthMetadata>(authMetaPath(instanceId, kind))
  if (authMeta?.expiresAt && authMeta.clientId && authMeta.serverMetadata) {
    const expiresAt = new Date(authMeta.expiresAt).getTime()
    const now = Date.now()
    if (now >= expiresAt - 60_000) {
      try {
        console.log(`[n8n-desk] ${kind} access token expired, refreshing...`)
        const tokenResponse = await refreshTokens(
          authMeta.serverMetadata as Parameters<typeof refreshTokens>[0],
          authMeta.clientId,
          tokens.refresh_token,
        )
        await storeTokensFor(instanceId, kind, tokenResponse.access_token, tokenResponse.refresh_token)
        authMeta.expiresAt = new Date(Date.now() + tokenResponse.expires_in * 1000).toISOString()
        await writeJson(authMetaPath(instanceId, kind), authMeta)
        tokens = { access_token: tokenResponse.access_token, refresh_token: tokenResponse.refresh_token }
        console.log(`[n8n-desk] ${kind} token refreshed successfully`)
      } catch (err) {
        console.error(`[n8n-desk] ${kind} token refresh failed:`, err)
        // Return the expired token anyway — the server will return 401 and the
        // renderer will surface the re-auth prompt.
      }
    }
  }

  return tokens.access_token
}

/** Thrown by readActiveInstanceConfig when a custom MCP URL is configured but not yet authorized. */
export class CustomMcpNotAuthorizedError extends Error {
  constructor(public readonly instanceId: string) {
    super('Custom MCP server is configured but not authorized. Sign in from Settings → Instances.')
    this.name = 'CustomMcpNotAuthorizedError'
  }
}

export interface ActiveInstanceConfig {
  instanceId: string
  url: string
  accessToken: string
  mcp: {
    url: string
    accessToken: string
    isCustom: boolean
  }
}

/**
 * Read the active instance config and resolve tokens for both the n8n instance
 * (REST + cookie context) and the MCP server (default: `${url}/mcp-server/http`
 * with the n8n OAuth token; custom: `mcpServerUrl` with its own OAuth token).
 *
 * Auto-refreshes both tokens if within 60s of expiry.
 *
 * Throws CustomMcpNotAuthorizedError when the instance has a `mcpServerUrl`
 * configured but no MCP tokens on disk — callers should emit an actionable
 * error event to the renderer.
 */
async function readActiveInstanceConfig(): Promise<ActiveInstanceConfig | null> {
  const config = await readJson<{ defaultInstanceId?: string }>(path.join(BASE_DIR, 'config.json'))
  if (!config?.defaultInstanceId) return null

  const instanceId = config.defaultInstanceId
  const instance = await readJson<{ url: string; mcpServerUrl?: string }>(
    path.join(BASE_DIR, 'instances', instanceId, 'instance.json')
  )
  if (!instance?.url) return null

  const n8nAccessToken = await loadAndRefresh(instanceId, 'n8n')
  if (!n8nAccessToken) return null

  let mcpUrl: string
  let mcpAccessToken: string
  let isCustom = false

  if (instance.mcpServerUrl) {
    const customMcpToken = await loadAndRefresh(instanceId, 'mcp')
    if (!customMcpToken) {
      throw new CustomMcpNotAuthorizedError(instanceId)
    }
    mcpUrl = instance.mcpServerUrl.replace(/\/+$/, '')
    mcpAccessToken = customMcpToken
    isCustom = true
  } else {
    mcpUrl = `${instance.url.replace(/\/+$/, '')}/mcp-server/http`
    mcpAccessToken = n8nAccessToken
  }

  console.log('[n8n-desk] Instance config loaded, mcp.isCustom:', isCustom, 'mcp.url:', mcpUrl)
  return {
    instanceId,
    url: instance.url,
    accessToken: n8nAccessToken,
    mcp: {
      url: mcpUrl,
      accessToken: mcpAccessToken,
      isCustom,
    },
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

/** Tools whose results contain workflow metadata (workflowId) but NOT full workflow JSON. */
const WORKFLOW_METADATA_TOOLS = [
  'create_workflow_from_code',
  'update_workflow',
]

/**
 * Check if a tool name matches one of the workflow metadata tools.
 * Handles both bare names ('create_workflow_from_code') and MCP-namespaced
 * names ('mcp__n8n__create_workflow_from_code') from the Claude Agent SDK.
 */
function isWorkflowMetadataTool(toolName: string): boolean {
  return WORKFLOW_METADATA_TOOLS.some((t) => toolName === t || toolName.endsWith(`__${t}`))
}

/**
 * Extract workflowId and name from an MCP tool result that contains only metadata.
 * Works for create_workflow_from_code / update_workflow which return
 * { content: "...", structuredContent: { workflowId, name, ... } }.
 */
function extractWorkflowMetadata(result: unknown): { workflowId: string; name: string } | null {
  if (!result || typeof result !== 'object') {
    if (typeof result === 'string') {
      try { return extractWorkflowMetadata(JSON.parse(result)) } catch { return null }
    }
    return null
  }

  // MCP content block array: [{ type: "text", text: "..." }]
  if (Array.isArray(result)) {
    for (const block of result) {
      if (block && typeof block === 'object' && (block as Record<string, unknown>).type === 'text') {
        const extracted = extractWorkflowMetadata((block as Record<string, unknown>).text)
        if (extracted) return extracted
      }
    }
    return null
  }

  const r = result as Record<string, unknown>

  // Direct: { workflowId: "...", name: "..." }
  if (typeof r.workflowId === 'string' && r.workflowId) {
    return { workflowId: r.workflowId, name: (r.name as string) ?? 'Workflow' }
  }

  // Nested: { structuredContent: { workflowId: "...", name: "..." } }
  if (typeof r.structuredContent === 'object' && r.structuredContent !== null) {
    return extractWorkflowMetadata(r.structuredContent)
  }

  // Content string: { content: "stringified JSON" }
  if (typeof r.content === 'string') {
    try { return extractWorkflowMetadata(JSON.parse(r.content)) } catch { /* not JSON */ }
  }

  return null
}

/**
 * Fetch full workflow JSON via the MCP server's get_workflow_details tool.
 * Uses the resolved MCP URL + MCP OAuth token (default n8n MCP or custom).
 */
async function fetchWorkflowViaMcp(
  mcpUrl: string,
  mcpAccessToken: string,
  workflowId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const result = await callToolWithUrl(
      mcpUrl,
      { Authorization: `Bearer ${mcpAccessToken}` },
      'get_workflow_details',
      { workflowId },
    )

    // MCP result: { content: [{ type: "text", text: "..." }] }
    if (result.isError) {
      console.warn(`[n8n-desk] MCP get_workflow_details returned error for ${workflowId}`)
      return null
    }

    // Extract the text content and parse it
    for (const block of result.content) {
      if (block.type === 'text' && block.text) {
        try {
          const parsed = JSON.parse(block.text) as Record<string, unknown>
          // The response may contain the workflow directly or nested
          if (Array.isArray(parsed.nodes) && parsed.connections) {
            return parsed
          }
          // Or wrapped in a workflow key
          if (typeof parsed.workflow === 'object' && parsed.workflow !== null) {
            const w = parsed.workflow as Record<string, unknown>
            if (Array.isArray(w.nodes)) return w
          }
          // Some responses have the full workflow at top level with id/name/nodes
          if (parsed.id && parsed.name && Array.isArray(parsed.nodes)) {
            return parsed
          }
        } catch {
          // Not JSON — skip this block
        }
      }
    }

    console.warn(`[n8n-desk] Could not extract workflow JSON from MCP response for ${workflowId}`)
    return null
  } catch (err) {
    console.warn('[n8n-desk] Error fetching workflow via MCP:', err)
    return null
  }
}

/**
 * Read session JSONL and build conversation history for multi-turn memory.
 * Returns messages in chronological order, combining text chunks into
 * complete assistant messages.
 *
 * @param sessionId - The session ID
 * @param mode - The agent mode ('workflow' | 'cowork'), determines session directory
 */
async function loadConversationHistory(
  sessionId: string,
  mode: 'workflow' | 'cowork' = 'workflow',
): Promise<ConversationMessage[]> {
  const config = await readJson<{ defaultInstanceId?: string }>(path.join(BASE_DIR, 'config.json'))
  if (!config?.defaultInstanceId) return []

  const jsonlPath = path.join(
    BASE_DIR,
    'instances',
    config.defaultInstanceId,
    'sessions',
    mode,
    `${sessionId}.jsonl`,
  )

  try {
    const content = await fs.readFile(jsonlPath, 'utf-8')
    const lines = content.trim().split('\n').filter(Boolean)
    const history: ConversationMessage[] = []

    for (const line of lines) {
      try {
        const msg = JSON.parse(line) as { role?: string; content?: string }
        if (!msg.role || !msg.content) continue

        if (msg.role === 'user') {
          history.push({ role: 'user', content: msg.content })
        } else if (msg.role === 'assistant' && msg.content) {
          history.push({ role: 'assistant', content: msg.content })
        }
        // Skip tool messages — the agent sees tool results via MCP, not via history
      } catch {
        // Skip malformed lines
      }
    }

    return history
  } catch {
    return [] // File doesn't exist yet (first message in session)
  }
}

// NOTE: Session JSONL persistence is handled entirely by the renderer's Pinia
// store (workflow-sessions / cowork-sessions). The backend does NOT write to
// JSONL to avoid duplicate messages.

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

  /** Options passed from the renderer alongside sessionId and message. */
  interface AgentInvokeOptions {
    /** Folders the user has attached to this session */
    attachedFolders?: Array<{ path: string }>
    /** Individual files the user has attached to this message */
    attachedFiles?: string[]
    /** Agent mode — determines sandbox policy, system prompt, and session path */
    mode?: 'workflow' | 'cowork'
  }

  ipcMain.handle('agent:invoke', async (_event, sessionId: string, message: string, options?: AgentInvokeOptions) => {
    const mode = options?.mode ?? 'workflow'
    const attachedFolders = options?.attachedFolders ?? []
    const attachedFiles = options?.attachedFiles ?? []
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
      let instanceConfig: ActiveInstanceConfig | null
      try {
        instanceConfig = await readActiveInstanceConfig()
      } catch (err) {
        if (err instanceof CustomMcpNotAuthorizedError) {
          const errorEvent: AgentStreamEvent = {
            sessionId,
            type: 'error',
            data: {
              message: 'Custom MCP server is configured but not authorized. Open Settings → Instances to sign in.',
              code: 'CUSTOM_MCP_NOT_AUTHORIZED',
            },
          }
          mainWindow.webContents.send('agent:event', errorEvent)
          const doneEvent: AgentStreamEvent = { sessionId, type: 'done', data: { reason: 'error' } }
          mainWindow.webContents.send('agent:event', doneEvent)
          return { success: false, error: 'Custom MCP not authorized' }
        }
        throw err
      }
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

      // --- Sandbox Policy & File Tools ---

      // Build per-session sandbox policy based on mode and attached folders.
      // If no folders are attached, the policy still grants read access to
      // ~/.n8n-desk/ (minus sensitive files) and write access to skills/.
      //
      // Individually attached files: add their parent directories as read-only
      // mounts so the agent can read them. The agent is told the exact paths
      // in the system prompt — it won't browse the parent dirs randomly.
      const fileFolderMounts = attachedFiles.map((fp) => ({
        path: path.dirname(fp),
      }))
      // Deduplicate: merge file parent dirs with explicit folder mounts
      const allMountFolders = [...attachedFolders]
      for (const fm of fileFolderMounts) {
        if (!allMountFolders.some((f) => f.path === fm.path)) {
          allMountFolders.push(fm)
        }
      }

      const sandboxPolicy = mode === 'cowork'
        ? buildCoworkPolicy(allMountFolders, BASE_DIR)
        : buildWorkflowPolicy(allMountFolders, BASE_DIR)

      // Create sandboxed file tools (13 format tools) and include jsComputeTool.
      // These are always available — they do NOT require approval.
      const fileTools = createFileTools(sandboxPolicy)

      // --- Plugin & Skill Integration ---

      const { instanceId } = instanceConfig

      // Build custom MCP server configs from plugins + standalone servers.
      // For Claude SDK: passed as customMcpServers (SDK handles tool discovery).
      // For Deep Agents: pre-built as LangChain tools via buildDeepAgentsTools.
      const customMcpServers = await pluginManager.buildClaudeSdkMcpServers(instanceId)
      const pluginTools = backend === 'deep-agents'
        ? await pluginManager.buildDeepAgentsTools(instanceId)
        : undefined

      // Merge file tools + jsComputeTool + plugin tools into a single array.
      // File tools and jsComputeTool are always included; plugin tools are
      // only included for the Deep Agents backend (Claude SDK uses MCP servers).
      const customTools = [
        ...fileTools,
        jsComputeTool,
        ...(pluginTools ?? []),
      ]

      // Load all skills and filter to auto-invocable ones.
      // Skills with disableModelInvocation=true are only invocable via /skill-name
      // in the chat input — they are not included in the system prompt.
      const allSkills = await loadAllSkills()
      const autoInvocableSkills = allSkills.filter((s) => !s.disableModelInvocation)

      // Select mode-specific system prompt
      const baseSystemPrompt = mode === 'cowork'
        ? COWORK_MODE_SYSTEM_PROMPT
        : WORKFLOW_MODE_SYSTEM_PROMPT

      // Inject attached folder and file paths into the system prompt so the
      // agent knows which resources are available for file tools.
      let contextBlock = ''
      if (attachedFolders.length > 0) {
        const folderList = attachedFolders
          .map((f) => `- ${f.path}`)
          .join('\n')
        contextBlock += `\n\n## Attached Project Folders\nThe user has attached the following folders to this session. You can use list_files, search_files, and all read/write tools on files inside these folders.\n${folderList}\n\nStart by using list_files to see what is in each folder when the user asks about their files.`
      }
      if (attachedFiles.length > 0) {
        const fileList = attachedFiles
          .map((f) => `- ${f}`)
          .join('\n')
        contextBlock += `\n\n## Attached Files\nThe user has attached these files directly. You can read them immediately with the appropriate read tool (read_excel, read_csv, read_pdf, etc.).\n${fileList}`
      }

      // Inject skill descriptions into the system prompt (lazy loading:
      // only names + descriptions, NOT full content — expanded on invocation).
      const skillBlock = buildSkillDescriptions(autoInvocableSkills)
      const augmentedPrompt = baseSystemPrompt
        + contextBlock
        + (skillBlock ? `\n\n${skillBlock}` : '')

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

      // Load conversation history for multi-turn memory
      const conversationHistory = await loadConversationHistory(sessionId, mode)
      console.log(`[n8n-desk] Loaded ${conversationHistory.length} messages from session history`)

      const runnerConfig: AgentRunnerConfig = {
        instanceUrl: instanceConfig.url,
        accessToken: instanceConfig.accessToken,
        mcpUrl: instanceConfig.mcp.url,
        mcpAccessToken: instanceConfig.mcp.accessToken,
        llmConfig,
        systemPrompt: augmentedPrompt,
        interruptOnTools,
        customMcpServers,
        customTools,
        skills: autoInvocableSkills,
        conversationHistory,
        sandboxPolicy,
      }

      console.log('[n8n-desk] System prompt:\n', augmentedPrompt)

      // Run agent and stream events
      // Use an async IIFE so we don't block the IPC return
      void (async () => {
        try {
          for await (const event of runner.invoke(sessionId, message, runnerConfig)) {
            if (active.stopped) break
            mainWindow.webContents.send('agent:event', event)
            // NOTE: Session messages are persisted by the renderer's Pinia store
            // (via persistMessage). Do NOT also persist here — that causes duplicates.

            // Auto-emit workflow preview when a tool result contains workflow JSON
            if (event.type === 'tool_call_result' && event.data.success) {
              console.log(`[n8n-desk] tool_call_result: name=${event.data.name}, id=${event.data.id}`)

              // First: try to extract full workflow JSON directly from the result
              const extracted = extractWorkflowFromResult(event.data.result)
              if (extracted) {
                console.log(`[n8n-desk] Extracted workflow directly: ${extracted.workflowId}`)
                const previewEvent: AgentStreamEvent = {
                  type: 'workflow_preview',
                  sessionId,
                  data: { ...extracted, toolCallId: event.data.id },
                }
                mainWindow.webContents.send('agent:event', previewEvent)
              } else {
                // No full workflow in result — check if it contains workflow metadata
                // (workflowId). This handles create_workflow_from_code and update_workflow
                // which return only metadata. We also try this as a fallback regardless
                // of tool name, since the Claude SDK may not always provide the name.
                const meta = extractWorkflowMetadata(event.data.result)
                if (meta) {
                  console.log(`[n8n-desk] Found workflow metadata in tool result (tool=${event.data.name}): workflowId=${meta.workflowId}`)
                  void fetchWorkflowViaMcp(
                    instanceConfig.mcp.url,
                    instanceConfig.mcp.accessToken,
                    meta.workflowId,
                  ).then((workflow) => {
                    if (!workflow || active.stopped) return
                    console.log(`[n8n-desk] Fetched workflow ${meta.workflowId} for preview (${Array.isArray((workflow as Record<string, unknown>).nodes) ? ((workflow as Record<string, unknown>).nodes as unknown[]).length : '?'} nodes)`)
                    const previewEvent: AgentStreamEvent = {
                      type: 'workflow_preview',
                      sessionId,
                      data: {
                        toolCallId: event.data.id,
                        workflowId: meta.workflowId,
                        name: meta.name,
                        workflow,
                      },
                    }
                    mainWindow.webContents.send('agent:event', previewEvent)
                  }).catch((err) => {
                    console.error(`[n8n-desk] Failed to fetch workflow for preview:`, err)
                  })
                }
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
