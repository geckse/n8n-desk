import fs from 'fs/promises'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum file size in bytes (100 MB). */
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024

/** Default maximum number of lines returned per read. */
const DEFAULT_LINE_LIMIT = 2_000

/** Bytes inspected for binary detection. */
const BINARY_SNIFF_BYTES = 8_192

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface ReadTextResult {
  success: true
  content: string
  sizeBytes: number
  /** Total number of lines in the file (not just the returned window) */
  lineCount: number
  /** First line returned (zero-based offset that was applied) */
  offset: number
  /** Number of lines included in `content` */
  returnedLines: number
  /** True when the file has more lines beyond the returned window */
  truncated: boolean
}

export interface WriteTextResult {
  success: true
  sizeBytes: number
}

export interface FileParserError {
  success: false
  error: string
  type: 'size_limit' | 'read_error' | 'write_error' | 'binary_file'
}

export interface ReadTextOptions {
  /** Number of lines to skip from the start (default: 0). */
  offset?: number
  /** Maximum number of lines to return (default: 2000). */
  limit?: number
  /** Character encoding (defaults to 'utf-8'). */
  encoding?: BufferEncoding
}

// ---------------------------------------------------------------------------
// Binary detection
// ---------------------------------------------------------------------------

/**
 * Heuristic binary check on the first bytes of a buffer: a NUL byte is a
 * reliable non-text signal (UTF-8/UTF-16-with-BOM text never contains one;
 * PNG/ZIP/PDF/executables almost always do within the first KB).
 */
export function looksBinary(buffer: Buffer): boolean {
  const window = buffer.subarray(0, BINARY_SNIFF_BYTES)
  return window.includes(0)
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Read a text file from disk and return its content.
 *
 * - Checks file size before reading (100 MB limit).
 * - Detects binary files and refuses them with an actionable error instead of
 *   returning megabytes of mojibake (audit #30).
 * - Paginates by lines: `offset` + `limit` (default 2000 lines) so huge files
 *   never land in the model context in one piece (audit #30).
 * - Returns descriptive error on failure, never throws.
 *
 * @param filePath - Absolute path to the text file (must already be sandbox-validated)
 * @param options  - Pagination and encoding options
 */
export async function readText(
  filePath: string,
  options: ReadTextOptions = {},
): Promise<ReadTextResult | FileParserError> {
  const { offset = 0, limit = DEFAULT_LINE_LIMIT, encoding = 'utf-8' } = options

  try {
    // Check file size before reading
    const stat = await fs.stat(filePath)
    if (stat.size > MAX_FILE_SIZE_BYTES) {
      const sizeMB = (stat.size / (1024 * 1024)).toFixed(1)
      return {
        success: false,
        error: `File too large (${sizeMB}MB). Maximum is 100MB.`,
        type: 'size_limit',
      }
    }

    const buffer = await fs.readFile(filePath)
    if (looksBinary(buffer)) {
      return {
        success: false,
        error: 'This looks like a binary file, not text. Use the matching reader instead (read_pdf, read_excel, read_docx) — or, for other binary formats, tell the user the file cannot be read as text.',
        type: 'binary_file',
      }
    }

    const full = buffer.toString(encoding)
    const lines = full.split('\n')
    const lineCount = lines.length

    const start = Math.max(0, offset)
    const end = Math.min(lineCount, start + Math.max(1, limit))
    const windowLines = start < lineCount ? lines.slice(start, end) : []
    const truncated = start > 0 || end < lineCount

    return {
      success: true,
      content: windowLines.join('\n'),
      sizeBytes: stat.size,
      lineCount,
      offset: start,
      returnedLines: windowLines.length,
      truncated,
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      success: false,
      error: `Failed to read text file: ${message}`,
      type: 'read_error',
    }
  }
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Write text content to a file on disk.
 *
 * - Checks content size before writing (100 MB limit).
 * - Creates parent directories as needed.
 * - Returns the number of bytes written.
 * - Returns descriptive error on failure, never throws.
 *
 * @param filePath - Absolute path to the target file (must already be sandbox-validated)
 * @param content - Text content to write
 * @param encoding - Character encoding (defaults to 'utf-8')
 */
export async function writeText(
  filePath: string,
  content: string,
  encoding: BufferEncoding = 'utf-8',
): Promise<WriteTextResult | FileParserError> {
  try {
    // Check content size before writing
    const sizeBytes = Buffer.byteLength(content, encoding)
    if (sizeBytes > MAX_FILE_SIZE_BYTES) {
      const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(1)
      return {
        success: false,
        error: `Content too large (${sizeMB}MB). Maximum is 100MB.`,
        type: 'size_limit',
      }
    }

    // Ensure parent directory exists
    const { dirname } = await import('path')
    await fs.mkdir(dirname(filePath), { recursive: true })

    await fs.writeFile(filePath, content, { encoding })

    return {
      success: true,
      sizeBytes,
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      success: false,
      error: `Failed to write text file: ${message}`,
      type: 'write_error',
    }
  }
}
