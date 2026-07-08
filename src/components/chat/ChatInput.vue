<template>
  <div
    :class="[$style.inputArea, isDragOver && allowFileUploads && $style.inputAreaDragOver]"
    @dragover="handleDragOver"
    @dragleave="handleDragLeave"
    @drop="handleDrop"
  >
    <div :class="$style.inputInner">
      <div v-if="error" :class="$style.errorBar">
        <span :class="$style.errorText">{{ error }}</span>
        <button
          :class="$style.errorClose"
          type="button"
          :aria-label="t('chat.input.dismissError')"
          @click="emit('dismissError')"
        >
          &times;
        </button>
      </div>

      <div :class="$style.inputBox">
        <!-- Attached folders -->
        <div v-if="attachedFolders.length > 0" :class="$style.fileTiles">
          <div
            v-for="folder in attachedFolders"
            :key="folder.path"
            :class="$style.fileTile"
            :title="folder.path"
          >
            <FolderPlus :size="14" :class="$style.fileTileIcon" />
            <span :class="$style.fileTileName">{{ folder.label }}</span>
            <button
              :class="$style.fileTileRemove"
              type="button"
              :aria-label="t('chat.input.removeFolder', { name: folder.label })"
              @click="removeFolder(folder.path)"
            >
              <X :size="10" />
            </button>
          </div>
        </div>

        <!-- Attached files -->
        <div v-if="attachedFiles.length > 0" :class="$style.fileTiles">
          <div
            v-for="file in attachedFiles"
            :key="file.fileName"
            :class="$style.fileTile"
            :title="file.fileName"
          >
            <component :is="fileIcon(file.fileName)" :size="14" :class="$style.fileTileIcon" />
            <span :class="$style.fileTileName">{{ file.fileName }}</span>
            <button
              :class="$style.fileTileRemove"
              type="button"
              :aria-label="t('chat.input.removeFile', { name: file.fileName })"
              @click="removeFile(file.fileName)"
            >
              <X :size="10" />
            </button>
          </div>
        </div>

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

        <div :class="$style.actionRow">
          <div :class="$style.actionRowLeft">
            <button
              v-if="showFolderPicker"
              :class="$style.actionIconBtn"
              type="button"
              :disabled="isDisabled"
              :title="t('chat.input.attachFolder')"
              @click="handleOpenFolder"
            >
              <FolderPlus :size="16" />
            </button>
            <button
              v-if="allowFileUploads"
              :class="$style.actionIconBtn"
              type="button"
              :disabled="isDisabled"
              :title="t('chat.input.attachFiles')"
              @click="handleAttachFiles"
            >
              <Paperclip :size="16" />
            </button>
          </div>
          <button
            v-if="isStreaming"
            :class="$style.stopBtn"
            type="button"
            :aria-label="t('chat.input.stop')"
            @click="emit('stop')"
          >
            <span :class="$style.stopIcon" />
          </button>
          <button
            v-else
            :class="$style.sendBtn"
            type="button"
            :disabled="!canSend"
            :aria-label="t('chat.input.send')"
            @click="handleSend"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 13L13 8L3 3V7L9 8L3 9V13Z" fill="currentColor" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { FolderPlus, Paperclip, X, FileText, FileSpreadsheet, FileImage } from 'lucide-vue-next'
import type { AttachedFolder } from '@/types/session'
import type { ChatAttachment } from '@/types/chathub'

const props = defineProps<{
  isStreaming?: boolean
  isOffline?: boolean
  disabled?: boolean
  error?: string | null
  showFolderPicker?: boolean
  allowFileUploads?: boolean
  allowedFilesMimeTypes?: string
}>()

const emit = defineEmits<{
  send: [message: string, attachedFolders: AttachedFolder[], attachments: ChatAttachment[]]
  stop: []
  dismissError: []
}>()

const { t } = useI18n()

const message = ref('')
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const attachedFolders = ref<AttachedFolder[]>([])
const attachedFiles = ref<ChatAttachment[]>([])
const isDragOver = ref(false)

const isDisabled = computed(() => props.isOffline || props.disabled)
const canSend = computed(() => message.value.trim().length > 0 && !isDisabled.value)

const placeholderText = computed(() => {
  if (props.isOffline) return t('chat.input.reconnect')
  return t('chat.input.typeMessage')
})

function fileIcon(filename: string) {
  const ext = filename.lastIndexOf('.') >= 0
    ? filename.slice(filename.lastIndexOf('.')).toLowerCase()
    : ''
  if (['.xlsx', '.xls', '.csv'].includes(ext)) return FileSpreadsheet
  if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp'].includes(ext)) return FileImage
  return FileText
}

function autoExpand() {
  const el = textareaRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 150)}px`
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
  const files = [...attachedFiles.value]
  attachedFiles.value = []
  emit('send', text, attachedFolders.value, files)
}

async function handleOpenFolder() {
  const folderPath = await window.n8nDesk?.dialog.openFolder()
  if (!folderPath) return
  if (attachedFolders.value.some((f) => f.path === folderPath)) return
  const label = folderPath.split(/[\\/]/).pop() ?? folderPath
  attachedFolders.value.push({ path: folderPath, label, mode: 'rw' })
}

function removeFolder(folderPath: string) {
  attachedFolders.value = attachedFolders.value.filter((f) => f.path !== folderPath)
}

async function handleAttachFiles() {
  const result = await window.n8nDesk?.dialog.openFilesAsAttachments(props.allowedFilesMimeTypes)
  if (!result) return
  for (const file of result) {
    if (!attachedFiles.value.some((f) => f.fileName === file.fileName)) {
      attachedFiles.value.push(file)
    }
  }
}

function removeFile(fileName: string) {
  attachedFiles.value = attachedFiles.value.filter((f) => f.fileName !== fileName)
}

// Drag and drop support
function handleDragOver(e: DragEvent) {
  if (!props.allowFileUploads) return
  e.preventDefault()
  isDragOver.value = true
}

function handleDragLeave() {
  isDragOver.value = false
}

async function handleDrop(e: DragEvent) {
  e.preventDefault()
  isDragOver.value = false
  if (!props.allowFileUploads || !e.dataTransfer?.files.length) return

  // Read dropped files as base64 in the renderer using FileReader
  for (const file of Array.from(e.dataTransfer.files)) {
    if (attachedFiles.value.some((f) => f.fileName === file.name)) continue
    const data = await readFileAsDataUrl(file)
    attachedFiles.value.push({
      data,
      mimeType: file.type || 'application/octet-stream',
      fileName: file.name,
    })
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

watch(() => props.isStreaming, (streaming, prev) => {
  if (prev && !streaming) {
    nextTick(() => textareaRef.value?.focus())
  }
})
</script>

<style lang="scss" module>
.inputArea {
  flex-shrink: 0;
  border-top: 1px solid var(--n8n-desk--surface-raised-bg, var(--color--foreground));
  padding: 8px 12px 12px;
  position: relative;
  z-index: 1;
}

.inputAreaDragOver {
  &::after {
    content: '';
    position: absolute;
    inset: 0;
    border: 2px dashed var(--color--primary, #ff6d5a);
    border-radius: 12px;
    background: rgba(255, 109, 90, 0.05);
    pointer-events: none;
    z-index: 2;
  }
}

.inputInner {
  width: 90%;
  max-width: 960px;
  margin: 0 auto;
}

.errorBar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px 6px 14px;
  background: var(--color--danger);
  color: #fff;
  font-size: 12px;
  line-height: 1.4;
  border-radius: 12px 12px 0 0;
  border: 1px solid var(--color--danger);
  border-bottom: none;
  margin-bottom: -1px;
}

.errorText {
  flex: 1;
  min-width: 0;
}

.errorClose {
  flex-shrink: 0;
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.8);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;

  &:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.15);
  }
}

.inputBox {
  background: var(--n8n-desk--surface-bg, var(--color--foreground));
  border: 1px solid var(--n8n-desk--surface-raised-bg, var(--color--foreground));
  border-radius: 12px;
  padding: 10px 14px 6px;
  transition: border-color 0.15s;

  &:focus-within {
    border-color: var(--color--primary, #ff6d5a);
  }
}

.fileTiles {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding-bottom: 8px;
}

.fileTile {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 6px 4px 8px;
  background: var(--n8n-desk--surface-raised-bg, var(--color--foreground));
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.3;
  color: var(--color--text--shade-1, inherit);
  max-width: 180px;
}

.fileTileIcon {
  flex-shrink: 0;
  color: var(--color--text--tint-1);
}

.fileTileName {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fileTileRemove {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: none;
  color: var(--color--text--tint-1, #999);
  cursor: pointer;
  transition: color 0.15s, background-color 0.15s;

  &:hover {
    color: var(--color--text--shade-1, inherit);
    background: rgba(0, 0, 0, 0.08);
  }
}

.textarea {
  width: 100%;
  box-sizing: border-box;
  resize: none;
  border: none;
  padding: 0;
  font-size: 14px;
  font-family: inherit;
  line-height: 1.5;
  background: transparent;
  color: var(--color--text--shade-1);
  outline: none;
  max-height: 150px;
  overflow-y: auto;

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  &::placeholder {
    color: var(--color--text--tint-1);
  }
}

.actionRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 6px;
}

.actionRowLeft {
  display: flex;
  align-items: center;
  gap: 4px;
}

.actionIconBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: none;
  background: none;
  color: var(--color--text--tint-1);
  cursor: pointer;
  flex-shrink: 0;
  transition: color 0.15s, background 0.15s;

  &:hover {
    color: var(--color--text--shade-1);
    background: var(--n8n-desk--surface-raised-bg, var(--color--foreground));
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
}

.sendBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  background: var(--color--primary, #ff6d5a);
  color: #fff;
  cursor: pointer;
  flex-shrink: 0;
  font-size: 18px;

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  &:not(:disabled):hover {
    opacity: 0.9;
  }
}

.stopBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  background: var(--color--danger, #d32f2f);
  color: #fff;
  cursor: pointer;
  flex-shrink: 0;

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
