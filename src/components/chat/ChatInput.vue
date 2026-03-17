<template>
  <div :class="$style.container">
    <div :class="$style.inputWrapper">
      <textarea
        ref="textareaRef"
        v-model="message"
        :class="$style.textarea"
        :placeholder="placeholderText"
        :disabled="isDisabled"
        rows="1"
        @input="autoExpand"
        @keydown="handleKeydown"
      />
      <button
        v-if="isStreaming"
        :class="[$style.actionButton, $style.stopButton]"
        type="button"
        aria-label="Stop generation"
        @click="emit('stop')"
      >
        <span :class="$style.stopIcon" />
      </button>
      <button
        v-else
        :class="[$style.actionButton, $style.sendButton]"
        type="button"
        :disabled="!canSend"
        aria-label="Send message"
        @click="handleSend"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M3 13L13 8L3 3V7L9 8L3 9V13Z" fill="currentColor" />
        </svg>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, watch } from 'vue'

const props = defineProps<{
  isStreaming?: boolean
  isOffline?: boolean
  disabled?: boolean
}>()

const emit = defineEmits<{
  send: [message: string]
  stop: []
}>()

const message = ref('')
const textareaRef = ref<HTMLTextAreaElement | null>(null)

const isDisabled = computed(() => props.isOffline || props.disabled)
const canSend = computed(() => message.value.trim().length > 0 && !isDisabled.value)

const placeholderText = computed(() => {
  if (props.isOffline) return 'Reconnect to continue…'
  return 'Type a message…'
})

function autoExpand() {
  const el = textareaRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 200)}px`
}

function resetHeight() {
  const el = textareaRef.value
  if (!el) return
  el.style.height = 'auto'
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSend()
  }
}

function handleSend() {
  if (!canSend.value) return
  const text = message.value.trim()
  message.value = ''
  nextTick(() => resetHeight())
  emit('send', text)
}

watch(() => props.isStreaming, (streaming, prev) => {
  if (prev && !streaming) {
    nextTick(() => textareaRef.value?.focus())
  }
})
</script>

<style lang="scss" module>
.container {
  padding: 8px 16px 16px;
  background: var(--n8n-desk--content-bg);
}

.inputWrapper {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  background: var(--n8n-desk--surface-bg);
  border: 1px solid var(--color--border--base, #ccc);
  border-radius: 12px;
  padding: 8px 8px 8px 14px;
  transition: border-color 0.15s;

  &:focus-within {
    border-color: var(--color--primary, #ff6d5a);
  }
}

.textarea {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  color: var(--color--text--dark, inherit);
  font-family: inherit;
  font-size: 14px;
  line-height: 1.5;
  resize: none;
  max-height: 200px;
  padding: 2px 0;

  &::placeholder {
    color: var(--color--text--light, #999);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
}

.actionButton {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: opacity 0.15s, background-color 0.15s;
}

.sendButton {
  background: var(--color--primary, #ff6d5a);
  color: #fff;

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  &:not(:disabled):hover {
    opacity: 0.85;
  }
}

.stopButton {
  background: var(--color--danger, #d32f2f);
  color: #fff;

  &:hover {
    opacity: 0.85;
  }
}

.stopIcon {
  display: block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  background: currentColor;
}
</style>
