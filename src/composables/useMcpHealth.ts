import { ref, computed } from 'vue'
import type { McpStatusResult } from '@/types/mcp'

/** Renderer-side MCP health status. 'unknown' = never checked yet. */
export type McpHealthStatus = 'unknown' | 'checking' | 'connected' | 'unauthorized' | 'unreachable' | 'not-configured'

// --- Shared singleton state (same pattern as useConnection) ---
const status = ref<McpHealthStatus>('unknown')
const toolCount = ref<number | null>(null)
const lastError = ref<string | null>(null)
const lastChecked = ref<string | null>(null)

let pollInterval: ReturnType<typeof setInterval> | null = null
let monitorRefCount = 0
let inFlight: Promise<McpStatusResult | null> | null = null

/**
 * The MCP check is a real tools/list round-trip against the agent's resolved
 * endpoint — heavier than the /healthz ping, so poll less aggressively.
 */
const POLL_INTERVAL_MS = 60_000

async function performCheck(): Promise<McpStatusResult | null> {
  if (!window.n8nDesk) return null
  // Coalesce concurrent callers onto one in-flight IPC round-trip.
  if (inFlight) return inFlight

  if (status.value === 'unknown') {
    status.value = 'checking'
  }

  inFlight = window.n8nDesk.agent
    .mcpStatus()
    .then((result) => {
      status.value = result.status
      toolCount.value = result.toolCount ?? null
      lastError.value = result.error ?? null
      lastChecked.value = new Date().toISOString()
      return result
    })
    .catch((err: unknown) => {
      status.value = 'unreachable'
      lastError.value = err instanceof Error ? err.message : String(err)
      lastChecked.value = new Date().toISOString()
      return null
    })
    .finally(() => {
      inFlight = null
    })

  return inFlight
}

/**
 * MCP endpoint health for the active instance — drives the "n8n tools
 * unavailable" banner in the Cowork/Workflow panels. Singleton state; the
 * poll runs while at least one component holds a startMonitoring() lease.
 */
export function useMcpHealth() {
  const isHealthy = computed(() => status.value === 'connected')
  const isBroken = computed(() => status.value === 'unauthorized' || status.value === 'unreachable')

  async function checkNow(): Promise<McpStatusResult | null> {
    return performCheck()
  }

  /** Start polling. Refcounted — safe to call from multiple panels. */
  function startMonitoring(): void {
    monitorRefCount += 1
    if (pollInterval) return

    void checkNow()
    pollInterval = setInterval(() => {
      if (!document.hidden) void performCheck()
    }, POLL_INTERVAL_MS)
  }

  /** Release one monitoring lease; polling stops when none remain. */
  function stopMonitoring(): void {
    monitorRefCount = Math.max(0, monitorRefCount - 1)
    if (monitorRefCount === 0 && pollInterval) {
      clearInterval(pollInterval)
      pollInterval = null
    }
  }

  /** Instance switched — old status is meaningless until the next check. */
  function resetStatus(): void {
    status.value = 'unknown'
    toolCount.value = null
    lastError.value = null
    lastChecked.value = null
  }

  return {
    status,
    toolCount,
    lastError,
    lastChecked,
    isHealthy,
    isBroken,
    checkNow,
    startMonitoring,
    stopMonitoring,
    resetStatus,
  }
}
