/**
 * Tests for the deepagents built-in-tool permission rules generated from the
 * sandbox policy (#2 — built-ins previously bypassed the sandbox entirely).
 *
 * deepagents evaluates FilesystemPermission rules with micromatch,
 * first-match-wins, permissive default. This suite replays that exact
 * evaluation against the generated rules and asserts the same deny/allow
 * matrix that sandbox-filter.ts enforces for the custom tools.
 */
import { describe, it, expect } from 'vitest'
import micromatch from 'micromatch'
import path from 'path'
import os from 'os'
import {
  buildCoworkPolicy,
  buildFilesystemPermissions,
  type BuiltinFsPermission,
} from '../sandbox-policy'

// Replays deepagents' documented evaluation: declaration order, first rule
// whose operations include the op AND whose paths glob-match wins; no match →
// allow.
function evaluate(
  rules: BuiltinFsPermission[],
  operation: 'read' | 'write',
  virtualPath: string,
): 'allow' | 'deny' {
  for (const rule of rules) {
    if (!rule.operations.includes(operation)) continue
    if (micromatch.isMatch(virtualPath, rule.paths, { dot: true })) {
      return rule.mode ?? 'allow'
    }
  }
  return 'allow'
}

const N8N_DESK_DIR = path.join(os.tmpdir(), '.n8n-desk-test')

function makeRules(attached: Array<{ path: string; mode?: 'ro' | 'rw' }> = []) {
  const policy = buildCoworkPolicy(attached, N8N_DESK_DIR)
  return buildFilesystemPermissions(policy)
}

describe('buildFilesystemPermissions', () => {
  it('denies reading secret files everywhere', () => {
    const rules = makeRules([{ path: '/tmp/proj' }])
    expect(evaluate(rules, 'read', '/tmp/proj/.env')).toBe('deny')
    expect(evaluate(rules, 'read', '/tmp/proj/deep/nested/.env.local')).toBe('deny')
    expect(evaluate(rules, 'read', '/tmp/proj/server.pem')).toBe('deny')
    expect(evaluate(rules, 'read', '/tmp/proj/id_rsa.key')).toBe('deny')
    expect(evaluate(rules, 'read', path.join(N8N_DESK_DIR, 'skills/tokens.enc'))).toBe('deny')
  })

  it('denies app-internal filenames under ~/.n8n-desk/', () => {
    const rules = makeRules()
    expect(evaluate(rules, 'read', path.join(N8N_DESK_DIR, 'skills/llm.json'))).toBe('deny')
    expect(evaluate(rules, 'read', path.join(N8N_DESK_DIR, 'skills/sub/auth.json'))).toBe('deny')
    expect(evaluate(rules, 'read', path.join(N8N_DESK_DIR, 'skills/mcp-auth.json'))).toBe('deny')
    expect(evaluate(rules, 'read', path.join(N8N_DESK_DIR, 'skills/credentials.json'))).toBe('deny')
    // The same filenames in a user project are allowed
    expect(evaluate(rules, 'read', '/tmp/proj/auth.json')).toBe('allow')
    expect(evaluate(rules, 'read', '/tmp/proj/llm.json')).toBe('allow')
  })

  it('denies writes into read-only mounts, allows them in rw mounts', () => {
    const rules = makeRules([
      { path: '/tmp/rw-proj', mode: 'rw' },
      { path: '/tmp/ro-proj', mode: 'ro' },
    ])
    expect(evaluate(rules, 'write', '/tmp/rw-proj/notes.md')).toBe('allow')
    expect(evaluate(rules, 'write', '/tmp/ro-proj/notes.md')).toBe('deny')
    // reads in ro mounts stay allowed
    expect(evaluate(rules, 'read', '/tmp/ro-proj/notes.md')).toBe('allow')
  })

  it('never allows writing executables, even in rw mounts', () => {
    const rules = makeRules([{ path: '/tmp/proj' }])
    expect(evaluate(rules, 'write', '/tmp/proj/evil.sh')).toBe('deny')
    expect(evaluate(rules, 'write', '/tmp/proj/evil.exe')).toBe('deny')
    expect(evaluate(rules, 'write', '/tmp/proj/lib.dylib')).toBe('deny')
  })

  it('enforces the write extension allowlist with extensionless fallthrough', () => {
    const rules = makeRules([{ path: '/tmp/proj' }])
    // Allowlisted extensions
    expect(evaluate(rules, 'write', '/tmp/proj/report.md')).toBe('allow')
    expect(evaluate(rules, 'write', '/tmp/proj/data.xlsx')).toBe('allow')
    expect(evaluate(rules, 'write', '/tmp/proj/x.test.ts')).toBe('allow')
    // Unlisted extension → deny
    expect(evaluate(rules, 'write', '/tmp/proj/archive.zip')).toBe('deny')
    expect(evaluate(rules, 'write', '/tmp/proj/binary.wasm')).toBe('deny')
    // Extensionless files fall through to the permissive default (Makefile etc.)
    expect(evaluate(rules, 'write', '/tmp/proj/Makefile')).toBe('allow')
  })

  it('rule paths are absolute glob patterns (deepagents validation requirement)', () => {
    const rules = makeRules([{ path: '/tmp/proj' }])
    for (const rule of rules) {
      for (const p of rule.paths) {
        expect(p.startsWith('/')).toBe(true)
        expect(p).not.toContain('..')
        expect(p).not.toContain('~')
      }
    }
  })
})
