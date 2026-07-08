import { z } from 'zod'
import type { FilesystemSandboxPolicy, LoadedSkill } from './types'
import { createFileTools } from './file-tools'
import { createMemoryTools } from './memory-tools'
import { jsComputeTool } from './js-sandbox'
import {
  ASK_USER_QUESTION_TOOL,
  ASK_USER_QUESTION_DESCRIPTION,
  askUserQuestionZodShape,
  normalizeQuestions,
  formatAnswersForModel,
  type AskUserQuestionItem,
  type AskUserAnswers,
} from './ask-user-question'
import { substituteArguments, readSupportingFile } from '../skill-loader'

// The MCP SDK's McpServer type — kept loose to avoid a hard type dependency
// on the lazily-imported module.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type McpServerInstance = any

/**
 * Register the shared local agent tool surface on an in-process McpServer:
 * - the sandboxed file tools when a sandbox policy exists (read/write for all
 *   supported formats, list/search, edit_text, file management, clipboard)
 * - js_compute (sandboxed JavaScript execution)
 * - memory_read + memory_append when a memory file is configured (audit #45)
 * - invoke_skill + read_skill_file when skills are configured — INDEPENDENT
 *   of the sandbox policy (audit #53)
 * - ask_user_question when an `askUser` callback is provided — the handler
 *   blocks until the user answers in the UI (canUseTool cannot inject tool
 *   results, so the wait lives here)
 *
 * This is the single registration point for the Claude SDK backend. The Deep
 * Agents backend consumes the same LangChain tools directly — both backends
 * must expose the identical local toolset (CLAUDE.md hard invariant).
 *
 * Tool invocation errors are returned as `isError` MCP responses (never
 * thrown) so the agent can recover gracefully.
 */
export function registerAgentTools(
  mcpServer: McpServerInstance,
  policy: FilesystemSandboxPolicy | undefined,
  skills: LoadedSkill[] = [],
  options: {
    memoryFilePath?: string
    askUser?: (questions: AskUserQuestionItem[]) => Promise<AskUserAnswers>
  } = {},
): number {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allTools: any[] = [
    ...(policy ? createFileTools(policy) : []),
    jsComputeTool,
    ...(options.memoryFilePath ? createMemoryTools(options.memoryFilePath) : []),
  ]

  for (const lcTool of allTools) {
    const name: string = lcTool.name
    const description: string = lcTool.description ?? ''

    // LangChain's tool() creates a DynamicStructuredTool with a z.ZodObject
    // schema; ZodObject.shape is the ZodRawShape McpServer.tool() expects.
    const zodShape = lcTool.schema?.shape

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handler = async (args: Record<string, unknown>): Promise<any> => {
      try {
        const result = await lcTool.invoke(args)
        return {
          content: [{
            type: 'text' as const,
            text: typeof result === 'string' ? result : JSON.stringify(result),
          }],
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: false, error: message }),
          }],
          isError: true,
        }
      }
    }

    if (zodShape) {
      mcpServer.tool(name, description, zodShape, handler)
    } else {
      mcpServer.tool(name, description, handler)
    }
  }

  if (skills.length > 0) {
    registerSkillTools(mcpServer, skills)
  }

  let registeredCount = allTools.length

  // ask_user_question — registered directly (not via the LangChain loop)
  // because its handler must be runner-bound: it emits question_asked and
  // blocks on the runner's pending-question registry until answer() fires.
  const askUser = options.askUser
  if (askUser) {
    mcpServer.tool(
      ASK_USER_QUESTION_TOOL,
      ASK_USER_QUESTION_DESCRIPTION,
      askUserQuestionZodShape,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (args: Record<string, unknown>): Promise<any> => {
        try {
          const questions = normalizeQuestions(args as Parameters<typeof normalizeQuestions>[0])
          const answers = await askUser(questions)
          return { content: [{ type: 'text' as const, text: formatAnswersForModel(questions, answers) }] }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err)
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: message }) }],
            isError: true,
          }
        }
      },
    )
    registeredCount += 1
  }

  return registeredCount
}

/**
 * Register invoke_skill and read_skill_file. These mirror the LangChain skill
 * tools in DeepAgentsRunner, keeping both agent backends in sync.
 */
function registerSkillTools(mcpServer: McpServerInstance, skills: LoadedSkill[]): void {
  mcpServer.tool(
    'invoke_skill',
    'Load a skill by name. Returns the full instructions with arguments substituted. If the content references additional files (e.g., [PATTERNS.md](PATTERNS.md)), use read_skill_file to load them.',
    {
      skillName: z.string().describe('The kebab-case name of the skill to invoke'),
      arguments: z.string().optional().describe('Arguments to substitute into the skill content'),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (args: { skillName: string; arguments?: string }): Promise<any> => {
      const skill = skills.find((s) => s.name === args.skillName)
      if (!skill) {
        return { content: [{ type: 'text' as const, text: `Skill "${args.skillName}" not found.` }], isError: true }
      }
      return { content: [{ type: 'text' as const, text: substituteArguments(skill.content, args.arguments ?? '') }] }
    },
  )

  mcpServer.tool(
    'read_skill_file',
    'Read a supporting file referenced by a skill (e.g., PATTERNS.md, SDK-API.md). Use when invoke_skill returns content that references additional files.',
    {
      skillName: z.string().describe('The skill name that owns this file'),
      filePath: z.string().describe('Relative path within the skill directory (e.g., "PATTERNS.md")'),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (args: { skillName: string; filePath: string }): Promise<any> => {
      const skill = skills.find((s) => s.name === args.skillName)
      if (!skill) {
        return { content: [{ type: 'text' as const, text: `Skill "${args.skillName}" not found.` }], isError: true }
      }
      const content = await readSupportingFile(skill, args.filePath)
      if (content === null) {
        return { content: [{ type: 'text' as const, text: `File "${args.filePath}" not found in skill "${args.skillName}".` }], isError: true }
      }
      return { content: [{ type: 'text' as const, text: content }] }
    },
  )
}
