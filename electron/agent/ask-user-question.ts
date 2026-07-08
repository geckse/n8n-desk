import { z } from 'zod'
import { tool } from '@langchain/core/tools'

/**
 * Shared `ask_user_question` tool definitions used by BOTH agent runners
 * (CLAUDE.md hard invariant — one shared layer, two backends).
 *
 * The tool lets the agent pause and ask the user 1–4 structured questions.
 * The renderer shows a card with single-select (radio) or multi-select
 * (checkbox) options PLUS an always-present free-text "Other" input per
 * question. The submitted answers become the tool result.
 *
 * Backend mechanics differ (event parity, not mechanism parity):
 * - Deep Agents: the tool handler calls LangGraph's `interrupt()`; the graph
 *   pauses, the runner emits `question_asked`, and `new Command({ resume })`
 *   makes `interrupt()` return the answers. The handler re-executes from the
 *   top on resume, so it must have NO side effects before `interrupt()`.
 * - Claude SDK: the tool is registered on the in-process MCP server; its
 *   handler blocks awaiting the answers (canUseTool cannot inject results).
 */

export const ASK_USER_QUESTION_TOOL = 'ask_user_question'

export const ASK_USER_QUESTION_DESCRIPTION =
  'Ask the user one or more clarifying questions and wait for their answers. ' +
  'Use when requirements are ambiguous or a decision materially changes the outcome. ' +
  'Batch all related questions (up to 4) into ONE call — never make parallel calls. ' +
  'Give each question 2-5 concise options; set multiSelect when several may apply. ' +
  'The UI always adds a free-text "Other" field, so options need not be exhaustive. ' +
  'Runs locally and needs no approval. Do not ask what you can infer yourself.'

// --- Types ---

export interface AskUserQuestionOption {
  label: string
  description?: string
}

export interface AskUserQuestionItem {
  id: string
  question: string
  options: AskUserQuestionOption[]
  multiSelect?: boolean
}

export interface AskUserAnswerItem {
  /** Selected option labels (empty when the user only used the "Other" field) */
  selected: string[]
  /** Free-text "Other" answer, when provided */
  otherText?: string
}

/** Answers keyed by question id. */
export type AskUserAnswers = Record<string, AskUserAnswerItem>

// --- Schema ---

/**
 * ZodRawShape — usable both as `z.object(shape)` for the LangChain tool and
 * as the raw shape `McpServer.tool()` expects.
 */
export const askUserQuestionZodShape = {
  questions: z
    .array(
      z.object({
        id: z.string().optional().describe('Stable id for the question; auto-assigned when omitted'),
        question: z.string().min(1).describe('The complete question to ask the user'),
        options: z
          .array(
            z.object({
              label: z.string().min(1).describe('Concise display text for this choice'),
              description: z.string().optional().describe('Optional explanation of the choice'),
            }),
          )
          .min(1)
          .max(12)
          .describe('The available choices (the UI adds a free-text "Other" automatically)'),
        multiSelect: z.boolean().optional().describe('Allow selecting multiple options'),
      }),
    )
    .min(1)
    .max(4)
    .describe('The questions to ask (1-4 per call)'),
}

type AskUserQuestionInput = z.infer<z.ZodObject<typeof askUserQuestionZodShape>>

// --- Normalization ---

/**
 * Assign missing or duplicate question ids deterministically (q1..qN) so the
 * events, the UI, and the answer keys always line up.
 */
export function normalizeQuestions(input: AskUserQuestionInput): AskUserQuestionItem[] {
  const seen = new Set<string>()
  return input.questions.map((q, index) => {
    let id = typeof q.id === 'string' && q.id.trim() ? q.id.trim() : `q${index + 1}`
    if (seen.has(id)) id = `q${index + 1}`
    seen.add(id)
    return {
      id,
      question: q.question,
      options: q.options.map((o) => ({
        label: o.label,
        ...(o.description ? { description: o.description } : {}),
      })),
      ...(q.multiSelect ? { multiSelect: true } : {}),
    }
  })
}

/**
 * Coerce an untrusted renderer payload into `AskUserAnswers`. Drops anything
 * that isn't `{ selected: string[], otherText?: string }` keyed by string.
 */
export function sanitizeAnswers(raw: unknown): AskUserAnswers {
  const answers: AskUserAnswers = {}
  if (!raw || typeof raw !== 'object') return answers

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue
    const item = value as Record<string, unknown>
    const selected = Array.isArray(item.selected)
      ? item.selected.filter((s): s is string => typeof s === 'string')
      : []
    const otherText =
      typeof item.otherText === 'string' && item.otherText.trim() ? item.otherText.trim() : undefined
    answers[key] = { selected, ...(otherText ? { otherText } : {}) }
  }

  return answers
}

/**
 * Readable serialization of the answers returned to the model as the tool
 * result, e.g.:
 *   Q1: Which format? → selected: CSV
 *   Q2: Which sources? → selected: Gmail, Slack; other: also our intranet wiki
 */
export function formatAnswersForModel(
  questions: AskUserQuestionItem[],
  answers: AskUserAnswers,
): string {
  const lines = questions.map((q) => {
    const answer = answers[q.id]
    const parts: string[] = []
    if (answer && answer.selected.length > 0) {
      parts.push(`selected: ${answer.selected.join(', ')}`)
    }
    if (answer?.otherText) {
      parts.push(`other: ${answer.otherText}`)
    }
    const rendered = parts.length > 0 ? parts.join('; ') : 'no answer provided'
    return `Q (${q.id}): ${q.question} → ${rendered}`
  })
  return `The user answered:\n${lines.join('\n')}`
}

// --- Deep Agents interrupt payload ---

export const QUESTION_INTERRUPT_KIND = 'ask_user_question'

export interface QuestionInterruptValue {
  kind: typeof QUESTION_INTERRUPT_KIND
  questions: AskUserQuestionItem[]
}

export function isQuestionInterrupt(value: unknown): value is QuestionInterruptValue {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as QuestionInterruptValue).kind === QUESTION_INTERRUPT_KIND &&
    Array.isArray((value as QuestionInterruptValue).questions)
  )
}

// --- Deep Agents tool factory ---

/**
 * Create the LangChain tool for the Deep Agents backend. `interruptFn` is the
 * lazily imported `interrupt` from `@langchain/langgraph`, passed in so this
 * module stays free of the ESM-only import.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createAskUserQuestionTool(interruptFn: (value: unknown) => unknown): any {
  return tool(
    async (input: AskUserQuestionInput) => {
      const questions = normalizeQuestions(input)
      // NO side effects before interrupt() — the handler re-executes from the
      // top on resume; the runner (not this handler) emits the stream events.
      const interruptValue: QuestionInterruptValue = { kind: QUESTION_INTERRUPT_KIND, questions }
      const answers = interruptFn(interruptValue) as AskUserAnswers
      return formatAnswersForModel(questions, answers)
    },
    {
      name: ASK_USER_QUESTION_TOOL,
      description: ASK_USER_QUESTION_DESCRIPTION,
      schema: z.object(askUserQuestionZodShape),
    },
  )
}
