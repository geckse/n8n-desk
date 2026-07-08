import fs from 'fs/promises'
import path from 'path'

import type { FilesystemSandboxPolicy, SandboxFolderMount } from './types'
import {
  SENSITIVE_READ_DENY_EXTENSIONS,
  SENSITIVE_READ_DENY_N8N_DESK_FILENAMES,
  SENSITIVE_WRITE_DENY_EXTENSIONS,
  WRITABLE_EXTENSIONS,
} from './sandbox-policy'

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/** Result of resolving and validating a path against the sandbox policy. */
export interface PathValidationResult {
  /** Whether the path is within an allowed mount */
  allowed: boolean
  /** The resolved absolute path (after symlink resolution) — only set when allowed */
  resolvedPath?: string
  /** The mount that the path was resolved against — only set when allowed */
  mount?: SandboxFolderMount
  /** Descriptive error message — only set when not allowed */
  error?: string
}

/** Result of checking a file path against the read deny-list. */
export interface ReadDenyResult {
  /** Whether the read is denied */
  denied: boolean
  /** Descriptive error message — only set when denied */
  error?: string
}

/** Result of checking a file path for write permission. */
export interface WriteCheckResult {
  /** Whether the write is allowed */
  allowed: boolean
  /** Descriptive error message — only set when not allowed */
  error?: string
}

// ---------------------------------------------------------------------------
// Path resolution & mount validation
// ---------------------------------------------------------------------------

/**
 * Check whether a resolved path is within a given mount directory.
 *
 * Uses the path.sep suffix trick from skill-loader.ts to prevent prefix
 * attacks (e.g., `/safe-dir` matching `/safe-directory`). Both paths are
 * resolved before comparison.
 */
function isWithinMount(resolvedFilePath: string, mountHostPath: string): boolean {
  const normalizedMountDir = path.resolve(mountHostPath) + path.sep
  const normalizedFile = path.resolve(resolvedFilePath)

  return (
    normalizedFile.startsWith(normalizedMountDir) ||
    normalizedFile === path.resolve(mountHostPath)
  )
}

/**
 * Resolve and validate a requested file path against the sandbox policy.
 *
 * Security steps (in order):
 * 1. `path.resolve()` to normalize traversal attempts (`../..`)
 * 2. `fs.realpath()` to resolve symlinks and detect escapes
 * 3. Prefix-check resolved path against all policy mounts using `path.sep` trick
 *
 * For paths that don't yet exist (write targets), the parent directory is
 * resolved via `fs.realpath()` and the filename is appended. This ensures
 * that even new files cannot be created outside allowed mounts via symlinked
 * parent directories.
 *
 * Returns a result object — never throws.
 */
export async function resolveAndValidatePath(
  requestedPath: string,
  policy: FilesystemSandboxPolicy,
): Promise<PathValidationResult> {
  // Step 1: Normalize traversal in the path string
  const resolved = path.resolve(requestedPath)

  // Step 2: Resolve symlinks via realpath
  let realPath: string
  try {
    realPath = await fs.realpath(resolved)
  } catch {
    // File doesn't exist yet — resolve the parent directory instead
    // (needed for write operations targeting new files)
    const parentDir = path.dirname(resolved)
    try {
      const realParent = await fs.realpath(parentDir)
      realPath = path.join(realParent, path.basename(resolved))
    } catch {
      return {
        allowed: false,
        error: `Path does not exist and parent directory is not accessible: ${requestedPath}`,
      }
    }
  }

  // Step 3: Check resolved path against all policy mounts
  // Iterate mounts in order — more specific mounts (e.g., skills/) come before
  // broader ones (e.g., ~/.n8n-desk/) in policy builders, so first match wins.
  for (const mount of policy.mounts) {
    if (isWithinMount(realPath, mount.hostPath)) {
      return {
        allowed: true,
        resolvedPath: realPath,
        mount,
      }
    }
  }

  // No mount matched — log for debugging and return error
  console.warn(
    `[n8n-desk] Sandbox: access denied — path "${requestedPath}" ` +
    `(resolved: ${realPath}) is outside all allowed mounts`,
  )

  return {
    allowed: false,
    error: `Access denied: "${requestedPath}" is outside all allowed folders. ` +
      `Attach the containing folder to this session first.`,
  }
}

// ---------------------------------------------------------------------------
// Read deny-list check
// ---------------------------------------------------------------------------

/**
 * Check if a file path is denied for read access.
 *
 * Two-layer deny-list:
 * 1. **Global extension deny** — files with sensitive extensions (.env, .pem, .key,
 *    etc.) are always blocked regardless of location.
 * 2. **Scoped filename deny** — certain filenames (credentials.json, llm.json, etc.)
 *    are only blocked when located under `~/.n8n-desk/`. The same filenames in
 *    user project folders are allowed.
 *
 * @param filePath - Resolved absolute path to check (output of resolveAndValidatePath)
 * @param n8nDeskDir - Absolute path to ~/.n8n-desk/ (for scoped filename checks)
 */
export function isReadDenied(
  filePath: string,
  n8nDeskDir: string,
): ReadDenyResult {
  const ext = path.extname(filePath).toLowerCase()
  const basename = path.basename(filePath)
  const basenameLower = basename.toLowerCase()

  // Layer 1: Global extension deny-list
  if (SENSITIVE_READ_DENY_EXTENSIONS.has(ext)) {
    return {
      denied: true,
      error: `Access denied: ${ext} files are blocked for security.`,
    }
  }

  // Layer 1b: Dotfile forms of the same list. path.extname('.env') === '' so a
  // file literally named `.env` (or `.env.local`) slips the extension check.
  for (const deniedExt of SENSITIVE_READ_DENY_EXTENSIONS) {
    if (basenameLower === deniedExt || basenameLower.startsWith(`${deniedExt}.`)) {
      return {
        denied: true,
        error: `Access denied: "${basename}" files are blocked for security.`,
      }
    }
  }

  // Layer 2: Scoped filename deny-list (only under ~/.n8n-desk/)
  if (SENSITIVE_READ_DENY_N8N_DESK_FILENAMES.has(basename)) {
    const normalizedN8nDeskDir = path.resolve(n8nDeskDir) + path.sep
    const normalizedFilePath = path.resolve(filePath)

    if (normalizedFilePath.startsWith(normalizedN8nDeskDir)) {
      return {
        denied: true,
        error: `Access denied: "${basename}" under ~/.n8n-desk/ is blocked for security.`,
      }
    }
  }

  return { denied: false }
}

// ---------------------------------------------------------------------------
// Write allow/deny check
// ---------------------------------------------------------------------------

/**
 * Check if a file path is allowed for write access.
 *
 * Three-layer check:
 * 1. **Mount mode** — the file must be within a mount with mode 'rw' (not 'ro').
 *    Uses the same prefix-check logic as resolveAndValidatePath.
 * 2. **Extension deny-list** — executable extensions (.exe, .sh, .bat, etc.) are
 *    always blocked to prevent the agent from creating runnable code.
 * 3. **Extension allowlist** — only files with explicitly allowed extensions can be
 *    written. This is defense-in-depth against unexpected file types.
 *
 * @param filePath - Resolved absolute path to check (output of resolveAndValidatePath)
 * @param policy - The sandbox policy for this session
 */
export function isWriteAllowed(
  filePath: string,
  policy: FilesystemSandboxPolicy,
): WriteCheckResult {
  const ext = path.extname(filePath).toLowerCase()
  const normalizedFilePath = path.resolve(filePath)

  // Layer 1: Find the mount and check its mode
  let matchedMount: SandboxFolderMount | undefined
  for (const mount of policy.mounts) {
    if (isWithinMount(normalizedFilePath, mount.hostPath)) {
      matchedMount = mount
      break
    }
  }

  if (!matchedMount) {
    return {
      allowed: false,
      error: `Write denied: "${filePath}" is outside all allowed folders.`,
    }
  }

  if (matchedMount.mode !== 'rw') {
    return {
      allowed: false,
      error: `Write denied: the folder "${matchedMount.virtualPrefix}" is mounted as read-only.`,
    }
  }

  // Layer 2: Extension deny-list (executables)
  if (SENSITIVE_WRITE_DENY_EXTENSIONS.has(ext)) {
    return {
      allowed: false,
      error: `Write denied: ${ext} files cannot be written for security.`,
    }
  }

  // Layer 3: Extension allowlist
  // Files without an extension (e.g., Makefile, Dockerfile) are allowed
  if (ext && !WRITABLE_EXTENSIONS.has(ext)) {
    return {
      allowed: false,
      error: `Write denied: "${ext}" is not an allowed file extension. ` +
        `Allowed extensions: ${[...WRITABLE_EXTENSIONS].join(', ')}`,
    }
  }

  return { allowed: true }
}
