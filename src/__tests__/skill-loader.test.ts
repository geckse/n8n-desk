import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock fs/promises — used by parseSkillMd to read files
const mockReadFile = vi.fn()
vi.mock('fs/promises', () => ({
  default: {
    readFile: (...args: unknown[]) => mockReadFile(...args),
    readdir: vi.fn().mockResolvedValue([]),
    stat: vi.fn(),
    mkdir: vi.fn(),
    writeFile: vi.fn(),
    rm: vi.fn(),
  },
}))

import {
  parseSkillMd,
  substituteArguments,
  buildSkillDescriptions,
} from '../../electron/skill-loader'
import type { LoadedSkill } from '@/types/plugin'

describe('skill-loader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // --- parseSkillMd ---

  describe('parseSkillMd', () => {
    it('parses valid SKILL.md with all fields', async () => {
      const content = [
        '---',
        'name: my-skill',
        'description: A useful skill',
        'disable-model-invocation: true',
        'user-invocable: false',
        'allowed-tools:',
        '  - tool_a',
        '  - tool_b',
        '---',
        'This is the skill content body.',
        '',
        'It has multiple lines.',
      ].join('\n')

      mockReadFile.mockResolvedValue(content)

      const result = await parseSkillMd('/fake/skills/my-skill/SKILL.md', 'user')

      expect(result).not.toBeNull()
      expect(result!.name).toBe('my-skill')
      expect(result!.description).toBe('A useful skill')
      expect(result!.disableModelInvocation).toBe(true)
      expect(result!.userInvocable).toBe(false)
      expect(result!.allowedTools).toEqual(['tool_a', 'tool_b'])
      expect(result!.content).toBe('This is the skill content body.\n\nIt has multiple lines.')
      expect(result!.source).toBe('user')
      expect(result!.directory).toBe('/fake/skills/my-skill')
    })

    it('uses default values for optional boolean fields', async () => {
      const content = [
        '---',
        'name: simple-skill',
        'description: A simple skill',
        '---',
        'Content here.',
      ].join('\n')

      mockReadFile.mockResolvedValue(content)

      const result = await parseSkillMd('/fake/skills/simple-skill/SKILL.md', 'user')

      expect(result).not.toBeNull()
      expect(result!.disableModelInvocation).toBe(false) // default
      expect(result!.userInvocable).toBe(true) // default
      expect(result!.allowedTools).toBeUndefined()
    })

    it('returns null when name is missing', async () => {
      const content = [
        '---',
        'description: No name here',
        '---',
        'Body content.',
      ].join('\n')

      mockReadFile.mockResolvedValue(content)

      const result = await parseSkillMd('/fake/SKILL.md', 'user')
      expect(result).toBeNull()
    })

    it('returns null when description is missing', async () => {
      const content = [
        '---',
        'name: no-desc',
        '---',
        'Body content.',
      ].join('\n')

      mockReadFile.mockResolvedValue(content)

      const result = await parseSkillMd('/fake/SKILL.md', 'user')
      expect(result).toBeNull()
    })

    it('returns null when name is not a string', async () => {
      const content = [
        '---',
        'name: 123',
        'description: Has numeric name',
        '---',
        'Body.',
      ].join('\n')

      mockReadFile.mockResolvedValue(content)

      const result = await parseSkillMd('/fake/SKILL.md', 'user')
      // gray-matter parses 123 as a number, not a string
      expect(result).toBeNull()
    })

    it('returns null for invalid YAML frontmatter', async () => {
      const content = [
        '---',
        'name: [invalid yaml',
        'description: :::',
        '---',
        'Body.',
      ].join('\n')

      mockReadFile.mockResolvedValue(content)

      const result = await parseSkillMd('/fake/SKILL.md', 'user')
      // gray-matter may return unexpected types for malformed YAML
      // The function validates types, so it should either return null or handle gracefully
      // In this case, [invalid yaml parses to an array, so name check fails
      expect(result).toBeNull()
    })

    it('returns null when file cannot be read', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT: no such file'))

      const result = await parseSkillMd('/fake/missing/SKILL.md', 'user')
      expect(result).toBeNull()
    })

    it('filters non-string values from allowed-tools', async () => {
      const content = [
        '---',
        'name: tools-skill',
        'description: Skill with mixed tools',
        'allowed-tools:',
        '  - valid_tool',
        '  - 123',
        '  - ""',
        '  - another_tool',
        '---',
        'Body.',
      ].join('\n')

      mockReadFile.mockResolvedValue(content)

      const result = await parseSkillMd('/fake/SKILL.md', 'user')

      expect(result).not.toBeNull()
      // Empty strings and non-strings should be filtered out
      // 123 is parsed as number by gray-matter, "" as empty string
      expect(result!.allowedTools).toEqual(['valid_tool', 'another_tool'])
    })

    it('sets source to the plugin name for plugin skills', async () => {
      const content = [
        '---',
        'name: plugin-skill',
        'description: From a plugin',
        '---',
        'Body.',
      ].join('\n')

      mockReadFile.mockResolvedValue(content)

      const result = await parseSkillMd('/fake/SKILL.md', 'my-plugin')
      expect(result).not.toBeNull()
      expect(result!.source).toBe('my-plugin')
    })
  })

  // --- substituteArguments ---

  describe('substituteArguments', () => {
    it('replaces $ARGUMENTS with the full arguments string', () => {
      const result = substituteArguments('Process: $ARGUMENTS', 'file.txt --verbose')
      expect(result).toBe('Process: file.txt --verbose')
    })

    it('replaces multiple $ARGUMENTS occurrences', () => {
      const result = substituteArguments(
        'Input: $ARGUMENTS\nAgain: $ARGUMENTS',
        'hello world',
      )
      expect(result).toBe('Input: hello world\nAgain: hello world')
    })

    it('replaces positional arguments $0, $1, $2', () => {
      const result = substituteArguments(
        'First: $0, Second: $1, Third: $2',
        'alpha beta gamma',
      )
      expect(result).toBe('First: alpha, Second: beta, Third: gamma')
    })

    it('leaves unreferenced positional placeholders intact', () => {
      const result = substituteArguments(
        'First: $0, Missing: $3',
        'only-one',
      )
      expect(result).toBe('First: only-one, Missing: $3')
    })

    it('handles no arguments (empty string)', () => {
      const result = substituteArguments(
        'Args: $ARGUMENTS, Pos: $0',
        '',
      )
      expect(result).toBe('Args: , Pos: $0')
    })

    it('handles whitespace-only arguments', () => {
      const result = substituteArguments(
        'Args: $ARGUMENTS, Pos: $0',
        '   ',
      )
      expect(result).toBe('Args:    , Pos: $0')
    })

    it('does not replace $10 when only $1 has a value', () => {
      // $1 should be replaced but $10 should remain as "$10"
      // because the regex uses (?![0-9]) negative lookahead
      const result = substituteArguments('$0 and $10', 'zero one')
      expect(result).toBe('zero and $10')
    })

    it('handles content with no placeholders', () => {
      const result = substituteArguments('No placeholders here', 'some args')
      expect(result).toBe('No placeholders here')
    })

    it('handles both $ARGUMENTS and positional args together', () => {
      const result = substituteArguments(
        'All: $ARGUMENTS\nFirst: $0\nSecond: $1',
        'foo bar',
      )
      expect(result).toBe('All: foo bar\nFirst: foo\nSecond: bar')
    })
  })

  // --- buildSkillDescriptions ---

  describe('buildSkillDescriptions', () => {
    function makeSkill(name: string, description: string): LoadedSkill {
      return {
        name,
        description,
        content: 'This is the full content that should NOT appear in descriptions',
        disableModelInvocation: false,
        userInvocable: true,
        directory: '/fake',
        source: 'user',
      }
    }

    it('returns null for empty skills array', () => {
      const result = buildSkillDescriptions([])
      expect(result).toBeNull()
    })

    it('builds description block for a single skill', () => {
      const skills = [makeSkill('deploy', 'Deploy to production')]
      const result = buildSkillDescriptions(skills)

      expect(result).toContain('## Available Skills')
      expect(result).toContain('- deploy: Deploy to production')
    })

    it('builds description block for multiple skills', () => {
      const skills = [
        makeSkill('deploy', 'Deploy to production'),
        makeSkill('test', 'Run test suite'),
        makeSkill('lint', 'Check code style'),
      ]
      const result = buildSkillDescriptions(skills)

      expect(result).toContain('- deploy: Deploy to production')
      expect(result).toContain('- test: Run test suite')
      expect(result).toContain('- lint: Check code style')
    })

    it('only includes name and description, not full content', () => {
      const skills = [makeSkill('secret-skill', 'Does secret things')]
      const result = buildSkillDescriptions(skills)

      expect(result).not.toContain('full content')
      expect(result).not.toContain('should NOT appear')
      expect(result).toContain('secret-skill')
      expect(result).toContain('Does secret things')
    })

    it('teaches the invoke_skill mechanism (audit #58)', () => {
      const skills = [makeSkill('my-skill', 'My description')]
      const result = buildSkillDescriptions(skills)

      expect(result).toContain('- my-skill:')
      expect(result).toContain('invoke_skill')
      expect(result).toContain('read_skill_file')
    })
  })
})
