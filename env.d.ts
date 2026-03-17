/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

interface N8nDeskBridge {
  agent: {
    invoke: (sessionId: string, message: string) => Promise<{ success: boolean; error?: string }>
    stop: (sessionId: string) => Promise<{ success: boolean }>
    approve: (sessionId: string, decision: 'approve' | 'reject') => Promise<{ success: boolean; error?: string }>
    testConnection: () => Promise<{ success: boolean; error?: string }>
    onEvent: (callback: (event: import('./src/types/agent').AgentEvent) => void) => () => void
  }
  storage: {
    read: (path: string) => Promise<string | null>
    write: (path: string, data: string) => Promise<void>
    append: (path: string, line: string) => Promise<void>
  }
  api: {
    fetch: (url: string, options?: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number }) =>
      Promise<{ status: number; headers: Record<string, string>; body: string }>
  }
  auth: {
    login: (instanceUrl: string, options?: { forceLocalhost?: boolean }) => Promise<import('./src/types/auth').AuthLoginResult>
    logout: (instanceId: string) => Promise<void>
    refresh: (instanceId: string) => Promise<import('./src/types/auth').AuthRefreshResult>
    credentialLogin: (instanceId: string, credentials: { email: string; password: string; mfaCode?: string }) => Promise<import('./src/types/auth').CredentialLoginResult>
    getSessionToken: (instanceId: string) => Promise<string | null>
  }
  keychain: {
    get: (key: string) => Promise<string | null>
    set: (key: string, value: string) => Promise<void>
    delete: (key: string) => Promise<void>
  }
}

interface Window {
  n8nDesk?: N8nDeskBridge
}
