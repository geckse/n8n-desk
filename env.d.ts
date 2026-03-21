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
  push: {
    connect: (instanceId: string, instanceUrl: string) => Promise<{ success: boolean; error?: string }>
    disconnect: () => Promise<void>
    onEvent: (callback: (raw: string) => void) => void
    onStatus: (callback: (status: string) => void) => void
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
    getBrowserId: (instanceId: string) => Promise<string | null>
    syncCookie: (instanceId: string) => Promise<boolean>
  }
  keychain: {
    get: (key: string) => Promise<string | null>
    set: (key: string, value: string) => Promise<void>
    delete: (key: string) => Promise<void>
  }
  plugins: {
    // Marketplace
    marketplaceList: () => Promise<import('./src/types/plugin').Marketplace[] | { success: false; error: string }>
    marketplaceAdd: (source: import('./src/types/plugin').MarketplaceSource) =>
      Promise<{ success: true; marketplace: import('./src/types/plugin').Marketplace } | { success: false; error: string }>
    marketplaceRemove: (id: string) => Promise<{ success: true } | { success: false; error: string }>
    marketplaceRefresh: (id: string) => Promise<{ success: true } | { success: false; error: string }>

    // Browse
    browse: (marketplaceId?: string) =>
      Promise<import('./src/types/plugin').MarketplacePluginEntry[] | { success: false; error: string }>

    // Plugin lifecycle
    installedList: () => Promise<import('./src/types/plugin').InstalledPlugin[] | { success: false; error: string }>
    install: (name: string, marketplaceId: string) =>
      Promise<{ success: true; plugin: import('./src/types/plugin').InstalledPlugin } | { success: false; error: string }>
    uninstall: (id: string) => Promise<{ success: true } | { success: false; error: string }>
    enable: (id: string) => Promise<{ success: true } | { success: false; error: string }>
    disable: (id: string) => Promise<{ success: true } | { success: false; error: string }>
    previewInstall: (name: string, marketplaceId: string) =>
      Promise<{ urls: string[]; headerNames: string[]; toolCount: number; error?: string }>

    // Standalone MCP servers
    serversList: () => Promise<import('./src/types/plugin').StandaloneMcpServer[] | { success: false; error: string }>
    serversAdd: (config: {
      name: string
      description?: string
      url: string
      authType?: 'static-headers' | 'oauth'
      headerNames?: string[]
      enabled: boolean
      requireApproval: boolean
    }) => Promise<{ success: true; server: import('./src/types/plugin').StandaloneMcpServer } | { success: false; error: string }>
    serversUpdate: (id: string, updates: Record<string, unknown>) =>
      Promise<{ success: true } | { success: false; error: string }>
    serversRemove: (id: string) => Promise<{ success: true } | { success: false; error: string }>
    serversTest: (url: string, headers: Record<string, string>) =>
      Promise<{ success: true; tools: import('./src/types/plugin').DiscoveredTool[] } | { success: false; error: string }>
    serversTestById: (serverId: string) =>
      Promise<{ success: true; tools: import('./src/types/plugin').DiscoveredTool[] } | { success: false; error: string }>

    // Server OAuth
    serverProbeOAuth: (serverUrl: string) => Promise<{ supportsOAuth: boolean }>
    serverOAuthConnect: (params: { serverId: string; serverUrl: string; clientId?: string; clientSecret?: string }) =>
      Promise<{ success: boolean; expiresAt?: string; scope?: string; error?: string; needsManualClient?: boolean }>
    serverOAuthDisconnect: (params: { serverId: string }) =>
      Promise<{ success: boolean; error?: string }>
    serverOAuthRefresh: (params: { serverId: string }) =>
      Promise<{ success: boolean; expiresAt?: string; error?: string }>

    // Secret management
    setSecret: (namespace: 'plugin' | 'server', id: string, headerName: string, value: string) =>
      Promise<{ success: true } | { success: false; error: string }>
    deleteSecrets: (namespace: 'plugin' | 'server', id: string) =>
      Promise<{ success: true } | { success: false; error: string }>

    // Skills
    listSkills: () => Promise<import('./src/types/plugin').LoadedSkill[] | { success: false; error: string }>
    saveSkill: (skill: { name: string; content: string }) =>
      Promise<{ success: true } | { success: false; error: string }>
    deleteSkill: (name: string) => Promise<{ success: true } | { success: false; error: string }>
  }
}

interface Window {
  n8nDesk?: N8nDeskBridge
}
