import { describe, it, expect, vi } from 'vitest'
import {
  ASK_USER_QUESTION_TOOL,
  normalizeQuestions,
  sanitizeAnswers,
  formatAnswersForModel,
  isQuestionInterrupt,
  createAskUserQuestionTool,
  QUESTION_INTERRUPT_KIND,
  type AskUserAnswers,
} from '../ask-user-question'
import { DESTRUCTIVE_TOOLS, requiresApproval } from '../approval'

describe('normalizeQuestions', () => {
  it('assigns missing ids deterministically (q1..qN)', () => {
    const questions = normalizeQuestions({
      questions: [
        { question: 'A?', options: [{ label: 'x' }] },
        { question: 'B?', options: [{ label: 'y' }] },
      ],
    })
    expect(questions.map((q) => q.id)).toEqual(['q1', 'q2'])
  })

  it('keeps provided ids and replaces duplicates', () => {
    const questions = normalizeQuestions({
      questions: [
        { id: 'format', question: 'A?', options: [{ label: 'x' }] },
        { id: 'format', question: 'B?', options: [{ label: 'y' }] },
        { question: 'C?', options: [{ label: 'z' }] },
      ],
    })
    expect(questions.map((q) => q.id)).toEqual(['format', 'q2', 'q3'])
  })

  it('preserves option descriptions and multiSelect', () => {
    const [q] = normalizeQuestions({
      questions: [
        {
          question: 'A?',
          options: [{ label: 'x', description: 'the x choice' }, { label: 'y' }],
          multiSelect: true,
        },
      ],
    })
    expect(q.multiSelect).toBe(true)
    expect(q.options[0]).toEqual({ label: 'x', description: 'the x choice' })
    expect(q.options[1]).toEqual({ label: 'y' })
  })
})

describe('sanitizeAnswers', () => {
  it('coerces a valid payload', () => {
    const answers = sanitizeAnswers({
      q1: { selected: ['CSV'], otherText: '  keep both  ' },
      q2: { selected: [] },
    })
    expect(answers).toEqual({
      q1: { selected: ['CSV'], otherText: 'keep both' },
      q2: { selected: [] },
    })
  })

  it('drops non-object entries, non-string selections, and empty otherText', () => {
    const answers = sanitizeAnswers({
      q1: { selected: ['ok', 42, null], otherText: '   ' },
      q2: 'nope',
      q3: null,
    })
    expect(answers).toEqual({ q1: { selected: ['ok'] } })
  })

  it('returns empty object for garbage input', () => {
    expect(sanitizeAnswers(null)).toEqual({})
    expect(sanitizeAnswers('text')).toEqual({})
    expect(sanitizeAnswers(42)).toEqual({})
  })
})

describe('formatAnswersForModel', () => {
  const questions = normalizeQuestions({
    questions: [
      { question: 'Which format?', options: [{ label: 'CSV' }, { label: 'JSON' }] },
      { question: 'Which sources?', options: [{ label: 'Gmail' }], multiSelect: true },
      { question: 'Deploy now?', options: [{ label: 'Yes' }] },
    ],
  })

  it('renders selections, other text, and missing answers', () => {
    const answers: AskUserAnswers = {
      q1: { selected: ['CSV'] },
      q2: { selected: ['Gmail'], otherText: 'also the wiki' },
    }
    const text = formatAnswersForModel(questions, answers)
    expect(text).toContain('Q (q1): Which format? → selected: CSV')
    expect(text).toContain('Q (q2): Which sources? → selected: Gmail; other: also the wiki')
    expect(text).toContain('Q (q3): Deploy now? → no answer provided')
  })

  it('renders other-only answers', () => {
    const text = formatAnswersForModel(questions, { q1: { selected: [], otherText: 'PDF' } })
    expect(text).toContain('Q (q1): Which format? → other: PDF')
  })
})

describe('isQuestionInterrupt', () => {
  it('accepts the question interrupt shape', () => {
    expect(isQuestionInterrupt({ kind: QUESTION_INTERRUPT_KIND, questions: [] })).toBe(true)
  })

  it('rejects HITL approval interrupts and garbage', () => {
    expect(isQuestionInterrupt({ actionRequests: [] })).toBe(false)
    expect(isQuestionInterrupt(null)).toBe(false)
    expect(isQuestionInterrupt({ kind: 'other', questions: [] })).toBe(false)
    expect(isQuestionInterrupt({ kind: QUESTION_INTERRUPT_KIND })).toBe(false)
  })
})

describe('createAskUserQuestionTool', () => {
  it('interrupts with normalized questions and returns formatted answers', async () => {
    const answers: AskUserAnswers = { q1: { selected: ['CSV'] } }
    const interruptFn = vi.fn().mockReturnValue(answers)
    const lcTool = createAskUserQuestionTool(interruptFn)

    expect(lcTool.name).toBe(ASK_USER_QUESTION_TOOL)

    const result = await lcTool.invoke({
      questions: [{ question: 'Which format?', options: [{ label: 'CSV' }, { label: 'JSON' }] }],
    })

    expect(interruptFn).toHaveBeenCalledWith({
      kind: QUESTION_INTERRUPT_KIND,
      questions: [
        { id: 'q1', question: 'Which format?', options: [{ label: 'CSV' }, { label: 'JSON' }] },
      ],
    })
    expect(result).toContain('selected: CSV')
  })
})

describe('approval gating', () => {
  it('ask_user_question never requires approval in any name form', () => {
    const interrupt = new Set(DESTRUCTIVE_TOOLS)
    expect(requiresApproval(ASK_USER_QUESTION_TOOL, interrupt)).toBe(false)
    expect(requiresApproval(`mcp__n8n-desk-local__${ASK_USER_QUESTION_TOOL}`, interrupt)).toBe(false)
  })
})
