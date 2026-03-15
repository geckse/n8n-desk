import { ipcMain, safeStorage } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'

const BASE_DIR = path.join(os.homedir(), '.n8n-desk')

interface FetchOptions {
  method?: string
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
}

interface FetchResult {
  status: number
  headers: Record<string, string>
  body: string
}

/**
 * When n8n auto-refreshes the session cookie, update the stored session token.
 * This keeps the REST API session alive transparently.
 */
async function handleCookieRefresh(url: string, setCookieHeaders: string[]): Promise<void> {
  const authCookie = setCookieHeaders
    .map((c) => c.split(';')[0])
    .find((c) => c.startsWith('n8n-auth='))

  if (!authCookie) return

  const newToken = authCookie.replace('n8n-auth=', '')
  if (!newToken) return

  // Find the instance by URL prefix
  const instancesDir = path.join(BASE_DIR, 'instances')
  try {
    const indexContent = await fs.readFile(path.join(instancesDir, 'index.json'), 'utf-8')
    const instanceIds = JSON.parse(indexContent) as string[]

    for (const id of instanceIds) {
      try {
        const configContent = await fs.readFile(path.join(instancesDir, id, 'instance.json'), 'utf-8')
        const config = JSON.parse(configContent) as { url: string }
        if (url.startsWith(config.url)) {
          // Update the session token for this instance
          const sessionData = JSON.stringify({ session_token: newToken })
          const sessionFilePath = path.join(instancesDir, id, 'session.enc')

          if (safeStorage.isEncryptionAvailable()) {
            const encrypted = safeStorage.encryptString(sessionData)
            await fs.writeFile(sessionFilePath, encrypted, { mode: 0o600 })
          } else {
            await fs.writeFile(sessionFilePath, sessionData, { encoding: 'utf-8', mode: 0o600 })
          }
          break
        }
      } catch {
        // Skip this instance
      }
    }
  } catch {
    // No instances index — nothing to update
  }
}

let handlersRegistered = false

export function registerApiProxyHandlers(): void {
  if (handlersRegistered) return
  handlersRegistered = true

  ipcMain.handle('api:fetch', async (_event, url: string, options?: FetchOptions): Promise<FetchResult> => {
    const response = await fetch(url, {
      method: options?.method ?? 'GET',
      headers: options?.headers,
      body: options?.body,
      redirect: 'manual',
      signal: AbortSignal.timeout(options?.timeoutMs ?? 30000),
    })

    const headers: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      headers[key] = value
    })

    const body = await response.text()

    // Auto-capture refreshed session cookies from n8n (best-effort, non-blocking)
    const setCookieHeaders = response.headers.getSetCookie?.() ?? []
    if (setCookieHeaders.length > 0) {
      void handleCookieRefresh(url, setCookieHeaders)
    }

    return { status: response.status, headers, body }
  })
}
