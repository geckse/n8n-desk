/**
 * MCP wire-pipeline tests for the file actions exposed to the agent.
 *
 * These tests exercise the *exact* protocol path that ClaudeSdkRunner sets up
 * in production (see claude-sdk-runner.ts:174-277): an in-process McpServer
 * with the file tools + js_compute + skill tools registered on it. The Claude
 * Agent SDK talks to that McpServer instance directly (type: 'sdk'), no HTTP.
 *
 * We connect a Client via InMemoryTransport, which exercises the same
 * tools/list and tools/call request handlers the SDK uses, with no port,
 * no body parsing, and no flakiness from the localhost loopback.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

import { registerAgentTools } from '../agent-tool-registry'
import { createFileTools } from '../file-tools'
import { buildCoworkPolicy } from '../sandbox-policy'
import type { FilesystemSandboxPolicy, LoadedSkill } from '../types'

// ---------------------------------------------------------------------------
// Helpers — replicate the wiring from claude-sdk-runner.ts (production path)
// ---------------------------------------------------------------------------

/**
 * Build the same in-process McpServer that ClaudeSdkRunner builds at runtime,
 * using the REAL production registration function (agent-tool-registry.ts).
 */
function buildAgentMcpServer(
  policy: FilesystemSandboxPolicy,
  skills: LoadedSkill[] = [],
): McpServer {
  const server = new McpServer(
    { name: 'n8n-desk-local', version: '1.0.0' },
    { capabilities: { tools: {} } },
  )
  registerAgentTools(server, policy, skills)
  return server
}

/** Connect a Client and McpServer via in-memory linked transports. */
async function connectInMemory(server: McpServer): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)

  const client = new Client(
    { name: 'pipeline-test-client', version: '1.0.0' },
    { capabilities: {} },
  )
  await client.connect(clientTransport)
  return client
}

/** Parse the JSON text the server returns inside MCP content[0]. */
function parseToolText(result: { content: Array<{ type: string; text?: string }> }): unknown {
  const first = result.content[0]
  expect(first.type).toBe('text')
  return JSON.parse(first.text!)
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let tmpDir: string
let projectDir: string
let readonlyDir: string
let n8nDeskDir: string
let policy: FilesystemSandboxPolicy

const cleanups: Array<() => Promise<void>> = []

beforeEach(async () => {
  const rawTmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-pipeline-test-'))
  tmpDir = await fs.realpath(rawTmp)
  projectDir = path.join(tmpDir, 'project')
  readonlyDir = path.join(tmpDir, 'readonly')
  n8nDeskDir = path.join(tmpDir, '.n8n-desk')
  await fs.mkdir(projectDir, { recursive: true })
  await fs.mkdir(readonlyDir, { recursive: true })
  await fs.mkdir(path.join(n8nDeskDir, 'skills'), { recursive: true })
  policy = buildCoworkPolicy(
    [{ path: projectDir }, { path: readonlyDir, mode: 'ro' }],
    n8nDeskDir,
  )
})

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop()!
    await cleanup().catch(() => {})
  }
  await fs.rm(tmpDir, { recursive: true, force: true })
})

/** Build an MCP server + client pair, register cleanup. */
async function setupPair(skills: LoadedSkill[] = []): Promise<{
  server: McpServer
  client: Client
}> {
  const server = buildAgentMcpServer(policy, skills)
  const client = await connectInMemory(server)
  cleanups.push(async () => {
    await client.close().catch(() => {})
    await server.close().catch(() => {})
  })
  return { server, client }
}

// ---------------------------------------------------------------------------
// Protocol — tools/list
// ---------------------------------------------------------------------------

describe('MCP pipeline tools/list', () => {
  it('exposes 22 file tools + js_compute (23 total) when no skills', async () => {
    const { client } = await setupPair()
    const { tools } = await client.listTools()
    const names = tools.map((t) => t.name).sort()

    expect(names).toContain('js_compute')
    const fileNames = names.filter((n) => n !== 'js_compute')
    expect(fileNames).toEqual(
      [
        'clipboard_read',
        'clipboard_write',
        'copy_file',
        'delete_file',
        'edit_text',
        'list_files',
        'move_file',
        'open_path',
        'read_csv',
        'read_docx',
        'read_excel',
        'read_json',
        'read_pdf',
        'read_text',
        'read_yaml',
        'search_files',
        'write_csv',
        'write_docx',
        'write_excel',
        'write_json',
        'write_text',
        'write_yaml',
      ].sort(),
    )
    expect(tools).toHaveLength(23)
  })

  it('adds invoke_skill and read_skill_file when skills are provided', async () => {
    const skill: LoadedSkill = {
      name: 'demo-skill',
      description: 'Demo',
      content: '# Demo\nHello $ARGUMENTS',
      disableModelInvocation: false,
      userInvocable: true,
      directory: path.join(n8nDeskDir, 'skills', 'demo-skill'),
      source: 'user',
    }
    await fs.mkdir(skill.directory, { recursive: true })

    const { client } = await setupPair([skill])
    const { tools } = await client.listTools()
    const names = tools.map((t) => t.name)

    expect(names).toContain('invoke_skill')
    expect(names).toContain('read_skill_file')
    expect(tools).toHaveLength(25)
  })

  it('every tool advertises name, description, and inputSchema', async () => {
    const { client } = await setupPair()
    const { tools } = await client.listTools()

    for (const t of tools) {
      expect(typeof t.name).toBe('string')
      expect(t.name.length).toBeGreaterThan(0)
      expect(typeof t.description).toBe('string')
      expect(t.inputSchema).toBeDefined()
      expect(t.inputSchema.type).toBe('object')
    }
  })

  it('matches createFileTools name set (backend parity)', async () => {
    const { client } = await setupPair()
    const { tools } = await client.listTools()

    const mcpFileNames = new Set(
      tools.map((t) => t.name).filter((n) => n !== 'js_compute'),
    )
    const lcFileNames = new Set(
      createFileTools(policy).map((t: { name: string }) => t.name),
    )
    expect(mcpFileNames).toEqual(lcFileNames)
  })
})

// ---------------------------------------------------------------------------
// Protocol — tools/call (round-trips)
// ---------------------------------------------------------------------------

describe('MCP pipeline tools/call round-trips', () => {
  it('write_text → read_text returns identical content via MCP', async () => {
    const { client } = await setupPair()
    const filePath = path.join(projectDir, 'hello.txt')

    const writeResult = await client.callTool({
      name: 'write_text',
      arguments: { path: filePath, content: 'Hello from the agent' },
    })
    expect(parseToolText(writeResult as never)).toMatchObject({ success: true })

    const readResult = await client.callTool({
      name: 'read_text',
      arguments: { path: filePath },
    })
    const body = parseToolText(readResult as never) as {
      success: boolean
      content: string
    }
    expect(body.success).toBe(true)
    expect(body.content).toBe('Hello from the agent')
  })

  it('read_csv on a real CSV returns parsed rows + headers', async () => {
    const { client } = await setupPair()
    const csvPath = path.join(projectDir, 'data.csv')
    await fs.writeFile(csvPath, 'name,score\nAlice,42\nBob,17\n')

    const result = await client.callTool({
      name: 'read_csv',
      arguments: { path: csvPath },
    })
    const body = parseToolText(result as never) as {
      success: boolean
      headers: string[]
      rows: Array<Record<string, unknown>>
    }
    expect(body.success).toBe(true)
    expect(body.headers).toEqual(['name', 'score'])
    expect(body.rows).toHaveLength(2)
    expect(body.rows[0]).toMatchObject({ name: 'Alice', score: 42 })
  })

  it('read_excel on a real .xlsx returns the sheet rows', async () => {
    const { client } = await setupPair()

    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.json_to_sheet([
      { product: 'apple', qty: 3 },
      { product: 'pear', qty: 5 },
    ])
    XLSX.utils.book_append_sheet(wb, ws, 'Inventory')
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
    const xlsxPath = path.join(projectDir, 'inventory.xlsx')
    await fs.writeFile(xlsxPath, buf)

    const result = await client.callTool({
      name: 'read_excel',
      arguments: { path: xlsxPath },
    })
    const body = parseToolText(result as never) as {
      success: boolean
      sheets: Array<{ name: string; rows: Array<Record<string, unknown>> }>
    }
    expect(body.success).toBe(true)
    expect(body.sheets).toHaveLength(1)
    expect(body.sheets[0].name).toBe('Inventory')
    expect(body.sheets[0].rows).toEqual([
      { product: 'apple', qty: 3 },
      { product: 'pear', qty: 5 },
    ])
  })

  it('read_pdf on a real fixture returns extracted text + page count', async () => {
    const { client } = await setupPair()

    const fixtureSrc = path.join(
      path.resolve(__dirname, '..', '..', '..'),
      'node_modules', 'pdf-parse', 'test', 'data', '01-valid.pdf',
    )
    const pdfPath = path.join(projectDir, 'fixture.pdf')
    await fs.copyFile(fixtureSrc, pdfPath)

    const result = await client.callTool({
      name: 'read_pdf',
      arguments: { path: pdfPath },
    })
    const body = parseToolText(result as never) as {
      success: boolean
      pageCount: number
      text: string
    }
    expect(body.success).toBe(true)
    expect(body.pageCount).toBeGreaterThan(0)
    expect(body.text.length).toBeGreaterThan(50)
  })

  it('list_files via MCP returns directory entries', async () => {
    const { client } = await setupPair()
    await fs.writeFile(path.join(projectDir, 'a.txt'), 'a')
    await fs.writeFile(path.join(projectDir, 'b.json'), '{}')

    const result = await client.callTool({
      name: 'list_files',
      arguments: { path: projectDir },
    })
    const body = parseToolText(result as never) as {
      success: boolean
      entries: Array<{ name: string; type: string }>
    }
    expect(body.success).toBe(true)
    expect(body.entries).toHaveLength(2)
  })

  it('write_json then read_json round-trips structured data', async () => {
    const { client } = await setupPair()
    const filePath = path.join(projectDir, 'data.json')
    const payload = { items: [{ id: 1 }, { id: 2 }], meta: { total: 2 } }

    await client.callTool({
      name: 'write_json',
      arguments: { path: filePath, data: payload },
    })
    const readResult = await client.callTool({
      name: 'read_json',
      arguments: { path: filePath },
    })
    const body = parseToolText(readResult as never) as { data: unknown }
    expect(body.data).toEqual(payload)
  })
})

// ---------------------------------------------------------------------------
// Error propagation through the wire
// ---------------------------------------------------------------------------

describe('MCP pipeline error propagation', () => {
  it('deny-listed read returns body.success=false (not a thrown MCP error)', async () => {
    // file-tools always returns serialized success:false (it does not throw),
    // so the MCP wrapper does NOT mark this as isError. The agent depends on
    // this contract — error info comes back inside the JSON body.
    const { client } = await setupPair()
    await fs.writeFile(path.join(projectDir, 'config.env'), 'KEY=val')

    const result = await client.callTool({
      name: 'read_text',
      arguments: { path: path.join(projectDir, 'config.env') },
    }) as { content: Array<{ type: string; text?: string }>; isError?: boolean }

    expect(result.isError).not.toBe(true)
    const body = parseToolText(result) as { success: boolean; error: string }
    expect(body.success).toBe(false)
    expect(body.error).toContain('blocked for security')
  })

  it('sandbox rejection (path outside mount) returns body.success=false', async () => {
    const { client } = await setupPair()
    const outsideDir = path.join(tmpDir, 'outside')
    await fs.mkdir(outsideDir, { recursive: true })
    await fs.writeFile(path.join(outsideDir, 'x.txt'), 'nope')

    const result = await client.callTool({
      name: 'read_text',
      arguments: { path: path.join(outsideDir, 'x.txt') },
    })
    const body = parseToolText(result as never) as { success: boolean; error: string }
    expect(body.success).toBe(false)
    expect(body.error).toContain('outside all allowed folders')
  })

  it('write to read-only mount returns body.success=false', async () => {
    const { client } = await setupPair()

    const result = await client.callTool({
      name: 'write_text',
      arguments: {
        path: path.join(readonlyDir, 'should-not-write.md'),
        content: 'attempt',
      },
    })
    const body = parseToolText(result as never) as { success: boolean; error: string }
    expect(body.success).toBe(false)
    expect(body.error).toContain('read-only')
  })

  it('malformed args (missing required path) returns isError=true', async () => {
    const { client } = await setupPair()

    const result = await client.callTool({
      name: 'read_text',
      arguments: {},
    }) as { content: Array<{ type: string; text?: string }>; isError?: boolean }

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/invalid|required|path/i)
  })

  it('server stays usable after a failing call', async () => {
    const { client } = await setupPair()

    const failed = await client.callTool({
      name: 'read_text',
      arguments: {},
    }) as { isError?: boolean }
    expect(failed.isError).toBe(true)

    // Subsequent valid calls still work
    await fs.writeFile(path.join(projectDir, 'after.txt'), 'after')
    const ok = await client.callTool({
      name: 'read_text',
      arguments: { path: path.join(projectDir, 'after.txt') },
    })
    const body = parseToolText(ok as never) as { content: string }
    expect(body.content).toBe('after')
  })

  it('unknown tool name returns isError=true', async () => {
    const { client } = await setupPair()

    const result = await client.callTool({
      name: 'totally_made_up_tool',
      arguments: {},
    }) as { content: Array<{ type: string; text?: string }>; isError?: boolean }

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('not found')
  })
})

// ---------------------------------------------------------------------------
// Skill tools
// ---------------------------------------------------------------------------

describe('MCP pipeline skill tools', () => {
  async function makeDemoSkill(): Promise<LoadedSkill> {
    const dir = path.join(n8nDeskDir, 'skills', 'demo-skill')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, 'PATTERNS.md'), 'Pattern reference content.')
    return {
      name: 'demo-skill',
      description: 'A demo skill',
      content: '# Demo\nGreetings $ARGUMENTS',
      disableModelInvocation: false,
      userInvocable: true,
      directory: dir,
      source: 'user',
    }
  }

  it('invoke_skill substitutes $ARGUMENTS', async () => {
    const skill = await makeDemoSkill()
    const { client } = await setupPair([skill])

    const result = await client.callTool({
      name: 'invoke_skill',
      arguments: { skillName: 'demo-skill', arguments: 'world' },
    }) as { content: Array<{ type: string; text?: string }> }

    expect(result.content[0].text).toContain('Greetings world')
  })

  it('read_skill_file returns supporting file contents', async () => {
    const skill = await makeDemoSkill()
    const { client } = await setupPair([skill])

    const result = await client.callTool({
      name: 'read_skill_file',
      arguments: { skillName: 'demo-skill', filePath: 'PATTERNS.md' },
    }) as { content: Array<{ type: string; text?: string }> }

    expect(result.content[0].text).toBe('Pattern reference content.')
  })

  it('invoke_skill on unknown name returns isError=true', async () => {
    const skill = await makeDemoSkill()
    const { client } = await setupPair([skill])

    const result = await client.callTool({
      name: 'invoke_skill',
      arguments: { skillName: 'does-not-exist' },
    }) as { content: Array<{ type: string; text?: string }>; isError?: boolean }

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('not found')
  })

  it('read_skill_file on unknown file returns isError=true', async () => {
    const skill = await makeDemoSkill()
    const { client } = await setupPair([skill])

    const result = await client.callTool({
      name: 'read_skill_file',
      arguments: { skillName: 'demo-skill', filePath: 'NOPE.md' },
    }) as { content: Array<{ type: string; text?: string }>; isError?: boolean }

    expect(result.isError).toBe(true)
  })

  it('read_skill_file refuses path traversal outside skill dir', async () => {
    const skill = await makeDemoSkill()
    const { client } = await setupPair([skill])

    await fs.writeFile(path.join(n8nDeskDir, 'sibling.txt'), 'private')

    const result = await client.callTool({
      name: 'read_skill_file',
      arguments: { skillName: 'demo-skill', filePath: '../../sibling.txt' },
    }) as { content: Array<{ type: string; text?: string }>; isError?: boolean }

    expect(result.isError).toBe(true)
  })
})
