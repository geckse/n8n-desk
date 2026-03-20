<script setup lang="ts">
import { computed } from 'vue'
import { IonCard, IonCardContent, IonButton, IonSpinner } from '@ionic/vue'
import { Package, Download, Trash2, ToggleLeft, ToggleRight } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import type { MarketplacePluginEntry, InstalledPlugin } from '@/types/plugin'

interface Props {
  /** Marketplace entry for browsing — mutually exclusive with `installed` */
  entry?: MarketplacePluginEntry
  /** Installed plugin data — if provided, card shows installed state */
  installed?: InstalledPlugin
  /** Whether an install operation is in progress */
  installing?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  installing: false,
})

const emit = defineEmits<{
  install: [entry: MarketplacePluginEntry]
  uninstall: [plugin: InstalledPlugin]
  toggle: [plugin: InstalledPlugin]
}>()

const { t } = useI18n()

const name = computed(() =>
  props.installed?.name ?? props.entry?.name ?? '',
)

const description = computed(() =>
  props.installed?.manifest?.description ?? props.entry?.description ?? '',
)

const author = computed(() =>
  props.installed?.manifest?.author?.name ?? props.entry?.author?.name ?? '',
)

const version = computed(() =>
  props.installed?.manifest?.version ?? props.entry?.version ?? '',
)

const category = computed(() =>
  props.entry?.category ?? '',
)

const isInstalled = computed(() => !!props.installed)

const isEnabled = computed(() =>
  props.installed?.enabled ?? false,
)

const initial = computed(() => {
  const n = name.value
  return n ? n.charAt(0).toUpperCase() : 'P'
})

function handleInstall() {
  if (props.entry) {
    emit('install', props.entry)
  }
}

function handleUninstall() {
  if (props.installed) {
    emit('uninstall', props.installed)
  }
}

function handleToggle() {
  if (props.installed) {
    emit('toggle', props.installed)
  }
}
</script>

<template>
  <ion-card :class="$style.card">
    <ion-card-content :class="$style.content">
      <div :class="$style.header">
        <div :class="$style.iconWrap">
          <span :class="$style.initial">{{ initial }}</span>
        </div>
        <div :class="$style.info">
          <div :class="$style.nameRow">
            <span :class="$style.name">{{ name }}</span>
            <span v-if="version" :class="$style.version">v{{ version }}</span>
          </div>
          <span v-if="author" :class="$style.author">{{ author }}</span>
        </div>
        <span v-if="category && !isInstalled" :class="$style.badge">{{ category }}</span>
      </div>

      <p v-if="description" :class="$style.description">{{ description }}</p>

      <div :class="$style.actions">
        <template v-if="isInstalled && installed">
          <button
            :class="[$style.toggleBtn, isEnabled && $style.toggleBtnActive]"
            :title="isEnabled ? t('plugins.card.disable') : t('plugins.card.enable')"
            @click="handleToggle"
          >
            <component :is="isEnabled ? ToggleRight : ToggleLeft" :size="18" />
            <span>{{ isEnabled ? t('plugins.card.enabled') : t('plugins.card.disabled') }}</span>
          </button>
          <ion-button
            fill="clear"
            size="small"
            color="danger"
            :class="$style.uninstallBtn"
            @click="handleUninstall"
          >
            <Trash2 :size="14" />
            {{ t('plugins.card.uninstall') }}
          </ion-button>
        </template>
        <template v-else-if="entry">
          <ion-button
            fill="outline"
            size="small"
            :disabled="installing"
            @click="handleInstall"
          >
            <ion-spinner v-if="installing" name="crescent" :class="$style.spinner" />
            <Download v-else :size="14" />
            {{ installing ? t('plugins.card.installing') : t('plugins.card.install') }}
          </ion-button>
        </template>
      </div>
    </ion-card-content>
  </ion-card>
</template>

<style lang="scss" module>
.card {
  --background: var(--n8n-desk--surface-bg, var(--color--foreground));
  --color: var(--color--text--shade-1);
  margin: 0;
  border-radius: 10px;
  border: 1px solid var(--n8n-desk--content-bg, var(--color--background));
  box-shadow: none;

  &:hover {
    border-color: var(--color--text--tint-2, rgba(0, 0, 0, 0.1));
  }
}

.content {
  padding: 14px 16px;
}

.header {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 8px;
}

.iconWrap {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: var(--n8n-desk--surface-raised-bg, var(--color--foreground--tint-2));
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.initial {
  font-size: 16px;
  font-weight: 600;
  color: var(--color--primary, #ff6d5a);
  line-height: 1;
}

.info {
  flex: 1;
  min-width: 0;
}

.nameRow {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.name {
  font-size: 14px;
  font-weight: 600;
  color: var(--color--text--shade-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.version {
  font-size: 11px;
  color: var(--color--text--tint-1);
  white-space: nowrap;
  flex-shrink: 0;
}

.author {
  font-size: 12px;
  color: var(--color--text--tint-1);
  display: block;
  margin-top: 1px;
}

.badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 500;
  color: var(--color--primary, #ff6d5a);
  background: var(--n8n-desk--surface-raised-bg, var(--color--foreground--tint-2));
  white-space: nowrap;
  flex-shrink: 0;
}

.description {
  font-size: 13px;
  color: var(--color--text--tint-1);
  line-height: 1.4;
  margin: 0 0 10px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.actions {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: flex-end;
}

.toggleBtn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 500;
  color: var(--color--text--tint-1);
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;

  &:hover {
    background: var(--n8n-desk--surface-raised-bg, var(--color--foreground--tint-2));
  }
}

.toggleBtnActive {
  color: var(--color--success, #10b981);
}

.uninstallBtn {
  --padding-start: 6px;
  --padding-end: 8px;
  font-size: 12px;
  gap: 4px;
}

.spinner {
  width: 14px;
  height: 14px;
  margin-right: 4px;
}
</style>
