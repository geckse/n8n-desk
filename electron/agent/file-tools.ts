import { z } from 'zod'
import { tool } from '@langchain/core/tools'
import fs from 'fs/promises'
import path from 'path'

import type { FilesystemSandboxPolicy } from './types'
import { resolveAndValidatePath, isReadDenied, isWriteAllowed } from './sandbox-filter'

// File parser imports — each parser lazy-loads its heavy dependencies internally
import { readText, writeText } from './file-parsers/text'
import { readJson, writeJson } from './file-parsers/json'
import { readCsv, writeCsv } from './file-parsers/csv'
import { readYaml, writeYaml } from './file-parsers/yaml'
import { readExcel } from './file-parsers/excel'
import { readPdf } from './file-parsers/pdf'
import { readDocx } from './file-parsers/docx-read'
import { writeDocx } from './file-parsers/docx-write'

// --- Types ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LangChainTool = any

// --- Constants ---

/** Maximum output file size in bytes (100 MB) — matches parser limits. */
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024

// ---------------------------------------------------------------------------
// Path Validation Helpers
// ---------------------------------------------------------------------------

/**
 * Validate a path for read access against the sandbox policy.
 *
 * Steps:
 * 1. Resolve and validate path against mounts (symlink-safe)
 * 2. Check read deny-list (sensitive extensions, scoped n8n-desk filenames)
 *
 * Returns the resolved absolute path on success, or an error object on failure.
 */
async function validateReadPath(
  requestedPath: string,
  policy: FilesystemSandboxPolicy,
): Promise<{ resolvedPath: string } | { error: string }> {
  const pathResult = await resolveAndValidatePath(requestedPath, policy)
  if (!pathResult.allowed) {
    return { error: pathResult.error! }
  }

  const denyResult = isReadDenied(pathResult.resolvedPath!, policy.n8nDeskDir)
  if (denyResult.denied) {
    return { error: denyResult.error! }
  }

  return { resolvedPath: pathResult.resolvedPath! }
}

/**
 * Validate a path for write access against the sandbox policy.
 *
 * Steps:
 * 1. Resolve and validate path against mounts (symlink-safe)
 * 2. Check write permissions (mount mode, extension deny-list, extension allowlist)
 *
 * Returns the resolved absolute path on success, or an error object on failure.
 */
async function validateWritePath(
  requestedPath: string,
  policy: FilesystemSandboxPolicy,
): Promise<{ resolvedPath: string } | { error: string }> {
  const pathResult = await resolveAndValidatePath(requestedPath, policy)
  if (!pathResult.allowed) {
    return { error: pathResult.error! }
  }

  const writeResult = isWriteAllowed(pathResult.resolvedPath!, policy)
  if (!writeResult.allowed) {
    return { error: writeResult.error! }
  }

  return { resolvedPath: pathResult.resolvedPath! }
}

// ---------------------------------------------------------------------------
// Safe Handler Wrapper
// ---------------------------------------------------------------------------

/**
 * Wrap a tool handler to catch all errors and return JSON error strings.
 * Ensures tools never throw — they always return a serialized result.
 */
function safeHandler(
  fn: (args: Record<string, unknown>) => Promise<string>,
): (args: Record<string, unknown>) => Promise<string> {
  return async (args) => {
    try {
      return await fn(args)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      return JSON.stringify({ success: false, error: message })
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create all 13 LangChain file tool wrappers for sandboxed file operations.
 *
 * Each tool:
 * 1. Validates the file path against the sandbox policy (mount checks, symlink resolution)
 * 2. Checks read/write deny-lists (sensitive extensions, executable write prevention)
 * 3. Calls the corresponding file parser function
 * 4. Returns JSON.stringify(result) — never throws
 *
 * Tools are designed for use by Cowork and Workflow mode agents. They do NOT
 * require human-in-the-loop approval — the folder attachment is the trust grant.
 *
 * @param policy - Per-session filesystem sandbox policy
 */
export function createFileTools(policy: FilesystemSandboxPolicy): LangChainTool[] {
  return [
    // --- Excel ---------------------------------------------------------------

    tool(
      safeHandler(async (args) => {
        const { path: filePath, sheet, offset, limit } = args as {
          path: string; sheet?: string | number; offset?: number; limit?: number
        }
        const validation = await validateReadPath(filePath, policy)
        if ('error' in validation) {
          return JSON.stringify({ success: false, error: validation.error })
        }
        const result = await readExcel(validation.resolvedPath, {
          sheet,
          offset,
          maxRows: limit,
        })
        return JSON.stringify(result)
      }),
      {
        name: 'read_excel',
        description:
          'Read an Excel (.xlsx/.xls) file. Returns sheet names, column headers, rows, and total row count. ' +
          'For large files, returns first 100 rows by default — use offset and limit to paginate through the data.',
        schema: z.object({
          path: z.string().describe('Path to the Excel file'),
          sheet: z.union([z.string(), z.number()]).optional()
            .describe('Sheet name or zero-based index to read (default: all sheets)'),
          offset: z.number().optional().describe('Number of data rows to skip (default: 0)'),
          limit: z.number().optional().describe('Maximum number of rows to return per sheet (default: 100)'),
        }),
      },
    ),

    tool(
      safeHandler(async (args) => {
        const { path: filePath, sheets } = args as {
          path: string
          sheets: Array<{ name: string; rows: Record<string, unknown>[] }>
        }
        const validation = await validateWritePath(filePath, policy)
        if ('error' in validation) {
          return JSON.stringify({ success: false, error: validation.error })
        }

        // Build multi-sheet workbook using xlsx directly (parser only supports single sheet)
        const XLSX = await import('xlsx')
        const workbook = XLSX.utils.book_new()
        for (const sheet of sheets) {
          const worksheet = XLSX.utils.json_to_sheet(sheet.rows)
          XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name)
        }
        const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer

        if (buffer.length > MAX_FILE_SIZE_BYTES) {
          const sizeMB = (buffer.length / (1024 * 1024)).toFixed(1)
          return JSON.stringify({
            success: false,
            error: `Serialized Excel file too large (${sizeMB}MB). Maximum is 100MB.`,
          })
        }

        await fs.mkdir(path.dirname(validation.resolvedPath), { recursive: true })
        await fs.writeFile(validation.resolvedPath, buffer)

        return JSON.stringify({ success: true, sizeBytes: buffer.length })
      }),
      {
        name: 'write_excel',
        description:
          'Write data to an Excel (.xlsx) file with one or more named sheets. ' +
          'Each sheet is defined with a name and an array of row objects where keys become column headers.',
        schema: z.object({
          path: z.string().describe('Path to the output Excel file'),
          sheets: z.array(z.object({
            name: z.string().describe('Sheet name'),
            rows: z.array(z.record(z.unknown()))
              .describe('Array of row objects (keys become column headers)'),
          })).describe('Array of sheet definitions'),
        }),
      },
    ),

    // --- CSV -----------------------------------------------------------------

    tool(
      safeHandler(async (args) => {
        const { path: filePath, delimiter, offset, limit } = args as {
          path: string; delimiter?: string; offset?: number; limit?: number
        }
        const validation = await validateReadPath(filePath, policy)
        if ('error' in validation) {
          return JSON.stringify({ success: false, error: validation.error })
        }

        const off = offset ?? 0
        const lim = limit ?? 100

        // Read enough rows to cover offset + limit, then slice for pagination
        const result = await readCsv(validation.resolvedPath, {
          delimiter,
          maxRows: off + lim,
        })

        if (!result.success) {
          return JSON.stringify(result)
        }

        // Apply offset pagination on top of parser results
        const paginatedRows = result.rows.slice(off, off + lim)
        return JSON.stringify({
          ...result,
          rows: paginatedRows,
          truncated: result.totalRows > off + lim,
        })
      }),
      {
        name: 'read_csv',
        description:
          'Read a CSV file with auto-detected delimiter. Returns column headers, typed rows ' +
          '(numbers and booleans auto-converted), and total row count. For large files, returns ' +
          'first 100 rows by default — use offset and limit to paginate.',
        schema: z.object({
          path: z.string().describe('Path to the CSV file'),
          delimiter: z.string().optional()
            .describe('Override auto-detected delimiter (e.g., "\\t" for TSV)'),
          offset: z.number().optional().describe('Number of rows to skip (default: 0)'),
          limit: z.number().optional().describe('Maximum number of rows to return (default: 100)'),
        }),
      },
    ),

    tool(
      safeHandler(async (args) => {
        const { path: filePath, rows, columns } = args as {
          path: string; rows: Record<string, unknown>[]; columns?: string[]
        }
        const validation = await validateWritePath(filePath, policy)
        if ('error' in validation) {
          return JSON.stringify({ success: false, error: validation.error })
        }

        // Filter and order columns if specified
        let dataToWrite = rows
        if (columns && columns.length > 0) {
          dataToWrite = rows.map((row) => {
            const filtered: Record<string, unknown> = {}
            for (const col of columns) {
              if (col in row) {
                filtered[col] = row[col]
              }
            }
            return filtered
          })
        }

        const result = await writeCsv(validation.resolvedPath, dataToWrite)
        return JSON.stringify(result)
      }),
      {
        name: 'write_csv',
        description:
          'Write data to a CSV file. Takes an array of row objects. ' +
          'Optionally specify columns to control which fields are included and their order in the output. ' +
          'Formulae are automatically escaped for CSV injection protection.',
        schema: z.object({
          path: z.string().describe('Path to the output CSV file'),
          rows: z.array(z.record(z.unknown())).describe('Array of row objects to write'),
          columns: z.array(z.string()).optional()
            .describe('Column names to include, in order (default: all columns from row keys)'),
        }),
      },
    ),

    // --- PDF -----------------------------------------------------------------

    tool(
      safeHandler(async (args) => {
        const { path: filePath, pages } = args as { path: string; pages?: string }
        const validation = await validateReadPath(filePath, policy)
        if ('error' in validation) {
          return JSON.stringify({ success: false, error: validation.error })
        }
        const result = await readPdf(validation.resolvedPath, { pages })
        return JSON.stringify(result)
      }),
      {
        name: 'read_pdf',
        description:
          'Extract text content from a PDF file. Returns full text, page count, document metadata, ' +
          'and per-page text. Optionally filter to specific pages using a range string.',
        schema: z.object({
          path: z.string().describe('Path to the PDF file'),
          pages: z.string().optional()
            .describe('Page range to extract (e.g., "1-5", "2,4,6", "1-3,7,10-12"). Default: all pages'),
        }),
      },
    ),

    // --- Word (docx) ---------------------------------------------------------

    tool(
      safeHandler(async (args) => {
        const { path: filePath } = args as { path: string }
        const validation = await validateReadPath(filePath, policy)
        if ('error' in validation) {
          return JSON.stringify({ success: false, error: validation.error })
        }
        const result = await readDocx(validation.resolvedPath)
        return JSON.stringify(result)
      }),
      {
        name: 'read_docx',
        description:
          'Read a Word (.docx) file. Returns plain text content, paragraph structure with styles ' +
          '(headings, lists, paragraphs), and metadata.',
        schema: z.object({
          path: z.string().describe('Path to the .docx file'),
        }),
      },
    ),

    tool(
      safeHandler(async (args) => {
        const { path: filePath, content } = args as { path: string; content: string }
        const validation = await validateWritePath(filePath, policy)
        if ('error' in validation) {
          return JSON.stringify({ success: false, error: validation.error })
        }
        const result = await writeDocx(validation.resolvedPath, content)
        return JSON.stringify(result)
      }),
      {
        name: 'write_docx',
        description:
          'Create a Word (.docx) file from markdown content. Supports headings (#), bold (**), ' +
          'italic (*), strikethrough (~~), bullet lists (-), ordered lists (1.), code blocks, ' +
          'blockquotes (>), and horizontal rules (---).',
        schema: z.object({
          path: z.string().describe('Path to the output .docx file'),
          content: z.string().describe('Markdown-formatted text to convert to docx'),
        }),
      },
    ),

    // --- JSON ----------------------------------------------------------------

    tool(
      safeHandler(async (args) => {
        const { path: filePath } = args as { path: string }
        const validation = await validateReadPath(filePath, policy)
        if ('error' in validation) {
          return JSON.stringify({ success: false, error: validation.error })
        }
        const result = await readJson(validation.resolvedPath)
        return JSON.stringify(result)
      }),
      {
        name: 'read_json',
        description: 'Read and parse a JSON file. Returns the parsed data structure and file size.',
        schema: z.object({
          path: z.string().describe('Path to the JSON file'),
        }),
      },
    ),

    tool(
      safeHandler(async (args) => {
        const { path: filePath, data } = args as { path: string; data?: unknown }
        const validation = await validateWritePath(filePath, policy)
        if ('error' in validation) {
          return JSON.stringify({ success: false, error: validation.error })
        }
        const result = await writeJson(validation.resolvedPath, data ?? null)
        return JSON.stringify(result)
      }),
      {
        name: 'write_json',
        description:
          'Write data as pretty-printed JSON to a file. Accepts any JSON-serializable value ' +
          '(objects, arrays, strings, numbers, booleans, null).',
        schema: z.object({
          path: z.string().describe('Path to the output JSON file'),
          data: z.unknown().optional().describe('Data to serialize as JSON (default: null)'),
        }),
      },
    ),

    // --- YAML ----------------------------------------------------------------

    tool(
      safeHandler(async (args) => {
        const { path: filePath } = args as { path: string }
        const validation = await validateReadPath(filePath, policy)
        if ('error' in validation) {
          return JSON.stringify({ success: false, error: validation.error })
        }
        const result = await readYaml(validation.resolvedPath)
        return JSON.stringify(result)
      }),
      {
        name: 'read_yaml',
        description:
          'Read and parse a YAML file. Returns the parsed data structure and file size. ' +
          'Uses the safe YAML loader (no code execution from YAML content).',
        schema: z.object({
          path: z.string().describe('Path to the YAML file'),
        }),
      },
    ),

    tool(
      safeHandler(async (args) => {
        const { path: filePath, data } = args as { path: string; data?: unknown }
        const validation = await validateWritePath(filePath, policy)
        if ('error' in validation) {
          return JSON.stringify({ success: false, error: validation.error })
        }
        const result = await writeYaml(validation.resolvedPath, data ?? null)
        return JSON.stringify(result)
      }),
      {
        name: 'write_yaml',
        description: 'Write data as YAML to a file. Accepts any YAML-serializable value.',
        schema: z.object({
          path: z.string().describe('Path to the output YAML file'),
          data: z.unknown().optional().describe('Data to serialize as YAML (default: null)'),
        }),
      },
    ),

    // --- Text ----------------------------------------------------------------

    tool(
      safeHandler(async (args) => {
        const { path: filePath } = args as { path: string }
        const validation = await validateReadPath(filePath, policy)
        if ('error' in validation) {
          return JSON.stringify({ success: false, error: validation.error })
        }
        const result = await readText(validation.resolvedPath)
        return JSON.stringify(result)
      }),
      {
        name: 'read_text',
        description: 'Read a text file. Returns the full content, file size in bytes, and line count.',
        schema: z.object({
          path: z.string().describe('Path to the text file'),
        }),
      },
    ),

    tool(
      safeHandler(async (args) => {
        const { path: filePath, content } = args as { path: string; content: string }
        const validation = await validateWritePath(filePath, policy)
        if ('error' in validation) {
          return JSON.stringify({ success: false, error: validation.error })
        }
        const result = await writeText(validation.resolvedPath, content)
        return JSON.stringify(result)
      }),
      {
        name: 'write_text',
        description: 'Write text content to a file. Creates parent directories as needed.',
        schema: z.object({
          path: z.string().describe('Path to the output text file'),
          content: z.string().describe('Text content to write'),
        }),
      },
    ),
  ]
}
