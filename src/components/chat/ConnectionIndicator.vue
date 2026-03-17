<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import type { ConnectionStatus } from '@/types/connection'
import { useConnection } from '@/composables/useConnection'
import { useInstancesStore } from '@/stores/instances'

const { status, startMonitoring } = useConnection()
const instancesStore = useInstancesStore()

const showBanner = ref(false)
let bannerTimeout: ReturnType<typeof setTimeout> | null = null

function clearBannerTimeout() {
  if (bannerTimeout) {
    clearTimeout(bannerTimeout)
    bannerTimeout = null
  }
}

watch(status, (newStatus: ConnectionStatus) => {
  if (newStatus === 'connected') {
    clearBannerTimeout()
    showBanner.value = false
  } else if (newStatus === 'disconnected' || newStatus === 'reconnecting') {
    if (!bannerTimeout && !showBanner.value) {
      bannerTimeout = setTimeout(() => {
        if (status.value !== 'connected') {
          showBanner.value = true
        }
        bannerTimeout = null
      }, 3000)
    }
  }
}, { immediate: true })

function handleReconnect() {
  const url = instancesStore.activeInstance?.url
  if (url) {
    startMonitoring(url)
  }
}

onUnmounted(() => {
  clearBannerTimeout()
})

const instanceLabel = computed(() => instancesStore.activeInstance?.label ?? 'n8n')
</script>

<template>
  <div class="connection-indicator">
    <!-- Status dot (always visible in header area) -->
    <div
      class="status-dot"
      :class="{
        'status-dot--connected': status === 'connected',
        'status-dot--reconnecting': status === 'reconnecting',
        'status-dot--disconnected': status === 'disconnected',
      }"
    />

    <!-- Banner (shown after 3s sustained disconnect) -->
    <Transition name="banner">
      <div
        v-if="showBanner"
        class="connection-banner"
        @click="handleReconnect"
      >
        <span class="banner-text">
          Reconnecting to {{ instanceLabel }}…
        </span>
        <button class="banner-action" @click.stop="handleReconnect">
          Reconnect
        </button>
      </div>
    </Transition>
  </div>
</template>

<style lang="scss" scoped>
.connection-indicator {
  display: flex;
  align-items: center;
  position: relative;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  transition: background-color 0.2s ease;

  &--connected {
    background-color: var(--color--success);
  }

  &--reconnecting {
    background-color: var(--color--warning);
    animation: pulse 1.5s ease-in-out infinite;
  }

  &--disconnected {
    background-color: var(--color--danger);
  }
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.connection-banner {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 8px 16px;
  background-color: var(--color--warning);
  color: var(--color--text-dark);
  font-size: var(--font-size--2xs);
  cursor: pointer;
}

.banner-text {
  font-weight: 500;
}

.banner-action {
  background: none;
  border: 1px solid currentColor;
  border-radius: 4px;
  padding: 2px 8px;
  font-size: var(--font-size--2xs);
  color: inherit;
  cursor: pointer;

  &:hover {
    background-color: rgba(0, 0, 0, 0.1);
  }
}

.banner-enter-active,
.banner-leave-active {
  transition: transform 0.3s ease, opacity 0.3s ease;
}

.banner-enter-from,
.banner-leave-to {
  transform: translateY(-100%);
  opacity: 0;
}
</style>
