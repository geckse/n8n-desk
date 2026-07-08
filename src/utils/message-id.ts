let counter = 0

/**
 * Unique session-message id.
 *
 * `msg_${Date.now()}` alone collides: agent events land in synchronous
 * bursts, so several messages get created within the same millisecond and
 * every id-based lookup (segment flush, tool-result matching) then resolves
 * to the wrong message.
 */
export function generateMessageId(): string {
  return `msg_${Date.now().toString(36)}_${(counter++).toString(36)}`
}
