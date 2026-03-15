import { useAuthStore } from '@/stores/auth'
import { useInstancesStore } from '@/stores/instances'

export class N8nApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`n8n API error ${status}: ${body}`)
    this.name = 'N8nApiError'
  }
}

/**
 * Fetch wrapper that uses IPC proxy in Electron (bypasses CORS)
 * or falls back to native fetch in browser.
 */
async function proxyFetch(url: string, options?: RequestInit): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  if (window.n8nDesk) {
    // Route through Electron main process — no CORS issues
    const headers: Record<string, string> = {}
    if (options?.headers) {
      const h = options.headers
      if (h instanceof Headers) {
        h.forEach((value, key) => { headers[key] = value })
      } else if (Array.isArray(h)) {
        for (const [key, value] of h) { headers[key] = value }
      } else {
        Object.assign(headers, h)
      }
    }

    return window.n8nDesk.api.fetch(url, {
      method: options?.method,
      headers,
      body: options?.body as string | undefined,
      timeoutMs: 30000,
    })
  }

  // Fallback for browser dev (no Electron)
  const response = await fetch(url, options)
  const responseHeaders: Record<string, string> = {}
  response.headers.forEach((value, key) => { responseHeaders[key] = value })
  const body = await response.text()
  return { status: response.status, headers: responseHeaders, body }
}

export class N8nApiClient {
  private isRefreshing = false

  constructor(
    private baseUrl: string,
    private getMcpToken: () => string | null,
    private getSessionToken: () => string | null,
    private onRefreshNeeded: () => Promise<boolean>,
    private onSessionExpired?: () => void,
  ) {}

  async request<T>(path: string, options?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<T> {
    const response = await this.doFetch(path, options)

    if (response.status === 401 && !this.isRefreshing) {
      const isRestApi = path.startsWith('/rest/') || path.startsWith('/chat/')

      if (isRestApi) {
        // REST API session expired — signal re-login needed
        this.onSessionExpired?.()
        throw new N8nApiError(401, 'Session expired. Please sign in again.')
      }

      // MCP token — attempt refresh, then retry once
      this.isRefreshing = true
      try {
        const refreshed = await this.onRefreshNeeded()
        if (refreshed) {
          const retryResponse = await this.doFetch(path, options)
          if (retryResponse.status < 200 || retryResponse.status >= 300) {
            throw new N8nApiError(retryResponse.status, retryResponse.body)
          }
          return this.parseJson<T>(retryResponse)
        }
      } finally {
        this.isRefreshing = false
      }
      throw new N8nApiError(401, 'Authentication failed after token refresh')
    }

    if (response.status < 200 || response.status >= 300) {
      throw new N8nApiError(response.status, response.body)
    }

    return this.parseJson<T>(response)
  }

  private parseJson<T>(response: { status: number; headers: Record<string, string>; body: string }): T {
    if (response.status === 204 || !response.body) {
      return undefined as unknown as T
    }
    const contentType = response.headers['content-type'] ?? ''
    if (!contentType.includes('application/json')) {
      return undefined as unknown as T
    }
    return JSON.parse(response.body) as T
  }

  private async doFetch(
    path: string,
    options?: { method?: string; headers?: Record<string, string>; body?: string },
  ): Promise<{ status: number; headers: Record<string, string>; body: string }> {
    const headers: Record<string, string> = { ...options?.headers }

    // Choose auth method based on the endpoint:
    // - /rest/* and /chat/* use session cookie (n8n-auth JWT)
    // - /mcp-server/* uses Bearer token (MCP OAuth)
    const isRestApi = path.startsWith('/rest/') || path.startsWith('/chat/')
    const sessionToken = this.getSessionToken()
    const mcpToken = this.getMcpToken()

    if (isRestApi && sessionToken) {
      headers['Cookie'] = `n8n-auth=${sessionToken}`
    } else if (mcpToken) {
      headers['Authorization'] = `Bearer ${mcpToken}`
    }

    if (!headers['Content-Type'] && options?.body) {
      headers['Content-Type'] = 'application/json'
    }

    return proxyFetch(`${this.baseUrl}${path}`, {
      method: options?.method ?? 'GET',
      headers,
      body: options?.body,
    })
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'GET' })
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  }

  async patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'PATCH',
      body: JSON.stringify(body),
    })
  }

  async delete(path: string): Promise<void> {
    await this.request<void>(path, { method: 'DELETE' })
  }
}

/**
 * Create an N8nApiClient bound to the current active instance.
 */
export function createApiClient(): N8nApiClient | null {
  const instancesStore = useInstancesStore()
  const authStore = useAuthStore()

  const instance = instancesStore.activeInstance
  if (!instance) return null

  return new N8nApiClient(
    instance.url,
    () => authStore.accessToken,
    () => authStore.sessionToken,
    async () => {
      const result = await authStore.refresh(instance.id)
      return result.success
    },
    () => authStore.markSessionExpired(),
  )
}
