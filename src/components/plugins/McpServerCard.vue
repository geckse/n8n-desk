<script setup lang="ts">
import { computed } from 'vue'
import { IonToggle, IonButton } from '@ionic/vue'
import { Pencil, Trash2, ShieldCheck, Server, KeyRound } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import type { StandaloneMcpServer } from '@/types/plugin'

interface Props {
  server: StandaloneMcpServer
}

const props = defineProps<Props>()

const emit = defineEmits<{
  edit: [server: StandaloneMcpServer]
  delete: [server: StandaloneMcpServer]
  toggle: [server: StandaloneMcpServer]
}>()

const { t } = useI18n()

const initial = computed(() => {
  const n = props.server.name
  return n ? n.charAt(0).toUpperCase() : 'S'
})

const truncatedUrl = computed(() => {
  const url = props.server.url
  if (!url) return ''
  try {
    const parsed = new URL(url)
    const display = parsed.host + parsed.pathname
    return display.length > 40 ? display.slice(0, 37) + '...' : display
  } catch {
    return url.length > 40 ? url.slice(0, 37) + '...' : url
  }
})

function handleToggle() {
  emit('toggle', props.server)
}

function handleEdit() {
  emit('edit', props.server)
}

function handleDelete() {
  emit('delete', props.server)
}
</script>

<template>
  <div :class="$style.card">
    <div :class="$style.main">
      <div :class="$style.iconWrap">
        <Server :size="16" :class="$style.icon" />
      </div>

      <div :class="$style.info">
        <div :class="$style.nameRow">
          <span :class="$style.name">{{ server.name }}</span>
          <span
            v-if="(server.authType ?? 'static-headers') === 'oauth'"
            :class="[$style.oauthBadge, server.oauthStatus?.connected ? $style.oauthBadgeConnected : $style.oauthBadgeDisconnected]"
          >
            <KeyRound :size="11" />
            {{ server.oauthStatus?.connected ? t('plugins.server.oauthConnected') : t('plugins.server.oauthNotConnected') }}
          </span>
          <span v-if="server.requireApproval" :class="$style.approvalBadge">
            <ShieldCheck :size="12" />
            {{ t('plugins.server.requiresApproval') }}
          </span>
        </div>
        <span :class="$style.url" :title="server.url">{{ truncatedUrl }}</span>
        <p v-if="server.description" :class="$style.description">{{ server.description }}</p>
      </div>

      <div :class="$style.actions">
        <ion-toggle
          :checked="server.enabled"
          :aria-label="server.enabled ? t('plugins.server.disable') : t('plugins.server.enable')"
          @ion-change="handleToggle"
        />
        <ion-button
          fill="clear"
          size="small"
          :class="$style.actionBtn"
          :title="t('plugins.server.edit')"
          @click="handleEdit"
        >
          <Pencil :size="14" />
        </ion-button>
        <ion-button
          fill="clear"
          size="small"
          color="danger"
          :class="$style.actionBtn"
          :title="t('plugins.server.delete')"
          @click="handleDelete"
        >
          <Trash2 :size="14" />
        </ion-button>
      </div>
    </div>
  </div>
</template>

<style lang="scss" module>
.card {
  background: var(--n8n-desk--surface-bg, var(--color--foreground));
  border: 1px solid var(--n8n-desk--content-bg, var(--color--background));
  border-radius: 10px;
  padding: 12px 16px;
  transition: border-color 0.15s ease;

  &:hover {
    border-color: var(--color--text--tint-2, rgba(0, 0, 0, 0.1));
  }
}

.main {
  display: flex;
  align-items: flex-start;
  gap: 10px;
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

.icon {
  color: var(--color--primary, #ff6d5a);
}

.info {
  flex: 1;
  min-width: 0;
}

.nameRow {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.name {
  font-size: 14px;
  font-weight: 600;
  color: var(--color--text--shade-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.oauthBadge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 7px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
  flex-shrink: 0;
}

.oauthBadgeConnected {
  color: var(--color--success, #10b981);
  background: color-mix(in srgb, var(--color--success, #10b981) 12%, transparent);
}

.oauthBadgeDisconnected {
  color: var(--color--warning, #f59e0b);
  background: color-mix(in srgb, var(--color--warning, #f59e0b) 12%, transparent);
}

.approvalBadge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 7px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 500;
  color: var(--color--warning, #f59e0b);
  background: var(--n8n-desk--surface-raised-bg, var(--color--foreground--tint-2));
  white-space: nowrap;
  flex-shrink: 0;
}

.url {
  display: block;
  font-size: 12px;
  color: var(--color--text--tint-1);
  margin-top: 2px;
  font-family: monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.description {
  font-size: 13px;
  color: var(--color--text--tint-1);
  line-height: 1.4;
  margin: 6px 0 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.actionBtn {
  --padding-start: 6px;
  --padding-end: 6px;
  --padding-top: 4px;
  --padding-bottom: 4px;
  min-height: 28px;
}
</style>
