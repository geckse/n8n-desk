/**
 * Deterministic scripted chat model for runner integration tests.
 *
 * Pops one pre-scripted AIMessage per model call — turn 1 can emit tool
 * calls, turn 2 the final answer, etc. Extends the v1 BaseChatModel from the
 * SAME @langchain/core tree the agent graph runs on, so message classes and
 * callbacks interoperate.
 */
import { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { AIMessage, type BaseMessage } from '@langchain/core/messages'
import type { ChatResult } from '@langchain/core/outputs'
import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager'

export class ScriptedChatModel extends BaseChatModel {
  private script: AIMessage[]
  /** Every messages array _generate was called with, for assertions. */
  calls: BaseMessage[][] = []

  constructor(script: AIMessage[]) {
    super({})
    this.script = [...script]
  }

  _llmType(): string {
    return 'scripted'
  }

  // The graph binds tools onto the model; a fake ignores them.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override bindTools(): any {
    return this
  }

  async _generate(
    messages: BaseMessage[],
    _options: this['ParsedCallOptions'],
    runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    this.calls.push(messages)
    const message = this.script.shift() ?? new AIMessage('(script exhausted)')
    const text = typeof message.content === 'string' ? message.content : ''
    if (text) {
      await runManager?.handleLLMNewToken(text)
    }
    return {
      generations: [{ message, text }],
      llmOutput: {},
    }
  }
}
