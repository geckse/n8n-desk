<script setup lang="ts">
import { IonSearchbar } from '@ionic/vue'
import { Plus, Search } from 'lucide-vue-next'
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import SessionList from './SessionList.vue'
import { useWorkflowSessionsStore } from '@/stores/workflow-sessions'
import { useWorkflowAgent } from '@/composables/useWorkflowAgent'

const { t } = useI18n()
const store = useWorkflowSessionsStore()
const { sendMessage } = useWorkflowAgent()
const searchQuery = ref('')
const searchVisible = ref(false)

const activeSessionId = computed(() => store.activeSessionId)

async function newWorkflow() {
  await store.createSession()
}

async function selectSession(sessionId: string) {
  await store.selectSession(sessionId)
}

async function renameSession(sessionId: string, newTitle: string) {
  await store.renameSession(sessionId, newTitle)
}

async function deleteSession(sessionId: string) {
  await store.deleteSession(sessionId)
}

/**
 * Re-run a past task (audit #50): new session with the same folders, then
 * send the original first message to the agent.
 */
async function rerunSession(sessionId: string) {
  const message = await store.firstUserMessage(sessionId)
  if (!message) return
  const source = store.sessions.find((s) => s.id === sessionId)
  await store.createSession(undefined, source?.attachedFolders)
  await sendMessage(message)
}
</script>

<template>
  <div class="workflow-sidebar">
    <!-- Action Items -->
    <div class="sidebar-actions">
      <button class="sidebar-action-btn" @click="newWorkflow">
        <Plus :size="16" />
        <span>{{ t('sidebar.newWorkflow') }}</span>
      </button>
      <button class="sidebar-action-btn" @click="searchVisible = !searchVisible">
        <Search :size="16" />
        <span>{{ t('sidebar.searchWorkflows').replace('...', '') }}</span>
      </button>
    </div>

    <!-- Search (toggleable) -->
    <div v-if="searchVisible" class="sidebar-section">
      <ion-searchbar
        v-model="searchQuery"
        :placeholder="t('sidebar.searchWorkflows')"
        :debounce="300"
      />
    </div>

    <!-- Session List -->
    <SessionList
      :sessions="store.sessions"
      :active-session-id="activeSessionId"
      :search-query="searchQuery"
      show-rerun
      @select="selectSession"
      @rename="renameSession"
      @rerun="rerunSession"
      @delete="deleteSession"
    />
  </div>
</template>

<style scoped lang="scss">
.workflow-sidebar {
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
  padding: var(--spacing--xs) var(--spacing--xs) 0;
}

.sidebar-action-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  border: none;
  background: transparent;
  color: var(--color--text--tint-1);
  font-size: 13px;
  font-weight: 400;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
  transition: background 0.12s ease, color 0.12s ease;

  &:hover {
    background: var(--n8n-desk--surface-raised-bg);
    color: var(--color--text);
  }
}

ion-searchbar {
  --background: var(--n8n-desk--surface-bg);
  --border-radius: var(--radius--xs);
  padding: 0;
}
</style>
