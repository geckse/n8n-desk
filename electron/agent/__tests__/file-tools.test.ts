import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'

import { createFileTools } from '../file-tools'
import { buildCoworkPolicy } from '../sandbox-policy'
import type { FilesystemSandboxPolicy, SandboxFolderMount } from '../types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a temporary directory for each test and clean up after.
 *
 * On macOS, os.tmpdir() returns '/tmp' which is a symlink to '/private/tmp'.
 * We resolve through realpath so that mount hostPaths match what
 * fs.realpath() returns inside resolveAndValidatePath().
 */
let tmpDir: string

beforeEach(async () => {
  const rawTmp = await fs.mkdtemp(path.join(os.tmpdir(), 'file-tools-test-'))
  tmpDir = await fs.realpath(rawTmp)
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

/** Build a minimal policy with a single rw project mount + n8n-desk dirs. */
async function makeTestPolicy(projectDir: string): Promise<FilesystemSandboxPolicy> {
  const n8nDeskDir = path.join(tmpDir, '.n8n-desk')
  const skillsDir = path.join(n8nDeskDir, 'skills')
  await fs.mkdir(skillsDir, { recursive: true })

  return buildCoworkPolicy([{ path: projectDir }], n8nDeskDir)
}

/** Build a minimal policy from raw mounts (for targeted tests). */
function makePolicyFromMounts(
  mounts: SandboxFolderMount[],
  n8nDeskDir?: string,
): FilesystemSandboxPolicy {
  return {
    mounts,
    n8nDeskDir: n8nDeskDir ?? path.join(tmpDir, '.n8n-desk'),
  }
}

// ---------------------------------------------------------------------------
// Tool count and names
// ---------------------------------------------------------------------------

describe('createFileTools', () => {
  it('returns exactly 13 tools', async () => {
    const projectDir = path.join(tmpDir, 'project')
    await fs.mkdir(projectDir, { recursive: true })
    const policy = await makeTestPolicy(projectDir)
    const tools = createFileTools(policy)

    expect(tools).toHaveLength(13)
  })

  it('returns tools with expected names', async () => {
    const projectDir = path.join(tmpDir, 'project')
    await fs.mkdir(projectDir, { recursive: true })
    const policy = await makeTestPolicy(projectDir)
    const tools = createFileTools(policy)

    const toolNames = tools.map((t: { name: string }) => t.name).sort()
    const expectedNames = [
      'read_csv',
      'read_docx',
      'read_excel',
      'read_json',
      'read_pdf',
      'read_text',
      'read_yaml',
      'write_csv',
      'write_docx',
      'write_excel',
      'write_json',
      'write_text',
      'write_yaml',
    ].sort()

    expect(toolNames).toEqual(expectedNames)
  })
})

// ---------------------------------------------------------------------------
// Sandbox enforcement — paths outside mounts
// ---------------------------------------------------------------------------

describe('tools reject paths outside sandbox', () => {
  it('read_text rejects path outside any mount', async () => {
    const projectDir = path.join(tmpDir, 'project')
    const outsideDir = path.join(tmpDir, 'outside')
    await fs.mkdir(projectDir, { recursive: true })
    await fs.mkdir(outsideDir, { recursive: true })
    await fs.writeFile(path.join(outsideDir, 'secret.txt'), 'secret data')

    const policy = await makeTestPolicy(projectDir)
    const tools = createFileTools(policy)
    const readText = tools.find((t: { name: string }) => t.name === 'read_text')!

    const resultStr = await readText.invoke({ path: path.join(outsideDir, 'secret.txt') })
    const result = JSON.parse(resultStr)

    expect(result.success).toBe(false)
    expect(result.error).toContain('outside all allowed folders')
  })

  it('write_text rejects path outside any mount', async () => {
    const projectDir = path.join(tmpDir, 'project')
    const outsideDir = path.join(tmpDir, 'outside')
    await fs.mkdir(projectDir, { recursive: true })
    await fs.mkdir(outsideDir, { recursive: true })

    const policy = await makeTestPolicy(projectDir)
    const tools = createFileTools(policy)
    const writeText = tools.find((t: { name: string }) => t.name === 'write_text')!

    const resultStr = await writeText.invoke({
      path: path.join(outsideDir, 'output.txt'),
      content: 'should not be written',
    })
    const result = JSON.parse(resultStr)

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('read_json rejects path outside any mount', async () => {
    const projectDir = path.join(tmpDir, 'project')
    const outsideDir = path.join(tmpDir, 'outside')
    await fs.mkdir(projectDir, { recursive: true })
    await fs.mkdir(outsideDir, { recursive: true })
    await fs.writeFile(path.join(outsideDir, 'data.json'), '{"key": "value"}')

    const policy = await makeTestPolicy(projectDir)
    const tools = createFileTools(policy)
    const readJson = tools.find((t: { name: string }) => t.name === 'read_json')!

    const resultStr = await readJson.invoke({ path: path.join(outsideDir, 'data.json') })
    const result = JSON.parse(resultStr)

    expect(result.success).toBe(false)
    expect(result.error).toContain('outside all allowed folders')
  })

  it('write_json rejects path outside any mount', async () => {
    const projectDir = path.join(tmpDir, 'project')
    const outsideDir = path.join(tmpDir, 'outside')
    await fs.mkdir(projectDir, { recursive: true })
    await fs.mkdir(outsideDir, { recursive: true })

    const policy = await makeTestPolicy(projectDir)
    const tools = createFileTools(policy)
    const writeJson = tools.find((t: { name: string }) => t.name === 'write_json')!

    const resultStr = await writeJson.invoke({
      path: path.join(outsideDir, 'output.json'),
      data: { test: true },
    })
    const result = JSON.parse(resultStr)

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('read_csv rejects path outside any mount', async () => {
    const projectDir = path.join(tmpDir, 'project')
    const outsideDir = path.join(tmpDir, 'outside')
    await fs.mkdir(projectDir, { recursive: true })
    await fs.mkdir(outsideDir, { recursive: true })
    await fs.writeFile(path.join(outsideDir, 'data.csv'), 'a,b\n1,2\n')

    const policy = await makeTestPolicy(projectDir)
    const tools = createFileTools(policy)
    const readCsv = tools.find((t: { name: string }) => t.name === 'read_csv')!

    const resultStr = await readCsv.invoke({ path: path.join(outsideDir, 'data.csv') })
    const result = JSON.parse(resultStr)

    expect(result.success).toBe(false)
    expect(result.error).toContain('outside all allowed folders')
  })
})

// ---------------------------------------------------------------------------
// Read deny-list enforcement (.env blocked even in attached folder)
// ---------------------------------------------------------------------------

describe('tools respect read deny-lists', () => {
  it('read_text blocks .env file even inside attached folder', async () => {
    const projectDir = path.join(tmpDir, 'project')
    await fs.mkdir(projectDir, { recursive: true })
    await fs.writeFile(path.join(projectDir, 'database.env'), 'DB_PASSWORD=secret')

    const policy = await makeTestPolicy(projectDir)
    const tools = createFileTools(policy)
    const readText = tools.find((t: { name: string }) => t.name === 'read_text')!

    const resultStr = await readText.invoke({ path: path.join(projectDir, 'database.env') })
    const result = JSON.parse(resultStr)

    expect(result.success).toBe(false)
    expect(result.error).toContain('.env')
    expect(result.error).toContain('blocked for security')
  })

  it('read_json blocks .env file even when targeting json reader', async () => {
    // A .env file attempted through read_json should still be blocked by deny-list
    const projectDir = path.join(tmpDir, 'project')
    await fs.mkdir(projectDir, { recursive: true })
    await fs.writeFile(path.join(projectDir, 'secrets.env'), 'API_KEY=abc123')

    const policy = await makeTestPolicy(projectDir)
    const tools = createFileTools(policy)
    const readJson = tools.find((t: { name: string }) => t.name === 'read_json')!

    const resultStr = await readJson.invoke({ path: path.join(projectDir, 'secrets.env') })
    const result = JSON.parse(resultStr)

    expect(result.success).toBe(false)
    expect(result.error).toContain('.env')
    expect(result.error).toContain('blocked for security')
  })

  it('read_text blocks .pem file in attached folder', async () => {
    const projectDir = path.join(tmpDir, 'project')
    await fs.mkdir(projectDir, { recursive: true })
    await fs.writeFile(path.join(projectDir, 'cert.pem'), '-----BEGIN CERTIFICATE-----')

    const policy = await makeTestPolicy(projectDir)
    const tools = createFileTools(policy)
    const readText = tools.find((t: { name: string }) => t.name === 'read_text')!

    const resultStr = await readText.invoke({ path: path.join(projectDir, 'cert.pem') })
    const result = JSON.parse(resultStr)

    expect(result.success).toBe(false)
    expect(result.error).toContain('.pem')
    expect(result.error).toContain('blocked for security')
  })

  it('read_text blocks .key file in attached folder', async () => {
    const projectDir = path.join(tmpDir, 'project')
    await fs.mkdir(projectDir, { recursive: true })
    await fs.writeFile(path.join(projectDir, 'private.key'), '-----BEGIN RSA PRIVATE KEY-----')

    const policy = await makeTestPolicy(projectDir)
    const tools = createFileTools(policy)
    const readText = tools.find((t: { name: string }) => t.name === 'read_text')!

    const resultStr = await readText.invoke({ path: path.join(projectDir, 'private.key') })
    const result = JSON.parse(resultStr)

    expect(result.success).toBe(false)
    expect(result.error).toContain('.key')
    expect(result.error).toContain('blocked for security')
  })

  it('read_text blocks llm.json under ~/.n8n-desk/', async () => {
    const projectDir = path.join(tmpDir, 'project')
    const n8nDeskDir = path.join(tmpDir, '.n8n-desk')
    const skillsDir = path.join(n8nDeskDir, 'skills')
    await fs.mkdir(projectDir, { recursive: true })
    await fs.mkdir(skillsDir, { recursive: true })
    await fs.writeFile(path.join(n8nDeskDir, 'llm.json'), '{"apiKey": "sk-secret"}')

    const policy = buildCoworkPolicy([{ path: projectDir }], n8nDeskDir)
    const tools = createFileTools(policy)
    const readText = tools.find((t: { name: string }) => t.name === 'read_text')!

    const resultStr = await readText.invoke({ path: path.join(n8nDeskDir, 'llm.json') })
    const result = JSON.parse(resultStr)

    expect(result.success).toBe(false)
    expect(result.error).toContain('blocked for security')
  })

  it('read_text allows auth.json in user project (not under ~/.n8n-desk/)', async () => {
    const projectDir = path.join(tmpDir, 'project')
    const n8nDeskDir = path.join(tmpDir, '.n8n-desk')
    const skillsDir = path.join(n8nDeskDir, 'skills')
    await fs.mkdir(projectDir, { recursive: true })
    await fs.mkdir(skillsDir, { recursive: true })
    await fs.writeFile(path.join(projectDir, 'auth.json'), '{"allowed": true}')

    const policy = buildCoworkPolicy([{ path: projectDir }], n8nDeskDir)
    const tools = createFileTools(policy)
    const readJson = tools.find((t: { name: string }) => t.name === 'read_json')!

    const resultStr = await readJson.invoke({ path: path.join(projectDir, 'auth.json') })
    const result = JSON.parse(resultStr)

    expect(result.success).toBe(true)
    expect(result.data).toEqual({ allowed: true })
  })
})

// ---------------------------------------------------------------------------
// Write deny-list enforcement (.exe write blocked)
// ---------------------------------------------------------------------------

describe('tools respect write deny-lists', () => {
  it('write_text blocks .exe file write', async () => {
    const projectDir = path.join(tmpDir, 'project')
    await fs.mkdir(projectDir, { recursive: true })

    const policy = await makeTestPolicy(projectDir)
    const tools = createFileTools(policy)
    const writeText = tools.find((t: { name: string }) => t.name === 'write_text')!

    const resultStr = await writeText.invoke({
      path: path.join(projectDir, 'malware.exe'),
      content: 'binary content',
    })
    const result = JSON.parse(resultStr)

    expect(result.success).toBe(false)
    expect(result.error).toContain('.exe')
  })

  it('write_text blocks .sh file write', async () => {
    const projectDir = path.join(tmpDir, 'project')
    await fs.mkdir(projectDir, { recursive: true })

    const policy = await makeTestPolicy(projectDir)
    const tools = createFileTools(policy)
    const writeText = tools.find((t: { name: string }) => t.name === 'write_text')!

    const resultStr = await writeText.invoke({
      path: path.join(projectDir, 'script.sh'),
      content: '#!/bin/bash\nrm -rf /',
    })
    const result = JSON.parse(resultStr)

    expect(result.success).toBe(false)
    expect(result.error).toContain('.sh')
  })

  it('write_text blocks .bat file write', async () => {
    const projectDir = path.join(tmpDir, 'project')
    await fs.mkdir(projectDir, { recursive: true })

    const policy = await makeTestPolicy(projectDir)
    const tools = createFileTools(policy)
    const writeText = tools.find((t: { name: string }) => t.name === 'write_text')!

    const resultStr = await writeText.invoke({
      path: path.join(projectDir, 'script.bat'),
      content: 'del /f /q C:\\*',
    })
    const result = JSON.parse(resultStr)

    expect(result.success).toBe(false)
    expect(result.error).toContain('.bat')
  })

  it('write_json blocks .dll file write', async () => {
    const projectDir = path.join(tmpDir, 'project')
    await fs.mkdir(projectDir, { recursive: true })

    const policy = await makeTestPolicy(projectDir)
    const tools = createFileTools(policy)
    const writeJson = tools.find((t: { name: string }) => t.name === 'write_json')!

    const resultStr = await writeJson.invoke({
      path: path.join(projectDir, 'library.dll'),
      data: { fake: true },
    })
    const result = JSON.parse(resultStr)

    expect(result.success).toBe(false)
    expect(result.error).toContain('.dll')
  })

  it('write to read-only mount is blocked', async () => {
    const n8nDeskDir = path.join(tmpDir, '.n8n-desk')
    const skillsDir = path.join(n8nDeskDir, 'skills')
    await fs.mkdir(skillsDir, { recursive: true })

    // Build policy with no attached folders — only n8n-desk ro and skills rw
    const policy = buildCoworkPolicy([], n8nDeskDir)
    const tools = createFileTools(policy)
    const writeText = tools.find((t: { name: string }) => t.name === 'write_text')!

    const resultStr = await writeText.invoke({
      path: path.join(n8nDeskDir, 'should-not-write.md'),
      content: 'attempt',
    })
    const result = JSON.parse(resultStr)

    expect(result.success).toBe(false)
    expect(result.error).toContain('read-only')
  })
})

// ---------------------------------------------------------------------------
// Happy path — tools work for allowed paths
// ---------------------------------------------------------------------------

describe('tools work for allowed paths', () => {
  it('read_text reads a .txt file in sandbox mount', async () => {
    const projectDir = path.join(tmpDir, 'project')
    await fs.mkdir(projectDir, { recursive: true })
    await fs.writeFile(path.join(projectDir, 'readme.txt'), 'Hello, world!')

    const policy = await makeTestPolicy(projectDir)
    const tools = createFileTools(policy)
    const readText = tools.find((t: { name: string }) => t.name === 'read_text')!

    const resultStr = await readText.invoke({ path: path.join(projectDir, 'readme.txt') })
    const result = JSON.parse(resultStr)

    expect(result.success).toBe(true)
    expect(result.content).toBe('Hello, world!')
    expect(result.sizeBytes).toBeGreaterThan(0)
    expect(result.lineCount).toBe(1)
  })

  it('write_text writes a .md file in sandbox mount', async () => {
    const projectDir = path.join(tmpDir, 'project')
    await fs.mkdir(projectDir, { recursive: true })

    const policy = await makeTestPolicy(projectDir)
    const tools = createFileTools(policy)
    const writeText = tools.find((t: { name: string }) => t.name === 'write_text')!

    const filePath = path.join(projectDir, 'output.md')
    const resultStr = await writeText.invoke({
      path: filePath,
      content: '# Test Output\n\nSome content here.',
    })
    const result = JSON.parse(resultStr)

    expect(result.success).toBe(true)
    expect(result.sizeBytes).toBeGreaterThan(0)

    // Verify file was actually written
    const written = await fs.readFile(filePath, 'utf-8')
    expect(written).toBe('# Test Output\n\nSome content here.')
  })

  it('read_json + write_json round-trip through sandbox', async () => {
    const projectDir = path.join(tmpDir, 'project')
    await fs.mkdir(projectDir, { recursive: true })

    const policy = await makeTestPolicy(projectDir)
    const tools = createFileTools(policy)
    const writeJson = tools.find((t: { name: string }) => t.name === 'write_json')!
    const readJson = tools.find((t: { name: string }) => t.name === 'read_json')!

    const testData = { users: [{ name: 'Alice', age: 30 }, { name: 'Bob', age: 25 }] }
    const filePath = path.join(projectDir, 'users.json')

    // Write
    const writeResultStr = await writeJson.invoke({ path: filePath, data: testData })
    const writeResult = JSON.parse(writeResultStr)
    expect(writeResult.success).toBe(true)

    // Read back
    const readResultStr = await readJson.invoke({ path: filePath })
    const readResult = JSON.parse(readResultStr)
    expect(readResult.success).toBe(true)
    expect(readResult.data).toEqual(testData)
  })

  it('read_yaml + write_yaml round-trip through sandbox', async () => {
    const projectDir = path.join(tmpDir, 'project')
    await fs.mkdir(projectDir, { recursive: true })

    const policy = await makeTestPolicy(projectDir)
    const tools = createFileTools(policy)
    const writeYaml = tools.find((t: { name: string }) => t.name === 'write_yaml')!
    const readYaml = tools.find((t: { name: string }) => t.name === 'read_yaml')!

    const testData = { server: { host: 'localhost', port: 3000 } }
    const filePath = path.join(projectDir, 'config.yaml')

    // Write
    const writeResultStr = await writeYaml.invoke({ path: filePath, data: testData })
    const writeResult = JSON.parse(writeResultStr)
    expect(writeResult.success).toBe(true)

    // Read back
    const readResultStr = await readYaml.invoke({ path: filePath })
    const readResult = JSON.parse(readResultStr)
    expect(readResult.success).toBe(true)
    expect(readResult.data).toEqual(testData)
  })

  it('read_csv reads a CSV file in sandbox mount', async () => {
    const projectDir = path.join(tmpDir, 'project')
    await fs.mkdir(projectDir, { recursive: true })
    await fs.writeFile(
      path.join(projectDir, 'data.csv'),
      'name,age,city\nAlice,30,NYC\nBob,25,LA\n',
    )

    const policy = await makeTestPolicy(projectDir)
    const tools = createFileTools(policy)
    const readCsv = tools.find((t: { name: string }) => t.name === 'read_csv')!

    const resultStr = await readCsv.invoke({ path: path.join(projectDir, 'data.csv') })
    const result = JSON.parse(resultStr)

    expect(result.success).toBe(true)
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0]).toHaveProperty('name', 'Alice')
  })

  it('write_csv writes a CSV file in sandbox mount', async () => {
    const projectDir = path.join(tmpDir, 'project')
    await fs.mkdir(projectDir, { recursive: true })

    const policy = await makeTestPolicy(projectDir)
    const tools = createFileTools(policy)
    const writeCsv = tools.find((t: { name: string }) => t.name === 'write_csv')!

    const filePath = path.join(projectDir, 'output.csv')
    const resultStr = await writeCsv.invoke({
      path: filePath,
      rows: [
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
      ],
    })
    const result = JSON.parse(resultStr)

    expect(result.success).toBe(true)

    // Verify file exists on disk
    const written = await fs.readFile(filePath, 'utf-8')
    expect(written).toContain('Alice')
    expect(written).toContain('Bob')
  })

  it('write to ~/.n8n-desk/skills/ succeeds (rw mount)', async () => {
    const projectDir = path.join(tmpDir, 'project')
    const n8nDeskDir = path.join(tmpDir, '.n8n-desk')
    const skillsDir = path.join(n8nDeskDir, 'skills')
    await fs.mkdir(projectDir, { recursive: true })
    await fs.mkdir(skillsDir, { recursive: true })

    const policy = buildCoworkPolicy([{ path: projectDir }], n8nDeskDir)
    const tools = createFileTools(policy)
    const writeText = tools.find((t: { name: string }) => t.name === 'write_text')!

    const filePath = path.join(skillsDir, 'my-skill.md')
    const resultStr = await writeText.invoke({
      path: filePath,
      content: '# My Skill\n\nDoes something useful.',
    })
    const result = JSON.parse(resultStr)

    expect(result.success).toBe(true)

    // Verify file was written
    const written = await fs.readFile(filePath, 'utf-8')
    expect(written).toContain('My Skill')
  })
})

// ---------------------------------------------------------------------------
// All tools return JSON.stringify results
// ---------------------------------------------------------------------------

describe('tools return JSON.stringify results', () => {
  it('successful read returns valid JSON string', async () => {
    const projectDir = path.join(tmpDir, 'project')
    await fs.mkdir(projectDir, { recursive: true })
    await fs.writeFile(path.join(projectDir, 'test.txt'), 'content')

    const policy = await makeTestPolicy(projectDir)
    const tools = createFileTools(policy)
    const readText = tools.find((t: { name: string }) => t.name === 'read_text')!

    const resultStr = await readText.invoke({ path: path.join(projectDir, 'test.txt') })

    // Must be a string
    expect(typeof resultStr).toBe('string')

    // Must be valid JSON
    const parsed = JSON.parse(resultStr)
    expect(parsed).toBeDefined()
    expect(parsed.success).toBe(true)
  })

  it('successful write returns valid JSON string', async () => {
    const projectDir = path.join(tmpDir, 'project')
    await fs.mkdir(projectDir, { recursive: true })

    const policy = await makeTestPolicy(projectDir)
    const tools = createFileTools(policy)
    const writeText = tools.find((t: { name: string }) => t.name === 'write_text')!

    const resultStr = await writeText.invoke({
      path: path.join(projectDir, 'test.txt'),
      content: 'content',
    })

    expect(typeof resultStr).toBe('string')
    const parsed = JSON.parse(resultStr)
    expect(parsed).toBeDefined()
    expect(parsed.success).toBe(true)
  })

  it('error result returns valid JSON string with error field', async () => {
    const projectDir = path.join(tmpDir, 'project')
    await fs.mkdir(projectDir, { recursive: true })

    const policy = await makeTestPolicy(projectDir)
    const tools = createFileTools(policy)
    const readText = tools.find((t: { name: string }) => t.name === 'read_text')!

    // Try to read a path outside the sandbox
    const outsideDir = path.join(tmpDir, 'outside')
    await fs.mkdir(outsideDir, { recursive: true })
    await fs.writeFile(path.join(outsideDir, 'file.txt'), 'nope')

    const resultStr = await readText.invoke({ path: path.join(outsideDir, 'file.txt') })

    expect(typeof resultStr).toBe('string')
    const parsed = JSON.parse(resultStr)
    expect(parsed.success).toBe(false)
    expect(parsed.error).toBeDefined()
    expect(typeof parsed.error).toBe('string')
  })

  it('deny-list error returns valid JSON string', async () => {
    const projectDir = path.join(tmpDir, 'project')
    await fs.mkdir(projectDir, { recursive: true })
    await fs.writeFile(path.join(projectDir, 'secrets.env'), 'SECRET=val')

    const policy = await makeTestPolicy(projectDir)
    const tools = createFileTools(policy)
    const readText = tools.find((t: { name: string }) => t.name === 'read_text')!

    const resultStr = await readText.invoke({ path: path.join(projectDir, 'secrets.env') })

    expect(typeof resultStr).toBe('string')
    const parsed = JSON.parse(resultStr)
    expect(parsed.success).toBe(false)
    expect(typeof parsed.error).toBe('string')
  })

  it('all 13 tools return strings (not objects) from invoke', async () => {
    const projectDir = path.join(tmpDir, 'project')
    await fs.mkdir(projectDir, { recursive: true })

    // Create sample files for readers
    await fs.writeFile(path.join(projectDir, 'test.txt'), 'hello')
    await fs.writeFile(path.join(projectDir, 'test.json'), '{"a":1}')
    await fs.writeFile(path.join(projectDir, 'test.yaml'), 'key: value\n')
    await fs.writeFile(path.join(projectDir, 'test.csv'), 'a,b\n1,2\n')

    const policy = await makeTestPolicy(projectDir)
    const tools = createFileTools(policy)

    // Test a representative sample of tools — all should return strings
    const readTools = ['read_text', 'read_json', 'read_yaml', 'read_csv']
    for (const toolName of readTools) {
      const t = tools.find((tool: { name: string }) => tool.name === toolName)!
      const ext = toolName.replace('read_', '')
      const filePath = path.join(projectDir, `test.${ext === 'text' ? 'txt' : ext}`)
      const resultStr = await t.invoke({ path: filePath })
      expect(typeof resultStr).toBe('string')
      // Should not throw when parsing
      expect(() => JSON.parse(resultStr)).not.toThrow()
    }

    const writeTools = [
      { name: 'write_text', args: { path: path.join(projectDir, 'out.txt'), content: 'hi' } },
      { name: 'write_json', args: { path: path.join(projectDir, 'out.json'), data: { x: 1 } } },
      { name: 'write_yaml', args: { path: path.join(projectDir, 'out.yaml'), data: { y: 2 } } },
      { name: 'write_csv', args: { path: path.join(projectDir, 'out.csv'), rows: [{ a: 1 }] } },
    ]
    for (const { name, args } of writeTools) {
      const t = tools.find((tool: { name: string }) => tool.name === name)!
      const resultStr = await t.invoke(args)
      expect(typeof resultStr).toBe('string')
      expect(() => JSON.parse(resultStr)).not.toThrow()
    }
  })
})
