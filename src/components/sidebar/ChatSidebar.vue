<script setup lang="ts">
import {
  IonButton, IonSearchbar,
  IonList, IonItem, IonLabel, IonListHeader, IonAvatar,
} from '@ionic/vue'
import { Plus, Bot } from 'lucide-vue-next'
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import SessionList from './SessionList.vue'
import { useChatStore } from '@/stores/chat'
import { useChatHub } from '@/composables/useChatHub'
import type { ChatModelDto } from '@/types/chathub'

const { t } = useI18n()
const chatStore = useChatStore()
const chatHub = useChatHub()
const searchQuery = ref('')

const pinnedAgents = computed(() => chatHub.agents.value.slice(0, 5))

function getAgentInitial(agent: ChatModelDto): string {
  if (agent.icon?.type === 'emoji') return agent.icon.value
  return agent.name.charAt(0).toUpperCase()
}

function getAgentColor(agent: ChatModelDto): string {
  // Deterministic color from agent name
  let hash = 0
  for (let i = 0; i < agent.name.length; i++) {
    hash = agent.name.charCodeAt(i) + ((hash << 5) - hash)
  }
  const hue = Math.abs(hash) % 360
  return `hsl(${hue}, 55%, 50%)`
}

function getAgentKey(agent: ChatModelDto): string {
  const m = agent.model
  if ('agentId' in m) return m.agentId
  if ('workflowId' in m) return m.workflowId
  return `${m.provider}:${m.model}`
}

async function newChat() {
  const sessionId = await chatStore.createSession('New chat')
  chatStore.switchSession(sessionId)
}

function openAgentsBrowser() {
  // TODO: open agents browser modal/view
}

async function selectAgent(agent: ChatModelDto) {
  const agentKey = getAgentKey(agent)
  const sessionId = await chatStore.createSession(agent.name, agentKey, agent.name)
  chatStore.switchSession(sessionId)
  chatHub.selectAgent(agent.model)
}

function selectSession(sessionId: string) {
  chatStore.switchSession(sessionId)
}

async function deleteSession(sessionId: string) {
  await chatStore.deleteSession(sessionId)
}
</script>

<template>
  <div class="chat-sidebar">
    <!-- Action Buttons -->
    <div class="sidebar-section sidebar-actions">
      <ion-button expand="block" class="action-btn action-btn--primary" @click="newChat">
        <Plus :size="18" slot="start" />
        {{ t('sidebar.newChat') }}
      </ion-button>
      <ion-button expand="block" fill="outline" class="action-btn action-btn--secondary" @click="openAgentsBrowser">
        <Bot :size="18" slot="start" />
        {{ t('sidebar.agents') }}
      </ion-button>
    </div>

    <!-- Pinned Agents -->
    <div v-if="pinnedAgents.length" class="sidebar-section pinned-section">
      <ion-list-header>
        <ion-label>{{ t('sidebar.pinned') }}</ion-label>
      </ion-list-header>
      <ion-list lines="none" class="pinned-list">
        <ion-item
          v-for="agent in pinnedAgents"
          :key="getAgentKey(agent)"
          button
          class="pinned-item"
          @click="selectAgent(agent)"
        >
          <ion-avatar slot="start" class="agent-avatar">
            <div class="agent-avatar-circle" :style="{ background: getAgentColor(agent) }">
              {{ getAgentInitial(agent) }}
            </div>
          </ion-avatar>
          <ion-label>{{ agent.name }}</ion-label>
        </ion-item>
      </ion-list>
    </div>

    <!-- Search -->
    <div class="sidebar-section">
      <ion-searchbar
        v-model="searchQuery"
        :placeholder="t('sidebar.searchChats')"
        :debounce="300"
      />
    </div>

    <!-- Session List -->
    <SessionList
      :sessions="chatStore.sortedSessions"
      :active-session-id="chatStore.activeSessionId"
      :search-query="searchQuery"
      :list-header="t('sidebar.chats')"
      @select="selectSession"
    />
  </div>
</template>

<style scoped lang="scss">
.chat-sidebar {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.sidebar-section {
  padding: var(--spacing--2xs) var(--spacing--xs);
}

.sidebar-actions {
  display: flex;
  flex-direction: column;
  gap: var(--spacing--3xs);
}

.action-btn {
  --border-radius: var(--radius--xs);
  text-transform: none;
  letter-spacing: 0;
  font-weight: var(--font-weight--medium);

  &--primary {
    --background: var(--color--primary);
    --color: var(--color--neutral-white);
  }

  &--secondary {
    --border-color: var(--border-color--base);
    --color: var(--color--text);
  }
}

.pinned-section {
  padding-bottom: 0;
}

.pinned-list {
  background: transparent;
}

.pinned-item {
  --background: transparent;
  --min-height: 40px;
  --padding-start: var(--spacing--xs);
  --inner-padding-end: var(--spacing--xs);
  font-size: var(--font-size--sm);
  border-radius: var(--radius--2xs);
  margin-bottom: 2px;
  cursor: pointer;

  &:hover {
    --background: var(--n8n-desk--surface-raised-bg);
  }
}

.agent-avatar {
  width: 28px;
  height: 28px;
}

.agent-avatar-circle {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: var(--color--neutral-white);
  font-size: 13px;
  font-weight: var(--font-weight--bold);
}

ion-searchbar {
  --background: var(--n8n-desk--surface-bg);
  --border-radius: var(--radius--xs);
  padding: 0;
}
</style>
