/**
 * Registration matrix for the shared local tool surface (audits #53, #45):
 * skills and memory tools must register independently of the sandbox policy.
 */
import { describe, it, expect } from 'vitest'
import path from 'path'
import os from 'os'
import { registerAgentTools } from '../agent-tool-registry'
import { buildCoworkPolicy } from '../sandbox-policy'
import type { LoadedSkill } from '../types'

/** Minimal McpServer stand-in that records registered tool names. */
function fakeMcpServer(): { names: string[]; server: { tool: (...args: unknown[]) => void } } {
  const names: string[] = []
  return {
    names,
    server: {
      tool: (...args: unknown[]) => {
        names.push(String(args[0]))
      },
    },
  }
}

function makeSkill(name: string): LoadedSkill {
  return {
    name,
    description: `${name} description`,
    content: `# ${name}`,
    disableModelInvocation: false,
    userInvocable: true,
    directory: '/fake',
    source: 'user',
  }
}

describe('registerAgentTools', () => {
  it('registers skill tools WITHOUT a sandbox policy (audit #53)', () => {
    const { names, server } = fakeMcpServer()
    registerAgentTools(server, undefined, [makeSkill('build-workflow')])

    expect(names).toContain('invoke_skill')
    expect(names).toContain('read_skill_file')
    expect(names).toContain('js_compute')
    // No file tools without a policy
    expect(names).not.toContain('read_text')
    expect(names).not.toContain('write_text')
  })

  it('registers memory tools when a memory file is configured (audit #45)', () => {
    const { names, server } = fakeMcpServer()
    registerAgentTools(server, undefined, [], {
      memoryFilePath: path.join(os.tmpdir(), 'memory.json'),
    })

    expect(names).toContain('memory_read')
    expect(names).toContain('memory_append')
  })

  it('registers the full surface with policy + skills + memory', () => {
    const { names, server } = fakeMcpServer()
    const policy = buildCoworkPolicy([], path.join(os.tmpdir(), '.n8n-desk-test'))
    registerAgentTools(server, policy, [makeSkill('s')], {
      memoryFilePath: path.join(os.tmpdir(), 'memory.json'),
    })

    for (const name of [
      'read_text', 'write_text', 'edit_text', 'list_files', 'search_files',
      'move_file', 'copy_file', 'delete_file', 'open_path',
      'clipboard_read', 'clipboard_write',
      'js_compute', 'memory_read', 'memory_append',
      'invoke_skill', 'read_skill_file',
    ]) {
      expect(names).toContain(name)
    }
  })

  it('registers ask_user_question only when an askUser callback is provided', () => {
    const withCallback = fakeMcpServer()
    const countWith = registerAgentTools(withCallback.server, undefined, [], {
      askUser: async () => ({}),
    })
    expect(withCallback.names).toContain('ask_user_question')
    expect(countWith).toBe(withCallback.names.length)

    const withoutCallback = fakeMcpServer()
    const countWithout = registerAgentTools(withoutCallback.server, undefined, [])
    expect(withoutCallback.names).not.toContain('ask_user_question')
    expect(countWith).toBe(countWithout + 1)
  })
})
