import { z } from 'zod'
import { tool } from '@langchain/core/tools'
import fs from 'fs/promises'
import type { Dirent } from 'fs'
import path from 'path'

import type { FilesystemSandboxPolicy } from './types'
import { resolveAndValidatePath, isReadDenied, isWriteAllowed } from './sandbox-filter'
import { SENSITIVE_WRITE_DENY_EXTENSIONS } from './sandbox-policy'

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

/**
 * Validate a path for file-management operations (move/copy/delete).
 *
 * Unlike validateWritePath, the writable-extension allowlist does NOT apply:
 * that list exists to stop the agent CREATING arbitrary content, while
 * managing already-existing user files (photos, archives, …) is legitimate.
 * What still holds: the path must sit inside a READ-WRITE mount, and the
 * executable deny-list applies to destinations.
 */
async function validateManagePath(
  requestedPath: string,
  policy: FilesystemSandboxPolicy,
  options: { denyExecutable?: boolean } = {},
): Promise<{ resolvedPath: string } | { error: string }> {
  const pathResult = await resolveAndValidatePath(requestedPath, policy)
  if (!pathResult.allowed) {
    return { error: pathResult.error! }
  }
  if (pathResult.mount!.mode !== 'rw') {
    return { error: `Denied: the folder containing "${requestedPath}" is attached as read-only.` }
  }
  if (options.denyExecutable) {
    const ext = path.extname(pathResult.resolvedPath!).toLowerCase()
    if (SENSITIVE_WRITE_DENY_EXTENSIONS.has(ext)) {
      return { error: `Denied: ${ext} files cannot be created for security.` }
    }
  }
  return { resolvedPath: pathResult.resolvedPath! }
}

/**
 * Lazy Electron access for shell/clipboard integration. Returns null outside
 * an Electron main process (e.g. unit tests) so callers degrade gracefully.
 */
async function getElectron(): Promise<{
  shell?: { trashItem: (p: string) => Promise<void>; openPath: (p: string) => Promise<string> }
  clipboard?: { readText: () => string; writeText: (t: string) => void }
} | null> {
  try {
    const electron = await import('electron')
    if (typeof electron?.shell?.openPath !== 'function') return null
    return electron
  } catch {
    return null
  }
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

        // The parser streams the file and keeps only the requested window in
        // memory (audit #55) — pagination happens inside readCsv.
        const result = await readCsv(validation.resolvedPath, {
          delimiter,
          offset: offset ?? 0,
          maxRows: limit ?? 100,
        })
        return JSON.stringify(result)
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
        const { path: filePath, offset, limit } = args as {
          path: string; offset?: number; limit?: number
        }
        const validation = await validateReadPath(filePath, policy)
        if ('error' in validation) {
          return JSON.stringify({ success: false, error: validation.error })
        }
        const result = await readText(validation.resolvedPath, { offset, limit })
        return JSON.stringify(result)
      }),
      {
        name: 'read_text',
        description:
          'Read a text file. Returns up to 2000 lines by default plus the total line count — ' +
          'use offset and limit to page through longer files. Binary files are rejected with a hint.',
        schema: z.object({
          path: z.string().describe('Path to the text file'),
          offset: z.number().optional().describe('Number of lines to skip (default: 0)'),
          limit: z.number().optional().describe('Maximum number of lines to return (default: 2000)'),
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

    // --- Partial Edit (edit_text — 'edit_file' collides with deepagents' built-in) -----------------------------------------------------------

    tool(
      safeHandler(async (args) => {
        const { path: filePath, old_string: oldString, new_string: newString, replace_all: replaceAll } = args as {
          path: string; old_string: string; new_string: string; replace_all?: boolean
        }

        if (oldString === newString) {
          return JSON.stringify({ success: false, error: 'old_string and new_string are identical.' })
        }

        // Editing both reads and writes the file — enforce both checks.
        const readValidation = await validateReadPath(filePath, policy)
        if ('error' in readValidation) {
          return JSON.stringify({ success: false, error: readValidation.error })
        }
        const validation = await validateWritePath(filePath, policy)
        if ('error' in validation) {
          return JSON.stringify({ success: false, error: validation.error })
        }

        let content: string
        try {
          content = await fs.readFile(validation.resolvedPath, 'utf-8')
        } catch {
          return JSON.stringify({ success: false, error: `File not found: ${filePath}` })
        }

        const occurrences = content.split(oldString).length - 1
        if (occurrences === 0) {
          return JSON.stringify({ success: false, error: 'old_string not found in the file. Read the file and match the existing text exactly (including whitespace).' })
        }
        if (occurrences > 1 && !replaceAll) {
          return JSON.stringify({
            success: false,
            error: `old_string appears ${occurrences} times. Provide a longer unique string, or set replace_all: true to replace every occurrence.`,
          })
        }

        const updated = replaceAll
          ? content.split(oldString).join(newString)
          : content.replace(oldString, newString)
        await fs.writeFile(validation.resolvedPath, updated, 'utf-8')

        return JSON.stringify({ success: true, replacements: replaceAll ? occurrences : 1 })
      }),
      {
        name: 'edit_text',
        description:
          'Make a surgical edit to a text-based file by replacing an exact string match. ' +
          'The old_string must match the file content exactly (including whitespace) and must be unique ' +
          'unless replace_all is set. Prefer this over write_text when changing part of an existing file.',
        schema: z.object({
          path: z.string().describe('Path to the file to edit'),
          old_string: z.string().describe('Exact text to replace (must be unique in the file unless replace_all)'),
          new_string: z.string().describe('Replacement text'),
          replace_all: z.boolean().optional().describe('Replace every occurrence instead of requiring uniqueness (default: false)'),
        }),
      },
    ),

    // --- List Files ------------------------------------------------------------

    tool(
      safeHandler(async (args) => {
        const { path: dirPath, recursive, pattern } = args as {
          path: string; recursive?: boolean; pattern?: string
        }
        const validation = await validateReadPath(dirPath, policy)
        if ('error' in validation) {
          return JSON.stringify({ success: false, error: validation.error })
        }
        const rootPath = validation.resolvedPath

        const results: Array<{ name: string; type: 'file' | 'directory'; size?: number }> = []
        const maxEntries = 500

        async function listDir(dir: string, depth: number) {
          if (results.length >= maxEntries) return
          if (depth > 5) return // safety limit on recursion depth

          let entries: Dirent[]
          try {
            entries = await fs.readdir(dir, { withFileTypes: true })
          } catch {
            return
          }

          for (const entry of entries) {
            if (results.length >= maxEntries) break
            // Skip hidden files/dirs
            if (entry.name.startsWith('.')) continue

            const fullPath = path.join(dir, entry.name)
            const relativePath = path.relative(rootPath, fullPath)

            if (pattern) {
              const pat = pattern.toLowerCase()
              if (!entry.name.toLowerCase().includes(pat) && !relativePath.toLowerCase().includes(pat)) {
                // For directories in recursive mode, still descend
                if (entry.isDirectory() && recursive) {
                  await listDir(fullPath, depth + 1)
                }
                continue
              }
            }

            if (entry.isDirectory()) {
              results.push({ name: relativePath, type: 'directory' })
              if (recursive) {
                await listDir(fullPath, depth + 1)
              }
            } else {
              let size: number | undefined
              try {
                const stat = await fs.stat(fullPath)
                size = stat.size
              } catch { /* ignore */ }
              results.push({ name: relativePath, type: 'file', size })
            }
          }
        }

        await listDir(rootPath, 0)
        const truncated = results.length >= maxEntries
        return JSON.stringify({
          success: true,
          directory: dirPath,
          entries: results,
          totalEntries: results.length,
          ...(truncated ? { truncated: true, note: `Showing first ${maxEntries} entries. Use a pattern to filter.` } : {}),
        })
      }),
      {
        name: 'list_files',
        description:
          'List files and directories in an attached folder. Returns names, types (file/directory), and file sizes. ' +
          'Use this to explore the contents of a project folder before reading specific files.',
        schema: z.object({
          path: z.string().describe('Path to the directory to list'),
          recursive: z.boolean().optional().describe('List subdirectories recursively (max depth 5). Default: false.'),
          pattern: z.string().optional().describe('Filter entries by name pattern (case-insensitive substring match)'),
        }),
      },
    ),

    // --- Search File Contents --------------------------------------------------

    tool(
      safeHandler(async (args) => {
        const { path: dirPath, query, extensions } = args as {
          path: string; query: string; extensions?: string[]
        }
        const validation = await validateReadPath(dirPath, policy)
        if ('error' in validation) {
          return JSON.stringify({ success: false, error: validation.error })
        }
        const rootPath = validation.resolvedPath

        const matches: Array<{ file: string; line: number; content: string }> = []
        const maxMatches = 100
        const queryLower = query.toLowerCase()

        async function searchDir(dir: string, depth: number) {
          if (matches.length >= maxMatches) return
          if (depth > 5) return

          let entries: Dirent[]
          try {
            entries = await fs.readdir(dir, { withFileTypes: true })
          } catch {
            return
          }

          for (const entry of entries) {
            if (matches.length >= maxMatches) break
            if (entry.name.startsWith('.')) continue

            const fullPath = path.join(dir, entry.name)

            if (entry.isDirectory()) {
              await searchDir(fullPath, depth + 1)
              continue
            }

            // Filter by extension if specified
            if (extensions && extensions.length > 0) {
              const ext = path.extname(entry.name).toLowerCase()
              if (!extensions.some((e) => ext === (e.startsWith('.') ? e : `.${e}`).toLowerCase())) {
                continue
              }
            }

            // Skip large files (> 1MB)
            try {
              const stat = await fs.stat(fullPath)
              if (stat.size > 1024 * 1024) continue
            } catch {
              continue
            }

            // Check read deny-list
            const denyResult = isReadDenied(fullPath, policy.n8nDeskDir)
            if (denyResult.denied) continue

            try {
              const content = await fs.readFile(fullPath, 'utf-8')
              const lines = content.split('\n')
              for (let i = 0; i < lines.length; i++) {
                if (matches.length >= maxMatches) break
                if (lines[i].toLowerCase().includes(queryLower)) {
                  matches.push({
                    file: path.relative(rootPath, fullPath),
                    line: i + 1,
                    content: lines[i].trim().slice(0, 200),
                  })
                }
              }
            } catch { /* skip unreadable files */ }
          }
        }

        await searchDir(rootPath, 0)
        const truncated = matches.length >= maxMatches
        return JSON.stringify({
          success: true,
          query,
          matches,
          totalMatches: matches.length,
          ...(truncated ? { truncated: true, note: `Showing first ${maxMatches} matches.` } : {}),
        })
      }),
      {
        name: 'search_files',
        description:
          'Search for text content across files in an attached folder. Returns matching file names, line numbers, and line content. ' +
          'Useful for finding specific data, patterns, or references within a project.',
        schema: z.object({
          path: z.string().describe('Path to the directory to search in'),
          query: z.string().describe('Text to search for (case-insensitive)'),
          extensions: z.array(z.string()).optional().describe('File extensions to include (e.g., ["csv", "json", "txt"]). If omitted, searches all text files.'),
        }),
      },
    ),

    // --- File management (audit #32) -------------------------------------------
    // Move/copy/delete manage EXISTING user files, so the writable-extension
    // allowlist does not apply — but both endpoints must be in rw mounts,
    // executables cannot be created, and read-denied sources (.env, keys)
    // cannot be moved or copied (renaming .env → notes.txt would expose it).

    tool(
      safeHandler(async (args) => {
        const { source, destination, overwrite } = args as {
          source: string; destination: string; overwrite?: boolean
        }
        const src = await validateManagePath(source, policy)
        if ('error' in src) return JSON.stringify({ success: false, error: src.error })
        const srcDeny = isReadDenied(src.resolvedPath, policy.n8nDeskDir)
        if (srcDeny.denied) return JSON.stringify({ success: false, error: srcDeny.error })
        const dest = await validateManagePath(destination, policy, { denyExecutable: true })
        if ('error' in dest) return JSON.stringify({ success: false, error: dest.error })

        if (!overwrite) {
          try {
            await fs.access(dest.resolvedPath)
            return JSON.stringify({ success: false, error: `Destination already exists: ${destination}. Set overwrite: true to replace it.` })
          } catch { /* destination free */ }
        }

        await fs.mkdir(path.dirname(dest.resolvedPath), { recursive: true })
        await fs.rename(src.resolvedPath, dest.resolvedPath)
        return JSON.stringify({ success: true, moved: source, to: destination })
      }),
      {
        name: 'move_file',
        description:
          'Move or rename a file or directory within the attached folders. ' +
          'Fails if the destination exists unless overwrite is set.',
        schema: z.object({
          source: z.string().describe('Current path of the file or directory'),
          destination: z.string().describe('New path'),
          overwrite: z.boolean().optional().describe('Replace the destination if it exists (default: false)'),
        }),
      },
    ),

    tool(
      safeHandler(async (args) => {
        const { source, destination, overwrite } = args as {
          source: string; destination: string; overwrite?: boolean
        }
        const src = await validateReadPath(source, policy)
        if ('error' in src) return JSON.stringify({ success: false, error: src.error })
        const dest = await validateManagePath(destination, policy, { denyExecutable: true })
        if ('error' in dest) return JSON.stringify({ success: false, error: dest.error })

        if (!overwrite) {
          try {
            await fs.access(dest.resolvedPath)
            return JSON.stringify({ success: false, error: `Destination already exists: ${destination}. Set overwrite: true to replace it.` })
          } catch { /* destination free */ }
        }

        await fs.mkdir(path.dirname(dest.resolvedPath), { recursive: true })
        await fs.cp(src.resolvedPath, dest.resolvedPath, { recursive: true, force: overwrite ?? false })
        return JSON.stringify({ success: true, copied: source, to: destination })
      }),
      {
        name: 'copy_file',
        description:
          'Copy a file or directory within the attached folders. ' +
          'Fails if the destination exists unless overwrite is set.',
        schema: z.object({
          source: z.string().describe('Path of the file or directory to copy'),
          destination: z.string().describe('Path of the copy'),
          overwrite: z.boolean().optional().describe('Replace the destination if it exists (default: false)'),
        }),
      },
    ),

    tool(
      safeHandler(async (args) => {
        const { path: targetPath } = args as { path: string }
        const target = await validateManagePath(targetPath, policy)
        if ('error' in target) return JSON.stringify({ success: false, error: target.error })

        try {
          await fs.access(target.resolvedPath)
        } catch {
          return JSON.stringify({ success: false, error: `File not found: ${targetPath}` })
        }

        // Prefer the OS trash so the user can undo; hard-delete only when the
        // Electron shell is unavailable (e.g. tests).
        const electron = await getElectron()
        if (electron?.shell && typeof electron.shell.trashItem === 'function') {
          await electron.shell.trashItem(target.resolvedPath)
          return JSON.stringify({ success: true, deleted: targetPath, method: 'trash' })
        }
        await fs.rm(target.resolvedPath, { recursive: true })
        return JSON.stringify({ success: true, deleted: targetPath, method: 'permanent' })
      }),
      {
        name: 'delete_file',
        description:
          'Delete a file or directory within the attached folders. ' +
          'Moves it to the OS trash so the user can restore it.',
        schema: z.object({
          path: z.string().describe('Path of the file or directory to delete'),
        }),
      },
    ),

    tool(
      safeHandler(async (args) => {
        const { path: targetPath } = args as { path: string }
        const validation = await validateReadPath(targetPath, policy)
        if ('error' in validation) {
          return JSON.stringify({ success: false, error: validation.error })
        }
        const electron = await getElectron()
        if (!electron?.shell) {
          return JSON.stringify({ success: false, error: 'Opening files requires the desktop app.' })
        }
        const openError = await electron.shell.openPath(validation.resolvedPath)
        if (openError) {
          return JSON.stringify({ success: false, error: `Could not open file: ${openError}` })
        }
        return JSON.stringify({ success: true, opened: targetPath })
      }),
      {
        name: 'open_path',
        description:
          'Open a file or folder from the attached folders in its default application ' +
          '(e.g. a PDF in Preview, a folder in Finder). Use after creating output the user asked to see.',
        schema: z.object({
          path: z.string().describe('Path of the file or folder to open'),
        }),
      },
    ),

    // --- Clipboard (audit #32) --------------------------------------------------

    tool(
      safeHandler(async () => {
        const electron = await getElectron()
        if (!electron?.clipboard) {
          return JSON.stringify({ success: false, error: 'Clipboard access requires the desktop app.' })
        }
        const text = electron.clipboard.readText()
        const MAX_CLIPBOARD_CHARS = 200_000
        if (text.length > MAX_CLIPBOARD_CHARS) {
          return JSON.stringify({
            success: true,
            text: text.slice(0, MAX_CLIPBOARD_CHARS),
            truncated: true,
            totalChars: text.length,
          })
        }
        return JSON.stringify({ success: true, text, truncated: false })
      }),
      {
        name: 'clipboard_read',
        description: 'Read the current text content of the system clipboard.',
        schema: z.object({}),
      },
    ),

    tool(
      safeHandler(async (args) => {
        const { text } = args as { text: string }
        if (text.length > 1_000_000) {
          return JSON.stringify({ success: false, error: 'Clipboard content too large (max 1,000,000 characters).' })
        }
        const electron = await getElectron()
        if (!electron?.clipboard) {
          return JSON.stringify({ success: false, error: 'Clipboard access requires the desktop app.' })
        }
        electron.clipboard.writeText(text)
        return JSON.stringify({ success: true, chars: text.length })
      }),
      {
        name: 'clipboard_write',
        description: 'Copy text to the system clipboard so the user can paste it elsewhere.',
        schema: z.object({
          text: z.string().describe('Text to place on the clipboard'),
        }),
      },
    ),
  ]
}
