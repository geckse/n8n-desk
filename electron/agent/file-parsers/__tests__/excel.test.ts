import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'

import { readExcel, writeExcel } from '../excel'
import type { ReadExcelResult, WriteExcelResult, FileParserError } from '../excel'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string

beforeEach(async () => {
  const rawTmp = await fs.mkdtemp(path.join(os.tmpdir(), 'excel-test-'))
  tmpDir = await fs.realpath(rawTmp)
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

/** Generate N rows of sample data with columns A, B, C. */
function generateRows(count: number): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = []
  for (let i = 0; i < count; i++) {
    rows.push({ A: `row${i}`, B: i, C: i % 2 === 0 })
  }
  return rows
}

// ---------------------------------------------------------------------------
// Round-trip write → read
// ---------------------------------------------------------------------------

describe('Excel round-trip', () => {
  it('writes and reads back a simple workbook', async () => {
    const filePath = path.join(tmpDir, 'simple.xlsx')
    const data = [
      { Name: 'Alice', Age: 30, Active: true },
      { Name: 'Bob', Age: 25, Active: false },
      { Name: 'Charlie', Age: 35, Active: true },
    ]

    const writeResult = await writeExcel(filePath, data)
    expect(writeResult.success).toBe(true)
    expect((writeResult as WriteExcelResult).sizeBytes).toBeGreaterThan(0)

    const readResult = await readExcel(filePath)
    expect(readResult.success).toBe(true)

    const result = readResult as ReadExcelResult
    expect(result.sheets).toHaveLength(1)
    expect(result.sheets[0].name).toBe('Sheet1')
    expect(result.sheets[0].headers).toEqual(['Name', 'Age', 'Active'])
    expect(result.sheets[0].totalRows).toBe(3)
    expect(result.sheets[0].rows).toHaveLength(3)
    expect(result.sheets[0].rows[0]).toEqual({ Name: 'Alice', Age: 30, Active: true })
    expect(result.sheets[0].rows[1]).toEqual({ Name: 'Bob', Age: 25, Active: false })
    expect(result.truncated).toBe(false)
  })

  it('preserves numeric types through round-trip', async () => {
    const filePath = path.join(tmpDir, 'numeric.xlsx')
    const data = [
      { Int: 42, Float: 3.14, Zero: 0, Negative: -100 },
    ]

    await writeExcel(filePath, data)
    const readResult = await readExcel(filePath) as ReadExcelResult
    const row = readResult.sheets[0].rows[0]

    expect(row['Int']).toBe(42)
    expect(row['Float']).toBeCloseTo(3.14, 2)
    expect(row['Zero']).toBe(0)
    expect(row['Negative']).toBe(-100)
  })

  it('handles empty data array', async () => {
    const filePath = path.join(tmpDir, 'empty.xlsx')
    const data: Record<string, unknown>[] = []

    const writeResult = await writeExcel(filePath, data)
    expect(writeResult.success).toBe(true)

    const readResult = await readExcel(filePath) as ReadExcelResult
    expect(readResult.sheets[0].totalRows).toBe(0)
    expect(readResult.sheets[0].rows).toHaveLength(0)
    expect(readResult.sheets[0].headers).toHaveLength(0)
  })

  it('uses custom sheet name', async () => {
    const filePath = path.join(tmpDir, 'named.xlsx')
    const data = [{ X: 1 }]

    await writeExcel(filePath, data, { sheetName: 'MyData' })
    const readResult = await readExcel(filePath) as ReadExcelResult
    expect(readResult.sheets[0].name).toBe('MyData')
  })

  it('creates parent directories automatically', async () => {
    const filePath = path.join(tmpDir, 'nested', 'deep', 'file.xlsx')
    const data = [{ Col: 'value' }]

    const writeResult = await writeExcel(filePath, data)
    expect(writeResult.success).toBe(true)

    // Verify file exists
    const stat = await fs.stat(filePath)
    expect(stat.isFile()).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Pagination for large data
// ---------------------------------------------------------------------------

describe('Excel pagination', () => {
  it('truncates to 100 rows by default for large files', async () => {
    const filePath = path.join(tmpDir, 'large.xlsx')
    const data = generateRows(500)

    await writeExcel(filePath, data)
    const readResult = await readExcel(filePath) as ReadExcelResult

    expect(readResult.sheets[0].totalRows).toBe(500)
    expect(readResult.sheets[0].rows).toHaveLength(100)
    expect(readResult.truncated).toBe(true)
  })

  it('respects custom maxRows option', async () => {
    const filePath = path.join(tmpDir, 'custom-limit.xlsx')
    const data = generateRows(200)

    await writeExcel(filePath, data)
    const readResult = await readExcel(filePath, { maxRows: 50 }) as ReadExcelResult

    expect(readResult.sheets[0].rows).toHaveLength(50)
    expect(readResult.sheets[0].totalRows).toBe(200)
    expect(readResult.truncated).toBe(true)
  })

  it('supports offset for pagination', async () => {
    const filePath = path.join(tmpDir, 'offset.xlsx')
    const data = generateRows(300)

    await writeExcel(filePath, data)

    // Read rows 100-199 (offset=100, maxRows=100)
    const readResult = await readExcel(filePath, { offset: 100, maxRows: 100 }) as ReadExcelResult

    expect(readResult.sheets[0].rows).toHaveLength(100)
    expect(readResult.sheets[0].rows[0]).toEqual({ A: 'row100', B: 100, C: true })
    expect(readResult.sheets[0].totalRows).toBe(300)
    expect(readResult.truncated).toBe(true)
  })

  it('handles offset past end of data gracefully', async () => {
    const filePath = path.join(tmpDir, 'past-end.xlsx')
    const data = generateRows(10)

    await writeExcel(filePath, data)
    const readResult = await readExcel(filePath, { offset: 100 }) as ReadExcelResult

    expect(readResult.sheets[0].rows).toHaveLength(0)
    expect(readResult.sheets[0].totalRows).toBe(10)
  })

  it('does not truncate when row count fits within maxRows', async () => {
    const filePath = path.join(tmpDir, 'fits.xlsx')
    const data = generateRows(50)

    await writeExcel(filePath, data)
    const readResult = await readExcel(filePath) as ReadExcelResult

    expect(readResult.sheets[0].rows).toHaveLength(50)
    expect(readResult.truncated).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Multi-sheet support
// ---------------------------------------------------------------------------

describe('Excel multi-sheet', () => {
  /**
   * Create a multi-sheet workbook programmatically using xlsx directly.
   */
  async function createMultiSheetWorkbook(filePath: string): Promise<void> {
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()

    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet([{ Name: 'Alice', Score: 95 }, { Name: 'Bob', Score: 88 }]),
      'Students',
    )
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet([{ Subject: 'Math' }, { Subject: 'English' }]),
      'Courses',
    )
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet([{ Grade: 'A' }]),
      'Grades',
    )

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
    await fs.writeFile(filePath, buf)
  }

  it('reads all sheets when no sheet is specified', async () => {
    const filePath = path.join(tmpDir, 'multi.xlsx')
    await createMultiSheetWorkbook(filePath)

    const readResult = await readExcel(filePath) as ReadExcelResult
    expect(readResult.sheets).toHaveLength(3)
    expect(readResult.sheets.map((s) => s.name)).toEqual(['Students', 'Courses', 'Grades'])
  })

  it('selects a single sheet by name', async () => {
    const filePath = path.join(tmpDir, 'multi.xlsx')
    await createMultiSheetWorkbook(filePath)

    const readResult = await readExcel(filePath, { sheet: 'Courses' }) as ReadExcelResult
    expect(readResult.sheets).toHaveLength(1)
    expect(readResult.sheets[0].name).toBe('Courses')
    expect(readResult.sheets[0].rows[0]).toEqual({ Subject: 'Math' })
  })

  it('selects a single sheet by zero-based index', async () => {
    const filePath = path.join(tmpDir, 'multi.xlsx')
    await createMultiSheetWorkbook(filePath)

    const readResult = await readExcel(filePath, { sheet: 2 }) as ReadExcelResult
    expect(readResult.sheets).toHaveLength(1)
    expect(readResult.sheets[0].name).toBe('Grades')
  })

  it('returns parse error for non-existent sheet name', async () => {
    const filePath = path.join(tmpDir, 'multi.xlsx')
    await createMultiSheetWorkbook(filePath)

    const readResult = await readExcel(filePath, { sheet: 'NonExistent' })
    expect(readResult.success).toBe(false)
    expect((readResult as FileParserError).type).toBe('parse_error')
    expect((readResult as FileParserError).error).toContain('not found')
  })

  it('returns parse error for out-of-range sheet index', async () => {
    const filePath = path.join(tmpDir, 'multi.xlsx')
    await createMultiSheetWorkbook(filePath)

    const readResult = await readExcel(filePath, { sheet: 10 })
    expect(readResult.success).toBe(false)
    expect((readResult as FileParserError).type).toBe('parse_error')
    expect((readResult as FileParserError).error).toContain('out of range')
  })
})

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('Excel error handling', () => {
  it('returns read_error for non-existent file', async () => {
    const result = await readExcel(path.join(tmpDir, 'does-not-exist.xlsx'))
    expect(result.success).toBe(false)
    expect((result as FileParserError).type).toBe('read_error')
  })

  it('handles non-xlsx content gracefully without crashing', async () => {
    // Note: xlsx library is extremely forgiving — it parses arbitrary input
    // as an empty workbook rather than throwing. This test verifies the parser
    // does not crash on non-Excel content.
    const filePath = path.join(tmpDir, 'corrupt.xlsx')
    await fs.writeFile(filePath, 'this is not a valid xlsx file')

    const result = await readExcel(filePath)
    // xlsx reads this as a valid (empty) workbook — verify no crash
    expect(result.success).toBe(true)
    const excelResult = result as ReadExcelResult
    expect(excelResult.sheets).toBeDefined()
  })

  it('returns sizeBytes in successful read result', async () => {
    const filePath = path.join(tmpDir, 'size-check.xlsx')
    await writeExcel(filePath, [{ A: 1 }])

    const result = await readExcel(filePath) as ReadExcelResult
    expect(result.sizeBytes).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Date fidelity (audit #54)
// ---------------------------------------------------------------------------

describe('Excel date fidelity', () => {
  it('returns date-formatted cells as ISO strings, not serial numbers', async () => {
    const XLSX = await import('xlsx')
    const filePath = path.join(tmpDir, 'dates.xlsx')

    const worksheet = XLSX.utils.aoa_to_sheet([
      ['Invoice', 'Due'],
      ['INV-1', new Date(Date.UTC(2026, 6, 15))],
    ], { cellDates: true })
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1')
    await fs.writeFile(filePath, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer)

    const result = await readExcel(filePath)
    expect(result.success).toBe(true)
    if (result.success) {
      const due = result.sheets[0].rows[0]['Due']
      expect(typeof due).toBe('string')
      expect(due).toContain('2026-07-15')
    }
  })
})
