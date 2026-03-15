import { ref, onMounted, onUnmounted } from 'vue'
import type { ConnectionStatus } from '@/types/connection'

/**
 * Fetch that bypasses CORS by routing through Electron's main process.
 */
async function healthFetch(url: string): Promise<boolean> {
  try {
    if (window.n8nDesk) {
      const result = await window.n8nDesk.api.fetch(url, { method: 'GET', timeoutMs: 5000 })
      return result.status >= 200 && result.status < 300
    }
    // Fallback for browser (will hit CORS in dev — acceptable)
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) })
    return response.ok
  } catch {
    return false
  }
}

export function useConnection() {
  const status = ref<ConnectionStatus>('disconnected')
  const lastChecked = ref<string | null>(null)

  let healthInterval: ReturnType<typeof setInterval> | null = null
  let currentBaseUrl: string | null = null

  async function checkHealth(baseUrl: string): Promise<boolean> {
    return healthFetch(`${baseUrl}/healthz`)
  }

  async function performCheck(): Promise<void> {
    if (!currentBaseUrl) return

    // Skip if document is hidden (save resources)
    if (document.hidden) return

    const reachable = await checkHealth(currentBaseUrl)
    lastChecked.value = new Date().toISOString()

    if (reachable) {
      status.value = 'connected'
    } else if (status.value === 'connected') {
      status.value = 'reconnecting'
    } else {
      status.value = 'disconnected'
    }
  }

  function startMonitoring(baseUrl: string): void {
    stopMonitoring()
    currentBaseUrl = baseUrl

    // Initial check
    void performCheck()

    // Poll every 30 seconds
    healthInterval = setInterval(() => {
      void performCheck()
    }, 30000)
  }

  function stopMonitoring(): void {
    if (healthInterval) {
      clearInterval(healthInterval)
      healthInterval = null
    }
    currentBaseUrl = null
    status.value = 'disconnected'
  }

  // Listen to browser online/offline events for fast hints
  function handleOnline(): void {
    if (currentBaseUrl) {
      status.value = 'reconnecting'
      void performCheck()
    }
  }

  function handleOffline(): void {
    status.value = 'disconnected'
  }

  // Resume polling when tab becomes visible
  function handleVisibilityChange(): void {
    if (!document.hidden && currentBaseUrl) {
      void performCheck()
    }
  }

  onMounted(() => {
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    document.addEventListener('visibilitychange', handleVisibilityChange)
  })

  onUnmounted(() => {
    stopMonitoring()
    window.removeEventListener('online', handleOnline)
    window.removeEventListener('offline', handleOffline)
    document.removeEventListener('visibilitychange', handleVisibilityChange)
  })

  return {
    status,
    lastChecked,
    startMonitoring,
    stopMonitoring,
    checkHealth,
  }
}
