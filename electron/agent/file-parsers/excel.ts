import fs from 'fs/promises'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum file size in bytes (100 MB). */
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024

/** Row threshold for pagination — files with more rows return metadata + first N rows. */
const PAGINATION_ROW_LIMIT = 100

/** Timeout for parse operations (30 seconds). */
const PARSE_TIMEOUT_MS = 30_000

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface SheetData {
  name: string
  headers: string[]
  rows: Record<string, unknown>[]
  totalRows: number
}

export interface ReadExcelResult {
  success: true
  sheets: SheetData[]
  truncated: boolean
  sizeBytes: number
}

export interface WriteExcelResult {
  success: true
  sizeBytes: number
}

export interface FileParserError {
  success: false
  error: string
  type: 'size_limit' | 'parse_error' | 'read_error' | 'write_error' | 'timeout'
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface ReadExcelOptions {
  /** Sheet name or zero-based index to read (default: all sheets). */
  sheet?: string | number
  /** Row offset — number of data rows to skip (default: 0). */
  offset?: number
  /** Maximum number of rows to return per sheet (default: 100 for large files). */
  maxRows?: number
}

export interface WriteExcelOptions {
  /** Sheet name (default: 'Sheet1'). */
  sheetName?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wrap a promise with a timeout. Rejects with a timeout error if the
 * promise does not settle within `ms` milliseconds.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Parse operation timed out (${ms / 1000}s limit)`)),
      ms,
    )
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (err) => { clearTimeout(timer); reject(err) },
    )
  })
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Read and parse an Excel (.xlsx / .xls) file from disk.
 *
 * - Checks file size before reading (100 MB limit).
 * - Uses `XLSX.read(buffer)` (not `readFile`) for ESM compatibility —
 *   avoids the need for `XLSX.set_fs(fs)`.
 * - Supports sheet selection by name or zero-based index.
 * - Returns paginated results for large files (first 100 rows per sheet + total count).
 * - Wraps parsing in a 30 s timeout to catch malformed files that hang.
 * - Returns descriptive error on failure, never throws.
 *
 * @param filePath - Absolute path to the Excel file (must already be sandbox-validated)
 * @param options  - Read options (sheet selection, offset, maxRows)
 */
export async function readExcel(
  filePath: string,
  options: ReadExcelOptions = {},
): Promise<ReadExcelResult | FileParserError> {
  const {
    sheet,
    offset = 0,
    maxRows = PAGINATION_ROW_LIMIT,
  } = options

  let buffer: Buffer
  let sizeBytes: number

  try {
    const stat = await fs.stat(filePath)
    sizeBytes = stat.size

    if (sizeBytes > MAX_FILE_SIZE_BYTES) {
      const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(1)
      return {
        success: false,
        error: `File too large (${sizeMB}MB). Maximum is 100MB.`,
        type: 'size_limit',
      }
    }

    buffer = await fs.readFile(filePath)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      success: false,
      error: `Failed to read Excel file: ${message}`,
      type: 'read_error',
    }
  }

  try {
    const result = await withTimeout(parseExcelBuffer(buffer, sheet, offset, maxRows), PARSE_TIMEOUT_MS)
    return {
      ...result,
      sizeBytes,
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('timed out')) {
      return {
        success: false,
        error: message,
        type: 'timeout',
      }
    }
    return {
      success: false,
      error: `Failed to parse Excel file: ${message}`,
      type: 'parse_error',
    }
  }
}

/**
 * Normalize cell values for JSON output: Date objects (from `cellDates`)
 * become ISO 8601 strings instead of locale-dependent serial numbers.
 */
function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  for (const key of Object.keys(row)) {
    const value = row[key]
    if (value instanceof Date) {
      row[key] = value.toISOString()
    }
  }
  return row
}

/**
 * Parse an Excel buffer using the xlsx library.
 *
 * Extracted into a separate async function so it can be wrapped with a timeout.
 */
async function parseExcelBuffer(
  buffer: Buffer,
  sheet: string | number | undefined,
  offset: number,
  maxRows: number,
): Promise<Omit<ReadExcelResult, 'sizeBytes'>> {
  // Lazy-load xlsx to avoid loading ~3MB for agents that don't need Excel
  const XLSX = await import('xlsx')

  // Use XLSX.read(buffer) instead of XLSX.readFile() for ESM compatibility.
  // cellDates gives real Date objects for date-formatted cells instead of
  // opaque Excel serial numbers (audit #54). Formula cells keep their CACHED
  // computed value (sheet_to_json reads `cell.v`) — the formula itself is not
  // re-evaluated, which matches what the user sees in Excel.
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true })

  // Determine which sheets to process
  const sheetNames = resolveSheetNames(workbook.SheetNames, sheet)

  let anyTruncated = false
  const sheets: SheetData[] = []

  for (const sheetName of sheetNames) {
    const worksheet = workbook.Sheets[sheetName]
    if (!worksheet) continue

    // Convert sheet to JSON rows (default gives objects with header keys)
    const allRows = (XLSX.utils.sheet_to_json(worksheet) as Record<string, unknown>[])
      .map(normalizeRow)
    const totalRows = allRows.length

    // Apply offset and limit for pagination
    const startIndex = Math.min(offset, totalRows)
    const endIndex = Math.min(startIndex + maxRows, totalRows)
    const rows = allRows.slice(startIndex, endIndex)
    const truncated = endIndex < totalRows

    if (truncated) {
      anyTruncated = true
    }

    // Derive headers from the first row keys or sheet range
    const headers = allRows.length > 0
      ? Object.keys(allRows[0])
      : []

    sheets.push({
      name: sheetName,
      headers,
      rows,
      totalRows,
    })
  }

  return {
    success: true,
    sheets,
    truncated: anyTruncated,
  }
}

/**
 * Resolve which sheet names to process based on the user's selection.
 */
function resolveSheetNames(
  allSheetNames: string[],
  sheet: string | number | undefined,
): string[] {
  if (sheet === undefined) {
    return allSheetNames
  }

  if (typeof sheet === 'number') {
    if (sheet < 0 || sheet >= allSheetNames.length) {
      throw new Error(
        `Sheet index ${sheet} out of range. Workbook has ${allSheetNames.length} sheet(s): ${allSheetNames.join(', ')}`,
      )
    }
    return [allSheetNames[sheet]]
  }

  // Sheet name lookup (case-sensitive)
  if (!allSheetNames.includes(sheet)) {
    throw new Error(
      `Sheet "${sheet}" not found. Available sheets: ${allSheetNames.join(', ')}`,
    )
  }
  return [sheet]
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Serialize data as an Excel (.xlsx) workbook and write to a file on disk.
 *
 * - Converts an array of row objects to a worksheet using `XLSX.utils.json_to_sheet()`.
 * - Writes a complete workbook buffer using `XLSX.write()`.
 * - Checks serialized size before writing (100 MB limit).
 * - Creates parent directories as needed.
 * - Returns descriptive error on failure, never throws.
 *
 * @param filePath - Absolute path to the target file (must already be sandbox-validated)
 * @param data     - Array of row objects to serialize as a sheet
 * @param options  - Write options (sheetName)
 */
export async function writeExcel(
  filePath: string,
  data: Record<string, unknown>[],
  options: WriteExcelOptions = {},
): Promise<WriteExcelResult | FileParserError> {
  const { sheetName = 'Sheet1' } = options

  let outputBuffer: Buffer

  try {
    // Lazy-load xlsx
    const XLSX = await import('xlsx')

    const worksheet = XLSX.utils.json_to_sheet(data)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName)

    // Write to a Node.js Buffer (type: 'buffer' returns Buffer in Node.js)
    outputBuffer = XLSX.write(workbook, {
      type: 'buffer',
      bookType: 'xlsx',
    }) as Buffer
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      success: false,
      error: `Failed to serialize data as Excel: ${message}`,
      type: 'write_error',
    }
  }

  try {
    const sizeBytes = outputBuffer.length

    if (sizeBytes > MAX_FILE_SIZE_BYTES) {
      const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(1)
      return {
        success: false,
        error: `Serialized Excel file too large (${sizeMB}MB). Maximum is 100MB.`,
        type: 'size_limit',
      }
    }

    // Ensure parent directory exists
    const { dirname } = await import('path')
    await fs.mkdir(dirname(filePath), { recursive: true })

    await fs.writeFile(filePath, outputBuffer)

    return {
      success: true,
      sizeBytes,
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      success: false,
      error: `Failed to write Excel file: ${message}`,
      type: 'write_error',
    }
  }
}
