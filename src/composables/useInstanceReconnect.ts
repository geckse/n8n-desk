import { ref } from 'vue'
import { useInstancesStore } from '@/stores/instances'
import { useAuthStore } from '@/stores/auth'
import { useMcpHealth } from '@/composables/useMcpHealth'

export interface ReconnectResult {
  success: boolean
  error?: string
}

/**
 * Re-establish an instance's agent/MCP auth without disconnecting it: silent
 * token refresh first, full OAuth (system browser) only when refresh fails.
 * Covers both token contexts — the n8n OAuth token and, when a custom MCP
 * server is configured, its separate OAuth token. Finishes with a real
 * tools/list round-trip so "reconnected" means the MCP endpoint actually works.
 */
export function useInstanceReconnect() {
  const instancesStore = useInstancesStore()
  const authStore = useAuthStore()
  const mcpHealth = useMcpHealth()

  const isReconnecting = ref(false)

  async function reconnect(instanceId: string): Promise<ReconnectResult> {
    const bridge = window.n8nDesk
    if (!bridge) {
      return { success: false, error: 'Not running in Electron' }
    }
    const instance = instancesStore.getInstance(instanceId)
    if (!instance) {
      return { success: false, error: 'Unknown instance' }
    }

    isReconnecting.value = true
    try {
      // n8n OAuth context — silent refresh, full OAuth as fallback.
      const refreshed = await bridge.auth.refresh(instanceId)
      if (!refreshed.success) {
        const login = await bridge.auth.login(instance.url)
        if (!login.success) {
          return { success: false, error: login.error }
        }
      }

      // Custom MCP override has its own token context.
      if (instance.mcpServerUrl) {
        const mcpRefreshed = await bridge.auth.mcp.refresh(instanceId)
        if (!mcpRefreshed.success) {
          const mcpLogin = await bridge.auth.mcp.login(instanceId, instance.mcpServerUrl)
          if (!mcpLogin.success) {
            return { success: false, error: mcpLogin.error }
          }
        }
      }

      // Reload renderer auth state for the active instance.
      if (instancesStore.activeInstanceId === instanceId) {
        await authStore.hydrate(instanceId)
      }

      // Verify with a real MCP round-trip. For the active instance this also
      // updates the shared health state the panel banner renders from.
      const result = instancesStore.activeInstanceId === instanceId
        ? await mcpHealth.checkNow()
        : await bridge.agent.mcpStatus(instanceId)

      if (!result) {
        return { success: false, error: 'MCP status check failed' }
      }
      if (result.status !== 'connected') {
        return {
          success: false,
          error: result.error
            ?? (result.status === 'unauthorized'
              ? 'Still unauthorized after reconnect'
              : 'MCP server is unreachable'),
        }
      }

      return { success: true }
    } finally {
      isReconnecting.value = false
    }
  }

  return { reconnect, isReconnecting }
}
