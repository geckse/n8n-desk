import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('n8nDesk', {
  agent: {
    invoke: (sessionId: string, message: string) =>
      ipcRenderer.invoke('agent:invoke', sessionId, message),
    stop: (sessionId: string) =>
      ipcRenderer.invoke('agent:stop', sessionId),
    approve: (sessionId: string, decision: 'approve' | 'reject') =>
      ipcRenderer.invoke('agent:approve', sessionId, decision),
    testConnection: () =>
      ipcRenderer.invoke('agent:test-connection'),
    onEvent: (callback: (event: unknown) => void) => {
      const listener = (_ipcEvent: Electron.IpcRendererEvent, data: unknown) => callback(data)
      ipcRenderer.on('agent:event', listener)
      return () => {
        ipcRenderer.removeListener('agent:event', listener)
      }
    },
  },
  storage: {
    read: (path: string) =>
      ipcRenderer.invoke('storage:read', path),
    write: (path: string, data: string) =>
      ipcRenderer.invoke('storage:write', path, data),
    append: (path: string, line: string) =>
      ipcRenderer.invoke('storage:append', path, line),
  },
  auth: {
    login: (instanceUrl: string, options?: { forceLocalhost?: boolean }) =>
      ipcRenderer.invoke('auth:login', instanceUrl, options),
    logout: (instanceId: string) =>
      ipcRenderer.invoke('auth:logout', instanceId),
    refresh: (instanceId: string) =>
      ipcRenderer.invoke('auth:refresh', instanceId),
    credentialLogin: (instanceId: string, credentials: { email: string; password: string; mfaCode?: string }) =>
      ipcRenderer.invoke('auth:credential-login', instanceId, credentials),
    getSessionToken: (instanceId: string) =>
      ipcRenderer.invoke('auth:get-session-token', instanceId),
    getBrowserId: (instanceId: string) =>
      ipcRenderer.invoke('auth:get-browser-id', instanceId),
    syncCookie: (instanceId: string) =>
      ipcRenderer.invoke('auth:sync-cookie', instanceId),
  },
  api: {
    fetch: (url: string, options?: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number }) =>
      ipcRenderer.invoke('api:fetch', url, options),
  },
  push: {
    connect: (instanceId: string, instanceUrl: string) =>
      ipcRenderer.invoke('push:connect', instanceId, instanceUrl),
    disconnect: () =>
      ipcRenderer.invoke('push:disconnect'),
    onEvent: (callback: (raw: string) => void) => {
      ipcRenderer.on('push:event', (_event, data) => callback(data))
    },
    onStatus: (callback: (status: string) => void) => {
      ipcRenderer.on('push:status', (_event, status) => callback(status))
    },
  },
  keychain: {
    get: (key: string) =>
      ipcRenderer.invoke('keychain:get', key),
    set: (key: string, value: string) =>
      ipcRenderer.invoke('keychain:set', key, value),
    delete: (key: string) =>
      ipcRenderer.invoke('keychain:delete', key),
  },
  plugins: {
    // Marketplace
    marketplaceList: () =>
      ipcRenderer.invoke('plugins:marketplace-list'),
    marketplaceAdd: (source: { source: 'github' | 'url' | 'local'; repo?: string; url?: string; ref?: string }) =>
      ipcRenderer.invoke('plugins:marketplace-add', source),
    marketplaceRemove: (id: string) =>
      ipcRenderer.invoke('plugins:marketplace-remove', id),
    marketplaceRefresh: (id: string) =>
      ipcRenderer.invoke('plugins:marketplace-refresh', id),

    // Browse
    browse: (marketplaceId?: string) =>
      ipcRenderer.invoke('plugins:browse', marketplaceId),

    // Plugin lifecycle
    installedList: () =>
      ipcRenderer.invoke('plugins:installed-list'),
    install: (name: string, marketplaceId: string) =>
      ipcRenderer.invoke('plugins:install', name, marketplaceId),
    uninstall: (id: string) =>
      ipcRenderer.invoke('plugins:uninstall', id),
    enable: (id: string) =>
      ipcRenderer.invoke('plugins:enable', id),
    disable: (id: string) =>
      ipcRenderer.invoke('plugins:disable', id),
    previewInstall: (name: string, marketplaceId: string) =>
      ipcRenderer.invoke('plugins:preview-install', name, marketplaceId),

    // Standalone MCP servers
    serversList: () =>
      ipcRenderer.invoke('plugins:servers-list'),
    serversAdd: (config: { name: string; description?: string; url: string; authType?: 'static-headers' | 'oauth'; headerNames?: string[]; enabled: boolean; requireApproval: boolean }) =>
      ipcRenderer.invoke('plugins:servers-add', config),
    serversUpdate: (id: string, updates: Record<string, unknown>) =>
      ipcRenderer.invoke('plugins:servers-update', id, updates),
    serversRemove: (id: string) =>
      ipcRenderer.invoke('plugins:servers-remove', id),
    serversTest: (url: string, headers: Record<string, string>) =>
      ipcRenderer.invoke('plugins:servers-test', url, headers),
    serversTestById: (serverId: string) =>
      ipcRenderer.invoke('plugins:servers-test-by-id', serverId),

    // Secret management
    setSecret: (namespace: 'plugin' | 'server', id: string, headerName: string, value: string) =>
      ipcRenderer.invoke('plugins:set-secret', namespace, id, headerName, value),
    deleteSecrets: (namespace: 'plugin' | 'server', id: string) =>
      ipcRenderer.invoke('plugins:delete-secrets', namespace, id),

    // Server OAuth
    serverProbeOAuth: (serverUrl: string) =>
      ipcRenderer.invoke('plugins:server-probe-oauth', { serverUrl }),
    serverOAuthConnect: (params: { serverId: string; serverUrl: string; clientId?: string; clientSecret?: string }) =>
      ipcRenderer.invoke('plugins:server-oauth-connect', params),
    serverOAuthDisconnect: (params: { serverId: string }) =>
      ipcRenderer.invoke('plugins:server-oauth-disconnect', params),
    serverOAuthRefresh: (params: { serverId: string }) =>
      ipcRenderer.invoke('plugins:server-oauth-refresh', params),

    // Skills
    listSkills: () =>
      ipcRenderer.invoke('plugins:list-skills'),
    saveSkill: (skill: { name: string; content: string }) =>
      ipcRenderer.invoke('plugins:save-skill', skill),
    deleteSkill: (name: string) =>
      ipcRenderer.invoke('plugins:delete-skill', name),
  },
})
