<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { IonContent } from '@ionic/vue'
import ChatMessage from './ChatMessage.vue'
import { useChatStore } from '@/stores/chat'

const props = defineProps<{
  sessionId: string | null
}>()

const emit = defineEmits<{
  editMessage: [messageId: string]
  regenerateMessage: [messageId: string]
}>()

const chatStore = useChatStore()
const contentRef = ref<InstanceType<typeof IonContent> | null>(null)

/** Whether the user has scrolled up from the bottom */
const userScrolledUp = ref(false)

const messages = computed(() => {
  if (!props.sessionId) return []
  return chatStore.messagesBySession.get(props.sessionId) ?? []
})

const isStreaming = computed(() => {
  if (!props.sessionId) return false
  const stream = chatStore.activeStreams.get(props.sessionId)
  return stream?.isStreaming ?? false
})

const streamingMessageId = computed(() => {
  if (!props.sessionId) return null
  const stream = chatStore.activeStreams.get(props.sessionId)
  return stream?.isStreaming ? stream.messageId : null
})

const isEmpty = computed(() => messages.value.length === 0)

async function scrollToBottom(smooth = true): Promise<void> {
  await nextTick()
  const el = contentRef.value?.$el as HTMLElement | undefined
  if (!el) return
  const scrollEl = await contentRef.value?.getScrollElement()
  if (!scrollEl) return
  scrollEl.scrollTo({
    top: scrollEl.scrollHeight,
    behavior: smooth ? 'smooth' : 'instant',
  })
}

function handleScroll(event: CustomEvent): void {
  const detail = event.detail
  const scrollEl = detail.scrollTop !== undefined ? detail : null
  if (!scrollEl) return

  const target = (contentRef.value?.$el as HTMLElement)?.querySelector('.inner-scroll') as HTMLElement | null
  if (!target) {
    // Fallback: use IonContent scroll API
    contentRef.value?.getScrollElement().then((el) => {
      if (!el) return
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
      userScrolledUp.value = distanceFromBottom > 100
    })
    return
  }

  const distanceFromBottom = target.scrollHeight - target.scrollTop - target.clientHeight
  userScrolledUp.value = distanceFromBottom > 100
}

// Auto-scroll on new messages (unless user scrolled up)
watch(
  () => messages.value.length,
  () => {
    if (!userScrolledUp.value) {
      scrollToBottom()
    }
  },
)

// Auto-scroll during streaming
watch(
  () => {
    if (!streamingMessageId.value || !props.sessionId) return ''
    const msgs = chatStore.messagesBySession.get(props.sessionId) ?? []
    const streamMsg = msgs.find((m) => m.id === streamingMessageId.value)
    return streamMsg?.content ?? ''
  },
  () => {
    if (!userScrolledUp.value && isStreaming.value) {
      scrollToBottom(false)
    }
  },
)

// Scroll to bottom on session change
watch(
  () => props.sessionId,
  () => {
    userScrolledUp.value = false
    scrollToBottom(false)
  },
)

onMounted(() => {
  scrollToBottom(false)
})

defineExpose({ scrollToBottom })
</script>

<template>
  <ion-content
    ref="contentRef"
    :class="$style.content"
    :scroll-events="true"
    @ionScroll="handleScroll"
  >
    <!-- Empty state -->
    <div v-if="isEmpty" :class="$style.emptyState">
      <div :class="$style.emptyIcon">💬</div>
      <p :class="$style.emptyTitle">Start a conversation</p>
      <p :class="$style.emptySubtitle">
        Send a message to begin chatting with your agent.
      </p>
    </div>

    <!-- Message list -->
    <div v-else :class="$style.messageList">
      <ChatMessage
        v-for="msg in messages"
        :key="msg.id"
        :message="msg"
        :is-streaming="msg.id === streamingMessageId"
        @edit="emit('editMessage', $event)"
        @regenerate="emit('regenerateMessage', $event)"
      />
    </div>

    <!-- Scroll-to-bottom button -->
    <button
      v-if="userScrolledUp && !isEmpty"
      :class="$style.scrollButton"
      title="Scroll to bottom"
      @click="userScrolledUp = false; scrollToBottom()"
    >
      ↓
    </button>
  </ion-content>
</template>

<style lang="scss" module>
.content {
  --padding-start: var(--spacing--sm);
  --padding-end: var(--spacing--sm);
  --padding-top: var(--spacing--sm);
  --padding-bottom: var(--spacing--sm);
}

.messageList {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  justify-content: flex-end;
}

.emptyState {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100%;
  text-align: center;
  padding: var(--spacing--xl);
}

.emptyIcon {
  font-size: 48px;
  margin-bottom: var(--spacing--sm);
  opacity: 0.6;
}

.emptyTitle {
  font-size: var(--font-size--m);
  font-weight: var(--font-weight--semi-bold);
  color: var(--color--text);
  margin: 0 0 var(--spacing--3xs) 0;
}

.emptySubtitle {
  font-size: var(--font-size--s);
  color: var(--color--text--light);
  margin: 0;
  max-width: 300px;
}

.scrollButton {
  position: fixed;
  bottom: 80px;
  right: 20px;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--n8n-desk--surface-bg);
  border: 1px solid var(--color--foreground--shade-3);
  color: var(--color--text);
  font-size: var(--font-size--m);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  z-index: 10;
  transition: background 0.15s ease;

  &:hover {
    background: var(--n8n-desk--surface-raised-bg);
  }
}
</style>
