import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import LlmSettings from '@/components/settings/LlmSettings.vue'

// Mock i18n module used by settings store
vi.mock('@/i18n', () => ({
  setAppLocale: vi.fn(),
}))

// Mock local-storage
vi.mock('@/services/local-storage', () => ({
  localStorageService: {
    readJson: vi.fn(async () => null),
    writeJson: vi.fn(async () => {}),
  },
}))

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: {
    en: {
      settings: {
        ai: {
          backend: 'Backend',
          backendClaudeSdk: 'Claude SDK',
          backendDeepAgents: 'Deep Agents',
          provider: 'Provider',
          apiKey: 'API Key',
          apiKeyPlaceholder: 'sk-...',
          model: 'Model',
          modelPlaceholder: 'claude-sonnet-4-6',
          ollamaUrl: 'Ollama URL',
          testConnection: 'Test Connection',
          testSuccess: 'Connected!',
          testFailed: 'Connection failed',
          testNotAvailable: 'Not available in browser',
        },
      },
    },
  },
})

const stubs = {
  IonSegment: {
    template: '<div class="ion-segment"><slot /></div>',
    props: ['value', 'mode'],
  },
  IonSegmentButton: {
    template: '<button class="ion-segment-button"><slot /></button>',
    props: ['value'],
  },
  IonLabel: { template: '<span><slot /></span>' },
  IonInput: {
    template: '<input class="ion-input" :type="type" />',
    props: ['modelValue', 'label', 'fill', 'labelPlacement', 'type', 'placeholder'],
  },
  IonButton: {
    template: '<button class="ion-button" :disabled="disabled"><slot /></button>',
    props: ['fill', 'size', 'disabled', 'color'],
  },
  IonSpinner: { template: '<span class="ion-spinner" />' },
}

describe('LlmSettings', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  function mountLlm() {
    return mount(LlmSettings, {
      global: {
        plugins: [i18n],
        stubs,
      },
    })
  }

  it('renders backend selector', () => {
    const wrapper = mountLlm()
    expect(wrapper.text()).toContain('Backend')
    expect(wrapper.text()).toContain('Claude SDK')
    expect(wrapper.text()).toContain('Deep Agents')
  })

  it('shows API key field with password type', () => {
    const wrapper = mountLlm()
    const apiKeyInput = wrapper.find('input[type="password"]')
    expect(apiKeyInput.exists()).toBe(true)
  })

  it('shows model input field', () => {
    const wrapper = mountLlm()
    // Model is rendered as an IonInput (stubbed as <input>); there should be at least 2 inputs
    const inputs = wrapper.findAll('.ion-input')
    expect(inputs.length).toBeGreaterThanOrEqual(2)
  })

  it('does not show provider selector in claude-sdk mode by default', () => {
    const wrapper = mountLlm()
    // Provider selector only shows for deep-agents backend
    expect(wrapper.text()).not.toContain('Provider')
  })

  it('renders test connection button', () => {
    const wrapper = mountLlm()
    expect(wrapper.text()).toContain('Test Connection')
  })
})
