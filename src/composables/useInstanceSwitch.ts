import { useRouter } from 'vue-router'
import { useInstancesStore } from '@/stores/instances'
import { useAuthStore } from '@/stores/auth'
import { useWorkflowSessionsStore } from '@/stores/workflow-sessions'
import { useCoworkSessionsStore } from '@/stores/cowork-sessions'
import { createApiClient } from '@/services/n8n-api'

/**
 * Full context swap to another instance — reset all instance-scoped stores,
 * activate the target (which also stops running agents), and rehydrate from
 * its data directory. Shared by the header InstanceSwitcher and the
 * session-expired modal so the swap semantics can't drift apart.
 */
export function useInstanceSwitch() {
  const router = useRouter()
  const instancesStore = useInstancesStore()
  const authStore = useAuthStore()
  const workflowSessionsStore = useWorkflowSessionsStore()
  const coworkSessionsStore = useCoworkSessionsStore()

  async function switchTo(instanceId: string): Promise<void> {
    if (instanceId === instancesStore.activeInstanceId) return

    authStore.reset()
    workflowSessionsStore.reset()
    coworkSessionsStore.reset()
    await instancesStore.setActive(instanceId)
    await authStore.hydrate(instanceId)
    await workflowSessionsStore.hydrate(instanceId)
    await coworkSessionsStore.hydrate(instanceId)

    // The reset cleared sessionExpired — but the instance we just switched to
    // may have a dead session as well. Validate proactively so the re-login
    // prompt reappears immediately instead of on the next failed API call.
    await validateSession()

    // Default landing after a swap
    await router.replace('/chat')
  }

  /**
   * Probe GET /rest/login ("check if the user is already logged in"). On 401
   * the API client's onSessionExpired hook flips authStore.sessionExpired for
   * us. Network errors and 5xx are not a session verdict — ignore them.
   */
  async function validateSession(): Promise<void> {
    if (!authStore.sessionToken) return // never credential-signed-in — nothing to validate
    const client = createApiClient()
    if (!client) return
    try {
      await client.get('/rest/login')
    } catch {
      // 401 already marked the session expired via the client hook.
    }
  }

  return { switchTo }
}
