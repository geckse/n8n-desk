/**
 * Cross-session memory tools (audit #45): read/append round-trip, entry and
 * store caps, corrupt-file tolerance, and the system-prompt block.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import {
  createMemoryTools,
  readMemoryEntries,
  buildMemoryPromptBlock,
  MAX_MEMORY_ENTRIES,
  MAX_MEMORY_ENTRY_CHARS,
} from '../memory-tools'

let tmpDir: string
let memoryPath: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-test-'))
  memoryPath = path.join(tmpDir, 'memory.json')
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

function getTools() {
  const tools = createMemoryTools(memoryPath)
  const read = tools.find((t: { name: string }) => t.name === 'memory_read')!
  const append = tools.find((t: { name: string }) => t.name === 'memory_append')!
  return { read, append }
}

describe('memory tools', () => {
  it('appends and reads back entries across tool instances (cross-session)', async () => {
    const { append } = getTools()
    await append.invoke({ text: 'User prefers xlsx summaries in ./reports' })
    await append.invoke({ text: 'Invoice workflow id is WF-42' })

    // A NEW tool instance (fresh session) sees the same entries
    const { read } = getTools()
    const result = JSON.parse(await read.invoke({}))
    expect(result.success).toBe(true)
    expect(result.totalEntries).toBe(2)
    expect(result.entries[1].text).toContain('WF-42')
    expect(result.entries[0].ts).toBeTruthy()
  })

  it('reads empty when no memory file exists', async () => {
    const { read } = getTools()
    const result = JSON.parse(await read.invoke({}))
    expect(result.success).toBe(true)
    expect(result.entries).toEqual([])
  })

  it('tolerates a corrupt memory file', async () => {
    await fs.writeFile(memoryPath, 'not json at all')
    const { read, append } = getTools()
    expect(JSON.parse(await read.invoke({})).entries).toEqual([])
    // Appending recovers the file
    await append.invoke({ text: 'fresh start' })
    expect((await readMemoryEntries(memoryPath))).toHaveLength(1)
  })

  it('rejects oversized entries and empty text', async () => {
    const { append } = getTools()
    const tooLong = JSON.parse(await append.invoke({ text: 'x'.repeat(MAX_MEMORY_ENTRY_CHARS + 1) }))
    expect(tooLong.success).toBe(false)

    const empty = JSON.parse(await append.invoke({ text: '   ' }))
    expect(empty.success).toBe(false)

    expect(await readMemoryEntries(memoryPath)).toHaveLength(0)
  })

  it('deduplicates identical notes and caps the store size', async () => {
    const { append } = getTools()
    await append.invoke({ text: 'same note' })
    const dup = JSON.parse(await append.invoke({ text: 'same note' }))
    expect(dup.note).toBe('Already remembered.')
    expect(await readMemoryEntries(memoryPath)).toHaveLength(1)

    // Fill past the cap — oldest entries are dropped
    const many = Array.from({ length: MAX_MEMORY_ENTRIES + 10 }, (_, i) => ({
      ts: new Date().toISOString(),
      text: `note ${i}`,
    }))
    await fs.writeFile(memoryPath, JSON.stringify(many))
    await append.invoke({ text: 'the newest note' })

    const entries = await readMemoryEntries(memoryPath)
    expect(entries.length).toBe(MAX_MEMORY_ENTRIES)
    expect(entries[entries.length - 1].text).toBe('the newest note')
    expect(entries.some((e) => e.text === 'note 0')).toBe(false)
  })
})

describe('buildMemoryPromptBlock', () => {
  it('returns null for empty memory', () => {
    expect(buildMemoryPromptBlock([])).toBeNull()
  })

  it('renders newest entries first within the character budget', () => {
    const entries = [
      { ts: '2026-07-01T10:00:00Z', text: 'older note' },
      { ts: '2026-07-07T10:00:00Z', text: 'newer note' },
    ]
    const block = buildMemoryPromptBlock(entries)!
    expect(block).toContain('## Saved Memory')
    expect(block.indexOf('newer note')).toBeLessThan(block.indexOf('older note'))
    expect(block).toContain('[2026-07-07]')
  })

  it('stays within the budget for large stores', () => {
    const entries = Array.from({ length: 500 }, (_, i) => ({
      ts: '2026-07-07T10:00:00Z',
      text: `a fairly long memory entry number ${i} `.repeat(3),
    }))
    const block = buildMemoryPromptBlock(entries)!
    expect(block.length).toBeLessThan(5_000)
  })
})
