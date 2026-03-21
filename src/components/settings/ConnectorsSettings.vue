<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { IonButton, IonSpinner } from '@ionic/vue'
import { Plus, Server, Lock } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import McpServerCard from '@/components/plugins/McpServerCard.vue'
import AddServerForm from '@/components/plugins/AddServerForm.vue'
import { usePluginsStore } from '@/stores/plugins'
import type { StandaloneMcpServer } from '@/types/plugin'

const { t } = useI18n()
const pluginsStore = usePluginsStore()

const isLoading = ref(false)
const showForm = ref(false)
const editingServer = ref<StandaloneMcpServer | undefined>(undefined)

onMounted(async () => {
  isLoading.value = true
  try {
    await pluginsStore.hydrate()
  } finally {
    isLoading.value = false
  }
})

function handleToggle(server: StandaloneMcpServer) {
  void pluginsStore.updateServer(server.id, { enabled: !server.enabled })
}

function handleEdit(server: StandaloneMcpServer) {
  editingServer.value = server
  showForm.value = true
}

function handleDelete(server: StandaloneMcpServer) {
  void pluginsStore.removeServer(server.id)
}

function handleSaved() {
  showForm.value = false
  editingServer.value = undefined
}

function handleCancel() {
  showForm.value = false
  editingServer.value = undefined
}

function openAdd() {
  editingServer.value = undefined
  showForm.value = true
}
</script>

<template>
  <div :class="$style.container">
    <h3 :class="$style.title">{{ t('settings.sections.connectors') }}</h3>
    <p :class="$style.description">{{ t('plugins.settings.connectors.description') }}</p>

    <div v-if="isLoading" :class="$style.loading">
      <ion-spinner name="crescent" />
    </div>

    <template v-else-if="showForm">
      <AddServerForm
        :edit-server="editingServer"
        @saved="handleSaved"
        @cancel="handleCancel"
      />
    </template>

    <template v-else>
      <!-- Built-in n8n MCP -->
      <div :class="$style.section">
        <div :class="$style.sectionLabel">{{ t('plugins.settings.installed.builtInTitle') }}</div>
        <div :class="$style.builtInCard">
          <div :class="$style.builtInRow">
            <div :class="$style.builtInIconWrap">
              <Server :size="16" :class="$style.builtInIcon" />
            </div>
            <div :class="$style.builtInInfo">
              <div :class="$style.builtInName">
                n8n MCP
                <span :class="$style.builtInBadge">{{ t('plugins.settings.installed.builtInBadge') }}</span>
              </div>
              <div :class="$style.builtInMeta">
                {{ t('plugins.settings.installed.builtInDescription') }}
              </div>
            </div>
            <div :class="$style.builtInStatus">
              <Lock :size="12" :class="$style.builtInLockIcon" />
              <span :class="$style.builtInStatusText">{{ t('plugins.settings.installed.builtInAlwaysOn') }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Custom MCP Servers -->
      <div :class="$style.section">
        <div :class="$style.sectionHeader">
          <div :class="$style.sectionLabel">{{ t('plugins.settings.installed.serversTitle') }}</div>
          <ion-button fill="clear" size="small" @click="openAdd">
            <Plus :size="14" style="margin-right: 4px;" />
            {{ t('plugins.settings.installed.addServer') }}
          </ion-button>
        </div>

        <div v-if="pluginsStore.standaloneServers.length === 0" :class="$style.empty">
          {{ t('plugins.settings.installed.serversEmpty') }}
        </div>
        <div v-else :class="$style.list">
          <McpServerCard
            v-for="server in pluginsStore.standaloneServers"
            :key="server.id"
            :server="server"
            @toggle="handleToggle"
            @edit="handleEdit"
            @delete="handleDelete"
          />
        </div>
      </div>
    </template>
  </div>
</template>

<style lang="scss" module>
.container { max-width: 640px; }

.title {
  font-size: var(--font-size--lg);
  font-weight: var(--font-weight--bold);
  color: var(--color--text);
  margin: 0 0 var(--spacing--2xs);
}

.description {
  font-size: var(--font-size--sm);
  color: var(--color--text--tint-1);
  margin: 0 0 var(--spacing--lg);
}

.loading {
  display: flex;
  justify-content: center;
  padding: var(--spacing--xl) 0;
}

.section { margin-bottom: var(--spacing--lg); }

.sectionHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--spacing--sm);
}

.sectionLabel {
  font-size: var(--font-size--2xs);
  font-weight: var(--font-weight--bold);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color--text--tint-1);
  margin-bottom: var(--spacing--sm);
}

.list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing--sm);
}

.empty {
  text-align: center;
  font-size: var(--font-size--sm);
  color: var(--color--text--tint-2);
  padding: var(--spacing--xl) var(--spacing--md);
  background: var(--n8n-desk--surface-bg, var(--color--foreground));
  border: 1px dashed var(--n8n-desk--content-bg, var(--color--background));
  border-radius: 10px;
}

// --- Built-in card ---
.builtInCard {
  background: var(--n8n-desk--surface-bg, var(--color--foreground));
  border: 1px solid var(--color--primary, #ff6d5a);
  border-radius: 10px;
  padding: 12px 16px;
}

.builtInRow {
  display: flex;
  align-items: center;
  gap: 10px;
}

.builtInIconWrap {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--color--primary, #ff6d5a) 15%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.builtInIcon { color: var(--color--primary, #ff6d5a); }

.builtInInfo { flex: 1; min-width: 0; }

.builtInName {
  font-size: 14px;
  font-weight: 600;
  color: var(--color--text--shade-1);
  display: flex;
  align-items: center;
  gap: 6px;
}

.builtInBadge {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color--primary, #ff6d5a);
  background: color-mix(in srgb, var(--color--primary, #ff6d5a) 12%, transparent);
  padding: 1px 6px;
  border-radius: 4px;
}

.builtInMeta {
  font-size: 12px;
  color: var(--color--text--tint-1);
  margin-top: 2px;
}

.builtInStatus {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  padding: 4px 10px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--color--success, #10b981) 10%, transparent);
}

.builtInLockIcon { color: var(--color--success, #10b981); }

.builtInStatusText {
  font-size: 11px;
  font-weight: 600;
  color: var(--color--success, #10b981);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
</style>
