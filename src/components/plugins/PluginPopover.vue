<script setup lang="ts">
import { computed } from 'vue'
import {
  IonPopover, IonList, IonItem, IonLabel, IonToggle, IonItemDivider,
} from '@ionic/vue'
import { Settings, Package, Server } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { usePluginsStore } from '@/stores/plugins'

defineProps<{
  trigger?: string
}>()

const emit = defineEmits<{
  manageSettings: []
}>()

const { t } = useI18n()
const pluginsStore = usePluginsStore()

const popover = defineModel<boolean>('isOpen', { default: false })

const hasPlugins = computed(() => pluginsStore.installedPlugins.length > 0)
const hasServers = computed(() => pluginsStore.standaloneServers.length > 0)
const isEmpty = computed(() => !hasPlugins.value && !hasServers.value)

async function handleTogglePlugin(pluginId: string): Promise<void> {
  try {
    await pluginsStore.togglePlugin(pluginId)
  } catch {
    // Toggle failed — store will not have changed
  }
}

async function handleToggleServer(serverId: string): Promise<void> {
  const server = pluginsStore.standaloneServers.find((s) => s.id === serverId)
  if (!server) return

  try {
    // The server toggle uses updateServer to flip the enabled state
    await pluginsStore.updateServer(serverId, { enabled: !server.enabled })
  } catch {
    // Toggle failed — store will not have changed
  }
}

function openSettings(): void {
  popover.value = false
  emit('manageSettings')
}
</script>

<template>
  <ion-popover
    :trigger="trigger"
    :is-open="popover"
    @did-dismiss="popover = false"
    side="top"
    alignment="start"
    :dismiss-on-select="false"
    :class="$style.popover"
  >
    <div :class="$style.container">
      <!-- Empty state -->
      <div v-if="isEmpty" :class="$style.emptyState">
        <p>{{ t('plugins.popover.empty') }}</p>
      </div>

      <template v-else>
        <!-- Plugins section -->
        <ion-list v-if="hasPlugins" lines="none" :class="$style.list">
          <ion-item-divider :class="$style.sectionHeader">
            <ion-label>{{ t('plugins.popover.plugins') }}</ion-label>
          </ion-item-divider>
          <ion-item
            v-for="plugin in pluginsStore.installedPlugins"
            :key="plugin.id"
            :class="$style.toggleItem"
            :detail="false"
          >
            <div slot="start" :class="$style.iconWrap">
              <Package :size="14" :class="$style.icon" />
            </div>
            <ion-label>
              <h3>{{ plugin.name }}</h3>
              <p v-if="plugin.manifest?.description">{{ plugin.manifest.description }}</p>
            </ion-label>
            <ion-toggle
              slot="end"
              :checked="plugin.enabled"
              :aria-label="plugin.enabled ? t('plugins.card.disable') : t('plugins.card.enable')"
              @ion-change="handleTogglePlugin(plugin.id)"
            />
          </ion-item>
        </ion-list>

        <!-- Servers section -->
        <ion-list v-if="hasServers" lines="none" :class="$style.list">
          <ion-item-divider :class="$style.sectionHeader">
            <ion-label>{{ t('plugins.popover.servers') }}</ion-label>
          </ion-item-divider>
          <ion-item
            v-for="server in pluginsStore.standaloneServers"
            :key="server.id"
            :class="$style.toggleItem"
            :detail="false"
          >
            <div slot="start" :class="$style.iconWrap">
              <Server :size="14" :class="$style.icon" />
            </div>
            <ion-label>
              <h3>{{ server.name }}</h3>
              <p v-if="server.description">{{ server.description }}</p>
            </ion-label>
            <ion-toggle
              slot="end"
              :checked="server.enabled"
              :aria-label="server.enabled ? t('plugins.server.disable') : t('plugins.server.enable')"
              @ion-change="handleToggleServer(server.id)"
            />
          </ion-item>
        </ion-list>
      </template>

      <!-- Manage in Settings link -->
      <ion-list lines="none" :class="$style.footerList">
        <ion-item
          button
          :detail="false"
          @click="openSettings"
          :class="$style.settingsLink"
        >
          <Settings :size="16" slot="start" :class="$style.settingsIcon" />
          <ion-label color="medium">{{ t('plugins.popover.manageInSettings') }}</ion-label>
        </ion-item>
      </ion-list>
    </div>
  </ion-popover>
</template>

<style lang="scss" module>
.popover {
  --width: 300px;
  --background: var(--n8n-desk--surface-bg, var(--color--foreground));
}

.container {
  display: flex;
  flex-direction: column;
}

.emptyState {
  padding: 16px;
  text-align: center;

  p {
    font-size: var(--font-size--2xs, 12px);
    color: var(--color--text--tint-1);
    margin: 0;
    line-height: 1.4;
  }
}

.list {
  padding: 0;
  background: transparent;
}

.sectionHeader {
  --background: transparent;
  --color: var(--color--text--tint-1);
  --padding-start: 16px;
  --inner-padding-end: 16px;
  --min-height: 32px;
  font-size: var(--font-size--2xs, 12px);
  font-weight: var(--font-weight--bold, 700);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-bottom: none;
}

.toggleItem {
  --min-height: 44px;
  --padding-start: 12px;
  --inner-padding-end: 12px;
  --background: transparent;

  h3 {
    font-size: var(--font-size--sm, 13px);
    font-weight: var(--font-weight--medium, 500);
    color: var(--color--text--shade-1);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  p {
    font-size: var(--font-size--2xs, 12px);
    color: var(--color--text--tint-1);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-top: 1px;
  }
}

.iconWrap {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: var(--n8n-desk--surface-raised-bg, var(--color--foreground--tint-2));
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-right: var(--spacing--xs, 8px);
}

.icon {
  color: var(--color--primary, #ff6d5a);
}

.footerList {
  padding: 0;
  background: transparent;
}

.settingsLink {
  --min-height: 40px;
  --padding-start: 16px;
  --inner-padding-end: 16px;
  --background: transparent;
  border-top: 1px solid var(--border-color--subtle, rgba(0, 0, 0, 0.08));
}

.settingsIcon {
  color: var(--color--text--tint-1);
  margin-right: var(--spacing--xs, 8px);
}
</style>
