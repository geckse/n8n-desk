/**
 * Unbounded async event queue with multiple producers and a single consumer.
 *
 * Exists because the Claude SDK's `canUseTool` callback must surface an
 * `approval_required` event to the renderer WHILE the SDK message iterator is
 * blocked waiting for the decision — draining events only between iterator
 * messages deadlocks. Producers push at any time; the consumer's async
 * iterator wakes immediately.
 */
export class AsyncEventQueue<T> {
  private queue: T[] = []
  private waiter: (() => void) | null = null
  private closed = false

  /** Enqueue an item and wake the consumer. No-op after close(). */
  push(item: T): void {
    if (this.closed) return
    this.queue.push(item)
    this.wake()
  }

  /** Signal that no more items will arrive. Queued items still drain. */
  close(): void {
    this.closed = true
    this.wake()
  }

  get isClosed(): boolean {
    return this.closed
  }

  private wake(): void {
    const waiter = this.waiter
    this.waiter = null
    waiter?.()
  }

  /** Drain items until close(). Single consumer only. */
  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    for (;;) {
      while (this.queue.length > 0) {
        yield this.queue.shift()!
      }
      if (this.closed) return
      await new Promise<void>((resolve) => {
        this.waiter = resolve
      })
    }
  }
}
