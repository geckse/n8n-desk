import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import type { UserRole, AuthMetadata, AuthLoginResult, AuthRefreshResult, CredentialLoginResult, UserProfile } from '@/types/auth'
import { localStorageService } from '@/services/local-storage'

function authMetadataPath(instanceId: string): string {
  return `instances/${instanceId}/auth.json`
}

function keychainKey(instanceId: string): string {
  return `n8n-desk:${instanceId}`
}

export const useAuthStore = defineStore('auth', () => {
  const accessToken = ref<string | null>(null)
  const sessionToken = ref<string | null>(null)
  const userRole = ref<UserRole>('unknown')
  const scopes = ref<string[]>([])
  const expiresAt = ref<string | null>(null)
  const userProfile = ref<UserProfile | null>(null)
  const sessionExpired = ref(false)

  const isAuthenticated = computed(() => accessToken.value !== null)
  const isFullAccess = computed(() => userRole.value !== 'chatUser' && userRole.value !== 'unknown')
  const hasRestAccess = computed(() => sessionToken.value !== null && !sessionExpired.value)

  const isTokenExpired = computed(() => {
    if (!expiresAt.value) return true
    return new Date(expiresAt.value).getTime() < Date.now()
  })

  /**
   * Hydrate the auth store from disk for a given instance.
   * Reads auth metadata from auth.json and tokens from encrypted storage.
   */
  async function hydrate(instanceId: string): Promise<void> {
    // Read non-secret metadata
    const meta = await localStorageService.readJson<AuthMetadata>(authMetadataPath(instanceId))
    if (!meta) {
      reset()
      return
    }

    userRole.value = meta.userRole as UserRole
    scopes.value = meta.scopes
    expiresAt.value = meta.expiresAt
    userProfile.value = meta.userProfile ?? null

    if (window.n8nDesk) {
      // Read MCP OAuth access token from keychain
      const tokenJson = await window.n8nDesk.keychain.get(keychainKey(instanceId))
      if (tokenJson) {
        try {
          const tokens = JSON.parse(tokenJson) as { access_token: string; refresh_token: string }
          accessToken.value = tokens.access_token
        } catch {
          accessToken.value = null
        }
      } else {
        accessToken.value = null
      }

      // Read REST API session token from encrypted storage
      if (meta.hasSessionToken) {
        sessionToken.value = await window.n8nDesk.auth.getSessionToken(instanceId)
      }
    }
  }

  /**
   * Initiate OAuth login for a new instance (MCP access).
   */
  async function login(instanceUrl: string, options?: { forceLocalhost?: boolean }): Promise<AuthLoginResult> {
    if (!window.n8nDesk) {
      return { success: false, error: 'Not running in Electron', errorCode: 'network_error' }
    }

    const result = await window.n8nDesk.auth.login(instanceUrl, options)

    if (result.success) {
      userRole.value = result.userRole as UserRole
      scopes.value = result.scopes
      expiresAt.value = result.expiresAt

      // Load user profile from auth.json (written by main process)
      const meta = await localStorageService.readJson<AuthMetadata>(authMetadataPath(result.instanceId))
      userProfile.value = meta?.userProfile ?? null

      // Load the token from keychain now that it's stored
      const tokenJson = await window.n8nDesk.keychain.get(keychainKey(result.instanceId))
      if (tokenJson) {
        try {
          const tokens = JSON.parse(tokenJson) as { access_token: string; refresh_token: string }
          accessToken.value = tokens.access_token
        } catch {
          accessToken.value = null
        }
      }
    }

    return result
  }

  /**
   * Sign in with email+password to get REST API session access.
   * This is separate from MCP OAuth — gives access to /rest/* and /chat/* endpoints.
   */
  async function credentialLogin(instanceId: string, credentials: { email: string; password: string; mfaCode?: string }): Promise<CredentialLoginResult> {
    if (!window.n8nDesk) {
      return { success: false, error: 'Not running in Electron', errorCode: 'network_error' }
    }

    const result = await window.n8nDesk.auth.credentialLogin(instanceId, credentials)

    if (result.success) {
      userProfile.value = result.userProfile
      // Load the session token that was just stored
      sessionToken.value = await window.n8nDesk.auth.getSessionToken(instanceId)
    }

    return result
  }

  /**
   * Log out and clear all auth state for the active instance.
   */
  async function logout(instanceId: string): Promise<void> {
    if (window.n8nDesk) {
      await window.n8nDesk.auth.logout(instanceId)
    }
    reset()
  }

  /**
   * Refresh the MCP OAuth access token for the active instance.
   * Called automatically on 401 or when the token is expired.
   */
  async function refresh(instanceId: string): Promise<AuthRefreshResult> {
    if (!window.n8nDesk) {
      return { success: false, error: 'Not running in Electron' }
    }

    const result = await window.n8nDesk.auth.refresh(instanceId)

    if (result.success) {
      accessToken.value = result.accessToken
      expiresAt.value = result.expiresAt
    }

    return result
  }

  function markSessionExpired(): void {
    sessionExpired.value = true
  }

  function clearSessionExpired(): void {
    sessionExpired.value = false
  }

  function reset(): void {
    accessToken.value = null
    sessionToken.value = null
    userRole.value = 'unknown'
    scopes.value = []
    expiresAt.value = null
    userProfile.value = null
    sessionExpired.value = false
  }

  return {
    accessToken,
    sessionToken,
    sessionExpired,
    userRole,
    userProfile,
    scopes,
    expiresAt,
    isAuthenticated,
    isFullAccess,
    hasRestAccess,
    isTokenExpired,
    hydrate,
    login,
    credentialLogin,
    logout,
    refresh,
    markSessionExpired,
    clearSessionExpired,
    reset,
  }
})
