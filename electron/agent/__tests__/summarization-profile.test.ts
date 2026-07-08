/**
 * Auto-summarization trigger wiring (audit #27).
 *
 * deepagents auto-wires createSummarizationMiddleware into every deep agent.
 * Without a model profile it falls back to a 170k-token trigger — which NEVER
 * fires inside Ollama's 32k context, so long sessions overflow instead of
 * summarizing. The runner therefore stamps a profile with maxInputTokens on
 * ChatOllama; ChatAnthropic/ChatOpenAI ship real profiles.
 */
import { describe, it, expect } from 'vitest'
import { computeSummarizationDefaults } from 'deepagents'
import { createChatModel, OLLAMA_NUM_CTX } from '../deep-agents-runner'

describe('summarization profile wiring (audit #27)', () => {
  it('stamps ChatOllama with a profile matching numCtx', async () => {
    const model = await createChatModel({ provider: 'ollama', model: 'qwen3' })
    const profile = (model as { profile?: { maxInputTokens?: number } }).profile
    expect(profile?.maxInputTokens).toBe(OLLAMA_NUM_CTX)
  })

  it('deepagents computes the 85%-of-context trigger for the Ollama model', async () => {
    const model = await createChatModel({ provider: 'ollama', model: 'qwen3' })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const defaults = computeSummarizationDefaults(model as any)
    // Fraction-based trigger — NOT the 170k-token fallback that never fires
    // in a 32k context.
    expect(defaults.trigger).toEqual({ type: 'fraction', value: 0.85 })
  })

  it('ChatAnthropic ships a native profile (no stamping needed)', async () => {
    const model = await createChatModel({ provider: 'anthropic', model: 'claude-sonnet-4-5-20250929', apiKey: 'test-key' })
    const profile = (model as { profile?: { maxInputTokens?: number } }).profile
    expect(typeof profile?.maxInputTokens).toBe('number')
    expect(profile!.maxInputTokens!).toBeGreaterThanOrEqual(100_000)
  })
})
