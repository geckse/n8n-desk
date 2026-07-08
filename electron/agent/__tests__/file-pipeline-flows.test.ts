/**
 * Realistic cross-tool flow tests for the file pipeline. These mirror what an
 * agent actually does — chain multiple tools to discover, read, transform,
 * and write data — exercising the path-handling between tool calls (the
 * output of one tool feeds the input of another).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'

import { createFileTools } from '../file-tools'
import { buildCoworkPolicy } from '../sandbox-policy'
import type { FilesystemSandboxPolicy } from '../types'

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tmpDir: string
let projectDir: string
let n8nDeskDir: string
let policy: FilesystemSandboxPolicy

beforeEach(async () => {
  const rawTmp = await fs.mkdtemp(path.join(os.tmpdir(), 'file-flow-test-'))
  tmpDir = await fs.realpath(rawTmp)
  projectDir = path.join(tmpDir, 'project')
  n8nDeskDir = path.join(tmpDir, '.n8n-desk')
  await fs.mkdir(projectDir, { recursive: true })
  await fs.mkdir(path.join(n8nDeskDir, 'skills'), { recursive: true })
  policy = buildCoworkPolicy([{ path: projectDir }], n8nDeskDir)
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getTool(name: string): any {
  const tools = createFileTools(policy)
  const t = tools.find((tool: { name: string }) => tool.name === name)
  if (!t) throw new Error(`Tool ${name} not found`)
  return t
}

async function invoke(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await getTool(name).invoke(args)
  return JSON.parse(result)
}

// ---------------------------------------------------------------------------
// Flow tests
// ---------------------------------------------------------------------------

describe('discover → read → transform → write', () => {
  it('list_files finds a CSV, read_csv parses it, write_json saves the transform', async () => {
    // Seed: a CSV with sales data
    const csvPath = path.join(projectDir, 'sales.csv')
    await fs.writeFile(
      csvPath,
      'product,units,price\nWidget,3,5\nGadget,2,10\nDoodad,5,2\n',
    )

    // Step 1: agent discovers files in the folder
    const ls = await invoke('list_files', { path: projectDir })
    expect(ls.success).toBe(true)
    const csvEntry = (ls.entries as Array<{ name: string; type: string }>).find(
      (e) => e.name.endsWith('.csv'),
    )
    expect(csvEntry).toBeDefined()

    // Step 2: agent reads the CSV using the discovered name
    const csv = await invoke('read_csv', {
      path: path.join(projectDir, csvEntry!.name),
    })
    expect(csv.success).toBe(true)
    const rows = csv.rows as Array<{ product: string; units: number; price: number }>

    // Step 3: agent transforms in-memory (compute revenue)
    const summary = rows.map((r) => ({
      product: r.product,
      revenue: r.units * r.price,
    }))

    // Step 4: agent writes the transform as JSON
    const jsonPath = path.join(projectDir, 'summary.json')
    const writeResult = await invoke('write_json', {
      path: jsonPath,
      data: summary,
    })
    expect(writeResult.success).toBe(true)

    // Verify final artifact
    const reread = await invoke('read_json', { path: jsonPath })
    expect(reread.data).toEqual([
      { product: 'Widget', revenue: 15 },
      { product: 'Gadget', revenue: 20 },
      { product: 'Doodad', revenue: 10 },
    ])
  })
})

describe('search → read', () => {
  it('search_files finds a hit, then read_text reads the file path it returned', async () => {
    // Seed: 3 files, one containing the keyword
    await fs.writeFile(path.join(projectDir, 'a.txt'), 'no match here\n')
    await fs.writeFile(
      path.join(projectDir, 'invoice.txt'),
      'AMOUNT_DUE: $1500\nVENDOR: Acme\n',
    )
    await fs.writeFile(path.join(projectDir, 'c.txt'), 'totally unrelated\n')

    // Step 1: search
    const search = await invoke('search_files', {
      path: projectDir,
      query: 'AMOUNT_DUE',
    })
    expect(search.success).toBe(true)
    const matches = search.matches as Array<{ file: string; line: number }>
    expect(matches).toHaveLength(1)
    expect(matches[0].file).toBe('invoice.txt')

    // Step 2: agent uses the returned relative path to read the file
    const fullPath = path.join(projectDir, matches[0].file)
    const readResult = await invoke('read_text', { path: fullPath })
    expect(readResult.success).toBe(true)
    expect(String(readResult.content)).toContain('AMOUNT_DUE: $1500')
  })
})

describe('Excel → CSV export', () => {
  it('reads sheet rows, writes them as CSV, re-read CSV matches', async () => {
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    const xlsxRows = [
      { name: 'Alice', dept: 'Sales' },
      { name: 'Bob', dept: 'Engineering' },
      { name: 'Eve', dept: 'Sales' },
    ]
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(xlsxRows),
      'Roster',
    )
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
    const xlsxPath = path.join(projectDir, 'roster.xlsx')
    await fs.writeFile(xlsxPath, buf)

    // Read excel
    const xlsx = await invoke('read_excel', { path: xlsxPath })
    expect(xlsx.success).toBe(true)
    const sheet = (xlsx.sheets as Array<{ rows: Record<string, unknown>[] }>)[0]
    expect(sheet.rows).toEqual(xlsxRows)

    // Write CSV
    const csvPath = path.join(projectDir, 'roster.csv')
    const writeResult = await invoke('write_csv', {
      path: csvPath,
      rows: sheet.rows,
    })
    expect(writeResult.success).toBe(true)

    // Re-read CSV — round-trip preserves data. Trim string fields because
    // PapaParse may include the trailing line-terminator on the last value
    // when no record terminator follows the final field.
    const csv = await invoke('read_csv', { path: csvPath })
    expect(csv.success).toBe(true)
    const csvRows = (csv.rows as Array<Record<string, unknown>>).map((r) => {
      const trimmed: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(r)) {
        trimmed[k] = typeof v === 'string' ? v.trim() : v
      }
      return trimmed
    })
    expect(csvRows).toEqual(xlsxRows)
  })
})

describe('PDF → text extraction', () => {
  it('reads a PDF, writes the text, reads it back', async () => {
    const fixtureSrc = path.join(
      path.resolve(__dirname, '..', '..', '..'),
      'node_modules', 'pdf-parse', 'test', 'data', '01-valid.pdf',
    )
    const pdfPath = path.join(projectDir, 'doc.pdf')
    await fs.copyFile(fixtureSrc, pdfPath)

    // Read PDF
    const pdf = await invoke('read_pdf', { path: pdfPath })
    expect(pdf.success).toBe(true)
    const extractedText = String(pdf.text)
    expect(extractedText.length).toBeGreaterThan(50)

    // Write extracted text
    const txtPath = path.join(projectDir, 'doc.txt')
    const writeResult = await invoke('write_text', {
      path: txtPath,
      content: extractedText,
    })
    expect(writeResult.success).toBe(true)

    // Re-read text
    const reread = await invoke('read_text', { path: txtPath })
    expect(reread.success).toBe(true)
    expect(reread.content).toBe(extractedText)
  })
})

describe('DOCX from markdown → re-list', () => {
  it('write_docx then list_files shows the file with size > 0', async () => {
    const docxPath = path.join(projectDir, 'report.docx')
    await invoke('write_docx', {
      path: docxPath,
      content: '# Quarterly Report\n\nKey insight: things are improving.\n',
    })

    const ls = await invoke('list_files', { path: projectDir })
    expect(ls.success).toBe(true)
    const entry = (ls.entries as Array<{ name: string; type: string; size?: number }>).find(
      (e) => e.name === 'report.docx',
    )
    expect(entry).toBeDefined()
    expect(entry!.type).toBe('file')
    expect(entry!.size).toBeGreaterThan(0)
  })
})

describe('skills mount round-trip', () => {
  it('write_text into ~/.n8n-desk/skills/ → list_files sees it', async () => {
    const skillsDir = path.join(n8nDeskDir, 'skills')
    const filePath = path.join(skillsDir, 'my-helper.md')

    const writeResult = await invoke('write_text', {
      path: filePath,
      content: '# My Helper\n\nA reusable skill.\n',
    })
    expect(writeResult.success).toBe(true)

    const ls = await invoke('list_files', { path: skillsDir })
    expect(ls.success).toBe(true)
    const entry = (ls.entries as Array<{ name: string }>).find(
      (e) => e.name === 'my-helper.md',
    )
    expect(entry).toBeDefined()
  })

  it('read_text outside the skills mount under ~/.n8n-desk/ is rejected', async () => {
    // Only ~/.n8n-desk/skills/ is mounted — a sibling file at the n8n-desk
    // root (instances, configs, session data) must be unreachable.
    const siblingPath = path.join(n8nDeskDir, 'global-config.md')
    await fs.writeFile(siblingPath, '# App-internal info\n')

    const result = await invoke('read_text', { path: siblingPath })
    expect(result.success).toBe(false)
    expect(String(result.error)).toContain('outside all allowed folders')
  })
})

describe('paths returned from one tool are still validated when fed to another', () => {
  it('a path that escapes via .. is rejected even if assembled from a tool result', async () => {
    // Seed: the agent runs list_files on projectDir, then tries to construct
    // a path string with ../ and feed it to read_text. The sandbox MUST still
    // catch this — there is no implicit "trust" between tool calls.
    await fs.mkdir(path.join(tmpDir, 'outside'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, 'outside', 'leak.txt'), 'leaked')

    // Even if the agent guesses an entry name, the sandbox checks the path:
    const escaping = path.join(projectDir, '..', 'outside', 'leak.txt')
    const result = await invoke('read_text', { path: escaping })

    expect(result.success).toBe(false)
    expect(String(result.error)).toContain('outside all allowed folders')
  })
})
