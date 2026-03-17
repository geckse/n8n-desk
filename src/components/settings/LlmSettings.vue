<script setup lang="ts">
import { IonSegment, IonSegmentButton, IonLabel, IonInput, IonButton, IonSpinner } from '@ionic/vue'
import { ref, reactive, watch, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '@/stores/settings'
import type { AgentBackend, LlmProvider, LlmConfig } from '@/types/settings'

const { t } = useI18n()
const settingsStore = useSettingsStore()

const draft = reactive({
  backend: 'claude-sdk' as AgentBackend,
  apiKey: '',
  model: 'claude-sonnet-4-6',
  provider: 'anthropic' as LlmProvider,
  ollamaBaseUrl: 'http://localhost:11434',
})

const testStatus = ref<'idle' | 'testing' | 'success' | 'error'>('idle')
const testError = ref('')

const showApiKey = computed(() => {
  if (draft.backend === 'claude-sdk') return true
  return draft.provider !== 'ollama'
})

const showOllamaUrl = computed(() => {
  return draft.backend === 'deep-agents' && draft.provider === 'ollama'
})

// Hydrate draft from store
watch(() => settingsStore.llmConfig, (config) => {
  if (!config) return
  draft.backend = config.backend
  draft.model = config.model
  if (config.backend === 'claude-sdk') {
    draft.apiKey = config.apiKey
  } else {
    draft.provider = config.provider
    draft.apiKey = config.apiKey ?? ''
    draft.ollamaBaseUrl = config.ollamaBaseUrl ?? 'http://localhost:11434'
  }
}, { immediate: true })

function buildConfig(): LlmConfig {
  if (draft.backend === 'claude-sdk') {
    return {
      backend: 'claude-sdk',
      apiKey: draft.apiKey,
      model: draft.model,
    }
  }
  return {
    backend: 'deep-agents',
    provider: draft.provider,
    model: draft.model,
    ...(draft.provider !== 'ollama' ? { apiKey: draft.apiKey } : {}),
    ...(draft.provider === 'ollama' ? { ollamaBaseUrl: draft.ollamaBaseUrl } : {}),
  }
}

function onBackendChange(event: CustomEvent) {
  draft.backend = event.detail.value as AgentBackend
  saveDraft()
}

function onProviderChange(event: CustomEvent) {
  draft.provider = event.detail.value as LlmProvider
  // Reset model to provider default
  if (draft.provider === 'anthropic') draft.model = 'claude-sonnet-4-6'
  else if (draft.provider === 'openai') draft.model = 'gpt-4.1'
  else draft.model = 'devstral-2'
  saveDraft()
}

function saveDraft() {
  void settingsStore.saveLlm(buildConfig())
}

async function testConnection() {
  testStatus.value = 'testing'
  testError.value = ''
  saveDraft()

  try {
    if (!window.n8nDesk) {
      testStatus.value = 'error'
      testError.value = t('settings.ai.testNotAvailable')
      return
    }
    const result = await window.n8nDesk.agent.testConnection()
    if (result.success) {
      testStatus.value = 'success'
    } else {
      testStatus.value = 'error'
      testError.value = result.error ?? t('settings.ai.testFailed')
    }
  } catch {
    testStatus.value = 'error'
    testError.value = t('settings.ai.testFailed')
  }
}
</script>

<template>
  <div class="llm-settings">
    <!-- Backend selector -->
    <div class="form-field">
      <label class="field-label">{{ t('settings.ai.backend') }}</label>
      <ion-segment
        :value="draft.backend"
        mode="ios"
        @ion-change="onBackendChange"
      >
        <ion-segment-button value="claude-sdk">
          <ion-label>{{ t('settings.ai.backendClaudeSdk') }}</ion-label>
        </ion-segment-button>
        <ion-segment-button value="deep-agents">
          <ion-label>{{ t('settings.ai.backendDeepAgents') }}</ion-label>
        </ion-segment-button>
      </ion-segment>
    </div>

    <!-- Deep Agents: provider selector -->
    <div v-if="draft.backend === 'deep-agents'" class="form-field">
      <label class="field-label">{{ t('settings.ai.provider') }}</label>
      <ion-segment
        :value="draft.provider"
        mode="ios"
        @ion-change="onProviderChange"
      >
        <ion-segment-button value="anthropic">
          <ion-label>Anthropic</ion-label>
        </ion-segment-button>
        <ion-segment-button value="openai">
          <ion-label>OpenAI</ion-label>
        </ion-segment-button>
        <ion-segment-button value="ollama">
          <ion-label>Ollama</ion-label>
        </ion-segment-button>
      </ion-segment>
    </div>

    <!-- API Key -->
    <div v-if="showApiKey" class="form-field">
      <ion-input
        v-model="draft.apiKey"
        :label="t('settings.ai.apiKey')"
        fill="outline"
        label-placement="stacked"
        type="password"
        :placeholder="t('settings.ai.apiKeyPlaceholder')"
        @ion-blur="saveDraft"
      />
    </div>

    <!-- Model -->
    <div class="form-field">
      <ion-input
        v-model="draft.model"
        :label="t('settings.ai.model')"
        fill="outline"
        label-placement="stacked"
        :placeholder="t('settings.ai.modelPlaceholder')"
        @ion-blur="saveDraft"
      />
    </div>

    <!-- Ollama URL -->
    <div v-if="showOllamaUrl" class="form-field">
      <ion-input
        v-model="draft.ollamaBaseUrl"
        :label="t('settings.ai.ollamaUrl')"
        fill="outline"
        label-placement="stacked"
        placeholder="http://localhost:11434"
        @ion-blur="saveDraft"
      />
    </div>

    <!-- Test Connection -->
    <div class="test-connection">
      <ion-button
        fill="outline"
        size="small"
        :disabled="testStatus === 'testing'"
        @click="testConnection"
      >
        <ion-spinner v-if="testStatus === 'testing'" name="crescent" style="margin-right: 6px;" />
        {{ t('settings.ai.testConnection') }}
      </ion-button>
      <span v-if="testStatus === 'success'" class="test-result test-result--success">
        {{ t('settings.ai.testSuccess') }}
      </span>
      <span v-if="testStatus === 'error'" class="test-result test-result--error">
        {{ testError }}
      </span>
    </div>
  </div>
</template>

<style scoped lang="scss">
.llm-settings {
  max-width: 520px;
}

.form-field {
  margin-bottom: var(--spacing--md);
}

.field-label {
  display: block;
  font-size: var(--font-size--sm);
  color: var(--color--text--tint-1);
  margin-bottom: var(--spacing--xs);
}

.test-connection {
  display: flex;
  align-items: center;
  gap: var(--spacing--sm);
  margin-top: var(--spacing--sm);
}

.test-result {
  font-size: var(--font-size--sm);

  &--success {
    color: var(--color--success);
  }

  &--error {
    color: var(--color--danger);
  }
}
</style>
