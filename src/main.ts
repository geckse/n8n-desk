import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { IonicVue } from '@ionic/vue'
import App from './App.vue'
import router, { setHydrated } from './router'
import { useSettingsStore } from './stores/settings'
import { useInstancesStore } from './stores/instances'
import { useAuthStore } from './stores/auth'
import { useTheme } from './composables/useTheme'
import { useChatStore } from './stores/chat'
import { useWorkflowSessionsStore } from './stores/workflow-sessions'
import { useCoworkSessionsStore } from './stores/cowork-sessions'
import { n8nHtml } from './directives/n8n-html'
import { i18n } from './i18n'

import 'highlight.js/styles/github-dark.css'
import './theme/global.scss'

const pinia = createPinia()

const app = createApp(App)
  .use(IonicVue)
  .use(pinia)
  .use(router)
  .use(i18n)
  .directive('n8n-html', n8nHtml)

// Hydrate stores BEFORE mounting the app so the router guard
// sees the correct state on the very first navigation.
async function bootstrap() {
  // 1. Hydrate settings (theme, locale, default instance, LLM config)
  const settingsStore = useSettingsStore()
  await settingsStore.hydrate()
  await settingsStore.hydrateLlm()
  const { init } = useTheme()
  init(settingsStore.theme)

  // 2. Hydrate instances
  const instancesStore = useInstancesStore()
  await instancesStore.hydrate()

  // 3. If an active instance exists, hydrate auth state and chat sessions
  if (instancesStore.activeInstanceId) {
    const authStore = useAuthStore()
    await authStore.hydrate(instancesStore.activeInstanceId)

    // 4. Hydrate chat store (session index) for the active instance
    const chatStore = useChatStore()
    await chatStore.hydrate()

    // 5. Hydrate workflow sessions store for the active instance
    const workflowSessionsStore = useWorkflowSessionsStore()
    await workflowSessionsStore.hydrate(instancesStore.activeInstanceId)

    // 6. Hydrate cowork sessions store for the active instance
    const coworkSessionsStore = useCoworkSessionsStore()
    await coworkSessionsStore.hydrate(instancesStore.activeInstanceId)
  }

  // Mark Electron for CSS safe area handling (macOS traffic lights)
  if (window.n8nDesk) {
    document.body.classList.add('electron-app')

    // Single global agent-event listener for the app lifetime. Events are
    // routed by sessionId inside the stores, so background sessions keep
    // streaming/persisting even when their view is not mounted (audit #23).
    // Session ids are unique across modes — exactly one store owns each event.
    window.n8nDesk.agent.onEvent((event) => {
      useWorkflowSessionsStore().handleAgentEvent(event)
      useCoworkSessionsStore().handleAgentEvent(event)
    })
  }

  // Signal to the router guard that stores are ready
  setHydrated()

  await router.isReady()
  app.mount('#app')
}

bootstrap()
