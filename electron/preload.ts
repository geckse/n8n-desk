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
  },
  api: {
    fetch: (url: string, options?: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number }) =>
      ipcRenderer.invoke('api:fetch', url, options),
  },
  keychain: {
    get: (key: string) =>
      ipcRenderer.invoke('keychain:get', key),
    set: (key: string, value: string) =>
      ipcRenderer.invoke('keychain:set', key, value),
    delete: (key: string) =>
      ipcRenderer.invoke('keychain:delete', key),
  },
})
