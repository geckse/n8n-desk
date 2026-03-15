import { computed } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useInstancesStore } from '@/stores/instances'
import type { AuthLoginResult } from '@/types/auth'

export function useAuth() {
  const authStore = useAuthStore()
  const instancesStore = useInstancesStore()

  const isAuthenticated = computed(() => authStore.isAuthenticated)
  const isFullAccess = computed(() => authStore.isFullAccess)
  const userRole = computed(() => authStore.userRole)

  /**
   * Initiate OAuth login for an n8n instance URL.
   * On success, adds the instance and hydrates auth state.
   */
  async function login(instanceUrl: string, options?: { forceLocalhost?: boolean }): Promise<AuthLoginResult> {
    const result = await authStore.login(instanceUrl, options)

    if (result.success) {
      // Read the instance config from disk (written by the main process during login)
      // and add it to the instances store
      const { localStorageService } = await import('@/services/local-storage')
      const instanceConfig = await localStorageService.readJson<import('@/types/instance').Instance>(
        `instances/${result.instanceId}/instance.json`
      )
      if (instanceConfig) {
        await instancesStore.addInstance(instanceConfig)
        await instancesStore.setActive(instanceConfig.id)
      }
    }

    return result
  }

  /**
   * Log out of the active instance. Clears tokens and auth state.
   */
  async function logout(): Promise<void> {
    const activeId = instancesStore.activeInstanceId
    if (!activeId) return

    await authStore.logout(activeId)
  }

  /**
   * Ensure the current token is valid. Triggers refresh if expired.
   * Returns true if the user is authenticated after the check.
   */
  async function ensureAuthenticated(): Promise<boolean> {
    if (!authStore.isAuthenticated) return false

    if (authStore.isTokenExpired) {
      const activeId = instancesStore.activeInstanceId
      if (!activeId) return false

      const result = await authStore.refresh(activeId)
      return result.success
    }

    return true
  }

  return {
    isAuthenticated,
    isFullAccess,
    userRole,
    login,
    logout,
    ensureAuthenticated,
  }
}
