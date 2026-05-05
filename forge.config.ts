import type { ForgeConfig } from '@electron-forge/shared-types'
import { MakerZIP } from '@electron-forge/maker-zip'
import { MakerDMG } from '@electron-forge/maker-dmg'
import { MakerSquirrel } from '@electron-forge/maker-squirrel'
import { MakerDeb } from '@electron-forge/maker-deb'
import { MakerAppImage } from '@electron-forge/maker-appimage'

const isMac = process.platform === 'darwin'
const isWin = process.platform === 'win32'
const isLinux = process.platform === 'linux'

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    name: 'n8n-desk',
    executableName: 'n8n-desk',
    appBundleId: 'com.n8n-desk.app',
    extraResource: ['skills/plugins'],
    // TODO: add `icon` once branded .icns/.ico/.png assets land
  },
  makers: [
    new MakerZIP({}, ['darwin', 'linux', 'win32']),
    ...(isMac ? [new MakerDMG({ name: 'n8n-desk' })] : []),
    ...(isWin
      ? [
          new MakerSquirrel({
            name: 'n8n-desk',
            setupExe: 'n8n-desk-setup.exe',
          }),
        ]
      : []),
    ...(isLinux
      ? [
          new MakerDeb({
            options: {
              name: 'n8n-desk',
              productName: 'n8n-desk',
              bin: 'n8n-desk',
            },
          }),
          new MakerAppImage({
            options: {
              name: 'n8n-desk',
              productName: 'n8n-desk',
              bin: 'n8n-desk',
            },
          }),
        ]
      : []),
  ],
}

export default config
