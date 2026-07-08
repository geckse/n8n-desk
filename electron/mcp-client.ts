import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

// --- Types ---

export interface McpToolResult {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>
  isError?: boolean
}

/** MCP tool annotations (advisory hints from the server). */
export interface McpToolAnnotations {
  title?: string
  readOnlyHint?: boolean
  destructiveHint?: boolean
  idempotentHint?: boolean
  openWorldHint?: boolean
  [key: string]: unknown
}

export interface McpToolInfo {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
  annotations?: McpToolAnnotations
}

/** Per-request options threaded into the MCP SDK's RequestOptions. */
export interface McpCallOptions {
  /** Request timeout in ms. Defaults to TOOL_CALL_DEFAULT_TIMEOUT_MS. */
  timeoutMs?: number
  /** Abort signal — cancels the in-flight HTTP request (stop() support). */
  signal?: AbortSignal
}

export class McpUnauthorizedError extends Error {
  constructor(message = 'MCP request returned 401 Unauthorized') {
    super(message)
    this.name = 'McpUnauthorizedError'
  }
}

// --- Timeout policy ---

/**
 * The n8n server's execute_workflow budget is 5 minutes
 * (WORKFLOW_EXECUTION_TIMEOUT_MS in packages/cli/src/modules/mcp/) — the MCP
 * SDK's 60s default would kill long executions client-side while they keep
 * running server-side. Execution-class calls get the server budget + margin.
 */
export const EXECUTION_TOOL_TIMEOUT_MS = 330_000
export const TOOL_CALL_DEFAULT_TIMEOUT_MS = 60_000
export const LIST_TOOLS_TIMEOUT_MS = 30_000

/** Tools that hold the HTTP response open for the whole workflow execution. */
const EXECUTION_CLASS_TOOLS: ReadonlySet<string> = new Set([
  'execute_workflow',
  'test_workflow',
])

/** Resolve the default timeout for a tool call by (bare) tool name. */
export function defaultTimeoutForTool(toolName: string): number {
  const bareName = toolName.includes('__') ? toolName.slice(toolName.lastIndexOf('__') + 2) : toolName
  return EXECUTION_CLASS_TOOLS.has(bareName) ? EXECUTION_TOOL_TIMEOUT_MS : TOOL_CALL_DEFAULT_TIMEOUT_MS
}

// --- Helpers ---

function buildMcpUrl(instanceUrl: string): URL {
  const base = instanceUrl.replace(/\/+$/, '')
  return new URL(`${base}/mcp-server/http`)
}

/**
 * Create a fresh transport + client for an arbitrary MCP HTTP endpoint, execute
 * a callback, then close. Each call is stateless — the n8n MCP controller is
 * itself stateless (fresh server + transport per request, no session id), so a
 * persistent connection buys nothing. Detects 401 → McpUnauthorizedError so
 * callers can trigger token refresh.
 */
async function withClientUrl<T>(
  url: string,
  headers: Record<string, string>,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const parsedUrl = new URL(url)

  const transport = new StreamableHTTPClientTransport(parsedUrl, {
    requestInit: {
      headers,
    },
  })

  const client = new Client({
    name: 'n8n-desk',
    version: '1.0.0',
  })

  try {
    await client.connect(transport)
    return await fn(client)
  } catch (err: unknown) {
    if (err instanceof Error) {
      const msg = err.message.toLowerCase()
      if (msg.includes('401') || msg.includes('unauthorized')) {
        throw new McpUnauthorizedError()
      }
    }
    throw err
  } finally {
    try {
      await client.close()
    } catch {
      // Best-effort cleanup
    }
  }
}

// --- Public API ---

/**
 * Call a single MCP tool on an arbitrary HTTP MCP endpoint.
 * Creates a fresh connection per call (stateless).
 *
 * @param options.timeoutMs - Overrides the per-tool default (execution-class
 *   tools get 330s, everything else 60s).
 * @param options.signal - Aborts the in-flight request (used by stop()).
 */
export async function callToolWithUrl(
  url: string,
  headers: Record<string, string>,
  toolName: string,
  args: Record<string, unknown> = {},
  options: McpCallOptions = {},
): Promise<McpToolResult> {
  const timeout = options.timeoutMs ?? defaultTimeoutForTool(toolName)
  return withClientUrl(url, headers, async (client) => {
    const result = await client.callTool(
      { name: toolName, arguments: args },
      undefined,
      {
        timeout,
        // The server may not send progress notifications, but when it does,
        // keep long executions alive instead of tripping the fixed timeout.
        resetTimeoutOnProgress: true,
        // Absolute ceiling even with progress resets.
        maxTotalTimeout: Math.max(timeout, EXECUTION_TOOL_TIMEOUT_MS),
        ...(options.signal ? { signal: options.signal } : {}),
      },
    )
    return result as McpToolResult
  })
}

/**
 * List all available MCP tools on an arbitrary HTTP MCP endpoint, including
 * the server's advisory annotations (readOnlyHint etc.).
 * Creates a fresh connection per call (stateless).
 */
export async function listToolsWithUrl(
  url: string,
  headers: Record<string, string>,
  options: McpCallOptions = {},
): Promise<McpToolInfo[]> {
  const timeout = options.timeoutMs ?? LIST_TOOLS_TIMEOUT_MS
  return withClientUrl(url, headers, async (client) => {
    const result = await client.listTools(undefined, {
      timeout,
      ...(options.signal ? { signal: options.signal } : {}),
    })
    return result.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as Record<string, unknown> | undefined,
      annotations: t.annotations as McpToolAnnotations | undefined,
    }))
  })
}

/**
 * Call a single MCP tool on the given n8n instance (default MCP endpoint).
 * Thin wrapper over callToolWithUrl.
 */
export async function callTool(
  instanceUrl: string,
  token: string,
  toolName: string,
  args: Record<string, unknown> = {},
  options: McpCallOptions = {},
): Promise<McpToolResult> {
  return callToolWithUrl(
    buildMcpUrl(instanceUrl).toString(),
    { Authorization: `Bearer ${token}` },
    toolName,
    args,
    options,
  )
}

/**
 * List all available MCP tools on the given n8n instance (default MCP endpoint).
 * Thin wrapper over listToolsWithUrl.
 */
export async function listTools(
  instanceUrl: string,
  token: string,
  options: McpCallOptions = {},
): Promise<McpToolInfo[]> {
  return listToolsWithUrl(
    buildMcpUrl(instanceUrl).toString(),
    { Authorization: `Bearer ${token}` },
    options,
  )
}
