import { app, BrowserWindow } from 'electron'
import path from 'path'
import { registerStorageHandlers } from './ipc/storage'
import { registerAuthHandlers } from './ipc/auth'
import { registerAgentHandlers } from './ipc/agent'
import { registerKeychainHandlers } from './ipc/keychain'
import { registerApiProxyHandlers } from './ipc/api-proxy'
import { registerPushProxyHandlers } from './ipc/push-proxy'
import { registerPluginHandlers } from './ipc/plugins'
import { handleCallbackUrl } from './oauth-redirect'

let mainWindow: BrowserWindow | null = null
const isDev = !app.isPackaged

// --- Custom Protocol Registration ---
// Only register in production — in dev, the protocol opens a new Electron process
// (the default welcome page) instead of routing to the running dev instance.
// Dev mode always uses the localhost HTTP server fallback.
if (!isDev) {
  app.setAsDefaultProtocolClient('n8ndesk')
}

// --- Single Instance Lock (required for Windows/Linux protocol handling) ---
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  // Windows/Linux: protocol URL arrives via second-instance event
  app.on('second-instance', (_event, commandLine) => {
    const url = commandLine.find((arg) => arg.startsWith('n8ndesk://'))
    if (url) {
      handleCallbackUrl(url)
    }

    // Bring window to front
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  // macOS: protocol URL arrives via open-url event
  app.on('open-url', (event, url) => {
    event.preventDefault()
    handleCallbackUrl(url)

    // Bring window to front
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  // --- IPC Handler Registration ---
  // Register once, before any window is created, to prevent double-registration on macOS activate
  app.whenReady().then(() => {
    registerStorageHandlers()
    registerAuthHandlers()
    registerKeychainHandlers()
    registerApiProxyHandlers()
    registerPushProxyHandlers()
    registerPluginHandlers()

    createWindow()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('activate', () => {
    if (mainWindow === null) {
      createWindow()
    }
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 480,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
    titleBarStyle: 'hiddenInset',
    show: false,
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  // Agent handlers need the mainWindow reference for event streaming
  registerAgentHandlers(mainWindow)

  // In dev, load from Vite dev server; in prod, load built files
  if (isDev) {
    const devUrl = 'http://localhost:5173'
    const loadDevServer = async () => {
      for (let i = 0; i < 30; i++) {
        try {
          await mainWindow!.loadURL(devUrl)
          return
        } catch {
          await new Promise((r) => setTimeout(r, 1000))
        }
      }
      console.error('Failed to connect to Vite dev server at', devUrl)
      app.quit()
    }
    loadDevServer()
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}
