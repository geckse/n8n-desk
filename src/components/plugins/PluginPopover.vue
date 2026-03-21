<script setup lang="ts">
import { computed } from 'vue'
import {
  IonPopover, IonList, IonItem, IonLabel, IonToggle, IonItemDivider,
} from '@ionic/vue'
import { Settings, Package, Server, Zap, Shield } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { usePluginsStore } from '@/stores/plugins'
import { useSettingsStore } from '@/stores/settings'

defineProps<{
  trigger?: string
  sessionDisabledSkillCount?: number
}>()

const emit = defineEmits<{
  openSkills: []
}>()

const { t } = useI18n()
const pluginsStore = usePluginsStore()
const settingsStore = useSettingsStore()

const popover = defineModel<boolean>('isOpen', { default: false })

const hasPlugins = computed(() => pluginsStore.installedPlugins.length > 0)
const hasServers = computed(() => pluginsStore.standaloneServers.length > 0)
const enabledPluginCount = computed(() => pluginsStore.enabledPlugins.length)
const enabledServerCount = computed(() => pluginsStore.enabledServers.length)
const enabledSkillCount = computed(() => pluginsStore.enabledSkills.length)

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
    await pluginsStore.updateServer(serverId, { enabled: !server.enabled })
  } catch {
    // Toggle failed — store will not have changed
  }
}

function openSettings(): void {
  popover.value = false
  settingsStore.openSettings('plugins')
}

function openSkillsPopover(): void {
  popover.value = false
  emit('openSkills')
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
      <!-- Status summary -->
      <div :class="$style.summary">
        <div :class="$style.summaryRow">
          <Shield :size="14" :class="$style.summaryIconPrimary" />
          <span :class="$style.summaryLabel">n8n MCP</span>
          <span :class="$style.summaryBadgeActive">{{ t('plugins.popover.alwaysOn') }}</span>
        </div>
        <div
          :class="[$style.summaryRow, $style.summaryRowClickable]"
          @click="openSkillsPopover"
        >
          <Zap :size="14" :class="$style.summaryIcon" />
          <span :class="$style.summaryLabel">{{ t('plugins.popover.skills') }}</span>
          <span
            v-if="sessionDisabledSkillCount && sessionDisabledSkillCount > 0"
            :class="$style.summaryBadgeWarning"
          >
            {{ enabledSkillCount - sessionDisabledSkillCount }} / {{ enabledSkillCount }}
          </span>
          <span v-else :class="$style.summaryCount">{{ enabledSkillCount }} {{ t('plugins.popover.active') }}</span>
          <span :class="$style.summaryChevron">&rsaquo;</span>
        </div>
        <div v-if="enabledPluginCount > 0 || enabledServerCount > 0" :class="$style.summaryRow">
          <Package :size="14" :class="$style.summaryIcon" />
          <span :class="$style.summaryLabel">{{ t('plugins.popover.extensions') }}</span>
          <span :class="$style.summaryCount">{{ enabledPluginCount + enabledServerCount }} {{ t('plugins.popover.active') }}</span>
        </div>
      </div>

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

// --- Status summary ---
.summary {
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  border-bottom: 1px solid var(--border-color--subtle, rgba(0, 0, 0, 0.08));
}

.summaryRow {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.summaryIconPrimary {
  color: var(--color--primary, #ff6d5a);
  flex-shrink: 0;
}

.summaryIcon {
  color: var(--color--text--tint-1);
  flex-shrink: 0;
}

.summaryLabel {
  flex: 1;
  font-weight: 500;
  color: var(--color--text--shade-1);
}

.summaryCount {
  font-size: 12px;
  color: var(--color--text--tint-1);
  white-space: nowrap;
}

.summaryRowClickable {
  cursor: pointer;
  border-radius: 6px;
  margin: 0 -6px;
  padding: 4px 6px;
  transition: background 0.12s;

  &:hover {
    background: var(--n8n-desk--surface-raised-bg, var(--color--foreground--tint-2));
  }
}

.summaryChevron {
  font-size: 18px;
  line-height: 1;
  color: var(--color--text--tint-2);
  flex-shrink: 0;
  margin-left: 2px;
}

.summaryBadgeWarning {
  font-size: 11px;
  font-weight: 600;
  color: var(--color--warning, #f59e0b);
  background: color-mix(in srgb, var(--color--warning, #f59e0b) 12%, transparent);
  padding: 1px 6px;
  border-radius: 4px;
  white-space: nowrap;
}

.summaryBadgeActive {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--color--success, #10b981);
  background: color-mix(in srgb, var(--color--success, #10b981) 10%, transparent);
  padding: 2px 6px;
  border-radius: 4px;
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
  cursor: pointer;
}

.settingsIcon {
  color: var(--color--text--tint-1);
  margin-right: var(--spacing--xs, 8px);
}
</style>
