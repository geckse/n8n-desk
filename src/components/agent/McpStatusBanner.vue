<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { TriangleAlert, RefreshCw, Loader2 } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useMcpHealth } from '@/composables/useMcpHealth'
import { useInstanceReconnect } from '@/composables/useInstanceReconnect'
import { useInstancesStore } from '@/stores/instances'
import { useSettingsStore } from '@/stores/settings'

/**
 * Warning banner shown above the chat input in Cowork/Workflow mode when the
 * n8n MCP endpoint the agent depends on is unreachable or unauthorized.
 * Owns a monitoring lease on useMcpHealth while mounted.
 */
const { t } = useI18n()
const { status, isBroken, checkNow, startMonitoring, stopMonitoring, resetStatus } = useMcpHealth()
const { reconnect, isReconnecting } = useInstanceReconnect()
const instancesStore = useInstancesStore()
const settingsStore = useSettingsStore()

const isRetrying = ref(false)
const reconnectError = ref<string | null>(null)

const instanceLabel = computed(() => instancesStore.activeInstance?.label ?? 'n8n')

const message = computed(() =>
  status.value === 'unauthorized'
    ? t('agentPanel.mcpBanner.unauthorized', { instance: instanceLabel.value })
    : t('agentPanel.mcpBanner.unreachable', { instance: instanceLabel.value }),
)

async function handleRetry(): Promise<void> {
  isRetrying.value = true
  reconnectError.value = null
  try {
    await checkNow()
  } finally {
    isRetrying.value = false
  }
}

async function handleReconnect(): Promise<void> {
  const id = instancesStore.activeInstanceId
  if (!id || isReconnecting.value) return
  reconnectError.value = null
  const result = await reconnect(id)
  if (!result.success) {
    reconnectError.value = result.error ?? t('agentPanel.mcpBanner.reconnectFailed')
  }
}

function openInstanceSettings(): void {
  const id = instancesStore.activeInstanceId
  if (id) settingsStore.openSettings(`instance:${id}`)
}

// Instance switch — the previous instance's status is meaningless.
watch(() => instancesStore.activeInstanceId, (id, prev) => {
  if (id === prev) return
  resetStatus()
  reconnectError.value = null
  if (id) void checkNow()
})

onMounted(() => startMonitoring())
onUnmounted(() => stopMonitoring())
</script>

<template>
  <Transition name="mcp-banner">
    <div v-if="isBroken" class="mcp-banner" role="alert">
      <TriangleAlert :size="15" class="banner-icon" />
      <div class="banner-body">
        <span class="banner-text">{{ message }}</span>
        <span v-if="reconnectError" class="banner-error">{{ reconnectError }}</span>
      </div>
      <div class="banner-actions">
        <button
          v-if="status === 'unauthorized'"
          class="banner-btn banner-btn--primary"
          :disabled="isReconnecting"
          @click="handleReconnect"
        >
          <Loader2 v-if="isReconnecting" :size="12" class="spin" />
          {{ t('agentPanel.mcpBanner.reconnect') }}
        </button>
        <button
          v-else
          class="banner-btn banner-btn--primary"
          :disabled="isRetrying"
          @click="handleRetry"
        >
          <Loader2 v-if="isRetrying" :size="12" class="spin" />
          <RefreshCw v-else :size="12" />
          {{ t('agentPanel.mcpBanner.retry') }}
        </button>
        <button class="banner-btn" @click="openInstanceSettings">
          {{ t('agentPanel.mcpBanner.openSettings') }}
        </button>
      </div>
    </div>
  </Transition>
</template>

<style scoped lang="scss">
.mcp-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  margin-bottom: 8px;
  border: 1px solid color-mix(in srgb, var(--color--warning, #f59e0b) 45%, transparent);
  border-radius: 10px;
  background: color-mix(in srgb, var(--color--warning, #f59e0b) 12%, var(--n8n-desk--surface-bg, transparent));
  font-size: 12px;
  color: var(--color--text);
}

.banner-icon {
  flex-shrink: 0;
  color: var(--color--warning, #f59e0b);
}

.banner-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.banner-text {
  font-weight: 500;
}

.banner-error {
  color: var(--color--danger, #ea1f30);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.banner-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.banner-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border: 1px solid var(--border-color--subtle, currentColor);
  border-radius: 6px;
  background: transparent;
  color: var(--color--text);
  font-size: 11px;
  cursor: pointer;
  transition: background 0.15s ease;

  &:hover:not(:disabled) {
    background: var(--n8n-desk--surface-raised-bg);
  }

  &:disabled {
    opacity: 0.6;
    cursor: default;
  }

  &--primary {
    border-color: color-mix(in srgb, var(--color--warning, #f59e0b) 60%, transparent);
    color: var(--color--warning, #f59e0b);
    font-weight: 600;
  }
}

.spin {
  animation: mcp-banner-spin 1s linear infinite;
}

@keyframes mcp-banner-spin {
  to { transform: rotate(360deg); }
}

.mcp-banner-enter-active,
.mcp-banner-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.mcp-banner-enter-from,
.mcp-banner-leave-to {
  opacity: 0;
  transform: translateY(4px);
}
</style>
