/**
 * Mid-session token refresh (audit #41) against a real local Streamable-HTTP
 * MCP server that enforces bearer auth.
 *
 * The n8n access token outlives neither long sessions nor its TTL — a 401
 * mid-session must refresh the token ONCE (single-flight across concurrent
 * calls) and retry, and only surface a re-auth message when refresh fails.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import http from 'http'
import type { AddressInfo } from 'net'
import { z } from 'zod'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'

import { discoverN8nMcpTools } from '../tool-definitions'

let httpServer: http.Server
let serverUrl: string

/** Tokens the server currently accepts. */
const validTokens = new Set<string>()
/** Tool invocations that reached the handler, by token used. */
let executedWith: string[] = []

function buildServer(): McpServer {
  const server = new McpServer(
    { name: 'auth-test-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } },
  )
  server.registerTool(
    'echo_tool',
    {
      description: 'Echoes input',
      inputSchema: { value: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ value }) => ({ content: [{ type: 'text' as const, text: `echo:${value}` }] }),
  )
  // Validates stricter than its advertised JSON schema (the refine is not
  // serialized to tools/list) — mirrors the live n8n server rejecting
  // update_workflow descriptions > 255 chars with a protocol-level -32602.
  server.registerTool(
    'strict_tool',
    {
      description: 'Rejects values longer than 5 chars server-side',
      inputSchema: {
        value: z.string().refine((v) => v.length <= 5, 'String must contain at most 5 character(s)'),
      },
    },
    async ({ value }) => ({ content: [{ type: 'text' as const, text: `ok:${value}` }] }),
  )
  server.registerTool(
    'always_fails',
    {
      description: 'Always returns an isError result',
      inputSchema: { value: z.string() },
    },
    async () => ({ content: [{ type: 'text' as const, text: 'execution blew up' }], isError: true }),
  )
  return server
}

beforeAll(async () => {
  httpServer = http.createServer(async (req, res) => {
    const auth = req.headers.authorization ?? ''
    const token = auth.replace(/^Bearer\s+/i, '')
    if (!validTokens.has(token)) {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'unauthorized' }))
      return
    }
    executedWith.push(token)
    try {
      const server = buildServer()
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
      res.on('close', () => {
        transport.close().catch(() => {})
        server.close().catch(() => {})
      })
      await server.connect(transport)
      await transport.handleRequest(req, res)
    } catch {
      if (!res.headersSent) res.writeHead(500).end()
    }
  })
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
  serverUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) => httpServer.close((err) => (err ? reject(err) : resolve())))
})

beforeEach(() => {
  validTokens.clear()
  executedWith = []
})

async function callEcho(tools: unknown[], value: string): Promise<string> {
  const echo = (tools as Array<{ name: string; invoke: (args: unknown) => Promise<string> }>)
    .find((t) => t.name === 'echo_tool')
  expect(echo).toBeDefined()
  return echo!.invoke({ value })
}

describe('mid-session MCP token refresh (audit #41)', () => {
  it('refreshes on 401 and retries the tool call with the new token', async () => {
    validTokens.add('token-old')
    let refreshCalls = 0

    const discovery = await discoverN8nMcpTools(serverUrl, 'token-old', {
      refreshToken: async () => {
        refreshCalls++
        validTokens.add('token-new')
        return 'token-new'
      },
    })

    // Session runs long → the old token expires server-side.
    validTokens.delete('token-old')

    const result = await callEcho(discovery.tools, 'hello')
    expect(result).toBe('echo:hello')
    expect(refreshCalls).toBe(1)
    expect(executedWith).toContain('token-new')
  })

  it('single-flights the refresh across concurrent 401ing tool calls', async () => {
    validTokens.add('token-old')
    let refreshCalls = 0

    const discovery = await discoverN8nMcpTools(serverUrl, 'token-old', {
      refreshToken: async () => {
        refreshCalls++
        await new Promise((r) => setTimeout(r, 100))
        validTokens.add('token-new')
        return 'token-new'
      },
    })

    validTokens.delete('token-old')

    const [a, b, c] = await Promise.all([
      callEcho(discovery.tools, 'a'),
      callEcho(discovery.tools, 'b'),
      callEcho(discovery.tools, 'c'),
    ])
    expect([a, b, c]).toEqual(['echo:a', 'echo:b', 'echo:c'])
    expect(refreshCalls).toBe(1)
  })

  // Auth failures come back as tool RESULTS, not throws — a thrown tool error
  // escapes LangChain's middleware-wrapped ToolNode and kills the whole run.
  it('surfaces an actionable re-auth message as the tool result when refresh fails', async () => {
    validTokens.add('token-old')
    const discovery = await discoverN8nMcpTools(serverUrl, 'token-old', {
      refreshToken: async () => null,
    })

    validTokens.delete('token-old')

    await expect(callEcho(discovery.tools, 'x')).resolves.toMatch(/Sign in again from Settings/)
  })

  it('surfaces re-auth as the tool result when the refreshed token is also rejected', async () => {
    validTokens.add('token-old')
    const discovery = await discoverN8nMcpTools(serverUrl, 'token-old', {
      refreshToken: async () => 'token-still-bad',
    })

    validTokens.delete('token-old')

    await expect(callEcho(discovery.tools, 'x')).resolves.toMatch(/Sign in again from Settings/)
  })

  it('surfaces the 401 as the tool result when no refresh callback is provided', async () => {
    validTokens.add('token-old')
    const discovery = await discoverN8nMcpTools(serverUrl, 'token-old', {})

    validTokens.delete('token-old')

    await expect(callEcho(discovery.tools, 'x')).resolves.toMatch(/401|[Uu]nauthorized/)
  })

  it('retries discovery itself on a 401 during tools/list', async () => {
    // Old token invalid from the start — discovery must refresh and retry.
    let refreshCalls = 0
    const discovery = await discoverN8nMcpTools(serverUrl, 'token-expired', {
      refreshToken: async () => {
        refreshCalls++
        validTokens.add('token-new')
        return 'token-new'
      },
    })
    expect(refreshCalls).toBe(1)
    expect(discovery.tools.length).toBeGreaterThan(0)
  })
})

/**
 * MCP tool failures must feed back into the agent loop as error results the
 * model can read and iterate on — NEVER as throws. With middleware present
 * (deepagents always installs wrapToolCall), LangChain's ToolNode re-raises a
 * thrown tool error instead of converting it to a ToolMessage, which crashes
 * agent.stream and kills the run mid-task. Seen live: update_workflow rejected
 * with -32602 ("String must contain at most 255 character(s)") froze the
 * session instead of letting the model shorten the description and retry.
 */
describe('MCP tool failures feed back to the model (iterate-on-error)', () => {
  interface ToolErrorMessage { status?: string; content: unknown }

  async function invokeAsToolCall(
    tools: unknown[],
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolErrorMessage> {
    const t = (tools as Array<{ name: string; invoke: (input: unknown) => Promise<ToolErrorMessage> }>)
      .find((x) => x.name === name)
    expect(t).toBeDefined()
    return t!.invoke({ name, args, id: 'call_test_1', type: 'tool_call' })
  }

  it('returns a protocol-level -32602 validation error as an error ToolMessage', async () => {
    validTokens.add('tok')
    const discovery = await discoverN8nMcpTools(serverUrl, 'tok', {})

    // Client-side schema accepts (the refine is not advertised); the server
    // rejects at the JSON-RPC layer with McpError -32602.
    const result = await invokeAsToolCall(discovery.tools, 'strict_tool', { value: 'way too long' })

    expect(result.status).toBe('error')
    expect(String(result.content)).toMatch(/-32602|Invalid arguments/)
    expect(String(result.content)).toContain('try again')
  })

  it('returns isError tool results as an error ToolMessage, not a throw', async () => {
    validTokens.add('tok')
    const discovery = await discoverN8nMcpTools(serverUrl, 'tok', {})

    const result = await invokeAsToolCall(discovery.tools, 'always_fails', { value: 'x' })

    expect(result.status).toBe('error')
    expect(String(result.content)).toContain('execution blew up')
  })

  it('successful calls still return plain text', async () => {
    validTokens.add('tok')
    const discovery = await discoverN8nMcpTools(serverUrl, 'tok', {})

    const result = await invokeAsToolCall(discovery.tools, 'strict_tool', { value: 'ok' })
    // tool() wraps a string return into a success ToolMessage for tool_call input
    expect(result.status).not.toBe('error')
    expect(String(result.content)).toBe('ok:ok')
  })

  it('an aborted call still throws so stop() cancels the run', async () => {
    validTokens.add('tok')
    const discovery = await discoverN8nMcpTools(serverUrl, 'tok', {})
    const echo = (discovery.tools as Array<{ name: string; invoke: (input: unknown, config?: unknown) => Promise<unknown> }>)
      .find((t) => t.name === 'echo_tool')!

    const controller = new AbortController()
    controller.abort()

    await expect(
      echo.invoke(
        { name: 'echo_tool', args: { value: 'x' }, id: 'call_test_2', type: 'tool_call' },
        { signal: controller.signal },
      ),
    ).rejects.toThrow()
  })
})
