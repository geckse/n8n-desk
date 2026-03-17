<template>
  <div :class="$style.container">
    <ConnectionIndicator />

    <template v-if="activeSessionId">
      <ChatMessageList
        :session-id="activeSessionId"
        :class="$style.messageList"
        @edit-message="handleEditMessage"
        @regenerate-message="handleRegenerateMessage"
      />

      <ChatInput
        :is-streaming="isStreaming"
        :is-offline="!isConnected"
        @send="handleSend"
        @stop="handleStop"
      />
    </template>

    <div v-else :class="$style.emptyState">
      <div :class="$style.emptyIcon">💬</div>
      <h3 :class="$style.emptyTitle">Start a conversation</h3>
      <p :class="$style.emptyDescription">
        Select an agent and send a message to get started.
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import ChatMessageList from './ChatMessageList.vue'
import ChatInput from './ChatInput.vue'
import ConnectionIndicator from './ConnectionIndicator.vue'
import { useChatHub } from '@/composables/useChatHub'
import { useChatStore } from '@/stores/chat'
import type { ChatHubConversationModel } from '@/types/chathub'

const chatStore = useChatStore()
const chatHub = useChatHub()

const activeSessionId = computed(() => chatStore.activeSessionId)
const isStreaming = computed(() => chatStore.isStreaming)
const isConnected = computed(() => chatHub.isConnected.value)

function getCurrentModel(): ChatHubConversationModel {
  const session = chatStore.activeSession
  // If session has an agentId, use the custom-agent model
  if (session?.agentId) {
    return { provider: 'custom-agent', agentId: session.agentId }
  }
  // Fallback to the first available agent's model definition
  const firstAgent = chatStore.agents[0]
  if (firstAgent) {
    return firstAgent.model
  }
  // Last resort fallback
  return { provider: 'openai', model: 'gpt-4' }
}

async function handleSend(message: string): Promise<void> {
  const model = getCurrentModel()
  await chatHub.sendMessage(message, model)
}

async function handleStop(): Promise<void> {
  await chatHub.stopGeneration()
}

async function handleEditMessage(messageId: string): Promise<void> {
  const sessionId = activeSessionId.value
  if (!sessionId) return

  const messages = chatStore.messagesBySession.get(sessionId) ?? []
  const msg = messages.find((m) => m.id === messageId)
  if (!msg || msg.role !== 'user') return

  const model = getCurrentModel()
  await chatHub.editMessage(sessionId, messageId, msg.content, model)
}

async function handleRegenerateMessage(messageId: string): Promise<void> {
  const sessionId = activeSessionId.value
  if (!sessionId) return

  const model = getCurrentModel()
  await chatHub.regenerateMessage(sessionId, messageId, model)
}
</script>

<style lang="scss" module>
.container {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--n8n-desk--content-bg, var(--color--background));
}

.messageList {
  flex: 1;
  min-height: 0;
}

.emptyState {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-2xl, 32px);
  text-align: center;
}

.emptyIcon {
  font-size: 48px;
  margin-bottom: var(--spacing-m, 16px);
}

.emptyTitle {
  margin: 0 0 var(--spacing-xs, 8px);
  font-size: var(--font-size-l, 18px);
  font-weight: var(--font-weight-bold, 600);
  color: var(--color--text-dark, #333);
}

.emptyDescription {
  margin: 0;
  font-size: var(--font-size-s, 14px);
  color: var(--color--text-light, #999);
  max-width: 300px;
}
</style>
