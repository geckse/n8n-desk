import path from 'path'
import type { SandboxFolderMount, FilesystemSandboxPolicy } from './types'

// ---------------------------------------------------------------------------
// Deny-lists and allow-lists
// ---------------------------------------------------------------------------

/**
 * File extensions that are always denied for read access regardless of mount.
 * These typically contain secrets, private keys, or encrypted credentials.
 */
export const SENSITIVE_READ_DENY_EXTENSIONS: ReadonlySet<string> = new Set([
  '.env',
  '.pem',
  '.key',
  '.p12',
  '.pfx',
  '.jks',
  '.keystore',
  '.enc',
])

/**
 * Filenames that are denied for read access ONLY when located under ~/.n8n-desk/.
 * These contain app-internal credentials or configuration that should not be
 * exposed to the agent. The same filenames in user project folders are allowed.
 */
export const SENSITIVE_READ_DENY_N8N_DESK_FILENAMES: ReadonlySet<string> = new Set([
  'credentials.json',
  'tokens.enc',
  'mcp-tokens.enc',
  'llm.json',
  'auth.json',
  'mcp-auth.json',
])

/**
 * File extensions that are always denied for write access.
 * Prevents the agent from creating executable files on disk.
 */
export const SENSITIVE_WRITE_DENY_EXTENSIONS: ReadonlySet<string> = new Set([
  '.exe',
  '.sh',
  '.bat',
  '.cmd',
  '.app',
  '.dmg',
  '.msi',
  '.dll',
  '.so',
  '.dylib',
])

/**
 * File extensions that are allowed for write operations.
 * Only files with these extensions can be written by the agent.
 * This is an allowlist — any extension not listed here is denied.
 */
export const WRITABLE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.md',
  '.json',
  '.jsonl',
  '.yaml',
  '.yml',
  '.txt',
  '.js',
  '.ts',
  '.vue',
  '.scss',
  '.css',
  '.html',
  '.xml',
  '.csv',
  '.toml',
  '.svg',
  '.xlsx',
  '.docx',
])

// ---------------------------------------------------------------------------
// Policy builders
// ---------------------------------------------------------------------------

/** An attached folder with the user-chosen access mode. */
export interface AttachedFolderInput {
  path: string
  /** User-chosen access level. Defaults to 'rw' when absent. */
  mode?: 'ro' | 'rw'
}

/**
 * Shared folder mount structure for user-attached folders.
 *
 * ONE path convention everywhere (audit #31): the route prefix each mount
 * exposes IS the host path. The shared file tools, the deepagents built-in
 * file tools (via CompositeBackend routes), and the paths injected into the
 * system prompt all address files by the same host-absolute path — the agent
 * never has to translate between `/workspace/...` aliases and real paths.
 */
function buildAttachedFolderMounts(
  attachedFolders: AttachedFolderInput[],
): SandboxFolderMount[] {
  return attachedFolders.map((folder) => {
    const hostPath = path.resolve(folder.path)
    return {
      hostPath,
      virtualPrefix: `${hostPath}/`,
      mode: folder.mode ?? 'rw',
    }
  })
}

/**
 * Build the shared mount set for agent sessions.
 *
 * Mounts:
 * - Each user-attached folder at its own host path, honoring its access mode
 * - ~/.n8n-desk/skills/ as read-write (agent can create/edit skills)
 *
 * The rest of ~/.n8n-desk/ is deliberately NOT mounted: it holds every
 * instance's session history and config. Mount only what the agent needs
 * (CLAUDE.md hard invariant).
 */
function buildMounts(
  attachedFolders: AttachedFolderInput[],
  resolvedN8nDeskDir: string,
): SandboxFolderMount[] {
  const skillsDir = path.join(resolvedN8nDeskDir, 'skills')
  return [
    ...buildAttachedFolderMounts(attachedFolders),
    {
      hostPath: skillsDir,
      virtualPrefix: `${skillsDir}/`,
      mode: 'rw',
    },
  ]
}

/**
 * Build a filesystem sandbox policy for Cowork mode sessions.
 *
 * @param attachedFolders - Folders the user attached to this session
 * @param n8nDeskDir - Absolute path to ~/.n8n-desk/
 */
export function buildCoworkPolicy(
  attachedFolders: AttachedFolderInput[],
  n8nDeskDir: string,
): FilesystemSandboxPolicy {
  const resolvedN8nDeskDir = path.resolve(n8nDeskDir)
  return {
    mounts: buildMounts(attachedFolders, resolvedN8nDeskDir),
    n8nDeskDir: resolvedN8nDeskDir,
  }
}

/**
 * Build a filesystem sandbox policy for Workflow mode sessions.
 *
 * Workflow mode primarily uses MCP CRUD tools, but may need file access
 * for reading workflow SDK code from attached folders or writing generated
 * artifacts.
 *
 * @param attachedFolders - Folders the user attached to this session
 * @param n8nDeskDir - Absolute path to ~/.n8n-desk/
 */
export function buildWorkflowPolicy(
  attachedFolders: AttachedFolderInput[],
  n8nDeskDir: string,
): FilesystemSandboxPolicy {
  const resolvedN8nDeskDir = path.resolve(n8nDeskDir)
  return {
    mounts: buildMounts(attachedFolders, resolvedN8nDeskDir),
    n8nDeskDir: resolvedN8nDeskDir,
  }
}

// ---------------------------------------------------------------------------
// deepagents built-in file tools — permission rules
// ---------------------------------------------------------------------------

/** Mirrors deepagents' FilesystemPermission (kept structural to avoid a type import). */
export interface BuiltinFsPermission {
  operations: ReadonlyArray<'read' | 'write'>
  paths: string[]
  mode?: 'allow' | 'deny'
}

/**
 * Translate a sandbox policy into deepagents `permissions` rules for the
 * built-in file tools (ls/read_file/write_file/edit_file/glob/grep).
 *
 * The built-ins operate on the CompositeBackend route prefixes, which since
 * the path unification (audit #31) ARE the host paths — rules are expressed
 * against `mount.virtualPrefix` (= host path) and `policy.n8nDeskDir`. Rules
 * are evaluated first-match-wins with a permissive default, so the order is:
 *
 *   1. read-deny for sensitive extensions and dotfiles (global)
 *   2. read-deny for app-internal filenames under ~/.n8n-desk/
 *   3. write-deny for every read-only mount
 *   4. write-deny for executable extensions (global)
 *   5. write-allow for the extension allowlist
 *   6. write-deny catch-all for any other extension
 *      (extensionless files fall through to the permissive default — same
 *      semantics as isWriteAllowed)
 *
 * This is the SAME policy `sandbox-filter.ts` enforces for the custom file
 * tools — the two layers must stay in sync.
 */
export function buildFilesystemPermissions(
  policy: FilesystemSandboxPolicy,
): BuiltinFsPermission[] {
  const rules: BuiltinFsPermission[] = []

  // 1. Sensitive read deny — extensions plus their bare-dotfile forms
  //    (`/**/*.env` does not match a file literally named `.env`).
  const readDenyPaths: string[] = []
  for (const ext of SENSITIVE_READ_DENY_EXTENSIONS) {
    readDenyPaths.push(`/**/*${ext}`)
    readDenyPaths.push(`/**/${ext}`)
    readDenyPaths.push(`/**/${ext}.*`)
  }
  rules.push({ operations: ['read'], paths: readDenyPaths, mode: 'deny' })

  // 2. App-internal filenames under ~/.n8n-desk/
  rules.push({
    operations: ['read'],
    paths: [...SENSITIVE_READ_DENY_N8N_DESK_FILENAMES].map(
      (name) => `${policy.n8nDeskDir}/**/${name}`,
    ),
    mode: 'deny',
  })

  // 3. Read-only mounts reject writes
  for (const mount of policy.mounts) {
    if (mount.mode === 'ro') {
      rules.push({
        operations: ['write'],
        paths: [`${mount.virtualPrefix}**`],
        mode: 'deny',
      })
    }
  }

  // 4. Executable extensions are never writable
  rules.push({
    operations: ['write'],
    paths: [...SENSITIVE_WRITE_DENY_EXTENSIONS].map((ext) => `/**/*${ext}`),
    mode: 'deny',
  })

  // 5 + 6. Extension allowlist, then catch-all deny for other extensions
  const allowedExts = [...WRITABLE_EXTENSIONS].map((ext) => ext.slice(1)).join(',')
  rules.push({ operations: ['write'], paths: [`/**/*.{${allowedExts}}`], mode: 'allow' })
  rules.push({ operations: ['write'], paths: ['/**/*.*'], mode: 'deny' })

  return rules
}
