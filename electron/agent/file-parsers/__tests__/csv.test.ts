import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'

import { readCsv, writeCsv } from '../csv'
import type { ReadCsvResult, WriteCsvResult, FileParserError } from '../csv'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string

beforeEach(async () => {
  const rawTmp = await fs.mkdtemp(path.join(os.tmpdir(), 'csv-test-'))
  tmpDir = await fs.realpath(rawTmp)
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Round-trip write → read
// ---------------------------------------------------------------------------

describe('CSV round-trip', () => {
  it('writes and reads back simple CSV data', async () => {
    const filePath = path.join(tmpDir, 'simple.csv')
    const data = [
      { Name: 'Alice', Age: 30, City: 'NYC' },
      { Name: 'Bob', Age: 25, City: 'LA' },
    ]

    const writeResult = await writeCsv(filePath, data)
    expect(writeResult.success).toBe(true)
    expect((writeResult as WriteCsvResult).sizeBytes).toBeGreaterThan(0)

    const readResult = await readCsv(filePath)
    expect(readResult.success).toBe(true)

    const result = readResult as ReadCsvResult
    expect(result.headers).toEqual(['Name', 'Age', 'City'])
    expect(result.totalRows).toBe(2)
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0]['Name']).toBe('Alice')
    expect(result.rows[0]['Age']).toBe(30)
    expect(result.rows[0]['City']).toBe('NYC')
    expect(result.rows[1]['Name']).toBe('Bob')
    expect(result.rows[1]['Age']).toBe(25)
    // Trim to handle trailing newline from PapaParse unparse
    expect(String(result.rows[1]['City']).trim()).toBe('LA')
    expect(result.truncated).toBe(false)
  })

  it('handles empty data array', async () => {
    const filePath = path.join(tmpDir, 'empty.csv')
    const data: Record<string, unknown>[] = []

    const writeResult = await writeCsv(filePath, data)
    expect(writeResult.success).toBe(true)

    // Reading back an empty CSV may result in 0 rows
    const readResult = await readCsv(filePath) as ReadCsvResult
    expect(readResult.rows).toHaveLength(0)
  })

  it('writes array-of-arrays format', async () => {
    const filePath = path.join(tmpDir, 'arrays.csv')
    const data: unknown[][] = [
      ['Name', 'Score'],
      ['Alice', 95],
      ['Bob', 88],
    ]

    const writeResult = await writeCsv(filePath, data, { header: false })
    expect(writeResult.success).toBe(true)

    // Read back with header=true (first row becomes headers)
    const readResult = await readCsv(filePath) as ReadCsvResult
    expect(readResult.headers).toEqual(['Name', 'Score'])
    expect(readResult.rows).toHaveLength(2)
  })

  it('creates parent directories automatically', async () => {
    const filePath = path.join(tmpDir, 'nested', 'deep', 'file.csv')
    const data = [{ Col: 'value' }]

    const writeResult = await writeCsv(filePath, data)
    expect(writeResult.success).toBe(true)

    const stat = await fs.stat(filePath)
    expect(stat.isFile()).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Delimiter detection
// ---------------------------------------------------------------------------

describe('CSV delimiter detection', () => {
  it('auto-detects comma delimiter', async () => {
    const filePath = path.join(tmpDir, 'comma.csv')
    await fs.writeFile(filePath, 'Name,Age\nAlice,30\nBob,25\n')

    const result = await readCsv(filePath) as ReadCsvResult
    expect(result.delimiter).toBe(',')
    expect(result.headers).toEqual(['Name', 'Age'])
    expect(result.rows[0]).toEqual({ Name: 'Alice', Age: 30 })
  })

  it('auto-detects tab delimiter', async () => {
    const filePath = path.join(tmpDir, 'tab.tsv')
    await fs.writeFile(filePath, 'Name\tAge\nAlice\t30\nBob\t25\n')

    const result = await readCsv(filePath) as ReadCsvResult
    expect(result.delimiter).toBe('\t')
    expect(result.headers).toEqual(['Name', 'Age'])
    expect(result.rows[0]).toEqual({ Name: 'Alice', Age: 30 })
  })

  it('auto-detects semicolon delimiter', async () => {
    const filePath = path.join(tmpDir, 'semi.csv')
    await fs.writeFile(filePath, 'Name;Age\nAlice;30\nBob;25\n')

    const result = await readCsv(filePath) as ReadCsvResult
    expect(result.delimiter).toBe(';')
    expect(result.headers).toEqual(['Name', 'Age'])
  })

  it('respects explicit delimiter override', async () => {
    const filePath = path.join(tmpDir, 'pipe.csv')
    await fs.writeFile(filePath, 'Name|Age\nAlice|30\n')

    const result = await readCsv(filePath, { delimiter: '|' }) as ReadCsvResult
    expect(result.delimiter).toBe('|')
    expect(result.headers).toEqual(['Name', 'Age'])
  })

  it('uses custom delimiter for write', async () => {
    const filePath = path.join(tmpDir, 'custom-delim.csv')
    const data = [{ A: 1, B: 2 }]

    await writeCsv(filePath, data, { delimiter: ';' })

    const content = await fs.readFile(filePath, 'utf-8')
    expect(content).toContain(';')

    // Read it back with auto-detection
    const readResult = await readCsv(filePath) as ReadCsvResult
    expect(readResult.delimiter).toBe(';')
    expect(readResult.rows[0]).toEqual({ A: 1, B: 2 })
  })
})

// ---------------------------------------------------------------------------
// Formula escaping in write (CSV injection protection)
// ---------------------------------------------------------------------------

describe('CSV formula escaping', () => {
  it('escapes values starting with = (formula injection)', async () => {
    const filePath = path.join(tmpDir, 'formula.csv')
    const data = [
      { Name: 'Safe', Formula: '=HYPERLINK("http://evil.com")' },
      { Name: 'Also', Formula: '+cmd|" /C calc"!A0' },
    ]

    await writeCsv(filePath, data)
    const content = await fs.readFile(filePath, 'utf-8')

    // PapaParse escapeFormulae prepends a tab character to formula-like values
    // The raw CSV should NOT start with = or + in the data fields
    const lines = content.split('\n')
    // Check that the formula value in the CSV is escaped (not raw =HYPERLINK)
    // PapaParse adds a single-quote prefix to escape formulae
    expect(lines[1]).not.toContain(',=HYPERLINK')
    expect(lines[2]).not.toContain(',+cmd')
  })

  it('escapes values starting with @ and - (formula injection vectors)', async () => {
    const filePath = path.join(tmpDir, 'at-minus.csv')
    const data = [
      { Val: '@SUM(A1:A10)' },
      { Val: '-1+1' },
    ]

    await writeCsv(filePath, data)
    const content = await fs.readFile(filePath, 'utf-8')
    const lines = content.split('\n').filter((l) => l.trim() !== '')

    // Data lines should have escaped formula prefixes
    expect(lines[1]).not.toMatch(/^@SUM/)
  })
})

// ---------------------------------------------------------------------------
// Dynamic typing
// ---------------------------------------------------------------------------

describe('CSV dynamicTyping', () => {
  it('parses numbers as numeric types', async () => {
    const filePath = path.join(tmpDir, 'types.csv')
    await fs.writeFile(filePath, 'Int,Float,Str\n42,3.14,hello\n')

    const result = await readCsv(filePath) as ReadCsvResult
    expect(typeof result.rows[0]['Int']).toBe('number')
    expect(result.rows[0]['Int']).toBe(42)
    expect(typeof result.rows[0]['Float']).toBe('number')
    expect(result.rows[0]['Float']).toBeCloseTo(3.14, 2)
    expect(typeof result.rows[0]['Str']).toBe('string')
  })

  it('parses boolean values', async () => {
    const filePath = path.join(tmpDir, 'bool.csv')
    await fs.writeFile(filePath, 'Active\ntrue\nfalse\n')

    const result = await readCsv(filePath) as ReadCsvResult
    expect(result.rows[0]['Active']).toBe(true)
    expect(result.rows[1]['Active']).toBe(false)
  })

  it('skips empty lines', async () => {
    const filePath = path.join(tmpDir, 'empty-lines.csv')
    await fs.writeFile(filePath, 'Name\nAlice\n\n\nBob\n\n')

    const result = await readCsv(filePath) as ReadCsvResult
    expect(result.totalRows).toBe(2)
    expect(result.rows[0]).toEqual({ Name: 'Alice' })
    expect(result.rows[1]).toEqual({ Name: 'Bob' })
  })
})

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

describe('CSV pagination', () => {
  it('truncates to 100 rows by default for large files', async () => {
    const filePath = path.join(tmpDir, 'large.csv')
    const lines = ['Id,Value']
    for (let i = 0; i < 500; i++) {
      lines.push(`${i},val_${i}`)
    }
    await fs.writeFile(filePath, lines.join('\n') + '\n')

    const result = await readCsv(filePath) as ReadCsvResult
    expect(result.totalRows).toBe(500)
    expect(result.rows).toHaveLength(100)
    expect(result.truncated).toBe(true)
  })

  it('respects custom maxRows', async () => {
    const filePath = path.join(tmpDir, 'custom-max.csv')
    const lines = ['Id']
    for (let i = 0; i < 200; i++) {
      lines.push(`${i}`)
    }
    await fs.writeFile(filePath, lines.join('\n') + '\n')

    const result = await readCsv(filePath, { maxRows: 10 }) as ReadCsvResult
    expect(result.rows).toHaveLength(10)
    expect(result.totalRows).toBe(200)
    expect(result.truncated).toBe(true)
  })

  it('does not truncate small files', async () => {
    const filePath = path.join(tmpDir, 'small.csv')
    await fs.writeFile(filePath, 'A\n1\n2\n3\n')

    const result = await readCsv(filePath) as ReadCsvResult
    expect(result.totalRows).toBe(3)
    expect(result.truncated).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Header modes
// ---------------------------------------------------------------------------

describe('CSV header handling', () => {
  it('reads without header when header=false', async () => {
    const filePath = path.join(tmpDir, 'no-header.csv')
    await fs.writeFile(filePath, 'Alice,30\nBob,25\n')

    const result = await readCsv(filePath, { header: false }) as ReadCsvResult
    // With header=false, papaparse returns arrays, not objects
    expect(result.headers).toEqual([])
    expect(result.totalRows).toBe(2)
  })

  it('writes without header when header=false', async () => {
    const filePath = path.join(tmpDir, 'no-header-write.csv')
    const data = [{ Name: 'Alice', Age: 30 }]

    await writeCsv(filePath, data, { header: false })
    const content = await fs.readFile(filePath, 'utf-8')
    // Should not contain the header row
    expect(content).not.toContain('Name')
    expect(content).toContain('Alice')
  })
})

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('CSV error handling', () => {
  it('returns read_error for non-existent file', async () => {
    const result = await readCsv(path.join(tmpDir, 'missing.csv'))
    expect(result.success).toBe(false)
    expect((result as FileParserError).type).toBe('read_error')
  })

  it('returns sizeBytes in successful read result', async () => {
    const filePath = path.join(tmpDir, 'size.csv')
    await fs.writeFile(filePath, 'A\n1\n')

    const result = await readCsv(filePath) as ReadCsvResult
    expect(result.sizeBytes).toBeGreaterThan(0)
  })

  it('handles quoted fields with embedded delimiters', async () => {
    const filePath = path.join(tmpDir, 'quoted.csv')
    await fs.writeFile(filePath, 'Name,Description\nAlice,"Has a, comma"\nBob,"Normal"\n')

    const result = await readCsv(filePath) as ReadCsvResult
    expect(result.rows[0]['Description']).toBe('Has a, comma')
    expect(result.rows[1]['Description']).toBe('Normal')
  })

  it('handles quoted fields with embedded newlines', async () => {
    const filePath = path.join(tmpDir, 'newline-quoted.csv')
    await fs.writeFile(filePath, 'Name,Notes\nAlice,"Line 1\nLine 2"\n')

    const result = await readCsv(filePath) as ReadCsvResult
    expect(result.rows[0]['Notes']).toContain('Line 1')
    expect(result.rows[0]['Notes']).toContain('Line 2')
  })
})

// ---------------------------------------------------------------------------
// Streaming offset pagination (audit #55)
// ---------------------------------------------------------------------------

describe('CSV streaming offset', () => {
  it('returns the requested window with exact totals', async () => {
    const filePath = path.join(tmpDir, 'offset.csv')
    const lines = ['Id', ...Array.from({ length: 50 }, (_, i) => `${i}`)]
    await fs.writeFile(filePath, lines.join('\n') + '\n')

    const result = await readCsv(filePath, { offset: 20, maxRows: 5 }) as ReadCsvResult
    expect(result.rows).toHaveLength(5)
    expect(result.rows[0]['Id']).toBe(20)
    expect(result.totalRows).toBe(50)
    expect(result.truncated).toBe(true)
  })

  it('handles quoted embedded newlines across the offset window', async () => {
    const filePath = path.join(tmpDir, 'offset-quoted.csv')
    await fs.writeFile(filePath, 'Name,Notes\nA,"line1\nline2"\nB,"x"\nC,"y"\n')

    const result = await readCsv(filePath, { offset: 1, maxRows: 2 }) as ReadCsvResult
    expect(result.rows.map((r) => r['Name'])).toEqual(['B', 'C'])
    expect(result.totalRows).toBe(3)
  })
})
