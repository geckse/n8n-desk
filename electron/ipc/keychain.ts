import { ipcMain, safeStorage } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'

const BASE_DIR = path.join(os.homedir(), '.n8n-desk')

let encryptionAvailable: boolean | null = null

function isEncryptionAvailable(): boolean {
  if (encryptionAvailable === null) {
    encryptionAvailable = safeStorage.isEncryptionAvailable()
    if (!encryptionAvailable) {
      console.warn(
        '[keychain] safeStorage encryption not available. ' +
        'Tokens will be stored with file permissions only (0600). ' +
        'Install a keyring (e.g., gnome-keyring) for encrypted storage.'
      )
    }
  }
  return encryptionAvailable
}

function keyToPath(key: string): string {
  // Key format: "n8n-desk:inst_abc123" → instances/inst_abc123/tokens.enc
  const parts = key.split(':')
  if (parts.length === 2 && parts[0] === 'n8n-desk') {
    return path.join(BASE_DIR, 'instances', parts[1], 'tokens.enc')
  }
  // Fallback: store under a generic keychain dir
  const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, '_')
  return path.join(BASE_DIR, 'keychain', `${safeKey}.enc`)
}

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true, mode: 0o700 })
}

export function registerKeychainHandlers(): void {
  ipcMain.handle('keychain:get', async (_event, key: string): Promise<string | null> => {
    try {
      const filePath = keyToPath(key)
      const data = await fs.readFile(filePath)

      if (isEncryptionAvailable()) {
        return safeStorage.decryptString(data)
      }
      // Fallback: file was stored as plain UTF-8
      return data.toString('utf-8')
    } catch {
      return null
    }
  })

  ipcMain.handle('keychain:set', async (_event, key: string, value: string): Promise<void> => {
    const filePath = keyToPath(key)
    await ensureDir(path.dirname(filePath))

    if (isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(value)
      await fs.writeFile(filePath, encrypted, { mode: 0o600 })
    } else {
      // Fallback: store as plain text with restrictive permissions
      await fs.writeFile(filePath, value, { encoding: 'utf-8', mode: 0o600 })
    }
  })

  ipcMain.handle('keychain:delete', async (_event, key: string): Promise<void> => {
    try {
      const filePath = keyToPath(key)
      await fs.unlink(filePath)
    } catch {
      // File doesn't exist — nothing to delete
    }
  })
}
