import { ipcMain, BrowserWindow, safeStorage } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import type { AgentStreamEvent, AgentRunnerConfig, LlmProviderConfig, ConversationMessage } from '../agent/types'
import { type AgentRunner } from '../agent/types'
import { createAgentRunner, resolveLlmConfig, LlmConfigError } from '../agent/factory'
import { buildConversationHistory, parseSessionJsonl } from '../agent/conversation-history'
import { refreshTokens } from '../oauth'
import { pluginManager } from '../plugin-manager'
import { loadAllSkills, buildSkillDescriptions } from '../skill-loader'
import { buildCoworkPolicy, buildWorkflowPolicy } from '../agent/sandbox-policy'
import { WORKFLOW_MODE_SYSTEM_PROMPT, COWORK_MODE_SYSTEM_PROMPT } from '../agent/system-prompts'
import { callToolWithUrl, listToolsWithUrl, McpUnauthorizedError } from '../mcp-client'
import { DESTRUCTIVE_TOOLS, COWORK_DENIED_TOOLS, type ApprovalDecision } from '../agent/approval'
import { sanitizeAnswers } from '../agent/ask-user-question'
import { readAlwaysAllowPresets } from '../agent/approval-presets'

const BASE_DIR = path.join(os.homedir(), '.n8n-desk')

// --- Active runners ---

interface ActiveRunner {
  sessionId: string
  runner: AgentRunner
  stopped: boolean
}

const activeRunners = new Map<string, ActiveRunner>()

// --- Per-session "always allow" grants (approve_always) ---
//
// Keyed by sessionId, holding canonical tool names. The SAME Set instance is
// passed into runnerConfig on every invoke — runners mutate it when the user
// picks "Always allow this session", and because runners are recreated per
// invoke, this map (not the runner) is what carries the grant across turns.
// LRU-capped: session ids are random and never reused, so stale entries are
// only a memory concern.

const sessionAllowedTools = new Map<string, Set<string>>()
const MAX_SESSION_ALLOW_SETS = 100

function getSessionAllowSet(sessionId: string): Set<string> {
  const existing = sessionAllowedTools.get(sessionId)
  if (existing) {
    // Re-insert for LRU ordering
    sessionAllowedTools.delete(sessionId)
    sessionAllowedTools.set(sessionId, existing)
    return existing
  }
  const created = new Set<string>()
  sessionAllowedTools.set(sessionId, created)
  while (sessionAllowedTools.size > MAX_SESSION_ALLOW_SETS) {
    const oldest = sessionAllowedTools.keys().next().value
    if (oldest === undefined) break
    sessionAllowedTools.delete(oldest)
  }
  return created
}

// --- Renderer event delivery ---

/**
 * Live window accessor (audit #15). Handlers register once for the app's
 * lifetime, but on macOS the window is destroyed on close and recreated on
 * dock-activate — a captured BrowserWindow reference would keep sending
 * events to the destroyed instance. Resolve the CURRENT window per send.
 */
let getWindow: () => BrowserWindow | null = () => null

function sendAgentEvent(event: AgentStreamEvent): void {
  const win = getWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send('agent:event', event)
  }
}

/**
 * Stop every active runner and emit terminal `done { cancelled }` events.
 * Called on instance switch (audit #21) — agent sessions must never keep
 * running against the previous instance's MCP server and tokens.
 */
export async function stopAllAgentRunners(): Promise<void> {
  const entries = [...activeRunners.values()]
  activeRunners.clear()
  // Session approve_always grants do not survive an instance switch — the
  // persistent presets are per-instance, and session grants follow suit.
  sessionAllowedTools.clear()
  await Promise.all(entries.map(async (active) => {
    active.stopped = true
    try {
      await active.runner.stop(active.sessionId)
    } catch (err) {
      console.error(`[n8n-desk] Failed to stop runner for ${active.sessionId}:`, err)
    }
    sendAgentEvent({ sessionId: active.sessionId, type: 'done', data: { reason: 'cancelled' } })
  }))
}

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
 * Force-refresh the stored tokens for an instance/kind regardless of expiry.
 * Returns the new access token, or null when refresh is impossible/failed
 * (callers surface a re-auth prompt). Also used mid-session on 401 (audit #41).
 */
async function refreshStoredTokens(instanceId: string, kind: TokenKind): Promise<string | null> {
  const tokens = await readTokensFor(instanceId, kind)
  if (!tokens?.refresh_token) return null

  const authMeta = await readJson<AuthMetadata>(authMetaPath(instanceId, kind))
  if (!authMeta?.clientId || !authMeta.serverMetadata) return null

  try {
    console.log(`[n8n-desk] Refreshing ${kind} access token...`)
    const tokenResponse = await refreshTokens(
      authMeta.serverMetadata as unknown as Parameters<typeof refreshTokens>[0],
      authMeta.clientId,
      tokens.refresh_token,
    )
    await storeTokensFor(instanceId, kind, tokenResponse.access_token, tokenResponse.refresh_token)
    authMeta.expiresAt = new Date(Date.now() + tokenResponse.expires_in * 1000).toISOString()
    await writeJson(authMetaPath(instanceId, kind), authMeta)
    console.log(`[n8n-desk] ${kind} token refreshed successfully`)
    return tokenResponse.access_token
  } catch (err) {
    console.error(`[n8n-desk] ${kind} token refresh failed:`, err)
    return null
  }
}

/**
 * Load tokens for a given kind and refresh proactively if within 60s of expiry.
 * Returns the (possibly refreshed) access token or null if unavailable.
 */
async function loadAndRefresh(instanceId: string, kind: TokenKind): Promise<string | null> {
  const tokens = await readTokensFor(instanceId, kind)
  if (!tokens?.access_token) return null

  const authMeta = await readJson<AuthMetadata>(authMetaPath(instanceId, kind))
  if (authMeta?.expiresAt && authMeta.clientId && authMeta.serverMetadata) {
    const expiresAt = new Date(authMeta.expiresAt).getTime()
    if (Date.now() >= expiresAt - 60_000) {
      const refreshed = await refreshStoredTokens(instanceId, kind)
      if (refreshed) return refreshed
      // Fall through with the expired token — the server will return 401 and
      // the renderer will surface the re-auth prompt.
    }
  }

  return tokens.access_token
}

/** Result of the agent:mcp-status health check. */
export interface McpStatusResult {
  status: 'connected' | 'unauthorized' | 'unreachable' | 'not-configured'
  toolCount?: number
  isCustom?: boolean
  instanceId?: string
  error?: string
}

/** Health checks should fail fast — don't hold the banner for the full 30s list timeout. */
const MCP_STATUS_TIMEOUT_MS = 10_000

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
 * Read session JSONL and build faithful conversation history for multi-turn
 * memory (audit #18): assistant text segments AND tool calls/results are
 * folded into alternating user/assistant messages so identifiers created in
 * earlier turns (workflow IDs, execution IDs) survive.
 *
 * @param sessionId - The session ID
 * @param mode - The agent mode ('workflow' | 'cowork'), determines session directory
 * @param currentMessage - The message being sent right now. The renderer persists
 *   it to JSONL before invoking, so it must be dropped from the history block —
 *   otherwise the runners feed it to the model twice (history + prompt).
 */
async function loadConversationHistory(
  sessionId: string,
  mode: 'workflow' | 'cowork' = 'workflow',
  currentMessage?: string,
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
    return buildConversationHistory(parseSessionJsonl(content), currentMessage)
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
      if (!res.ok) return { success: false, error: `Ollama server responded with ${res.status}` }
      // Many Ollama models cannot tool-call — surface that here instead of
      // as a cryptic provider error mid-session (audit #28).
      const { checkOllamaToolSupport } = await import('../agent/ollama-capabilities')
      const support = await checkOllamaToolSupport(config.baseUrl, config.model)
      if (support.supported === false) {
        return { success: false, error: support.detail }
      }
      return { success: true }
    }
    return { success: false, error: `Unknown provider: ${provider}` }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, error: `Connection failed: ${message}` }
  }
}

// --- IPC Handlers ---

let handlersRegistered = false

/**
 * Register agent IPC handlers ONCE for the app lifetime.
 *
 * Takes a window ACCESSOR, not a window: events must always go to the
 * current window, or a macOS close/reopen would leave Cowork/Workflow modes
 * silently dead (events sent to the destroyed window — audit #15).
 */
export function registerAgentHandlers(getMainWindow: () => BrowserWindow | null): void {
  getWindow = getMainWindow
  if (handlersRegistered) return
  handlersRegistered = true

  /** Options passed from the renderer alongside sessionId and message. */
  interface AgentInvokeOptions {
    /**
     * Folders the user has attached to this session.
     * `mode` is the user-chosen access level — it MUST be honored when
     * building sandbox mounts (dropping it silently grants read-write).
     */
    attachedFolders?: Array<{ path: string; label?: string; mode?: 'ro' | 'rw' }>
    /** Individual files the user has attached to this message */
    attachedFiles?: string[]
    /** Agent mode — determines sandbox policy, system prompt, and session path */
    mode?: 'workflow' | 'cowork'
  }

  ipcMain.handle('agent:invoke', async (_event, sessionId: string, message: string, options?: AgentInvokeOptions) => {
    const mode = options?.mode ?? 'workflow'
    const attachedFolders = options?.attachedFolders ?? []
    const attachedFiles = options?.attachedFiles ?? []
    // Hoisted so the catch block can identity-check before cleanup
    let invokeActive: ActiveRunner | undefined
    try {
      // Invalid backend/provider combinations (hand-edited llm.json, stale
      // settings) throw LlmConfigError with an actionable message — surface
      // it instead of a generic failure.
      let llmConfig: Awaited<ReturnType<typeof resolveLlmConfig>>
      try {
        llmConfig = await resolveLlmConfig()
      } catch (err) {
        if (err instanceof LlmConfigError) {
          sendAgentEvent({ sessionId, type: 'error', data: { message: err.message, code: 'LLM_CONFIG_INVALID' } })
          sendAgentEvent({ sessionId, type: 'done', data: { reason: 'error' } })
          return { success: false, error: err.message }
        }
        throw err
      }
      if (!llmConfig) {
        const errorEvent: AgentStreamEvent = {
          sessionId,
          type: 'error',
          data: { message: 'No LLM configuration found. Please configure an LLM provider in Settings.' },
        }
        sendAgentEvent(errorEvent)
        const doneEvent: AgentStreamEvent = { sessionId, type: 'done', data: { reason: 'error' } }
        sendAgentEvent(doneEvent)
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
          sendAgentEvent(errorEvent)
          const doneEvent: AgentStreamEvent = { sessionId, type: 'done', data: { reason: 'error' } }
          sendAgentEvent(doneEvent)
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
        sendAgentEvent(errorEvent)
        const doneEvent: AgentStreamEvent = { sessionId, type: 'done', data: { reason: 'error' } }
        sendAgentEvent(doneEvent)
        return { success: false, error: 'No active instance' }
      }

      // Stop existing runner for this session if any. Mark it stopped FIRST so
      // its still-draining IIFE stops forwarding events for this session.
      const existing = activeRunners.get(sessionId)
      if (existing) {
        existing.stopped = true
        await existing.runner.stop(sessionId)
        activeRunners.delete(sessionId)
      }

      // Backend comes from the configured `backend` field in llm.json — never
      // derived from the provider (Anthropic runs on either backend).
      const backend = llmConfig.backend
      const runner = createAgentRunner(backend)

      const active: ActiveRunner = {
        sessionId,
        runner,
        stopped: false,
      }
      invokeActive = active
      activeRunners.set(sessionId, active)

      // --- Sandbox Policy & File Tools ---

      // Build per-session sandbox policy based on mode and attached folders.
      // If no folders are attached, the policy still grants read access to
      // ~/.n8n-desk/ (minus sensitive files) and write access to skills/.
      //
      // Individually attached files: add their parent directories as READ-ONLY
      // mounts so the agent can read them. The agent is told the exact paths
      // in the system prompt — it won't browse the parent dirs randomly.
      const fileFolderMounts = attachedFiles.map((fp) => ({
        path: path.dirname(fp),
        mode: 'ro' as const,
      }))
      // Deduplicate: merge file parent dirs with explicit folder mounts.
      // The user-chosen per-folder mode is preserved (defaults to 'rw' in the
      // policy builder when absent).
      const allMountFolders: Array<{ path: string; mode?: 'ro' | 'rw' }> = attachedFolders.map(
        (f) => ({ path: f.path, mode: f.mode }),
      )
      for (const fm of fileFolderMounts) {
        if (!allMountFolders.some((f) => f.path === fm.path)) {
          allMountFolders.push(fm)
        }
      }

      const sandboxPolicy = mode === 'cowork'
        ? buildCoworkPolicy(allMountFolders, BASE_DIR)
        : buildWorkflowPolicy(allMountFolders, BASE_DIR)

      // --- Plugin & Skill Integration ---

      const { instanceId } = instanceConfig

      // Build custom MCP server configs from plugins + standalone servers.
      // For Claude SDK: passed as customMcpServers (SDK handles tool discovery).
      // For Deep Agents: pre-built as LangChain tools via buildDeepAgentsTools.
      const customMcpServers = await pluginManager.buildClaudeSdkMcpServers(instanceId)
      const pluginTools = backend === 'deep-agents'
        ? await pluginManager.buildDeepAgentsTools(instanceId)
        : undefined

      // Plugin tools only — the runners construct file tools + js_compute from
      // sandboxPolicy themselves. Passing them here too registered every file
      // tool twice (strict providers reject duplicate tool names).
      const customTools = [...(pluginTools ?? [])]

      // Load all skills and filter to auto-invocable ones.
      // Skills with disableModelInvocation=true are only invocable via /skill-name
      // in the chat input — they are not included in the system prompt.
      const allSkills = await loadAllSkills()
      const autoInvocableSkills = allSkills.filter((s) => !s.disableModelInvocation)

      // Select mode-specific system prompt
      const baseSystemPrompt = mode === 'cowork'
        ? COWORK_MODE_SYSTEM_PROMPT
        : WORKFLOW_MODE_SYSTEM_PROMPT

      // Inject the current date and environment (audit #44) — without it the
      // model dates schedules and reports from its training cutoff.
      const platformName = process.platform === 'darwin' ? 'macOS'
        : process.platform === 'win32' ? 'Windows' : 'Linux'
      const currentDate = new Intl.DateTimeFormat('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      }).format(new Date())
      let contextBlock = `\n\n## Environment\n- Current date: ${currentDate}\n- Platform: ${platformName} (desktop app: n8n-desk)\n- Connected n8n instance: ${instanceConfig.url}`

      // Cross-session memory (audit #45): inject saved notes so multi-day
      // continuity doesn't depend on the agent thinking to call memory_read.
      const memoryFilePath = path.join(BASE_DIR, 'instances', instanceId, 'memory.json')
      const { readMemoryEntries, buildMemoryPromptBlock } = await import('../agent/memory-tools')
      const memoryBlock = buildMemoryPromptBlock(await readMemoryEntries(memoryFilePath))
      if (memoryBlock) {
        contextBlock += `\n\n${memoryBlock}`
      }

      // Inject attached folder and file paths into the system prompt so the
      // agent knows which resources are available for file tools.
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

      // Persistent per-instance always-allow presets (tool-approvals.json,
      // written by the Settings UI). Read fresh every invoke so preset
      // changes apply from the next message without a restart.
      const alwaysAllowedTools = await readAlwaysAllowPresets(BASE_DIR, instanceId)

      // Load conversation history for multi-turn memory
      const conversationHistory = await loadConversationHistory(sessionId, mode, message)
      console.log(`[n8n-desk] Loaded ${conversationHistory.length} messages from session history`)

      // Mid-session 401 recovery (audit #41): the MCP token kind matches the
      // channel in use — custom MCP servers have their own OAuth tokens.
      const mcpTokenKind: TokenKind = instanceConfig.mcp.isCustom ? 'mcp' : 'n8n'

      const runnerConfig: AgentRunnerConfig = {
        instanceUrl: instanceConfig.url,
        accessToken: instanceConfig.accessToken,
        mcpUrl: instanceConfig.mcp.url,
        mcpAccessToken: instanceConfig.mcp.accessToken,
        refreshMcpToken: () => refreshStoredTokens(instanceId, mcpTokenKind),
        llmConfig,
        systemPrompt: augmentedPrompt,
        interruptOnTools,
        // Cowork must not manage the workflow lifecycle — enforced in both
        // runners, not just stated in the prompt (audit #12).
        deniedTools: mode === 'cowork' ? COWORK_DENIED_TOOLS : [],
        customMcpServers,
        customTools,
        skills: autoInvocableSkills,
        conversationHistory,
        sandboxPolicy,
        memoryFilePath,
        sessionAllowedTools: getSessionAllowSet(sessionId),
        alwaysAllowedTools,
      }

      console.log('[n8n-desk] System prompt:\n', augmentedPrompt)

      // Run agent and stream events
      // Use an async IIFE so we don't block the IPC return
      void (async () => {
        try {
          for await (const event of runner.invoke(sessionId, message, runnerConfig)) {
            if (active.stopped) break
            sendAgentEvent(event)
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
                sendAgentEvent(previewEvent)
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
                    sendAgentEvent(previewEvent)
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
          sendAgentEvent(errorEvent)
          const doneEvent: AgentStreamEvent = { sessionId, type: 'done', data: { reason: 'error' } }
          sendAgentEvent(doneEvent)
        } finally {
          // Identity check: a second invoke may have replaced this runner.
          // Deleting unconditionally would orphan the replacement (it could
          // no longer be stopped or approved).
          if (activeRunners.get(sessionId) === active) {
            activeRunners.delete(sessionId)
          }
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
      sendAgentEvent(errorEvent)
      const doneEvent: AgentStreamEvent = { sessionId, type: 'done', data: { reason: 'error' } }
      sendAgentEvent(doneEvent)
      // The runner registered above never started streaming — remove it, but
      // only if it is still the registered one (identity check).
      if (invokeActive && activeRunners.get(sessionId) === invokeActive) {
        activeRunners.delete(sessionId)
      }
      return { success: false, error: errMessage }
    }
  })

  ipcMain.handle('agent:stop', async (_event, sessionId: string) => {
    const active = activeRunners.get(sessionId)
    if (active) {
      active.stopped = true
      await active.runner.stop(sessionId)
      activeRunners.delete(sessionId)
    }
    // ALWAYS emit the terminal done — even when no runner is registered.
    // The renderer keys its running state on this event; if a prior terminal
    // event was lost (window recreated, runner crashed), stop is the user's
    // escape hatch and must unlock the session unconditionally.
    const doneEvent: AgentStreamEvent = { sessionId, type: 'done', data: { reason: 'cancelled' } }
    sendAgentEvent(doneEvent)
    return { success: true }
  })

  // Instance switch: agent sessions must never keep running against the
  // previous instance's MCP server and tokens (audit #21).
  ipcMain.handle('agent:stop-all', async () => {
    await stopAllAgentRunners()
    return { success: true }
  })

  ipcMain.handle('agent:approve', async (_event, sessionId: string, approvalId: string, decision: ApprovalDecision) => {
    // Defensive whitelist — the decision reaches runner internals.
    if (!['approve', 'approve_always', 'reject'].includes(decision)) {
      return { success: false, error: 'Invalid decision' }
    }

    const active = activeRunners.get(sessionId)
    if (!active) {
      return { success: false, error: 'No active runner for session' }
    }

    // The runner is the single emitter of `approval_resolved` (with the real
    // approval id) — no synthetic event here.
    const resolved = await active.runner.approve(sessionId, approvalId, decision)
    if (!resolved) {
      return { success: false, error: 'No pending approval matched' }
    }

    return { success: true }
  })

  ipcMain.handle('agent:answer', async (_event, sessionId: string, questionId: string, answers: unknown) => {
    const active = activeRunners.get(sessionId)
    if (!active) {
      return { success: false, error: 'No active runner for session' }
    }

    // The renderer payload is untrusted — coerce before it reaches the runner
    // (and, on the Deep Agents backend, the LangGraph resume path).
    const sanitized = sanitizeAnswers(answers)

    // The runner is the single emitter of `question_answered` (with the real
    // question id) — no synthetic event here.
    const resolved = await active.runner.answer(sessionId, questionId, sanitized)
    if (!resolved) {
      return { success: false, error: 'No pending question matched' }
    }

    return { success: true }
  })

  ipcMain.handle('agent:test-connection', async () => {
    let llmConfig: Awaited<ReturnType<typeof resolveLlmConfig>>
    try {
      llmConfig = await resolveLlmConfig()
    } catch (err) {
      if (err instanceof LlmConfigError) {
        return { success: false, error: err.message }
      }
      throw err
    }
    if (!llmConfig) {
      return { success: false, error: 'No LLM configuration found' }
    }
    return testLlmConnection(llmConfig)
  })

  // Health check for the MCP endpoint the agent modes depend on. Resolves the
  // same URL + token pair as agent:invoke (default `${url}/mcp-server/http`
  // with the n8n OAuth token, or the custom mcpServerUrl with its own token)
  // and performs a real tools/list round-trip. On 401 it force-refreshes the
  // stored tokens once and retries, so a stale expiry doesn't read as broken.
  ipcMain.handle('agent:mcp-status', async (_event, instanceId?: string): Promise<McpStatusResult> => {
    let id = instanceId ?? null
    if (!id) {
      const config = await readJson<{ defaultInstanceId?: string }>(path.join(BASE_DIR, 'config.json'))
      id = config?.defaultInstanceId ?? null
    }
    if (!id) return { status: 'not-configured' }

    const instance = await readJson<{ url: string; mcpServerUrl?: string }>(
      path.join(BASE_DIR, 'instances', id, 'instance.json'),
    )
    if (!instance?.url) return { status: 'not-configured', instanceId: id }

    const isCustom = Boolean(instance.mcpServerUrl)
    const kind: TokenKind = isCustom ? 'mcp' : 'n8n'
    const mcpUrl = isCustom
      ? instance.mcpServerUrl!.replace(/\/+$/, '')
      : `${instance.url.replace(/\/+$/, '')}/mcp-server/http`

    const accessToken = await loadAndRefresh(id, kind)
    if (!accessToken) {
      return { status: 'unauthorized', isCustom, instanceId: id }
    }

    const probe = async (token: string): Promise<McpStatusResult> => {
      const tools = await listToolsWithUrl(
        mcpUrl,
        { Authorization: `Bearer ${token}` },
        { timeoutMs: MCP_STATUS_TIMEOUT_MS },
      )
      return { status: 'connected', toolCount: tools.length, isCustom, instanceId: id }
    }

    try {
      return await probe(accessToken)
    } catch (err) {
      if (err instanceof McpUnauthorizedError) {
        const refreshed = await refreshStoredTokens(id, kind)
        if (refreshed) {
          try {
            return await probe(refreshed)
          } catch (retryErr) {
            if (retryErr instanceof McpUnauthorizedError) {
              return { status: 'unauthorized', isCustom, instanceId: id }
            }
            return {
              status: 'unreachable',
              isCustom,
              instanceId: id,
              error: retryErr instanceof Error ? retryErr.message : String(retryErr),
            }
          }
        }
        return { status: 'unauthorized', isCustom, instanceId: id }
      }
      return {
        status: 'unreachable',
        isCustom,
        instanceId: id,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  })

  // Full tool catalog across the n8n MCP server and all enabled custom
  // servers — powers the Settings > Tool approvals section. Read-only; each
  // server is probed independently so one offline server doesn't hide the
  // rest. Entry `key` is the canonical allowlist key stored in
  // tool-approvals.json (bare for n8n tools, `{server}__{tool}` for custom).
  interface McpToolCatalogEntry {
    name: string
    key: string
    description?: string
    /** True when this tool would prompt for approval without a preset. */
    gated: boolean
    /** True for the static destructive n8n tool set — warn in the UI. */
    destructive: boolean
  }
  interface McpToolCatalog {
    instanceId: string | null
    n8n: { reachable: boolean; error?: string; tools: McpToolCatalogEntry[] }
    customServers: Array<{
      serverName: string
      requireApproval: boolean
      reachable: boolean
      error?: string
      tools: McpToolCatalogEntry[]
    }>
  }

  ipcMain.handle('agent:list-mcp-tools', async (_event, instanceId?: string): Promise<McpToolCatalog> => {
    let id = instanceId ?? null
    if (!id) {
      const config = await readJson<{ defaultInstanceId?: string }>(path.join(BASE_DIR, 'config.json'))
      id = config?.defaultInstanceId ?? null
    }

    const catalog: McpToolCatalog = {
      instanceId: id,
      n8n: { reachable: false, tools: [] },
      customServers: [],
    }
    if (!id) {
      catalog.n8n.error = 'No active n8n instance configured.'
      return catalog
    }

    // --- n8n server tools (same URL/token resolution as agent:mcp-status) ---
    const instance = await readJson<{ url: string; mcpServerUrl?: string }>(
      path.join(BASE_DIR, 'instances', id, 'instance.json'),
    )
    if (!instance?.url) {
      catalog.n8n.error = 'Instance is not configured.'
    } else {
      const isCustom = Boolean(instance.mcpServerUrl)
      const kind: TokenKind = isCustom ? 'mcp' : 'n8n'
      const mcpUrl = isCustom
        ? instance.mcpServerUrl!.replace(/\/+$/, '')
        : `${instance.url.replace(/\/+$/, '')}/mcp-server/http`
      const accessToken = await loadAndRefresh(id, kind)
      if (!accessToken) {
        catalog.n8n.error = 'Not signed in to this instance.'
      } else {
        try {
          const tools = await listToolsWithUrl(
            mcpUrl,
            { Authorization: `Bearer ${accessToken}` },
            { timeoutMs: MCP_STATUS_TIMEOUT_MS },
          )
          catalog.n8n.reachable = true
          catalog.n8n.tools = tools.map((t) => {
            const destructive = DESTRUCTIVE_TOOLS.includes(t.name)
            return {
              name: t.name,
              key: t.name,
              description: t.description,
              gated: destructive || t.annotations?.readOnlyHint === false,
              destructive,
            }
          })
        } catch (err) {
          catalog.n8n.error = err instanceof Error ? err.message : String(err)
        }
      }
    }

    // --- Custom / plugin server tools ---
    try {
      const servers = await pluginManager.buildClaudeSdkMcpServers(id)
      const approvalServers = new Set(await pluginManager.getApprovalRequiredServerNames(id))
      for (const [serverName, serverConfig] of Object.entries(servers)) {
        if (serverName === 'n8n') continue // reserved
        const requireApproval = approvalServers.has(serverName)
        try {
          const discovered = await pluginManager.discoverTools(serverConfig.url, serverConfig.headers)
          catalog.customServers.push({
            serverName,
            requireApproval,
            reachable: true,
            tools: discovered.map((t) => ({
              name: t.name,
              key: `${serverName}__${t.name}`,
              description: t.description,
              gated: requireApproval,
              destructive: false,
            })),
          })
        } catch (err) {
          catalog.customServers.push({
            serverName,
            requireApproval,
            reachable: false,
            error: err instanceof Error ? err.message : String(err),
            tools: [],
          })
        }
      }
    } catch (err) {
      console.error('[n8n-desk] Failed to enumerate custom MCP servers:', err)
    }

    return catalog
  })
}
