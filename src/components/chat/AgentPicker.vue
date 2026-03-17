<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  IonModal,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonSearchbar,
  IonList,
  IonItem,
  IonLabel,
  IonNote,
  IonButtons,
  IonButton,
  IonIcon,
} from '@ionic/vue'
import { closeOutline } from 'ionicons/icons'
import type {
  ChatModelDto,
  ChatHubConversationModel,
  ChatHubProvider,
  AgentIconOrEmoji,
} from '@/types/chathub'

const props = defineProps<{
  isOpen: boolean
  agents: ChatModelDto[]
  selectedModel?: ChatHubConversationModel | null
}>()

const emit = defineEmits<{
  'update:isOpen': [value: boolean]
  select: [agent: ChatModelDto]
}>()

const searchQuery = ref('')

// Reset search when modal opens
watch(() => props.isOpen, (open) => {
  if (open) searchQuery.value = ''
})

/** Display label for a provider group */
const PROVIDER_LABELS: Partial<Record<ChatHubProvider, string>> = {
  n8n: 'Workflow Agents',
  'custom-agent': 'Custom Agents',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  ollama: 'Ollama',
  azureOpenAi: 'Azure OpenAI',
  azureEntraId: 'Azure Entra ID',
  awsBedrock: 'AWS Bedrock',
  vercelAiGateway: 'Vercel AI Gateway',
  xAiGrok: 'xAI Grok',
  groq: 'Groq',
  openRouter: 'OpenRouter',
  deepSeek: 'DeepSeek',
  cohere: 'Cohere',
  mistralCloud: 'Mistral',
}

/** Order for provider groups — agents first, then LLM providers */
const PROVIDER_ORDER: ChatHubProvider[] = [
  'n8n',
  'custom-agent',
  'anthropic',
  'openai',
  'google',
  'ollama',
  'azureOpenAi',
  'azureEntraId',
  'awsBedrock',
  'vercelAiGateway',
  'xAiGrok',
  'groq',
  'openRouter',
  'deepSeek',
  'cohere',
  'mistralCloud',
]

/** Filtered agents based on search */
const filteredAgents = computed(() => {
  const q = searchQuery.value.toLowerCase().trim()
  if (!q) return props.agents
  return props.agents.filter(
    (a) =>
      a.name.toLowerCase().includes(q) ||
      a.description?.toLowerCase().includes(q) ||
      a.model.provider.toLowerCase().includes(q),
  )
})

/** Agents grouped by provider, sorted by PROVIDER_ORDER */
const groupedAgents = computed(() => {
  const map = new Map<ChatHubProvider, ChatModelDto[]>()
  for (const agent of filteredAgents.value) {
    const provider = agent.model.provider
    if (!map.has(provider)) map.set(provider, [])
    map.get(provider)!.push(agent)
  }

  // Sort groups by predefined order
  const sorted: Array<{ provider: ChatHubProvider; label: string; agents: ChatModelDto[] }> = []
  for (const provider of PROVIDER_ORDER) {
    const agents = map.get(provider)
    if (agents?.length) {
      sorted.push({
        provider,
        label: PROVIDER_LABELS[provider] ?? provider,
        agents,
      })
    }
  }
  // Append any providers not in the predefined order
  for (const [provider, agents] of map) {
    if (!sorted.some((g) => g.provider === provider)) {
      sorted.push({
        provider,
        label: PROVIDER_LABELS[provider] ?? provider,
        agents,
      })
    }
  }
  return sorted
})

/** Check if a model matches the currently selected one */
function isSelected(model: ChatHubConversationModel): boolean {
  if (!props.selectedModel) return false
  if (model.provider !== props.selectedModel.provider) return false
  if ('workflowId' in model && 'workflowId' in props.selectedModel) {
    return model.workflowId === props.selectedModel.workflowId
  }
  if ('agentId' in model && 'agentId' in props.selectedModel) {
    return model.agentId === props.selectedModel.agentId
  }
  if ('model' in model && 'model' in props.selectedModel) {
    return model.model === props.selectedModel.model
  }
  return false
}

function handleSelect(agent: ChatModelDto) {
  if (!agent.metadata.available) return
  emit('select', agent)
  emit('update:isOpen', false)
}

function close() {
  emit('update:isOpen', false)
}

function renderIcon(icon: AgentIconOrEmoji | null): string {
  if (!icon) return '🤖'
  if (icon.type === 'emoji') return icon.value
  return '🤖' // fallback for icon type — could be extended with actual icon rendering
}
</script>

<template>
  <ion-modal
    :is-open="isOpen"
    :class="$style.modal"
    @did-dismiss="close"
  >
    <ion-header>
      <ion-toolbar>
        <ion-title>Select Agent or Model</ion-title>
        <ion-buttons slot="end">
          <ion-button @click="close">
            <ion-icon :icon="closeOutline" />
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
      <ion-toolbar>
        <ion-searchbar
          v-model="searchQuery"
          placeholder="Search agents and models..."
          :debounce="150"
          :class="$style.searchbar"
        />
      </ion-toolbar>
    </ion-header>

    <ion-content :class="$style.content">
      <!-- Empty state -->
      <div
        v-if="groupedAgents.length === 0"
        :class="$style.emptyState"
      >
        <p v-if="searchQuery">No agents or models match "{{ searchQuery }}"</p>
        <p v-else>No agents or models available. Check your instance configuration.</p>
      </div>

      <!-- Grouped agent list -->
      <template v-for="group in groupedAgents" :key="group.provider">
        <div :class="$style.groupHeader">
          {{ group.label }}
        </div>
        <ion-list lines="none" :class="$style.agentList">
          <ion-item
            v-for="agent in group.agents"
            :key="agent.name + agent.model.provider"
            button
            :disabled="!agent.metadata.available"
            :class="[
              $style.agentItem,
              !agent.metadata.available && $style.unavailable,
              isSelected(agent.model) && $style.selected,
            ]"
            @click="handleSelect(agent)"
          >
            <div slot="start" :class="$style.agentIcon">
              {{ renderIcon(agent.icon) }}
            </div>
            <ion-label>
              <h3 :class="$style.agentName">{{ agent.name }}</h3>
              <p v-if="agent.description" :class="$style.agentDescription">
                {{ agent.description }}
              </p>
            </ion-label>
            <ion-note
              v-if="!agent.metadata.available"
              slot="end"
              :class="$style.unavailableBadge"
            >
              Unavailable
            </ion-note>
          </ion-item>
        </ion-list>
      </template>
    </ion-content>
  </ion-modal>
</template>

<style lang="scss" module>
.modal {
  --width: min(500px, 90vw);
  --height: min(600px, 80vh);
  --border-radius: var(--radius--sm, 12px);
  --background: var(--n8n-desk--surface-bg);
}

.searchbar {
  --background: var(--n8n-desk--content-bg);
  --border-radius: var(--radius--xs, 8px);
}

.content {
  --background: var(--n8n-desk--surface-bg);
}

.emptyState {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  text-align: center;
  color: var(--color--text--tint-1);
  font-size: var(--font-size--sm);
}

.groupHeader {
  padding: 12px 16px 4px;
  font-size: var(--font-size--2xs);
  font-weight: var(--font-weight--semi-bold);
  color: var(--color--text--tint-1);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.agentList {
  background: transparent;
  padding: 0;
}

.agentItem {
  --background: transparent;
  --background-hover: var(--n8n-desk--surface-raised-bg);
  --padding-start: 16px;
  --padding-end: 16px;
  --min-height: 52px;
  cursor: pointer;
}

.agentIcon {
  font-size: 1.5rem;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius--xs, 8px);
  background: var(--n8n-desk--content-bg);
  margin-right: 12px;
  flex-shrink: 0;
}

.agentName {
  font-size: var(--font-size--sm);
  font-weight: var(--font-weight--semi-bold);
  color: var(--color--text);
  margin: 0;
}

.agentDescription {
  font-size: var(--font-size--2xs);
  color: var(--color--text--tint-1);
  margin: 2px 0 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 320px;
}

.unavailable {
  opacity: 0.45;
  cursor: not-allowed;
}

.unavailableBadge {
  font-size: var(--font-size--2xs);
  color: var(--color--text--light);
}

.selected {
  --background: var(--n8n-desk--surface-raised-bg);

  .agentIcon {
    background: var(--color--primary);
  }
}
</style>
