import { createRouter, createWebHistory } from '@ionic/vue-router'
import type { RouteRecordRaw } from 'vue-router'
import MenuLayout from '@/views/MenuLayout.vue'
import { useInstancesStore } from '@/stores/instances'
import { useAuthStore } from '@/stores/auth'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    redirect: '/chat',
  },
  {
    path: '/',
    component: MenuLayout,
    children: [
      {
        path: 'chat',
        component: () => import('@/views/ChatView.vue'),
      },
      {
        path: 'cowork',
        component: () => import('@/views/CoworkView.vue'),
      },
      {
        path: 'workflow',
        component: () => import('@/views/WorkflowView.vue'),
      },
    ],
  },
  {
    path: '/onboarding',
    component: () => import('@/views/OnboardingView.vue'),
  },
  {
    path: '/showcase',
    component: () => import('@/views/ComponentShowcaseView.vue'),
  },
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})

// --- Hydration gate ---
// Stores must be hydrated before the guard can make decisions.
// Without this, the first navigation always sees empty stores → redirects to onboarding.
let hydrated = false
let hydratedResolve: (() => void) | null = null
const hydratedPromise = new Promise<void>((resolve) => {
  hydratedResolve = resolve
})

export function setHydrated(): void {
  hydrated = true
  hydratedResolve?.()
}

// --- Auth navigation guard ---
router.beforeEach(async (to) => {
  // Skip guard for onboarding and showcase routes
  if (to.path === '/onboarding' || to.path === '/showcase') {
    return true
  }

  // Wait for stores to be hydrated before checking auth state
  if (!hydrated) {
    await hydratedPromise
  }

  const instancesStore = useInstancesStore()
  const authStore = useAuthStore()

  // No instances configured → redirect to onboarding
  if (!instancesStore.hasInstances) {
    return '/onboarding'
  }

  // Instances exist but not authenticated → redirect to onboarding
  if (!authStore.isAuthenticated) {
    return '/onboarding'
  }

  // chatUser trying to access Cowork or Workflow → redirect to Chat
  if (!authStore.isFullAccess && (to.path === '/cowork' || to.path === '/workflow')) {
    return '/chat'
  }

  return true
})

export default router
