import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSettingsStore } from '@/stores/settings'
import type { LlmConfig } from '@/types/settings'

// Mock i18n
vi.mock('@/i18n', () => ({
  setAppLocale: vi.fn(),
}))

// Mock local-storage
vi.mock('@/services/local-storage', () => {
  const store: Record<string, string> = {}
  return {
    localStorageService: {
      readJson: vi.fn(async <T>(path: string): Promise<T | null> => {
        const data = store[path]
        return data ? (JSON.parse(data) as T) : null
      }),
      writeJson: vi.fn(async (path: string, data: unknown) => {
        store[path] = JSON.stringify(data)
      }),
      _store: store,
      _reset: () => {
        Object.keys(store).forEach((k) => delete store[k])
      },
    },
  }
})

import { localStorageService } from '@/services/local-storage'
const mockStore = (localStorageService as unknown as { _store: Record<string, string>; _reset: () => void })

describe('settings store - LLM config', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockStore._reset()
    vi.clearAllMocks()
  })

  it('hydrateLlm reads llm.json', async () => {
    const config: LlmConfig = {
      backend: 'claude-sdk',
      apiKey: 'sk-test-123',
      model: 'claude-sonnet-4-6',
    }
    mockStore._store['llm.json'] = JSON.stringify(config)

    const store = useSettingsStore()
    await store.hydrateLlm()

    expect(store.llmConfig).toEqual(config)
    expect(store.hasLlmConfig).toBe(true)
  })

  it('hydrateLlm sets null when no config exists', async () => {
    const store = useSettingsStore()
    await store.hydrateLlm()

    expect(store.llmConfig).toBeNull()
    expect(store.hasLlmConfig).toBe(false)
  })

  it('saveLlm writes claude-sdk config', async () => {
    const config: LlmConfig = {
      backend: 'claude-sdk',
      apiKey: 'sk-test-456',
      model: 'claude-sonnet-4-6',
    }

    const store = useSettingsStore()
    await store.saveLlm(config)

    expect(store.llmConfig).toEqual(config)
    expect(localStorageService.writeJson).toHaveBeenCalledWith('llm.json', config)
  })

  it('saveLlm writes deep-agents config', async () => {
    const config: LlmConfig = {
      backend: 'deep-agents',
      provider: 'ollama',
      model: 'devstral-2',
      ollamaBaseUrl: 'http://localhost:11434',
    }

    const store = useSettingsStore()
    await store.saveLlm(config)

    expect(store.llmConfig).toEqual(config)
    const written = JSON.parse(mockStore._store['llm.json'])
    expect(written.backend).toBe('deep-agents')
    expect(written.provider).toBe('ollama')
    expect(written.ollamaBaseUrl).toBe('http://localhost:11434')
  })

  it('saveLlm with openai deep-agents config includes apiKey', async () => {
    const config: LlmConfig = {
      backend: 'deep-agents',
      provider: 'openai',
      model: 'gpt-4.1',
      apiKey: 'sk-openai-test',
    }

    const store = useSettingsStore()
    await store.saveLlm(config)

    const written = JSON.parse(mockStore._store['llm.json'])
    expect(written.apiKey).toBe('sk-openai-test')
  })
})
