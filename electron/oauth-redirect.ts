import http from 'http'
import { app } from 'electron'

interface OAuthCallback {
  code: string
  state: string
}

interface RedirectListener {
  redirectUri: string
  waitForCallback: () => Promise<OAuthCallback>
  cleanup: () => void
}

// --- Shared state for protocol handler ---

let pendingResolve: ((value: OAuthCallback) => void) | null = null
let pendingReject: ((reason: Error) => void) | null = null

/**
 * Handle an OAuth callback URL from the custom protocol handler.
 * Called from main.ts when open-url or second-instance fires.
 */
export function handleCallbackUrl(callbackUrl: string): boolean {
  if (!pendingResolve) return false

  try {
    const url = new URL(callbackUrl)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const error = url.searchParams.get('error')

    if (error) {
      const reject = pendingReject
      pendingResolve = null
      pendingReject = null
      reject?.(new Error(`OAuth error: ${error}`))
      return true
    }

    if (!code || !state) {
      return false
    }

    const resolve = pendingResolve
    pendingResolve = null
    pendingReject = null
    resolve({ code, state })
    return true
  } catch {
    return false
  }
}

/**
 * Start a localhost HTTP server on a random port to receive the OAuth callback.
 * Returns a promise that resolves once the server is listening and the port is known.
 */
function startLocalhostServer(): Promise<RedirectListener> {
  return new Promise<RedirectListener>((resolveListener) => {
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null
    let server: http.Server | null = null

    const callbackPromise = new Promise<OAuthCallback>((resolveCallback, rejectCallback) => {
      server = http.createServer((req, res) => {
        if (!req.url?.startsWith('/callback')) {
          res.writeHead(404)
          res.end('Not found')
          return
        }

        const fullUrl = `http://localhost${req.url}`
        const url = new URL(fullUrl)
        const code = url.searchParams.get('code')
        const state = url.searchParams.get('state')
        const error = url.searchParams.get('error')

        // Respond with a page the user can close
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(`<!DOCTYPE html>
<html>
<head><title>n8n-desk</title></head>
<body style="font-family: system-ui; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #1a1a2e; color: #e0e0e0;">
  <div style="text-align: center;">
    <h2>${error ? 'Authentication Failed' : 'Authentication Successful'}</h2>
    <p>${error ? 'Please return to n8n-desk and try again.' : 'You can close this window and return to n8n-desk.'}</p>
  </div>
</body>
</html>`)

        if (error) {
          rejectCallback(new Error(`OAuth error: ${error}`))
        } else if (code && state) {
          resolveCallback({ code, state })
        } else {
          rejectCallback(new Error('Missing code or state in callback'))
        }
      })

      // 5-minute timeout
      timeoutHandle = setTimeout(() => {
        rejectCallback(new Error('OAuth callback timed out after 5 minutes'))
      }, 5 * 60 * 1000)

      // Listen on port 0 = OS picks a random available port
      server.listen(0, '127.0.0.1', () => {
        const addr = server!.address()
        const port = typeof addr === 'object' && addr ? addr.port : 0

        console.log(`[oauth-redirect] Localhost callback server listening on port ${port}`)

        const cleanup = () => {
          if (timeoutHandle) {
            clearTimeout(timeoutHandle)
            timeoutHandle = null
          }
          if (server) {
            server.close()
            server = null
          }
        }

        callbackPromise.finally(cleanup)

        resolveListener({
          redirectUri: `http://127.0.0.1:${port}/callback`,
          waitForCallback: () => callbackPromise,
          cleanup,
        })
      })
    })
  })
}

/**
 * Start a redirect listener.
 *
 * In production: tries the n8ndesk:// custom protocol first, falls back to localhost.
 * In dev: always uses localhost (custom protocol opens a new Electron process in dev).
 */
export async function startOAuthRedirectListener(options?: { forceLocalhost?: boolean }): Promise<RedirectListener> {
  const isDev = !app.isPackaged

  // In production, try custom protocol first (unless forceLocalhost is set)
  if (!isDev && !options?.forceLocalhost && app.isDefaultProtocolClient('n8ndesk')) {
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null

    const callbackPromise = new Promise<OAuthCallback>((resolve, reject) => {
      pendingResolve = resolve
      pendingReject = reject

      timeoutHandle = setTimeout(() => {
        pendingResolve = null
        pendingReject = null
        reject(new Error('OAuth callback timed out after 5 minutes'))
      }, 5 * 60 * 1000)
    })

    const cleanup = () => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle)
        timeoutHandle = null
      }
      pendingResolve = null
      pendingReject = null
    }

    callbackPromise.finally(cleanup)

    return {
      redirectUri: 'n8ndesk://callback',
      waitForCallback: () => callbackPromise,
      cleanup,
    }
  }

  // Dev mode or protocol not registered: use localhost server
  if (isDev) {
    console.log('[oauth-redirect] Dev mode — using localhost callback server')
  } else {
    console.log('[oauth-redirect] Custom protocol not registered — using localhost callback server')
  }

  return startLocalhostServer()
}
