<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Copy, Check } from 'lucide-vue-next'
import type { SessionMessage } from '@/types/session'
import type { ChatMessageContentChunk } from '@/types/chathub'
import MarkdownRenderer from './MarkdownRenderer.vue'
import BlinkingCursor from './BlinkingCursor.vue'
import ArtifactBlock from './ArtifactBlock.vue'

const props = defineProps<{
  message: SessionMessage
  isStreaming?: boolean
}>()

const emit = defineEmits<{
  edit: [messageId: string]
  regenerate: [messageId: string]
}>()

const { t } = useI18n()

const isUser = computed(() => props.message.role === 'user')
const isAssistant = computed(() => props.message.role === 'assistant')
const isSystem = computed(() => props.message.role === 'system')
const hasError = computed(() => !!props.message.meta?.error)

/**
 * Parse content chunks from message meta, falling back to a single text chunk.
 */
const contentChunks = computed<ChatMessageContentChunk[]>(() => {
  const meta = props.message.meta
  if (meta?.contentChunks && Array.isArray(meta.contentChunks)) {
    return meta.contentChunks as ChatMessageContentChunk[]
  }
  return [{ type: 'text', content: props.message.content }]
})

/** Visible (non-hidden) chunks */
const visibleChunks = computed(() =>
  contentChunks.value.filter((c) => c.type !== 'hidden')
)

const formattedTime = computed(() => {
  try {
    const date = new Date(props.message.ts)
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
})

/** Plain text content for copying (strips markdown for assistant, raw for user) */
const copyableText = computed(() => {
  if (isUser.value) return props.message.content
  // For assistant messages, join all text chunks
  return contentChunks.value
    .filter((c) => c.type === 'text' || c.type === 'with-buttons')
    .map((c) => c.content)
    .join('\n\n')
})

const justCopied = ref(false)

async function copyMessage(): Promise<void> {
  try {
    await navigator.clipboard.writeText(copyableText.value)
    justCopied.value = true
    setTimeout(() => { justCopied.value = false }, 1500)
  } catch {
    // Fallback for older browsers / Electron
    const textarea = document.createElement('textarea')
    textarea.value = copyableText.value
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
    justCopied.value = true
    setTimeout(() => { justCopied.value = false }, 1500)
  }
}
</script>

<template>
  <div
    :class="[
      $style.message,
      isUser && $style.user,
      isAssistant && $style.assistant,
      isSystem && $style.system,
    ]"
  >
    <!-- User message: plain text -->
    <div v-if="isUser" :class="$style.bubble">
      <p :class="$style.textContent">{{ message.content }}</p>
    </div>

    <!-- Assistant message: markdown with content chunks -->
    <div v-else-if="isAssistant" :class="$style.bubble">
      <template v-for="(chunk, idx) in visibleChunks" :key="idx">
        <!-- Text chunk: render as markdown -->
        <MarkdownRenderer
          v-if="chunk.type === 'text'"
          :content="chunk.content"
        />

        <ArtifactBlock
          v-else-if="chunk.type === 'artifact-create' || chunk.type === 'artifact-edit'"
          :chunk="chunk"
        />

        <!-- Button chunk -->
        <div
          v-else-if="chunk.type === 'with-buttons'"
          :class="$style.buttonChunk"
        >
          <MarkdownRenderer :content="chunk.content" />
          <div :class="$style.buttons">
            <a
              v-for="btn in chunk.buttons"
              :key="btn.link"
              :href="btn.link"
              target="_blank"
              rel="noopener noreferrer"
              :class="[$style.button, btn.type === 'primary' && $style.buttonPrimary]"
            >
              {{ btn.text }}
            </a>
          </div>
        </div>
      </template>

      <!-- Streaming cursor -->
      <BlinkingCursor v-if="isStreaming" />

      <!-- Stream error -->
      <div v-if="hasError" class="n8n-callout n8n-callout--danger" :class="$style.errorBanner">
        {{ message.meta?.error }}
      </div>
    </div>

    <!-- System message -->
    <div v-else-if="isSystem" :class="$style.systemBubble">
      <p :class="$style.textContent">{{ message.content }}</p>
    </div>

    <!-- Timestamp + actions -->
    <div :class="$style.meta">
      <span v-if="formattedTime" :class="$style.timestamp">{{ formattedTime }}</span>
      <div :class="[$style.actions, justCopied && $style.actionsVisible]">
        <button
          v-if="!isSystem && !isStreaming"
          :class="[$style.actionBtn, justCopied && $style.actionBtnSuccess]"
          :title="justCopied ? t('chat.messages.copied') : t('chat.messages.copy')"
          @click="copyMessage"
        >
          <Check v-if="justCopied" :size="14" />
          <Copy v-else :size="14" />
        </button>
        <button
          v-if="isUser"
          :class="$style.actionBtn"
          :title="t('chat.messages.edit')"
          @click="emit('edit', message.id)"
        >
          ✎
        </button>
        <button
          v-if="isAssistant && !isStreaming"
          :class="$style.actionBtn"
          :title="t('chat.messages.regenerate')"
          @click="emit('regenerate', message.id)"
        >
          ↻
        </button>
      </div>
    </div>
  </div>
</template>

<style lang="scss" module>
.message {
  display: flex;
  flex-direction: column;
  max-width: 90%;

  &:hover .actions {
    opacity: 1;
  }
}

.user {
  align-self: flex-end;
  align-items: flex-end;
}

.assistant {
  align-self: flex-start;
  align-items: flex-start;
}

.system {
  align-self: center;
  align-items: center;
}

.bubble {
  line-height: 1.5;
  font-size: 14px;

  .user & {
    max-width: 80%;
    padding: 10px 14px;
    border-radius: 16px 16px 4px 16px;
    background: var(--color--primary, #ff6d5a);
    color: #fff;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .assistant & {
    max-width: 90%;
    position: relative;
    color: var(--color--text--shade-1);
  }
}

// Markdown styles matching Cowork/Workflow
.bubble {
  :deep(p) {
    margin: 0 0 8px;

    &:last-child {
      margin-bottom: 0;
    }
  }

  :deep(ul),
  :deep(ol) {
    margin: 4px 0 8px;
    padding-left: 20px;

    li {
      margin-bottom: 2px;
    }
  }

  :deep(strong) {
    font-weight: 600;
    color: var(--color--text--shade-1);
  }

  :deep(a) {
    color: var(--color--primary);
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }

  :deep(code) {
    font-size: 12px;
    font-family: 'SFMono-Regular', 'Consolas', 'Liberation Mono', 'Menlo', monospace;
    background: var(--n8n-desk--surface-bg, var(--color--foreground));
    color: var(--color--text);
    padding: 2px 5px;
    border-radius: 4px;
  }

  :deep(pre) {
    background: var(--n8n-desk--surface-bg, var(--color--foreground));
    padding: 12px;
    border-radius: 6px;
    overflow-x: auto;
    margin: 8px 0;
    border: 1px solid var(--n8n-desk--surface-raised-bg, var(--color--foreground));

    code {
      background: none;
      padding: 0;
      border-radius: 0;
      font-size: 12.5px;
      line-height: 1.5;
      color: var(--color--text);
    }
  }

  :deep(blockquote) {
    margin: 8px 0;
    padding: 4px 12px;
    border-left: 3px solid var(--color--text--tint-1);
    color: var(--color--text);
  }

  :deep(hr) {
    border: none;
    border-top: 1px solid var(--n8n-desk--surface-raised-bg, var(--color--foreground));
    margin: 12px 0;
  }

  :deep(table) {
    width: 100%;
    border-collapse: collapse;
    margin: 8px 0;
    font-size: 13px;
    border: 1px solid var(--n8n-desk--surface-raised-bg, var(--color--foreground--shade-3));
    border-radius: 6px;
    overflow: hidden;
  }

  :deep(thead) {
    background: var(--n8n-desk--surface-bg, var(--color--foreground));
  }

  :deep(th) {
    text-align: left;
    font-weight: 600;
    padding: 8px 12px;
    color: var(--color--text--shade-1);
    border-bottom: 1px solid var(--n8n-desk--surface-raised-bg, var(--color--foreground--shade-3));
  }

  :deep(td) {
    padding: 6px 12px;
    border-bottom: 1px solid var(--n8n-desk--surface-raised-bg, var(--color--foreground--shade-3));
    color: var(--color--text);
  }

  :deep(tr:last-child td) {
    border-bottom: none;
  }

  :deep(tbody tr:hover) {
    background: var(--n8n-desk--surface-bg, var(--color--foreground));
  }

  :deep(h1),
  :deep(h2),
  :deep(h3),
  :deep(h4) {
    color: var(--color--text--shade-1);
    margin: 12px 0 6px;
    font-weight: 600;

    &:first-child { margin-top: 0; }
  }

  :deep(h1) { font-size: 18px; }
  :deep(h2) { font-size: 16px; }
  :deep(h3) { font-size: 15px; }
  :deep(h4) { font-size: 14px; }
}

.systemBubble {
  text-align: center;
  font-size: 12px;
  color: var(--color--text--tint-1);
  padding: 4px 0;
}

.textContent {
  margin: 0;
  white-space: pre-wrap;
  word-wrap: break-word;
}

.artifactPlaceholder {
  margin: 8px 0;
  padding: 8px;
  background: var(--n8n-desk--surface-raised-bg);
  border-radius: 8px;
  border: 1px solid var(--color--foreground--shade-3);
}

.artifactLabel {
  font-weight: 600;
  font-size: 12px;
}

.artifactLoading {
  font-size: 11px;
  color: var(--color--text--tint-1);
  margin-top: 4px;
}

.buttonChunk {
  margin-top: 8px;
}

.buttons {
  display: flex;
  gap: 8px;
  margin-top: 8px;
  flex-wrap: wrap;
}

.button {
  display: inline-block;
  padding: 4px 10px;
  border-radius: 8px;
  font-size: 12px;
  text-decoration: none;
  color: var(--color--text);
  background: var(--n8n-desk--surface-raised-bg);
  border: 1px solid var(--color--foreground--shade-3);
  cursor: pointer;

  &:hover {
    background: var(--color--foreground--shade-1);
  }
}

.buttonPrimary {
  background: var(--color--primary);
  color: #fff;
  border-color: var(--color--primary);

  &:hover {
    background: var(--color--primary--shade-1);
  }
}

.errorBanner {
  margin-top: 8px;
}

.meta {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 2px;
  min-height: 20px;
}

.timestamp {
  font-size: 11px;
  color: var(--color--text--tint-1);
}

.actions {
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.actionsVisible {
  opacity: 1;
}

.actionBtn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 13px;
  color: var(--color--text--tint-1);
  padding: 2px 4px;
  border-radius: 4px;
  line-height: 1;
  display: inline-flex;
  align-items: center;

  &:hover {
    color: var(--color--text--shade-1);
    background: var(--n8n-desk--surface-raised-bg);
  }
}

.actionBtnSuccess {
  color: var(--color--success);
  opacity: 1 !important;
}
</style>
