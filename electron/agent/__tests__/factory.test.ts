import { describe, it, expect } from 'vitest'
import { validateLlmConfig, LlmConfigError, createAgentRunner } from '../factory'
import { ClaudeSdkRunner } from '../claude-sdk-runner'
import { DeepAgentsRunner } from '../deep-agents-runner'

describe('validateLlmConfig', () => {
  it('returns null when nothing is configured', () => {
    expect(validateLlmConfig(null)).toBeNull()
  })

  it('accepts a valid claude-sdk config', () => {
    const resolved = validateLlmConfig({ backend: 'claude-sdk', apiKey: 'sk-ant-x', model: 'claude-sonnet-4-6' })
    expect(resolved).toEqual({
      backend: 'claude-sdk',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      apiKey: 'sk-ant-x',
    })
  })

  it('accepts deep-agents with every provider', () => {
    expect(validateLlmConfig({ backend: 'deep-agents', provider: 'anthropic', model: 'm', apiKey: 'k' })?.provider).toBe('anthropic')
    expect(validateLlmConfig({ backend: 'deep-agents', provider: 'openai', model: 'm', apiKey: 'k' })?.provider).toBe('openai')
    const ollama = validateLlmConfig({ backend: 'deep-agents', provider: 'ollama', model: 'qwen3', ollamaBaseUrl: 'http://box:11434' })
    expect(ollama?.provider).toBe('ollama')
    expect(ollama?.baseUrl).toBe('http://box:11434')
  })

  it('honors the configured backend for Anthropic on deep-agents (audit #17)', () => {
    const resolved = validateLlmConfig({ backend: 'deep-agents', provider: 'anthropic', model: 'claude-sonnet-4-6', apiKey: 'k' })
    expect(resolved?.backend).toBe('deep-agents')
  })

  it('rejects an unknown backend with an actionable message', () => {
    expect(() => validateLlmConfig({ backend: 'langgraph', model: 'm' })).toThrow(LlmConfigError)
    expect(() => validateLlmConfig({ backend: 'langgraph', model: 'm' })).toThrow(/invalid "backend"/)
    expect(() => validateLlmConfig({ model: 'm' })).toThrow(LlmConfigError)
  })

  it('rejects a missing model', () => {
    expect(() => validateLlmConfig({ backend: 'claude-sdk', apiKey: 'k' })).toThrow(/no "model"/)
  })

  it('rejects claude-sdk combined with a non-Anthropic provider', () => {
    expect(() => validateLlmConfig({ backend: 'claude-sdk', provider: 'ollama', model: 'm', apiKey: 'k' }))
      .toThrow(/only supports Anthropic/)
    expect(() => validateLlmConfig({ backend: 'claude-sdk', provider: 'openai', model: 'm', apiKey: 'k' }))
      .toThrow(/only supports Anthropic/)
  })

  it('rejects claude-sdk without an API key', () => {
    expect(() => validateLlmConfig({ backend: 'claude-sdk', model: 'm' })).toThrow(/Anthropic API key/)
  })

  it('rejects deep-agents with an invalid provider', () => {
    expect(() => validateLlmConfig({ backend: 'deep-agents', provider: 'gemini', model: 'm' }))
      .toThrow(/invalid "provider"/)
    expect(() => validateLlmConfig({ backend: 'deep-agents', model: 'm' })).toThrow(/invalid "provider"/)
  })

  it('rejects deep-agents anthropic/openai without an API key, but not ollama', () => {
    expect(() => validateLlmConfig({ backend: 'deep-agents', provider: 'anthropic', model: 'm' })).toThrow(/API key/)
    expect(() => validateLlmConfig({ backend: 'deep-agents', provider: 'openai', model: 'm' })).toThrow(/API key/)
    expect(validateLlmConfig({ backend: 'deep-agents', provider: 'ollama', model: 'm' })).not.toBeNull()
  })
})

describe('createAgentRunner', () => {
  it('creates the runner matching the backend', () => {
    expect(createAgentRunner('claude-sdk')).toBeInstanceOf(ClaudeSdkRunner)
    expect(createAgentRunner('deep-agents')).toBeInstanceOf(DeepAgentsRunner)
  })
})
