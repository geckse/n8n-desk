import fs from 'fs/promises'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum file size in bytes (100 MB). */
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024

/** Row threshold for pagination — files with more rows return metadata + first N rows. */
const PAGINATION_ROW_LIMIT = 100

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface ReadCsvResult {
  success: true
  headers: string[]
  rows: Record<string, unknown>[]
  totalRows: number
  truncated: boolean
  sizeBytes: number
  delimiter: string
}

export interface WriteCsvResult {
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

export interface ReadCsvOptions {
  /** Override auto-detected delimiter. */
  delimiter?: string
  /** Whether the first row is a header row (default: true). */
  header?: boolean
  /** Number of data rows to skip before collecting (default: 0). */
  offset?: number
  /** Maximum number of rows to return (default: 100 for large files). */
  maxRows?: number
  /** Character encoding (default: 'utf-8'). */
  encoding?: BufferEncoding
}

export interface WriteCsvOptions {
  /** Delimiter character (default: ','). */
  delimiter?: string
  /** Whether to include headers (default: true). */
  header?: boolean
  /** Character encoding (default: 'utf-8'). */
  encoding?: BufferEncoding
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/** Shape of a per-chunk result delivered to PapaParse's chunk callback. */
interface PapaChunkResult {
  data: Record<string, unknown>[]
  errors: Array<{ type: string; row?: number; message: string }>
  meta: { fields?: string[]; delimiter?: string }
}

/**
 * Read and parse a CSV file from disk, streaming row by row.
 *
 * - Checks file size before reading (100 MB limit).
 * - STREAMS the file through PapaParse's step API instead of materializing
 *   every row object: only the requested `offset`..`offset+maxRows` window is
 *   kept in memory; rows outside it are counted and discarded (audit #55).
 *   Quoted embedded newlines stay correct because the CSV parser itself does
 *   the row splitting.
 * - Uses `dynamicTyping` and `skipEmptyLines` for clean output.
 * - Auto-detects delimiter when not specified.
 * - Returns descriptive error on failure, never throws.
 *
 * @param filePath - Absolute path to the CSV file (must already be sandbox-validated)
 * @param options  - Read options (delimiter override, header, offset, maxRows, encoding)
 */
export async function readCsv(
  filePath: string,
  options: ReadCsvOptions = {},
): Promise<ReadCsvResult | FileParserError> {
  const {
    delimiter,
    header = true,
    offset = 0,
    maxRows = PAGINATION_ROW_LIMIT,
    encoding = 'utf-8',
  } = options

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
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      success: false,
      error: `Failed to read CSV file: ${message}`,
      type: 'read_error',
    }
  }

  try {
    // Lazy-load papaparse to avoid loading ~200KB for agents that don't need CSV
    const Papa = await import('papaparse')
    const { createReadStream } = await import('fs')

    return await new Promise<ReadCsvResult | FileParserError>((resolve) => {
      const rows: Record<string, unknown>[] = []
      const criticalErrors: Array<{ type: string; row?: number; message: string }> = []
      let totalRows = 0
      let headers: string[] = []
      let detectedDelimiter = delimiter ?? ','
      let settled = false

      const settle = (result: ReadCsvResult | FileParserError): void => {
        if (settled) return
        settled = true
        resolve(result)
      }

      const stream = createReadStream(filePath, { encoding })
      stream.on('error', (err) => {
        settle({
          success: false,
          error: `Failed to read CSV file: ${err.message}`,
          type: 'read_error',
        })
      })

      // PapaParse accepts Node readable streams; its bundled types only cover
      // the string/File overloads.
      ;(Papa.parse as unknown as (input: unknown, config: unknown) => void)(stream, {
        header,
        dynamicTyping: true,
        skipEmptyLines: true,
        delimiter: delimiter ?? undefined,
        // chunk (not step): it also fires for a header-only file, so the
        // detected headers/delimiter survive even with zero data rows.
        chunk: (result: PapaChunkResult) => {
          if (result.meta) {
            if (header && result.meta.fields) headers = result.meta.fields
            if (result.meta.delimiter) detectedDelimiter = result.meta.delimiter
          }
          for (const e of result.errors ?? []) {
            if (e.type === 'Quotes' || e.type === 'FieldMismatch') criticalErrors.push(e)
          }

          for (const row of result.data) {
            const index = totalRows
            totalRows++
            // Keep only the requested window — everything else is just counted.
            if (index >= offset && rows.length < maxRows) {
              rows.push(row)
            }
          }
        },
        complete: () => {
          if (criticalErrors.length > 0 && totalRows === 0) {
            const firstError = criticalErrors[0]
            settle({
              success: false,
              error: `Malformed CSV at row ${firstError.row}: ${firstError.message}`,
              type: 'parse_error',
            })
            return
          }
          settle({
            success: true,
            headers,
            rows,
            totalRows,
            truncated: offset > 0 || totalRows > offset + rows.length,
            sizeBytes,
            delimiter: detectedDelimiter,
          })
        },
        error: (err: Error) => {
          settle({
            success: false,
            error: `Failed to parse CSV: ${err.message}`,
            type: 'parse_error',
          })
        },
      })
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      success: false,
      error: `Failed to parse CSV: ${message}`,
      type: 'parse_error',
    }
  }
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Serialize data as CSV and write to a file on disk.
 *
 * - Uses PapaParse `unparse()` with `escapeFormulae: true` for CSV injection protection.
 * - Checks serialized size before writing (100 MB limit).
 * - Creates parent directories as needed.
 * - Returns descriptive error on failure, never throws.
 *
 * @param filePath - Absolute path to the target file (must already be sandbox-validated)
 * @param data     - Array of row objects (or array of arrays) to serialize
 * @param options  - Write options (delimiter, header, encoding)
 */
export async function writeCsv(
  filePath: string,
  data: Record<string, unknown>[] | unknown[][],
  options: WriteCsvOptions = {},
): Promise<WriteCsvResult | FileParserError> {
  const {
    delimiter = ',',
    header = true,
    encoding = 'utf-8',
  } = options

  let serialized: string

  try {
    // Lazy-load papaparse
    const Papa = await import('papaparse')

    serialized = Papa.unparse(data as Record<string, unknown>[], {
      delimiter,
      header,
      escapeFormulae: true,
    })

    // Ensure trailing newline
    if (!serialized.endsWith('\n')) {
      serialized += '\n'
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      success: false,
      error: `Failed to serialize data as CSV: ${message}`,
      type: 'write_error',
    }
  }

  try {
    const sizeBytes = Buffer.byteLength(serialized, encoding)

    if (sizeBytes > MAX_FILE_SIZE_BYTES) {
      const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(1)
      return {
        success: false,
        error: `Serialized CSV too large (${sizeMB}MB). Maximum is 100MB.`,
        type: 'size_limit',
      }
    }

    // Ensure parent directory exists
    const { dirname } = await import('path')
    await fs.mkdir(dirname(filePath), { recursive: true })

    await fs.writeFile(filePath, serialized, { encoding })

    return {
      success: true,
      sizeBytes,
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      success: false,
      error: `Failed to write CSV file: ${message}`,
      type: 'write_error',
    }
  }
}
