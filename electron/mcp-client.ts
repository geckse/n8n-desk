import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

// --- Types ---

export interface McpToolResult {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>
  isError?: boolean
}

export interface McpToolInfo {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

export class McpUnauthorizedError extends Error {
  constructor(message = 'MCP request returned 401 Unauthorized') {
    super(message)
    this.name = 'McpUnauthorizedError'
  }
}

// --- Helpers ---

function buildMcpUrl(instanceUrl: string): URL {
  const base = instanceUrl.replace(/\/+$/, '')
  return new URL(`${base}/mcp-server/http`)
}

/**
 * Create a fresh transport + client, execute a callback, then close.
 * Each call is stateless — no persistent connection.
 */
async function withClient<T>(
  instanceUrl: string,
  token: string,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const url = buildMcpUrl(instanceUrl)

  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
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
    // Detect 401 responses and throw a specific error for token refresh
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

/**
 * Create a fresh transport + client for an arbitrary MCP HTTP endpoint, execute
 * a callback, then close. Generalised version of withClient() that accepts a
 * raw URL and a free-form headers record instead of an n8n instance URL + Bearer
 * token. Follows the same stateless pattern: fresh transport per call, detect
 * 401 → McpUnauthorizedError, close in finally block.
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
 * Call a single MCP tool on the given n8n instance.
 * Creates a fresh connection per call (stateless).
 * Throws McpUnauthorizedError on 401 so the caller can trigger token refresh.
 */
export async function callTool(
  instanceUrl: string,
  token: string,
  toolName: string,
  args: Record<string, unknown> = {},
): Promise<McpToolResult> {
  return withClient(instanceUrl, token, async (client) => {
    const result = await client.callTool({ name: toolName, arguments: args })
    return result as McpToolResult
  })
}

/**
 * List all available MCP tools on the given n8n instance.
 * Creates a fresh connection per call (stateless).
 * Throws McpUnauthorizedError on 401 so the caller can trigger token refresh.
 */
export async function listTools(
  instanceUrl: string,
  token: string,
): Promise<McpToolInfo[]> {
  return withClient(instanceUrl, token, async (client) => {
    const result = await client.listTools()
    return result.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as Record<string, unknown> | undefined,
    }))
  })
}

/**
 * Call a single MCP tool on an arbitrary HTTP MCP endpoint.
 * Generalised version of callTool() for custom/plugin MCP servers.
 * Creates a fresh connection per call (stateless).
 * Throws McpUnauthorizedError on 401 so the caller can trigger token refresh.
 */
export async function callToolWithUrl(
  url: string,
  headers: Record<string, string>,
  toolName: string,
  args: Record<string, unknown> = {},
): Promise<McpToolResult> {
  return withClientUrl(url, headers, async (client) => {
    const result = await client.callTool({ name: toolName, arguments: args })
    return result as McpToolResult
  })
}

/**
 * List all available MCP tools on an arbitrary HTTP MCP endpoint.
 * Generalised version of listTools() for custom/plugin MCP servers.
 * Creates a fresh connection per call (stateless).
 * Throws McpUnauthorizedError on 401 so the caller can trigger token refresh.
 */
export async function listToolsWithUrl(
  url: string,
  headers: Record<string, string>,
): Promise<McpToolInfo[]> {
  return withClientUrl(url, headers, async (client) => {
    const result = await client.listTools()
    return result.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as Record<string, unknown> | undefined,
    }))
  })
}
