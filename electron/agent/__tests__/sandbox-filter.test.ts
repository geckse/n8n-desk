import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'

import {
  isReadDenied,
  isWriteAllowed,
  resolveAndValidatePath,
} from '../sandbox-filter'
import { buildCoworkPolicy } from '../sandbox-policy'
import type { FilesystemSandboxPolicy, SandboxFolderMount } from '../types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a temporary directory for each test and clean up after.
 *
 * On macOS, os.tmpdir() returns '/tmp' which is a symlink to '/private/tmp'.
 * We resolve through realpath so that mount hostPaths match what
 * fs.realpath() returns inside resolveAndValidatePath().
 */
let tmpDir: string

beforeEach(async () => {
  const rawTmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-test-'))
  tmpDir = await fs.realpath(rawTmp)
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

/** Build a minimal policy with the given mounts and n8nDeskDir. */
function makePolicy(
  mounts: SandboxFolderMount[],
  n8nDeskDir?: string,
): FilesystemSandboxPolicy {
  return {
    mounts,
    n8nDeskDir: n8nDeskDir ?? path.join(tmpDir, '.n8n-desk'),
  }
}

// ---------------------------------------------------------------------------
// isReadDenied
// ---------------------------------------------------------------------------

describe('isReadDenied', () => {
  const n8nDeskDir = '/home/user/.n8n-desk'

  describe('blocks sensitive extensions globally', () => {
    // These test files like "config.env", "cert.pem", "private.key", etc.
    // where the extension is the sensitive suffix
    const blockedExtensions = ['.env', '.pem', '.key', '.p12', '.pfx', '.jks', '.keystore', '.enc']

    for (const ext of blockedExtensions) {
      it(`blocks *${ext} files`, () => {
        const result = isReadDenied(`/some/project/secrets/config${ext}`, n8nDeskDir)
        expect(result.denied).toBe(true)
        expect(result.error).toContain(ext)
        expect(result.error).toContain('blocked for security')
      })
    }

    it('blocks database.env file', () => {
      const result = isReadDenied('/home/user/project/database.env', n8nDeskDir)
      expect(result.denied).toBe(true)
    })

    it('blocks tokens.enc files via .enc extension', () => {
      const result = isReadDenied('/home/user/.n8n-desk/tokens.enc', n8nDeskDir)
      expect(result.denied).toBe(true)
    })

    it('blocks server.key files', () => {
      const result = isReadDenied('/home/user/certs/server.key', n8nDeskDir)
      expect(result.denied).toBe(true)
    })

    it('blocks certificate.pem in any directory', () => {
      const result = isReadDenied('/var/ssl/certificate.pem', n8nDeskDir)
      expect(result.denied).toBe(true)
    })
  })

  describe('allows safe file types', () => {
    const allowedFiles = [
      '/project/src/main.ts',
      '/project/README.md',
      '/project/app.js',
      '/project/data.json',
      '/project/config.yaml',
      '/project/notes.txt',
      '/project/style.css',
      '/project/template.html',
    ]

    for (const file of allowedFiles) {
      it(`allows ${path.basename(file)}`, () => {
        const result = isReadDenied(file, n8nDeskDir)
        expect(result.denied).toBe(false)
        expect(result.error).toBeUndefined()
      })
    }
  })

  describe('scoped filename deny-list under ~/.n8n-desk/', () => {
    it('blocks auth.json under ~/.n8n-desk/', () => {
      const result = isReadDenied('/home/user/.n8n-desk/instances/inst_1/auth.json', n8nDeskDir)
      expect(result.denied).toBe(true)
      expect(result.error).toContain('auth.json')
    })

    it('blocks credentials.json under ~/.n8n-desk/', () => {
      const result = isReadDenied('/home/user/.n8n-desk/credentials.json', n8nDeskDir)
      expect(result.denied).toBe(true)
    })

    it('blocks llm.json under ~/.n8n-desk/', () => {
      const result = isReadDenied('/home/user/.n8n-desk/llm.json', n8nDeskDir)
      expect(result.denied).toBe(true)
      expect(result.error).toContain('blocked for security')
    })

    it('blocks tokens.enc under ~/.n8n-desk/ (caught by extension deny-list)', () => {
      const result = isReadDenied('/home/user/.n8n-desk/tokens.enc', n8nDeskDir)
      expect(result.denied).toBe(true)
    })

    it('allows auth.json in a user project (not under ~/.n8n-desk/)', () => {
      const result = isReadDenied('/home/user/my-project/auth.json', n8nDeskDir)
      expect(result.denied).toBe(false)
    })

    it('allows credentials.json in a user project', () => {
      const result = isReadDenied('/home/user/project/credentials.json', n8nDeskDir)
      expect(result.denied).toBe(false)
    })

    it('allows llm.json in a user project', () => {
      const result = isReadDenied('/home/user/project/llm.json', n8nDeskDir)
      expect(result.denied).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// isWriteAllowed
// ---------------------------------------------------------------------------

describe('isWriteAllowed', () => {
  describe('blocks executable extensions', () => {
    const blockedExtensions = ['.exe', '.sh', '.bat', '.cmd', '.app', '.dmg', '.msi', '.dll', '.so', '.dylib']

    for (const ext of blockedExtensions) {
      it(`blocks *${ext} files`, () => {
        const mount: SandboxFolderMount = {
          hostPath: '/home/user/project',
          virtualPrefix: '/workspace/project/',
          mode: 'rw',
        }
        const policy = makePolicy([mount])
        const result = isWriteAllowed(`/home/user/project/output${ext}`, policy)
        expect(result.allowed).toBe(false)
        expect(result.error).toContain(ext)
      })
    }
  })

  describe('permits allowed extensions', () => {
    const allowedExtensions = ['.md', '.json', '.ts', '.js', '.txt', '.csv', '.yaml', '.yml', '.vue', '.html', '.css', '.scss', '.xlsx', '.docx']

    for (const ext of allowedExtensions) {
      it(`allows *${ext} files in rw mount`, () => {
        const mount: SandboxFolderMount = {
          hostPath: '/home/user/project',
          virtualPrefix: '/workspace/project/',
          mode: 'rw',
        }
        const policy = makePolicy([mount])
        const result = isWriteAllowed(`/home/user/project/output${ext}`, policy)
        expect(result.allowed).toBe(true)
        expect(result.error).toBeUndefined()
      })
    }
  })

  describe('mount mode enforcement', () => {
    it('denies write to read-only mount', () => {
      const mount: SandboxFolderMount = {
        hostPath: '/home/user/.n8n-desk',
        virtualPrefix: '/n8n-desk/',
        mode: 'ro',
      }
      const policy = makePolicy([mount])
      const result = isWriteAllowed('/home/user/.n8n-desk/some-file.md', policy)
      expect(result.allowed).toBe(false)
      expect(result.error).toContain('read-only')
    })

    it('allows write to read-write mount', () => {
      const mount: SandboxFolderMount = {
        hostPath: '/home/user/project',
        virtualPrefix: '/workspace/project/',
        mode: 'rw',
      }
      const policy = makePolicy([mount])
      const result = isWriteAllowed('/home/user/project/notes.md', policy)
      expect(result.allowed).toBe(true)
    })

    it('denies write outside any mount', () => {
      const mount: SandboxFolderMount = {
        hostPath: '/home/user/project',
        virtualPrefix: '/workspace/project/',
        mode: 'rw',
      }
      const policy = makePolicy([mount])
      const result = isWriteAllowed('/home/user/other-folder/file.md', policy)
      expect(result.allowed).toBe(false)
      expect(result.error).toContain('outside')
    })
  })

  describe('files without extension', () => {
    it('allows writing files without extension (e.g., Makefile)', () => {
      const mount: SandboxFolderMount = {
        hostPath: '/home/user/project',
        virtualPrefix: '/workspace/project/',
        mode: 'rw',
      }
      const policy = makePolicy([mount])
      const result = isWriteAllowed('/home/user/project/Makefile', policy)
      expect(result.allowed).toBe(true)
    })
  })

  describe('~/.n8n-desk/skills/ permits write', () => {
    it('allows write to skills directory via rw mount', () => {
      const skillsMount: SandboxFolderMount = {
        hostPath: '/home/user/.n8n-desk/skills',
        virtualPrefix: '/n8n-desk/skills/',
        mode: 'rw',
      }
      const n8nDeskMount: SandboxFolderMount = {
        hostPath: '/home/user/.n8n-desk',
        virtualPrefix: '/n8n-desk/',
        mode: 'ro',
      }
      // Skills mount listed first so it matches before the broader ro mount
      const policy = makePolicy([skillsMount, n8nDeskMount])
      const result = isWriteAllowed('/home/user/.n8n-desk/skills/my-skill.md', policy)
      expect(result.allowed).toBe(true)
    })

    it('allows write to nested paths within skills directory', () => {
      const skillsMount: SandboxFolderMount = {
        hostPath: '/home/user/.n8n-desk/skills',
        virtualPrefix: '/n8n-desk/skills/',
        mode: 'rw',
      }
      const policy = makePolicy([skillsMount])
      const result = isWriteAllowed('/home/user/.n8n-desk/skills/category/deep-skill.json', policy)
      expect(result.allowed).toBe(true)
    })

    it('blocks write to ~/.n8n-desk/ root (read-only)', () => {
      const skillsMount: SandboxFolderMount = {
        hostPath: '/home/user/.n8n-desk/skills',
        virtualPrefix: '/n8n-desk/skills/',
        mode: 'rw',
      }
      const n8nDeskMount: SandboxFolderMount = {
        hostPath: '/home/user/.n8n-desk',
        virtualPrefix: '/n8n-desk/',
        mode: 'ro',
      }
      const policy = makePolicy([skillsMount, n8nDeskMount])
      const result = isWriteAllowed('/home/user/.n8n-desk/config.json', policy)
      expect(result.allowed).toBe(false)
      expect(result.error).toContain('read-only')
    })
  })
})

// ---------------------------------------------------------------------------
// resolveAndValidatePath
// ---------------------------------------------------------------------------

describe('resolveAndValidatePath', () => {
  describe('blocks path traversal', () => {
    it('blocks ../../../etc/passwd', async () => {
      const projectDir = path.join(tmpDir, 'project')
      await fs.mkdir(projectDir, { recursive: true })

      const mount: SandboxFolderMount = {
        hostPath: projectDir,
        virtualPrefix: '/workspace/project/',
        mode: 'rw',
      }
      const policy = makePolicy([mount])

      const result = await resolveAndValidatePath(
        path.join(projectDir, '../../../etc/passwd'),
        policy,
      )
      expect(result.allowed).toBe(false)
      // Error message may vary depending on whether /etc/passwd exists on the system.
      // On some systems the parent dir is accessible so we get "outside all allowed folders",
      // on others the parent dir doesn't exist so we get "not accessible".
      expect(result.error).toBeDefined()
    })

    it('blocks traversal with ../../ at the start', async () => {
      const projectDir = path.join(tmpDir, 'project')
      await fs.mkdir(projectDir, { recursive: true })

      const mount: SandboxFolderMount = {
        hostPath: projectDir,
        virtualPrefix: '/workspace/project/',
        mode: 'rw',
      }
      const policy = makePolicy([mount])

      const result = await resolveAndValidatePath(
        path.join(projectDir, '../../secret.txt'),
        policy,
      )
      expect(result.allowed).toBe(false)
    })

    it('blocks traversal with separate .. segments', async () => {
      const projectDir = path.join(tmpDir, 'project')
      await fs.mkdir(projectDir, { recursive: true })

      const mount: SandboxFolderMount = {
        hostPath: projectDir,
        virtualPrefix: '/workspace/project/',
        mode: 'rw',
      }
      const policy = makePolicy([mount])

      // path.resolve handles joining '..' segments
      const result = await resolveAndValidatePath(
        path.join(projectDir, '..', '..', 'etc', 'passwd'),
        policy,
      )
      expect(result.allowed).toBe(false)
    })
  })

  describe('validates against mounts', () => {
    it('allows path within a valid mount', async () => {
      const projectDir = path.join(tmpDir, 'project')
      await fs.mkdir(projectDir, { recursive: true })
      const filePath = path.join(projectDir, 'README.md')
      await fs.writeFile(filePath, '# Hello')

      const mount: SandboxFolderMount = {
        hostPath: projectDir,
        virtualPrefix: '/workspace/project/',
        mode: 'rw',
      }
      const policy = makePolicy([mount])

      const result = await resolveAndValidatePath(filePath, policy)
      expect(result.allowed).toBe(true)
      expect(result.resolvedPath).toBe(await fs.realpath(filePath))
      expect(result.mount).toEqual(mount)
    })

    it('allows paths to non-existent files (write targets) within mount', async () => {
      const projectDir = path.join(tmpDir, 'project')
      await fs.mkdir(projectDir, { recursive: true })

      const mount: SandboxFolderMount = {
        hostPath: projectDir,
        virtualPrefix: '/workspace/project/',
        mode: 'rw',
      }
      const policy = makePolicy([mount])

      // File doesn't exist, but parent does — should resolve via parent
      const result = await resolveAndValidatePath(
        path.join(projectDir, 'new-file.ts'),
        policy,
      )
      expect(result.allowed).toBe(true)
      expect(result.resolvedPath).toContain('new-file.ts')
    })

    it('denies path outside all mounts', async () => {
      const projectDir = path.join(tmpDir, 'project')
      const outsideDir = path.join(tmpDir, 'outside')
      await fs.mkdir(projectDir, { recursive: true })
      await fs.mkdir(outsideDir, { recursive: true })
      await fs.writeFile(path.join(outsideDir, 'secret.txt'), 'secret')

      const mount: SandboxFolderMount = {
        hostPath: projectDir,
        virtualPrefix: '/workspace/project/',
        mode: 'rw',
      }
      const policy = makePolicy([mount])

      const result = await resolveAndValidatePath(
        path.join(outsideDir, 'secret.txt'),
        policy,
      )
      expect(result.allowed).toBe(false)
      expect(result.error).toContain('outside all allowed folders')
    })

    it('returns error for inaccessible parent directory', async () => {
      const mount: SandboxFolderMount = {
        hostPath: '/some/mount',
        virtualPrefix: '/workspace/',
        mode: 'rw',
      }
      const policy = makePolicy([mount])

      const result = await resolveAndValidatePath(
        '/nonexistent/parent/dir/file.txt',
        policy,
      )
      expect(result.allowed).toBe(false)
      expect(result.error).toContain('not accessible')
    })

    it('prevents prefix attacks (e.g., /safe-dir vs /safe-directory)', async () => {
      const safeDir = path.join(tmpDir, 'safe-dir')
      const safeDirExtended = path.join(tmpDir, 'safe-directory')
      await fs.mkdir(safeDir, { recursive: true })
      await fs.mkdir(safeDirExtended, { recursive: true })
      await fs.writeFile(path.join(safeDirExtended, 'secret.txt'), 'data')

      const mount: SandboxFolderMount = {
        hostPath: safeDir,
        virtualPrefix: '/workspace/',
        mode: 'rw',
      }
      const policy = makePolicy([mount])

      const result = await resolveAndValidatePath(
        path.join(safeDirExtended, 'secret.txt'),
        policy,
      )
      expect(result.allowed).toBe(false)
    })
  })

  describe('symlink escape detection', () => {
    it('blocks symlink pointing outside mount', async () => {
      const projectDir = path.join(tmpDir, 'project')
      const outsideDir = path.join(tmpDir, 'outside')
      await fs.mkdir(projectDir, { recursive: true })
      await fs.mkdir(outsideDir, { recursive: true })
      await fs.writeFile(path.join(outsideDir, 'secret.txt'), 'top secret')

      // Create a symlink inside the project that points outside
      const symlinkPath = path.join(projectDir, 'escape-link')
      await fs.symlink(path.join(outsideDir, 'secret.txt'), symlinkPath)

      const mount: SandboxFolderMount = {
        hostPath: projectDir,
        virtualPrefix: '/workspace/project/',
        mode: 'rw',
      }
      const policy = makePolicy([mount])

      const result = await resolveAndValidatePath(symlinkPath, policy)
      expect(result.allowed).toBe(false)
      expect(result.error).toContain('outside all allowed folders')
    })

    it('blocks symlinked directory escape', async () => {
      const projectDir = path.join(tmpDir, 'project')
      const secretDir = path.join(tmpDir, 'secrets')
      await fs.mkdir(projectDir, { recursive: true })
      await fs.mkdir(secretDir, { recursive: true })
      await fs.writeFile(path.join(secretDir, 'passwords.txt'), 'admin:pass123')

      // Create a directory symlink inside the project pointing to secrets
      const symlinkDir = path.join(projectDir, 'linked-secrets')
      await fs.symlink(secretDir, symlinkDir, 'dir')

      const mount: SandboxFolderMount = {
        hostPath: projectDir,
        virtualPrefix: '/workspace/project/',
        mode: 'rw',
      }
      const policy = makePolicy([mount])

      // Try to read a file through the symlinked directory
      const result = await resolveAndValidatePath(
        path.join(symlinkDir, 'passwords.txt'),
        policy,
      )
      expect(result.allowed).toBe(false)
    })

    it('allows symlink within the same mount', async () => {
      const projectDir = path.join(tmpDir, 'project')
      const subDir = path.join(projectDir, 'src')
      await fs.mkdir(subDir, { recursive: true })
      await fs.writeFile(path.join(subDir, 'index.ts'), 'export {}')

      // Symlink within the project pointing to another location in the project
      const symlinkPath = path.join(projectDir, 'link-to-src')
      await fs.symlink(subDir, symlinkPath, 'dir')

      const mount: SandboxFolderMount = {
        hostPath: projectDir,
        virtualPrefix: '/workspace/project/',
        mode: 'rw',
      }
      const policy = makePolicy([mount])

      const result = await resolveAndValidatePath(
        path.join(symlinkPath, 'index.ts'),
        policy,
      )
      expect(result.allowed).toBe(true)
    })
  })

  describe('multiple mounts', () => {
    it('matches the correct mount among multiple', async () => {
      const projectA = path.join(tmpDir, 'project-a')
      const projectB = path.join(tmpDir, 'project-b')
      await fs.mkdir(projectA, { recursive: true })
      await fs.mkdir(projectB, { recursive: true })
      await fs.writeFile(path.join(projectB, 'app.ts'), 'const x = 1')

      const policy = makePolicy([
        { hostPath: projectA, virtualPrefix: '/workspace/a/', mode: 'rw' },
        { hostPath: projectB, virtualPrefix: '/workspace/b/', mode: 'ro' },
      ])

      const result = await resolveAndValidatePath(
        path.join(projectB, 'app.ts'),
        policy,
      )
      expect(result.allowed).toBe(true)
      expect(result.mount?.virtualPrefix).toBe('/workspace/b/')
    })
  })
})

// ---------------------------------------------------------------------------
// Integration: buildCoworkPolicy + sandbox filter functions
// ---------------------------------------------------------------------------

describe('buildCoworkPolicy integration', () => {
  it('builds policy with attached folders + skills rw only (no whole n8n-desk mount)', async () => {
    const n8nDeskDir = path.join(tmpDir, '.n8n-desk')
    const skillsDir = path.join(n8nDeskDir, 'skills')
    const projectDir = path.join(tmpDir, 'my-project')
    await fs.mkdir(skillsDir, { recursive: true })
    await fs.mkdir(projectDir, { recursive: true })

    const policy = buildCoworkPolicy(
      [{ path: projectDir }],
      n8nDeskDir,
    )

    // Exactly 2 mounts: project (rw), skills (rw). The rest of ~/.n8n-desk
    // (instances, sessions, configs) must NOT be mounted at all.
    expect(policy.mounts).toHaveLength(2)

    // Project folder should be rw
    const projectMount = policy.mounts.find(m => m.hostPath === path.resolve(projectDir))
    expect(projectMount?.mode).toBe('rw')

    // Skills should be rw
    const skillsMount = policy.mounts.find(m => m.virtualPrefix.includes('skills'))
    expect(skillsMount?.mode).toBe('rw')

    // No mount may cover the n8n-desk root
    const n8nDeskRootMount = policy.mounts.find(m => m.hostPath === path.resolve(n8nDeskDir))
    expect(n8nDeskRootMount).toBeUndefined()
  })

  it('honors the per-folder read-only mode from the renderer', async () => {
    const n8nDeskDir = path.join(tmpDir, '.n8n-desk')
    const roDir = path.join(tmpDir, 'ro-project')
    await fs.mkdir(path.join(n8nDeskDir, 'skills'), { recursive: true })
    await fs.mkdir(roDir, { recursive: true })

    const policy = buildCoworkPolicy([{ path: roDir, mode: 'ro' }], n8nDeskDir)
    const roMount = policy.mounts.find(m => m.hostPath === path.resolve(roDir))
    expect(roMount?.mode).toBe('ro')

    const target = path.join(roDir, 'note.md')
    await fs.writeFile(target, 'existing')
    const pathResult = await resolveAndValidatePath(target, policy)
    expect(pathResult.allowed).toBe(true)
    const writeResult = isWriteAllowed(pathResult.resolvedPath!, policy)
    expect(writeResult.allowed).toBe(false)
    expect(writeResult.error).toContain('read-only')
  })

  it('skills directory allows write through full policy', async () => {
    const n8nDeskDir = path.join(tmpDir, '.n8n-desk')
    const skillsDir = path.join(n8nDeskDir, 'skills')
    await fs.mkdir(skillsDir, { recursive: true })

    const policy = buildCoworkPolicy([], n8nDeskDir)

    // Verify skills path resolves within the rw skills mount
    const skillFile = path.join(skillsDir, 'my-skill.md')
    const pathResult = await resolveAndValidatePath(skillFile, policy)
    expect(pathResult.allowed).toBe(true)

    // Verify write is allowed on the resolved mount
    if (pathResult.allowed && pathResult.resolvedPath) {
      const writeResult = isWriteAllowed(pathResult.resolvedPath, policy)
      expect(writeResult.allowed).toBe(true)
    }
  })

  it('n8n-desk root is entirely outside the policy (no read, no write)', async () => {
    const n8nDeskDir = path.join(tmpDir, '.n8n-desk')
    await fs.mkdir(n8nDeskDir, { recursive: true })
    await fs.mkdir(path.join(n8nDeskDir, 'skills'), { recursive: true })

    const policy = buildCoworkPolicy([], n8nDeskDir)

    const configFile = path.join(n8nDeskDir, 'config.json')
    await fs.writeFile(configFile, '{}')

    const pathResult = await resolveAndValidatePath(configFile, policy)
    expect(pathResult.allowed).toBe(false)
    expect(pathResult.error).toContain('outside all allowed folders')
  })

  it('auth.json under ~/.n8n-desk/ is blocked for read but allowed in user project', async () => {
    const n8nDeskDir = path.join(tmpDir, '.n8n-desk')
    const projectDir = path.join(tmpDir, 'user-project')
    await fs.mkdir(path.join(n8nDeskDir, 'skills'), { recursive: true })
    await fs.mkdir(projectDir, { recursive: true })

    // Create auth.json in both locations
    await fs.writeFile(path.join(n8nDeskDir, 'auth.json'), '{}')
    await fs.writeFile(path.join(projectDir, 'auth.json'), '{}')

    // auth.json under ~/.n8n-desk/ should be blocked for read
    const n8nDeskAuthResult = isReadDenied(
      path.join(n8nDeskDir, 'auth.json'),
      n8nDeskDir,
    )
    expect(n8nDeskAuthResult.denied).toBe(true)

    // auth.json in user project should be allowed for read
    const projectAuthResult = isReadDenied(
      path.join(projectDir, 'auth.json'),
      n8nDeskDir,
    )
    expect(projectAuthResult.denied).toBe(false)
  })
})
