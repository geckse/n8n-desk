import type { ConversationMessage } from './types'

/**
 * Faithful multi-turn history assembly (audit #18).
 *
 * The renderer persists a chronological JSONL transcript per session: user
 * messages, assistant text segments (including the ones that precede tool
 * calls), and tool messages carrying the tool name, status, and result.
 * Replaying only the final assistant segment loses exactly the context that
 * makes "continue yesterday's workflow" work — workflow IDs, execution IDs,
 * validation output.
 *
 * This module folds that transcript into alternating user/assistant messages:
 * everything the agent did between two user turns (text segments, tool calls
 * + results) becomes ONE assistant message with tool activity rendered as
 * compact text blocks. Folding — rather than replaying native tool messages —
 * keeps both backends happy: providers enforce strict tool_use/tool_result
 * pairing that a cold-start replay can't reconstruct, and both runners consume
 * the same plain user/assistant shape (parity invariant).
 */

/** One line of the renderer's session JSONL. */
export interface SessionJsonlLine {
  role?: string
  content?: string
  meta?: {
    toolCallId?: string
    toolName?: string
    status?: string
    error?: unknown
    [key: string]: unknown
  }
}

/** Tool results are useful for their identifiers, not their bulk. */
const TOOL_RESULT_EXCERPT_LIMIT = 1_500

function excerpt(text: string): string {
  if (text.length <= TOOL_RESULT_EXCERPT_LIMIT) return text
  return `${text.slice(0, TOOL_RESULT_EXCERPT_LIMIT)}… [truncated ${text.length - TOOL_RESULT_EXCERPT_LIMIT} chars]`
}

function formatToolMessage(msg: SessionJsonlLine): string {
  const name = msg.meta?.toolName ?? 'unknown_tool'
  const status = msg.meta?.status === 'failed' ? 'failed' : 'completed'
  const header = `[Called tool ${name} — ${status}]`
  const body = msg.content ? `\nResult: ${excerpt(msg.content)}` : ''
  return `${header}${body}`
}

/**
 * Build alternating user/assistant conversation history from parsed JSONL
 * lines.
 *
 * @param lines - Parsed session JSONL entries in file order.
 * @param currentMessage - The message being sent right now. The renderer
 *   persists it before invoking, so a trailing match is dropped — otherwise
 *   the runners feed it to the model twice (history block + prompt).
 */
export function buildConversationHistory(
  lines: SessionJsonlLine[],
  currentMessage?: string,
): ConversationMessage[] {
  const history: ConversationMessage[] = []
  let assistantParts: string[] = []

  const flushAssistant = (): void => {
    if (assistantParts.length === 0) return
    history.push({ role: 'assistant', content: assistantParts.join('\n\n') })
    assistantParts = []
  }

  for (const msg of lines) {
    if (!msg.role) continue

    if (msg.role === 'user') {
      if (!msg.content) continue
      flushAssistant()
      history.push({ role: 'user', content: msg.content })
    } else if (msg.role === 'assistant') {
      if (!msg.content) continue
      assistantParts.push(msg.content)
    } else if (msg.role === 'tool' && msg.meta?.toolCallId) {
      // Tool activity folds into the surrounding assistant turn so key
      // identifiers (workflow IDs, execution IDs) survive across turns.
      assistantParts.push(formatToolMessage(msg))
    }
    // thinking / system (error banners) are UI-only — not model context
  }
  flushAssistant()

  // Drop the just-persisted current user message from the tail so it is not
  // duplicated into both the history block and the prompt (audit #43).
  const last = history[history.length - 1]
  if (currentMessage !== undefined && last?.role === 'user' && last.content === currentMessage) {
    history.pop()
  }

  return history
}

/** Parse raw JSONL file content into lines, skipping malformed entries. */
export function parseSessionJsonl(content: string): SessionJsonlLine[] {
  const lines: SessionJsonlLine[] = []
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      lines.push(JSON.parse(trimmed) as SessionJsonlLine)
    } catch {
      // Skip malformed lines
    }
  }
  return lines
}
