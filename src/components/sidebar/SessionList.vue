<script setup lang="ts">
import { IonList, IonItem } from '@ionic/vue'
import { Bot } from 'lucide-vue-next'
import { computed, ref, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import LucideIcon from '@/components/ui/LucideIcon.vue'
import type { SessionMeta } from '@/types/session'
import { groupSessionsByDate } from '@/utils/date-groups'
import SessionContextMenu from './SessionContextMenu.vue'

const props = defineProps<{
  sessions: SessionMeta[]
  activeSessionId?: string | null
  searchQuery?: string
  /** Offer "Re-run" in the context menu (agent sessions only — audit #50) */
  showRerun?: boolean
}>()

const emit = defineEmits<{
  select: [id: string]
  rename: [id: string, newTitle: string]
  rerun: [id: string]
  delete: [id: string]
}>()

const { t } = useI18n()

// Inline edit state
const editingSessionId = ref<string | null>(null)
const editingTitle = ref('')
const editInputRef = ref<HTMLInputElement | null>(null)

// Context menu state
const contextMenuOpen = ref(false)
const contextMenuEvent = ref<Event | null>(null)
const contextMenuSessionId = ref('')
const contextMenuSessionTitle = ref('')

// Long-press state
let longPressTimer: ReturnType<typeof setTimeout> | null = null

const filteredSessions = computed(() => {
  const query = (props.searchQuery ?? '').toLowerCase().trim()
  if (!query) return props.sessions
  return props.sessions.filter((s) =>
    s.title.toLowerCase().includes(query) ||
    (s.agentName?.toLowerCase().includes(query) ?? false)
  )
})

const groupedSessions = computed(() => groupSessionsByDate(filteredSessions.value))

function openContextMenu(sessionId: string, title: string, event: Event) {
  event.preventDefault()
  contextMenuSessionId.value = sessionId
  contextMenuSessionTitle.value = title
  contextMenuEvent.value = event
  contextMenuOpen.value = true
}

function onContextMenu(session: SessionMeta, event: MouseEvent) {
  openContextMenu(session.id, session.title, event)
}

function onPointerDown(session: SessionMeta, event: PointerEvent) {
  if (event.pointerType !== 'touch') return
  longPressTimer = setTimeout(() => {
    openContextMenu(session.id, session.title, event)
    longPressTimer = null
  }, 500)
}

function onPointerUp() {
  if (longPressTimer) {
    clearTimeout(longPressTimer)
    longPressTimer = null
  }
}

function onPointerCancel() {
  if (longPressTimer) {
    clearTimeout(longPressTimer)
    longPressTimer = null
  }
}

function startRename(sessionId: string) {
  const session = props.sessions.find((s) => s.id === sessionId)
  if (!session) return
  editingSessionId.value = sessionId
  editingTitle.value = session.title
  nextTick(() => {
    editInputRef.value?.focus()
    editInputRef.value?.select()
  })
}

function commitRename() {
  if (!editingSessionId.value) return
  const trimmed = editingTitle.value.trim()
  if (trimmed && trimmed !== getOriginalTitle()) {
    emit('rename', editingSessionId.value, trimmed)
  }
  editingSessionId.value = null
  editingTitle.value = ''
}

function cancelRename() {
  editingSessionId.value = null
  editingTitle.value = ''
}

function getOriginalTitle(): string {
  const session = props.sessions.find((s) => s.id === editingSessionId.value)
  return session?.title ?? ''
}

function onEditKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter') {
    event.preventDefault()
    commitRename()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    cancelRename()
  }
}

function onContextMenuRename(sessionId: string) {
  contextMenuOpen.value = false
  startRename(sessionId)
}

function onContextMenuRerun(sessionId: string) {
  contextMenuOpen.value = false
  emit('rerun', sessionId)
}

function onContextMenuDelete(sessionId: string) {
  contextMenuOpen.value = false
  emit('delete', sessionId)
}

function onContextMenuDismiss() {
  contextMenuOpen.value = false
}

function onItemKeydown(session: SessionMeta, event: KeyboardEvent) {
  if (event.key === 'F10' && event.shiftKey) {
    event.preventDefault()
    openContextMenu(session.id, session.title, event)
  }
}
</script>

<template>
  <div class="session-list-wrapper">
    <div v-if="groupedSessions.length === 0" class="session-empty">
      <span>{{ t('sidebar.noSessionsFound') }}</span>
    </div>

    <div v-for="group in groupedSessions" :key="group.label" class="session-group">
      <div class="session-group-label">{{ group.label }}</div>
      <ion-list lines="none" class="session-list">
        <ion-item
          v-for="session in group.sessions"
          :key="session.id"
          button
          class="session-item"
          :class="{ 'session-item--active': session.id === activeSessionId }"
          @click="editingSessionId !== session.id && $emit('select', session.id)"
          @contextmenu="onContextMenu(session, $event)"
          @pointerdown="onPointerDown(session, $event)"
          @pointerup="onPointerUp"
          @pointercancel="onPointerCancel"
          @keydown="onItemKeydown(session, $event)"
        >
          <!-- Agent icon -->
          <div slot="start" class="session-icon">
            <LucideIcon
              v-if="session.agentIcon?.type === 'icon'"
              :name="session.agentIcon.value"
              :size="16"
            />
            <Bot v-else :size="16" />
          </div>

          <!-- Session content: agent name + title -->
          <div v-if="editingSessionId !== session.id" class="session-text">
            <span v-if="session.agentName" class="session-agent-name">{{ session.agentName }}</span>
            <span class="session-title">{{ session.title }}</span>
          </div>
          <input
            v-else
            ref="editInputRef"
            v-model="editingTitle"
            class="session-edit-input"
            type="text"
            @blur="commitRename"
            @keydown="onEditKeydown"
            @click.stop
          />
        </ion-item>
      </ion-list>
    </div>

    <SessionContextMenu
      :session-id="contextMenuSessionId"
      :session-title="contextMenuSessionTitle"
      :is-open="contextMenuOpen"
      :event="contextMenuEvent"
      :show-rerun="props.showRerun"
      @rename="onContextMenuRename"
      @rerun="onContextMenuRerun"
      @delete="onContextMenuDelete"
      @dismiss="onContextMenuDismiss"
    />
  </div>
</template>

<style scoped lang="scss">
.session-list-wrapper {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

.session-empty {
  padding: var(--spacing--m) var(--spacing--xs);
  text-align: center;
  font-size: var(--font-size--2xs);
  color: var(--color--text--tint-2);
}

.session-group {
  &:not(:first-child) {
    margin-top: var(--spacing--s);
  }
}

.session-group-label {
  padding: 0 var(--spacing--xs) 4px;
  font-size: 11px;
  font-weight: var(--font-weight--medium);
  color: var(--color--text--tint-2);
  text-transform: none;
  letter-spacing: 0;
}

.session-list {
  background: transparent;

  .session-item {
    --background: transparent;
    --min-height: 44px;
    --padding-start: var(--spacing--xs);
    --inner-padding-end: var(--spacing--xs);
    border-radius: var(--radius--2xs);
    margin-bottom: 1px;
    cursor: pointer;

    &:hover {
      --background: var(--n8n-desk--surface-raised-bg);
    }

    &--active {
      --background: var(--n8n-desk--surface-raised-bg);
    }
  }
}

.session-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color--text--tint-2);
  flex-shrink: 0;
  margin-right: 8px;
}

.session-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  overflow: hidden;
}

.session-agent-name {
  font-size: 11px;
  color: var(--color--text--tint-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.3;
}

.session-title {
  font-size: var(--font-size--sm);
  color: var(--color--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.3;
  font-weight: var(--font-weight--medium);
}

.session-edit-input {
  width: 100%;
  border: 1px solid var(--color--primary);
  background: var(--n8n-desk--surface-bg);
  color: var(--color--text);
  font-size: var(--font-size--sm);
  font-family: inherit;
  padding: 2px 6px;
  border-radius: var(--radius--2xs);
  outline: none;

  &:focus {
    border-color: var(--color--primary);
    box-shadow: 0 0 0 1px var(--color--primary);
  }
}
</style>
