import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { IonicVue } from '@ionic/vue'
import App from './App.vue'
import router, { setHydrated } from './router'
import { useSettingsStore } from './stores/settings'
import { useInstancesStore } from './stores/instances'
import { useAuthStore } from './stores/auth'
import { useTheme } from './composables/useTheme'
import { i18n } from './i18n'

import './theme/global.scss'

const pinia = createPinia()

const app = createApp(App)
  .use(IonicVue)
  .use(pinia)
  .use(router)
  .use(i18n)

// Hydrate stores BEFORE mounting the app so the router guard
// sees the correct state on the very first navigation.
async function bootstrap() {
  // 1. Hydrate settings (theme, locale, default instance)
  const settingsStore = useSettingsStore()
  await settingsStore.hydrate()
  const { init } = useTheme()
  init(settingsStore.theme)

  // 2. Hydrate instances
  const instancesStore = useInstancesStore()
  await instancesStore.hydrate()

  // 3. If an active instance exists, hydrate auth state
  if (instancesStore.activeInstanceId) {
    const authStore = useAuthStore()
    await authStore.hydrate(instancesStore.activeInstanceId)
  }

  // Mark Electron for CSS safe area handling (macOS traffic lights)
  if (window.n8nDesk) {
    document.body.classList.add('electron-app')
  }

  // Signal to the router guard that stores are ready
  setHydrated()

  await router.isReady()
  app.mount('#app')
}

bootstrap()
