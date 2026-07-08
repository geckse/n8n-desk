import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { readAlwaysAllowPresets, toolApprovalsPath } from '../approval-presets'

let baseDir: string
const INSTANCE_ID = 'inst_test'

beforeEach(async () => {
  baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'n8n-desk-presets-'))
})

afterEach(async () => {
  await fs.rm(baseDir, { recursive: true, force: true })
})

async function writePresetsFile(content: string): Promise<void> {
  const filePath = toolApprovalsPath(baseDir, INSTANCE_ID)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content, 'utf-8')
}

describe('toolApprovalsPath', () => {
  it('resolves to the per-instance tool-approvals.json', () => {
    expect(toolApprovalsPath('/base', 'inst_a')).toBe(
      path.join('/base', 'instances', 'inst_a', 'tool-approvals.json'),
    )
  })
})

describe('readAlwaysAllowPresets (tolerant read)', () => {
  it('reads a valid presets file', async () => {
    await writePresetsFile(JSON.stringify({ version: 1, alwaysAllow: ['execute_workflow', 'srv__tool'] }))
    expect(await readAlwaysAllowPresets(baseDir, INSTANCE_ID)).toEqual([
      'execute_workflow',
      'srv__tool',
    ])
  })

  it('returns [] when the file is missing', async () => {
    expect(await readAlwaysAllowPresets(baseDir, INSTANCE_ID)).toEqual([])
  })

  it('returns [] for malformed JSON', async () => {
    await writePresetsFile('{not json')
    expect(await readAlwaysAllowPresets(baseDir, INSTANCE_ID)).toEqual([])
  })

  it('returns [] when alwaysAllow is not an array', async () => {
    await writePresetsFile(JSON.stringify({ version: 1, alwaysAllow: 'execute_workflow' }))
    expect(await readAlwaysAllowPresets(baseDir, INSTANCE_ID)).toEqual([])
  })

  it('filters out non-string and empty entries', async () => {
    await writePresetsFile(JSON.stringify({ version: 1, alwaysAllow: ['ok', 42, null, '', {}] }))
    expect(await readAlwaysAllowPresets(baseDir, INSTANCE_ID)).toEqual(['ok'])
  })
})
