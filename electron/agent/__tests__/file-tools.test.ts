import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'

import { createFileTools } from '../file-tools'
import { buildCoworkPolicy } from '../sandbox-policy'
import type { FilesystemSandboxPolicy } from '../types'

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

// ---------------------------------------------------------------------------
// Tool count and names
// ---------------------------------------------------------------------------

describe('createFileTools', () => {
  it('returns exactly 22 tools', async () => {
    const projectDir = path.join(tmpDir, 'project')
    await fs.mkdir(projectDir, { recursive: true })
    const policy = await makeTestPolicy(projectDir)
    const tools = createFileTools(policy)

    expect(tools).toHaveLength(22)
  })

  it('returns tools with expected names', async () => {
    const projectDir = path.join(tmpDir, 'project')
    await fs.mkdir(projectDir, { recursive: true })
    const policy = await makeTestPolicy(projectDir)
    const tools = createFileTools(policy)

    const toolNames = tools.map((t: { name: string }) => t.name).sort()
    const expectedNames = [
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
    // The n8n-desk root is not mounted at all now, so a copy at the root is
    // simply outside the sandbox. Also verify the scoped filename deny-list
    // still blocks the file inside the mounted skills subtree.
    await fs.writeFile(path.join(n8nDeskDir, 'llm.json'), '{"apiKey": "sk-secret"}')
    await fs.writeFile(path.join(skillsDir, 'llm.json'), '{"apiKey": "sk-secret"}')

    const policy = buildCoworkPolicy([{ path: projectDir }], n8nDeskDir)
    const tools = createFileTools(policy)
    const readText = tools.find((t: { name: string }) => t.name === 'read_text')!

    const rootResult = JSON.parse(await readText.invoke({ path: path.join(n8nDeskDir, 'llm.json') }))
    expect(rootResult.success).toBe(false)
    expect(rootResult.error).toContain('outside all allowed folders')

    const skillsResult = JSON.parse(await readText.invoke({ path: path.join(skillsDir, 'llm.json') }))
    expect(skillsResult.success).toBe(false)
    expect(skillsResult.error).toContain('blocked for security')
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
    const roDir = path.join(tmpDir, 'ro-folder')
    await fs.mkdir(skillsDir, { recursive: true })
    await fs.mkdir(roDir, { recursive: true })

    // Attach a folder in user-chosen read-only mode
    const policy = buildCoworkPolicy([{ path: roDir, mode: 'ro' }], n8nDeskDir)
    const tools = createFileTools(policy)
    const writeText = tools.find((t: { name: string }) => t.name === 'write_text')!

    const resultStr = await writeText.invoke({
      path: path.join(roDir, 'should-not-write.md'),
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

// ---------------------------------------------------------------------------
// list_files
// ---------------------------------------------------------------------------

describe('list_files', () => {
  it('lists files and directories with type and size', async () => {
    const projectDir = path.join(tmpDir, 'project')
    await fs.mkdir(projectDir, { recursive: true })
    await fs.writeFile(path.join(projectDir, 'a.txt'), 'aaa')
    await fs.writeFile(path.join(projectDir, 'b.json'), '{}')
    await fs.mkdir(path.join(projectDir, 'subdir'))

    const policy = await makeTestPolicy(projectDir)
    const tools = createFileTools(policy)
    const listFiles = tools.find((t: { name: string }) => t.name === 'list_files')!

    const result = JSON.parse(await listFiles.invoke({ path: projectDir }))

    expect(result.success).toBe(true)
    expect(result.entries).toHaveLength(3)

    const file = result.entries.find((e: { name: string }) => e.name === 'a.txt')
    expect(file).toMatchObject({ type: 'file', size: 3 })

    const dir = result.entries.find((e: { name: string }) => e.name === 'subdir')
    expect(dir).toMatchObject({ type: 'directory' })
  })

  it('skips hidden files and directories by default', async () => {
    const projectDir = path.join(tmpDir, 'project')
    await fs.mkdir(projectDir, { recursive: true })
    await fs.writeFile(path.join(projectDir, 'visible.txt'), 'x')
    await fs.writeFile(path.join(projectDir, '.hidden'), 'x')
    await fs.mkdir(path.join(projectDir, '.hidden-dir'))

    const policy = await makeTestPolicy(projectDir)
    const tools = createFileTools(policy)
    const listFiles = tools.find((t: { name: string }) => t.name === 'list_files')!

    const result = JSON.parse(await listFiles.invoke({ path: projectDir }))

    expect(result.success).toBe(true)
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].name).toBe('visible.txt')
  })

  it('recursive: true descends into subdirectories', async () => {
    const projectDir = path.join(tmpDir, 'project')
    await fs.mkdir(path.join(projectDir, 'a', 'b'), { recursive: true })
    await fs.writeFile(path.join(projectDir, 'a', 'b', 'deep.txt'), 'x')

    const policy = await makeTestPolicy(projectDir)
    const tools = createFileTools(policy)
    const listFiles = tools.find((t: { name: string }) => t.name === 'list_files')!

    const flat = JSON.parse(await listFiles.invoke({ path: projectDir }))
    const flatNames = flat.entries.map((e: { name: string }) => e.name)
    expect(flatNames).not.toContain(path.join('a', 'b', 'deep.txt'))

    const recursive = JSON.parse(
      await listFiles.invoke({ path: projectDir, recursive: true }),
    )
    const names = recursive.entries.map((e: { name: string }) => e.name)
    expect(names).toContain(path.join('a', 'b', 'deep.txt'))
  })

  it('recursive caps at depth 5', async () => {
    const projectDir = path.join(tmpDir, 'project')
    // Create 7 nested directories with a file inside the deepest
    let current = projectDir
    for (let i = 0; i < 7; i++) {
      current = path.join(current, `d${i}`)
      await fs.mkdir(current, { recursive: true })
    }
    await fs.writeFile(path.join(current, 'leaf.txt'), 'leaf')

    const policy = await makeTestPolicy(projectDir)
    const tools = createFileTools(policy)
    const listFiles = tools.find((t: { name: string }) => t.name === 'list_files')!

    const result = JSON.parse(
      await listFiles.invoke({ path: projectDir, recursive: true }),
    )
    expect(result.success).toBe(true)
    const names = result.entries.map((e: { name: string }) => e.name)
    expect(names).not.toContain(
      path.join('d0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'leaf.txt'),
    )
  })

  it('pattern filter matches case-insensitively', async () => {
    const projectDir = path.join(tmpDir, 'project')
    await fs.mkdir(projectDir, { recursive: true })
    await fs.writeFile(path.join(projectDir, 'Report.txt'), '')
    await fs.writeFile(path.join(projectDir, 'invoice.txt'), '')
    await fs.writeFile(path.join(projectDir, 'notes.md'), '')

    const policy = await makeTestPolicy(projectDir)
    const tools = createFileTools(policy)
    const listFiles = tools.find((t: { name: string }) => t.name === 'list_files')!

    const result = JSON.parse(
      await listFiles.invoke({ path: projectDir, pattern: 'REPORT' }),
    )
    expect(result.success).toBe(true)
    const names = result.entries.map((e: { name: string }) => e.name)
    expect(names).toContain('Report.txt')
    expect(names).not.toContain('invoice.txt')
  })

  it('rejects path outside any mount', async () => {
    const projectDir = path.join(tmpDir, 'project')
    const outsideDir = path.join(tmpDir, 'outside')
    await fs.mkdir(projectDir, { recursive: true })
    await fs.mkdir(outsideDir, { recursive: true })

    const policy = await makeTestPolicy(projectDir)
    const tools = createFileTools(policy)
    const listFiles = tools.find((t: { name: string }) => t.name === 'list_files')!

    const result = JSON.parse(await listFiles.invoke({ path: outsideDir }))
    expect(result.success).toBe(false)
    expect(result.error).toContain('outside all allowed folders')
  })

  it('truncates at 500 entries with a flag', async () => {
    const projectDir = path.join(tmpDir, 'project')
    await fs.mkdir(projectDir, { recursive: true })
    // Create 510 small files
    const writes: Promise<void>[] = []
    for (let i = 0; i < 510; i++) {
      writes.push(fs.writeFile(path.join(projectDir, `f${i}.txt`), ''))
    }
    await Promise.all(writes)

    const policy = await makeTestPolicy(projectDir)
    const tools = createFileTools(policy)
    const listFiles = tools.find((t: { name: string }) => t.name === 'list_files')!

    const result = JSON.parse(await listFiles.invoke({ path: projectDir }))
    expect(result.success).toBe(true)
    expect(result.entries).toHaveLength(500)
    expect(result.truncated).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// search_files
// ---------------------------------------------------------------------------

describe('search_files', () => {
  it('finds query and returns 1-based line numbers', async () => {
    const projectDir = path.join(tmpDir, 'project')
    await fs.mkdir(projectDir, { recursive: true })
    await fs.writeFile(
      path.join(projectDir, 'notes.txt'),
      'first line\nNEEDLE here\nthird line\n',
    )
    await fs.writeFile(path.join(projectDir, 'other.txt'), 'no match\n')

    const policy = await makeTestPolicy(projectDir)
    const tools = createFileTools(policy)
    const searchFiles = tools.find((t: { name: string }) => t.name === 'search_files')!

    const result = JSON.parse(
      await searchFiles.invoke({ path: projectDir, query: 'needle' }),
    )

    expect(result.success).toBe(true)
    expect(result.matches).toHaveLength(1)
    expect(result.matches[0]).toMatchObject({
      file: 'notes.txt',
      line: 2,
    })
    expect(result.matches[0].content).toContain('NEEDLE')
  })

  it('respects extensions filter (with and without leading dot)', async () => {
    const projectDir = path.join(tmpDir, 'project')
    await fs.mkdir(projectDir, { recursive: true })
    await fs.writeFile(path.join(projectDir, 'a.json'), '{"k":"hit"}\n')
    await fs.writeFile(path.join(projectDir, 'b.txt'), 'hit\n')
    await fs.writeFile(path.join(projectDir, 'c.md'), 'hit\n')

    const policy = await makeTestPolicy(projectDir)
    const tools = createFileTools(policy)
    const searchFiles = tools.find((t: { name: string }) => t.name === 'search_files')!

    // Without leading dot
    const noDot = JSON.parse(
      await searchFiles.invoke({ path: projectDir, query: 'hit', extensions: ['json'] }),
    )
    expect(noDot.matches.map((m: { file: string }) => m.file)).toEqual(['a.json'])

    // With leading dot
    const dot = JSON.parse(
      await searchFiles.invoke({ path: projectDir, query: 'hit', extensions: ['.md'] }),
    )
    expect(dot.matches.map((m: { file: string }) => m.file)).toEqual(['c.md'])
  })

  it('skips files larger than 1MB', async () => {
    const projectDir = path.join(tmpDir, 'project')
    await fs.mkdir(projectDir, { recursive: true })
    // 1.5 MB file with the query inside
    const large = 'x'.repeat(1_500_000) + '\nNEEDLE\n'
    await fs.writeFile(path.join(projectDir, 'big.txt'), large)
    await fs.writeFile(path.join(projectDir, 'small.txt'), 'NEEDLE\n')

    const policy = await makeTestPolicy(projectDir)
    const tools = createFileTools(policy)
    const searchFiles = tools.find((t: { name: string }) => t.name === 'search_files')!

    const result = JSON.parse(
      await searchFiles.invoke({ path: projectDir, query: 'NEEDLE' }),
    )

    expect(result.success).toBe(true)
    expect(result.matches.map((m: { file: string }) => m.file)).toEqual(['small.txt'])
  })

  it('excludes deny-listed files (.env, .pem) from results', async () => {
    const projectDir = path.join(tmpDir, 'project')
    await fs.mkdir(projectDir, { recursive: true })
    await fs.writeFile(path.join(projectDir, 'config.env'), 'SECRET=NEEDLE\n')
    await fs.writeFile(path.join(projectDir, 'cert.pem'), '-----NEEDLE-----\n')
    await fs.writeFile(path.join(projectDir, 'safe.txt'), 'NEEDLE here\n')

    const policy = await makeTestPolicy(projectDir)
    const tools = createFileTools(policy)
    const searchFiles = tools.find((t: { name: string }) => t.name === 'search_files')!

    const result = JSON.parse(
      await searchFiles.invoke({ path: projectDir, query: 'NEEDLE' }),
    )

    expect(result.success).toBe(true)
    const files = result.matches.map((m: { file: string }) => m.file)
    expect(files).toContain('safe.txt')
    expect(files).not.toContain('config.env')
    expect(files).not.toContain('cert.pem')
  })

  it('returns empty matches when nothing matches (still success)', async () => {
    const projectDir = path.join(tmpDir, 'project')
    await fs.mkdir(projectDir, { recursive: true })
    await fs.writeFile(path.join(projectDir, 'a.txt'), 'hello world\n')

    const policy = await makeTestPolicy(projectDir)
    const tools = createFileTools(policy)
    const searchFiles = tools.find((t: { name: string }) => t.name === 'search_files')!

    const result = JSON.parse(
      await searchFiles.invoke({ path: projectDir, query: 'definitely-not-here' }),
    )

    expect(result.success).toBe(true)
    expect(result.matches).toEqual([])
  })

  it('truncates at 100 matches with a flag', async () => {
    const projectDir = path.join(tmpDir, 'project')
    await fs.mkdir(projectDir, { recursive: true })
    // 110 lines all containing the query
    const lines = Array.from({ length: 110 }, (_, i) => `line ${i} HIT`).join('\n') + '\n'
    await fs.writeFile(path.join(projectDir, 'many.txt'), lines)

    const policy = await makeTestPolicy(projectDir)
    const tools = createFileTools(policy)
    const searchFiles = tools.find((t: { name: string }) => t.name === 'search_files')!

    const result = JSON.parse(
      await searchFiles.invoke({ path: projectDir, query: 'HIT' }),
    )

    expect(result.success).toBe(true)
    expect(result.matches).toHaveLength(100)
    expect(result.truncated).toBe(true)
  })

  it('rejects path outside any mount', async () => {
    const projectDir = path.join(tmpDir, 'project')
    const outsideDir = path.join(tmpDir, 'outside')
    await fs.mkdir(projectDir, { recursive: true })
    await fs.mkdir(outsideDir, { recursive: true })

    const policy = await makeTestPolicy(projectDir)
    const tools = createFileTools(policy)
    const searchFiles = tools.find((t: { name: string }) => t.name === 'search_files')!

    const result = JSON.parse(
      await searchFiles.invoke({ path: outsideDir, query: 'x' }),
    )
    expect(result.success).toBe(false)
    expect(result.error).toContain('outside all allowed folders')
  })
})

// ---------------------------------------------------------------------------
// edit_text — partial edits (#7)
// ---------------------------------------------------------------------------

describe('edit_text', () => {
  async function setupEditFixture() {
    const projectDir = path.join(tmpDir, 'project')
    await fs.mkdir(projectDir, { recursive: true })
    const policy = await makeTestPolicy(projectDir)
    const tools = createFileTools(policy)
    const editFile = tools.find((t: { name: string }) => t.name === 'edit_text')!
    const filePath = path.join(projectDir, 'config.md')
    await fs.writeFile(filePath, '# Config\n\nvalue: alpha\nother: alpha\n')
    return { editFile, filePath, projectDir, policy }
  }

  it('replaces a unique match', async () => {
    const { editFile, filePath } = await setupEditFixture()
    const result = JSON.parse(await editFile.invoke({
      path: filePath,
      old_string: 'value: alpha',
      new_string: 'value: beta',
    }))
    expect(result.success).toBe(true)
    expect(result.replacements).toBe(1)
    const content = await fs.readFile(filePath, 'utf-8')
    expect(content).toContain('value: beta')
    expect(content).toContain('other: alpha')
  })

  it('rejects an ambiguous match unless replace_all is set', async () => {
    const { editFile, filePath } = await setupEditFixture()
    const ambiguous = JSON.parse(await editFile.invoke({
      path: filePath,
      old_string: 'alpha',
      new_string: 'gamma',
    }))
    expect(ambiguous.success).toBe(false)
    expect(ambiguous.error).toContain('2 times')

    const all = JSON.parse(await editFile.invoke({
      path: filePath,
      old_string: 'alpha',
      new_string: 'gamma',
      replace_all: true,
    }))
    expect(all.success).toBe(true)
    expect(all.replacements).toBe(2)
    const content = await fs.readFile(filePath, 'utf-8')
    expect(content).not.toContain('alpha')
  })

  it('errors clearly when old_string is not found', async () => {
    const { editFile, filePath } = await setupEditFixture()
    const result = JSON.parse(await editFile.invoke({
      path: filePath,
      old_string: 'does-not-exist',
      new_string: 'x',
    }))
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })

  it('is blocked on read-only mounts', async () => {
    const n8nDeskDir = path.join(tmpDir, '.n8n-desk')
    const roDir = path.join(tmpDir, 'ro-edit')
    await fs.mkdir(path.join(n8nDeskDir, 'skills'), { recursive: true })
    await fs.mkdir(roDir, { recursive: true })
    await fs.writeFile(path.join(roDir, 'file.md'), 'content')

    const policy = buildCoworkPolicy([{ path: roDir, mode: 'ro' }], n8nDeskDir)
    const tools = createFileTools(policy)
    const editFile = tools.find((t: { name: string }) => t.name === 'edit_text')!

    const result = JSON.parse(await editFile.invoke({
      path: path.join(roDir, 'file.md'),
      old_string: 'content',
      new_string: 'changed',
    }))
    expect(result.success).toBe(false)
    expect(result.error).toContain('read-only')
  })

  it('is blocked outside the sandbox', async () => {
    const { editFile } = await setupEditFixture()
    const outside = path.join(tmpDir, 'outside.md')
    await fs.writeFile(outside, 'secret')
    const result = JSON.parse(await editFile.invoke({
      path: outside,
      old_string: 'secret',
      new_string: 'leak',
    }))
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// File management tools (audit #32)
// ---------------------------------------------------------------------------

describe('file management tools', () => {
  async function setupManageFixture() {
    const projectDir = path.join(tmpDir, 'project')
    await fs.mkdir(projectDir, { recursive: true })
    await fs.writeFile(path.join(projectDir, 'report.md'), 'the report')
    const policy = await makeTestPolicy(projectDir)
    const tools = createFileTools(policy)
    const get = (name: string) => tools.find((t: { name: string }) => t.name === name)!
    return { projectDir, tools, get }
  }

  it('move_file renames within the mount', async () => {
    const { projectDir, get } = await setupManageFixture()
    // Parent directories must already exist (same sandbox resolution rule as
    // the write tools — a not-yet-existing parent cannot be realpath'd).
    await fs.mkdir(path.join(projectDir, 'archive'), { recursive: true })
    const result = JSON.parse(await get('move_file').invoke({
      source: path.join(projectDir, 'report.md'),
      destination: path.join(projectDir, 'archive', 'report-final.md'),
    }))
    expect(result.success).toBe(true)
    await expect(fs.readFile(path.join(projectDir, 'archive', 'report-final.md'), 'utf-8'))
      .resolves.toBe('the report')
    await expect(fs.access(path.join(projectDir, 'report.md'))).rejects.toThrow()
  })

  it('move_file refuses to overwrite without the flag', async () => {
    const { projectDir, get } = await setupManageFixture()
    await fs.writeFile(path.join(projectDir, 'other.md'), 'existing')
    const result = JSON.parse(await get('move_file').invoke({
      source: path.join(projectDir, 'report.md'),
      destination: path.join(projectDir, 'other.md'),
    }))
    expect(result.success).toBe(false)
    expect(result.error).toContain('already exists')
  })

  it('move/copy refuse read-denied sources (.env exfiltration via rename)', async () => {
    const { projectDir, get } = await setupManageFixture()
    await fs.writeFile(path.join(projectDir, '.env'), 'SECRET=1')
    const moved = JSON.parse(await get('move_file').invoke({
      source: path.join(projectDir, '.env'),
      destination: path.join(projectDir, 'notes.txt'),
    }))
    expect(moved.success).toBe(false)
    const copied = JSON.parse(await get('copy_file').invoke({
      source: path.join(projectDir, '.env'),
      destination: path.join(projectDir, 'notes.txt'),
    }))
    expect(copied.success).toBe(false)
  })

  it('move/copy/delete refuse read-only mounts, executables, and outside paths', async () => {
    const n8nDeskDir = path.join(tmpDir, '.n8n-desk')
    const roDir = path.join(tmpDir, 'ro-manage')
    await fs.mkdir(path.join(n8nDeskDir, 'skills'), { recursive: true })
    await fs.mkdir(roDir, { recursive: true })
    await fs.writeFile(path.join(roDir, 'file.md'), 'x')
    const policy = buildCoworkPolicy([{ path: roDir, mode: 'ro' }], n8nDeskDir)
    const tools = createFileTools(policy)
    const get = (name: string) => tools.find((t: { name: string }) => t.name === name)!

    const del = JSON.parse(await get('delete_file').invoke({ path: path.join(roDir, 'file.md') }))
    expect(del.success).toBe(false)
    expect(del.error).toContain('read-only')

    const mv = JSON.parse(await get('move_file').invoke({
      source: path.join(roDir, 'file.md'),
      destination: path.join(roDir, 'renamed.md'),
    }))
    expect(mv.success).toBe(false)

    const outside = JSON.parse(await get('delete_file').invoke({ path: path.join(tmpDir, 'outside.md') }))
    expect(outside.success).toBe(false)
  })

  it('copy_file cannot create executables', async () => {
    const { projectDir, get } = await setupManageFixture()
    const result = JSON.parse(await get('copy_file').invoke({
      source: path.join(projectDir, 'report.md'),
      destination: path.join(projectDir, 'evil.sh'),
    }))
    expect(result.success).toBe(false)
  })

  it('delete_file falls back to permanent deletion outside Electron', async () => {
    const { projectDir, get } = await setupManageFixture()
    const result = JSON.parse(await get('delete_file').invoke({
      path: path.join(projectDir, 'report.md'),
    }))
    expect(result.success).toBe(true)
    expect(result.method).toBe('permanent') // no Electron shell in vitest
    await expect(fs.access(path.join(projectDir, 'report.md'))).rejects.toThrow()
  })

  it('open_path and clipboard degrade gracefully outside Electron', async () => {
    const { projectDir, get } = await setupManageFixture()
    const open = JSON.parse(await get('open_path').invoke({ path: path.join(projectDir, 'report.md') }))
    expect(open.success).toBe(false)
    expect(open.error).toContain('desktop app')

    const read = JSON.parse(await get('clipboard_read').invoke({}))
    expect(read.success).toBe(false)
    const write = JSON.parse(await get('clipboard_write').invoke({ text: 'hi' }))
    expect(write.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// read_text pagination + binary detection (audit #30)
// ---------------------------------------------------------------------------

describe('read_text pagination and binary detection', () => {
  it('paginates by lines with offset/limit and reports totals', async () => {
    const projectDir = path.join(tmpDir, 'project-rt')
    await fs.mkdir(projectDir, { recursive: true })
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i}`)
    await fs.writeFile(path.join(projectDir, 'big.txt'), lines.join('\n'))
    const policy = await makeTestPolicy(projectDir)
    const readText = createFileTools(policy).find((t: { name: string }) => t.name === 'read_text')!

    const page = JSON.parse(await readText.invoke({
      path: path.join(projectDir, 'big.txt'), offset: 10, limit: 5,
    }))
    expect(page.success).toBe(true)
    expect(page.content).toBe('line 10\nline 11\nline 12\nline 13\nline 14')
    expect(page.lineCount).toBe(50)
    expect(page.returnedLines).toBe(5)
    expect(page.truncated).toBe(true)

    const full = JSON.parse(await readText.invoke({ path: path.join(projectDir, 'big.txt') }))
    expect(full.truncated).toBe(false)
    expect(full.returnedLines).toBe(50)
  })

  it('rejects binary files with an actionable error', async () => {
    const projectDir = path.join(tmpDir, 'project-bin')
    await fs.mkdir(projectDir, { recursive: true })
    // PNG-ish header with NUL bytes
    await fs.writeFile(path.join(projectDir, 'image.dat'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]))
    const policy = await makeTestPolicy(projectDir)
    const readText = createFileTools(policy).find((t: { name: string }) => t.name === 'read_text')!

    const result = JSON.parse(await readText.invoke({ path: path.join(projectDir, 'image.dat') }))
    expect(result.success).toBe(false)
    expect(result.type).toBe('binary_file')
  })
})

// ---------------------------------------------------------------------------
// read_csv streaming offset (audit #55)
// ---------------------------------------------------------------------------

describe('read_csv offset pagination', () => {
  it('returns the requested window with exact totals', async () => {
    const projectDir = path.join(tmpDir, 'project-csv')
    await fs.mkdir(projectDir, { recursive: true })
    const rows = ['id,value', ...Array.from({ length: 300 }, (_, i) => `${i},val_${i}`)]
    await fs.writeFile(path.join(projectDir, 'data.csv'), rows.join('\n') + '\n')
    const policy = await makeTestPolicy(projectDir)
    const readCsv = createFileTools(policy).find((t: { name: string }) => t.name === 'read_csv')!

    const result = JSON.parse(await readCsv.invoke({
      path: path.join(projectDir, 'data.csv'), offset: 100, limit: 10,
    }))
    expect(result.success).toBe(true)
    expect(result.rows).toHaveLength(10)
    expect(result.rows[0].id).toBe(100)
    expect(result.totalRows).toBe(300)
    expect(result.truncated).toBe(true)
  })
})
