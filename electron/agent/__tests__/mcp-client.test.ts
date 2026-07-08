/**
 * mcp-client tests against a real local Streamable-HTTP MCP server.
 *
 * Covers the #19 fix (per-tool request timeouts instead of the SDK's blanket
 * 60s default) and the #39 fix (abort signal cancels in-flight calls), plus
 * annotation passthrough on tools/list (approval gating input).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'http'
import type { AddressInfo } from 'net'
import { z } from 'zod'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'

import {
  callToolWithUrl,
  listToolsWithUrl,
  defaultTimeoutForTool,
  EXECUTION_TOOL_TIMEOUT_MS,
  TOOL_CALL_DEFAULT_TIMEOUT_MS,
} from '../../mcp-client'

let httpServer: http.Server
let serverUrl: string

function buildServer(): McpServer {
  const server = new McpServer(
    { name: 'test-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } },
  )

  server.registerTool(
    'fast_tool',
    {
      description: 'Returns immediately',
      inputSchema: { value: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ value }) => ({ content: [{ type: 'text' as const, text: `fast:${value}` }] }),
  )

  server.registerTool(
    'slow_tool',
    {
      description: 'Takes 3 seconds',
      inputSchema: {},
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 3_000))
      return { content: [{ type: 'text' as const, text: 'finally done' }] }
    },
  )

  return server
}

beforeAll(async () => {
  // Stateless pattern: fresh McpServer + transport per request — the same
  // shape as n8n's MCP controller.
  httpServer = http.createServer(async (req, res) => {
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
      if (!res.headersSent) {
        res.writeHead(500).end()
      }
    }
  })
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
  serverUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()))
})

describe('timeout policy', () => {
  it('execution-class tools get the long server-aligned budget', () => {
    expect(defaultTimeoutForTool('execute_workflow')).toBe(EXECUTION_TOOL_TIMEOUT_MS)
    expect(defaultTimeoutForTool('test_workflow')).toBe(EXECUTION_TOOL_TIMEOUT_MS)
    // Namespaced forms resolve to the bare name
    expect(defaultTimeoutForTool('mcp__n8n__execute_workflow')).toBe(EXECUTION_TOOL_TIMEOUT_MS)
    expect(EXECUTION_TOOL_TIMEOUT_MS).toBeGreaterThan(300_000) // > n8n's 5-min budget
  })

  it('everything else gets the standard timeout', () => {
    expect(defaultTimeoutForTool('search_workflows')).toBe(TOOL_CALL_DEFAULT_TIMEOUT_MS)
    expect(defaultTimeoutForTool('get_sdk_reference')).toBe(TOOL_CALL_DEFAULT_TIMEOUT_MS)
  })
})

describe('callToolWithUrl', () => {
  it('round-trips a fast tool', async () => {
    const result = await callToolWithUrl(serverUrl, {}, 'fast_tool', { value: 'hello' })
    expect(result.isError ?? false).toBe(false)
    expect(result.content[0].text).toBe('fast:hello')
  })

  it('a per-call timeout rejects a slow tool instead of hanging', async () => {
    const start = Date.now()
    await expect(
      callToolWithUrl(serverUrl, {}, 'slow_tool', {}, { timeoutMs: 400 }),
    ).rejects.toThrow(/timeout|timed out/i)
    expect(Date.now() - start).toBeLessThan(2_500)
  }, 10_000)

  it('an abort signal cancels an in-flight call promptly (stop() support)', async () => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 200)

    const start = Date.now()
    await expect(
      callToolWithUrl(serverUrl, {}, 'slow_tool', {}, { signal: controller.signal }),
    ).rejects.toThrow()
    expect(Date.now() - start).toBeLessThan(2_500)
  }, 10_000)
})

describe('listToolsWithUrl', () => {
  it('returns annotations so mutating tools can be approval-gated', async () => {
    const tools = await listToolsWithUrl(serverUrl, {})
    const names = tools.map((t) => t.name).sort()
    expect(names).toEqual(['fast_tool', 'slow_tool'])

    const slow = tools.find((t) => t.name === 'slow_tool')!
    expect(slow.annotations?.readOnlyHint).toBe(false)
    const fast = tools.find((t) => t.name === 'fast_tool')!
    expect(fast.annotations?.readOnlyHint).toBe(true)

    // Input schemas come through for jsonSchemaToZod
    expect(fast.inputSchema).toBeDefined()
  })
})
