<script setup lang="ts">
import {
  IonItem, IonLabel,
  IonPage, IonRouterOutlet, IonAvatar,
  IonHeader, IonToolbar, IonButtons, IonButton,
  IonSegment, IonSegmentButton,
} from '@ionic/vue'
import { User, Settings, ChevronLeft, ChevronRight, Bot, Menu } from 'lucide-vue-next'
import { ref, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { usePlatform } from '@/composables/usePlatform'
import { useSidebarResize } from '@/composables/useSidebarResize'
import { useConnection } from '@/composables/useConnection'
import { useInstancesStore } from '@/stores/instances'
import { useAuthStore } from '@/stores/auth'
import { useSettingsStore } from '@/stores/settings'
import ChatSidebar from '@/components/sidebar/ChatSidebar.vue'
import CoworkSidebar from '@/components/sidebar/CoworkSidebar.vue'
import WorkflowSidebar from '@/components/sidebar/WorkflowSidebar.vue'
import InstanceSwitcher from '@/components/instance/InstanceSwitcher.vue'
import AppSettings from '@/components/settings/AppSettings.vue'
import ReLoginModal from '@/components/auth/ReLoginModal.vue'

const router = useRouter()
const route = useRoute()
const { t } = useI18n()
const { isMobile } = usePlatform()
const instancesStore = useInstancesStore()
const authStore = useAuthStore()
const settingsStore = useSettingsStore()
const { status: connectionStatus, startMonitoring } = useConnection()

const {
  sidebarWidth,
  isCollapsed,
  isResizing,
  onResizeStart,
  toggleCollapse,
} = useSidebarResize()

const mobileMenuOpen = ref(false)
const switcherOpen = ref(false)

const activeMode = ref(deriveMode())

// Start connection monitoring for the active instance
if (instancesStore.activeInstance) {
  startMonitoring(instancesStore.activeInstance.url)
}

// Computed: should we show Cowork/Workflow tabs?
const showAdvancedModes = computed(() => !isMobile.value && authStore.isFullAccess)

// Display info from stores
const displayName = computed(() => {
  const profile = authStore.userProfile
  if (profile?.firstName || profile?.lastName) {
    return [profile.firstName, profile.lastName].filter(Boolean).join(' ')
  }
  // Fallback to role name
  const role = authStore.userRole
  if (role === 'chatUser') return 'Chat User'
  if (role === 'member') return 'Member'
  if (role === 'admin') return 'Admin'
  if (role === 'owner') return 'Owner'
  return ''
})

const instanceLabel = computed(() => instancesStore.activeInstance?.label ?? '')
const instanceColor = computed(() => instancesStore.activeInstance?.color ?? '#ff6d5a')

function deriveMode(): string {
  const path = route.path
  if (path.startsWith('/cowork')) return 'cowork'
  if (path.startsWith('/workflow')) return 'workflow'
  return 'chat'
}

const availableModes = computed(() => {
  const modes = [{ value: 'chat', label: t('modes.chat') }]
  if (showAdvancedModes.value) {
    modes.push({ value: 'cowork', label: t('modes.cowork') })
    modes.push({ value: 'workflow', label: t('modes.workflow') })
  }
  return modes
})

function switchMode(mode: string) {
  activeMode.value = mode
  router.push(`/${mode}`)
}

function onModeChange(event: CustomEvent) {
  const mode = event.detail.value as string
  activeMode.value = mode
  router.push(`/${mode}`)
}

function openSettings() {
  settingsStore.openSettings()
  mobileMenuOpen.value = false
}

// Mobile drawer
function toggleMobileMenu() {
  mobileMenuOpen.value = !mobileMenuOpen.value
}

function closeMobileMenu() {
  mobileMenuOpen.value = false
}

const sidebarStyle = computed(() => ({
  width: `${sidebarWidth.value}px`,
  minWidth: `${sidebarWidth.value}px`,
}))

</script>

<template>
  <ion-page class="layout-root">
    <!-- ==================== DESKTOP TITLEBAR ==================== -->
    <header v-if="!isMobile" class="titlebar drag-region">
      <div class="titlebar-left">
        <button class="titlebar-btn no-drag" @click="$router.back()" :title="t('nav.back')">
          <ChevronLeft :size="16" />
        </button>
        <button class="titlebar-btn no-drag" @click="$router.forward()" :title="t('nav.forward')">
          <ChevronRight :size="16" />
        </button>
        <button
          class="titlebar-btn no-drag"
          @click="toggleCollapse()"
          :title="t('nav.toggleSidebar')"
        >
          <svg width="16" height="16" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="1" y="1" width="16" height="16" rx="2" stroke="currentColor" stroke-width="1.5" fill="none" />
            <line x1="6.5" y1="1" x2="6.5" y2="17" stroke="currentColor" stroke-width="1.5" />
          </svg>
        </button>
      </div>

      <div class="titlebar-center">
        <div class="mode-switcher no-drag">
          <button
            v-for="mode in availableModes"
            :key="mode.value"
            class="mode-btn"
            :class="{ 'mode-btn--active': activeMode === mode.value }"
            @click="switchMode(mode.value)"
          >
            {{ mode.label }}
          </button>
        </div>
      </div>

      <div class="titlebar-right">
        <button class="titlebar-btn no-drag" @click="openSettings" :title="t('nav.settings')">
          <Bot :size="16" />
        </button>
      </div>
    </header>

    <!-- ==================== DESKTOP BODY ==================== -->
    <div v-if="!isMobile" class="body-split">
      <aside
        class="sidebar"
        :class="{
          'sidebar--collapsed': isCollapsed,
          'sidebar--resizing': isResizing,
        }"
        :style="sidebarStyle"
      >
        <div class="sidebar-content">
          <div class="sidebar-inner">
            <ChatSidebar v-if="activeMode === 'chat'" />
            <CoworkSidebar v-else-if="activeMode === 'cowork'" />
            <WorkflowSidebar v-else />

            <div class="sidebar-section">
              <ion-item button lines="none" router-link="/showcase" style="font-size: var(--font-size--2xs); opacity: 0.5;">
                <ion-label>{{ t('sidebar.componentShowcase') }}</ion-label>
              </ion-item>
            </div>

            <div class="sidebar-footer">
              <ion-item
                id="instance-switcher-trigger"
                button
                lines="none"
                class="user-item"
                @click="switcherOpen = true"
              >
                <ion-avatar slot="start" class="user-avatar">
                  <div class="avatar-placeholder" :style="{ background: instanceColor }">
                    <User :size="16" />
                  </div>
                </ion-avatar>
                <ion-label>
                  <h3>{{ displayName || 'User' }}</h3>
                  <p>{{ instanceLabel || 'Not connected' }}</p>
                </ion-label>
                <div slot="end" class="footer-actions">
                  <div
                    class="connection-dot"
                    :class="{
                      'connection-dot--connected': connectionStatus === 'connected',
                      'connection-dot--reconnecting': connectionStatus === 'reconnecting',
                      'connection-dot--disconnected': connectionStatus === 'disconnected',
                    }"
                  />
                  <Settings :size="18" class="settings-icon" @click.stop="openSettings" />
                </div>
              </ion-item>

              <InstanceSwitcher
                v-model:is-open="switcherOpen"
                trigger="instance-switcher-trigger"
              />
            </div>
          </div>
        </div>

        <div
          v-if="!isCollapsed"
          class="resize-handle"
          @mousedown="onResizeStart"
        />
      </aside>

      <ion-page class="main-content">
        <div
          v-if="connectionStatus === 'reconnecting' || connectionStatus === 'disconnected'"
          class="connection-banner"
          :class="{ 'connection-banner--disconnected': connectionStatus === 'disconnected' }"
        >
          {{ connectionStatus === 'reconnecting'
            ? t('connection.reconnecting', { label: instanceLabel })
            : t('connection.disconnected')
          }}
        </div>

        <ion-router-outlet />
      </ion-page>
    </div>

    <!-- ==================== MOBILE LAYOUT ==================== -->
    <template v-if="isMobile">
      <!-- Mobile backdrop -->
      <div
        v-if="mobileMenuOpen"
        class="mobile-backdrop"
        @click="closeMobileMenu"
      />

      <!-- Mobile drawer -->
      <aside
        class="mobile-drawer"
        :class="{ 'mobile-drawer--open': mobileMenuOpen }"
      >
        <div class="sidebar-inner">
          <ChatSidebar v-if="activeMode === 'chat'" />
          <CoworkSidebar v-else-if="activeMode === 'cowork'" />
          <WorkflowSidebar v-else />

          <div class="sidebar-footer">
            <ion-item
              id="instance-switcher-trigger-mobile"
              button
              lines="none"
              class="user-item"
              @click="switcherOpen = true"
            >
              <ion-avatar slot="start" class="user-avatar">
                <div class="avatar-placeholder" :style="{ background: instanceColor }">
                  <User :size="16" />
                </div>
              </ion-avatar>
              <ion-label>
                <h3>{{ displayName || 'User' }}</h3>
                <p>{{ instanceLabel || 'Not connected' }}</p>
              </ion-label>
              <div slot="end" class="footer-actions">
                <div
                  class="connection-dot"
                  :class="{
                    'connection-dot--connected': connectionStatus === 'connected',
                    'connection-dot--reconnecting': connectionStatus === 'reconnecting',
                    'connection-dot--disconnected': connectionStatus === 'disconnected',
                  }"
                />
                <Settings :size="18" class="settings-icon" @click.stop="openSettings" />
              </div>
            </ion-item>

            <InstanceSwitcher
              v-model:is-open="switcherOpen"
              trigger="instance-switcher-trigger-mobile"
            />
          </div>
        </div>
      </aside>

      <!-- Mobile main content -->
      <ion-page class="main-content">
        <ion-header>
          <ion-toolbar>
            <ion-buttons slot="start">
              <ion-button fill="clear" @click="toggleMobileMenu">
                <Menu :size="22" />
              </ion-button>
            </ion-buttons>

            <ion-segment
              :value="activeMode"
              mode="ios"
              class="mobile-segment"
              @ion-change="onModeChange"
            >
              <ion-segment-button value="chat">
                <ion-label>{{ t('modes.chat') }}</ion-label>
              </ion-segment-button>
              <ion-segment-button v-if="authStore.isFullAccess" value="cowork">
                <ion-label>{{ t('modes.cowork') }}</ion-label>
              </ion-segment-button>
              <ion-segment-button v-if="authStore.isFullAccess" value="workflow">
                <ion-label>{{ t('modes.workflow') }}</ion-label>
              </ion-segment-button>
            </ion-segment>

            <ion-buttons slot="end">
              <ion-button fill="clear" @click="openSettings">
                <Settings :size="20" />
              </ion-button>
            </ion-buttons>
          </ion-toolbar>
        </ion-header>

        <div
          v-if="connectionStatus === 'reconnecting' || connectionStatus === 'disconnected'"
          class="connection-banner"
          :class="{ 'connection-banner--disconnected': connectionStatus === 'disconnected' }"
        >
          {{ connectionStatus === 'reconnecting'
            ? t('connection.reconnecting', { label: instanceLabel })
            : t('connection.disconnected')
          }}
        </div>

        <ion-router-outlet />
      </ion-page>
    </template>

    <!-- Settings Modal -->
    <AppSettings
      :is-open="settingsStore.settingsOpen"
      @update:is-open="(v: boolean) => v ? settingsStore.openSettings() : settingsStore.closeSettings()"
    />

    <!-- Re-Login Modal (session expired) -->
    <ReLoginModal
      :is-open="authStore.sessionExpired"
      @update:is-open="(v: boolean) => { if (!v) authStore.clearSessionExpired() }"
    />
  </ion-page>
</template>

<style scoped lang="scss">
// --- Layout Root ---
.layout-root {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
  position: absolute;
  inset: 0;
}

// --- Electron window drag ---
.drag-region {
  -webkit-app-region: drag;
}

.no-drag {
  -webkit-app-region: no-drag;
}

// --- Titlebar ---
.titlebar {
  display: flex;
  align-items: center;
  height: 38px;
  min-height: 38px;
  padding: 0 12px;
  // Leave room for macOS traffic lights
  padding-left: 78px;
  background: var(--n8n-desk--sidebar-bg);
  border-bottom: 1px solid var(--border-color--subtle);
  flex-shrink: 0;
  gap: 4px;
}

.titlebar-left {
  display: flex;
  align-items: center;
  gap: 2px;
}

.titlebar-center {
  flex: 1;
  display: flex;
  justify-content: center;
}

.titlebar-right {
  display: flex;
  align-items: center;
  gap: 2px;
}

.titlebar-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color--text--tint-1);
  cursor: pointer;
  padding: 0;
  transition: background 0.12s ease, color 0.12s ease;

  &:hover {
    background: var(--n8n-desk--surface-bg);
    color: var(--color--text);
  }

  &:active {
    background: var(--n8n-desk--surface-raised-bg);
  }
}

// --- Mode Switcher ---
.mode-switcher {
  display: flex;
  align-items: center;
  gap: 2px;
  background: var(--n8n-desk--content-bg);
  border-radius: 8px;
  padding: 2px;
}

.mode-btn {
  border: none;
  background: transparent;
  color: var(--color--text--tint-1);
  font-size: 12px;
  font-weight: 500;
  padding: 4px 14px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
  white-space: nowrap;
  line-height: 1;

  &:hover:not(.mode-btn--active) {
    color: var(--color--text);
  }

  &--active {
    background: var(--n8n-desk--surface-raised-bg);
    color: var(--color--text);
  }
}

// --- Body Split ---
.body-split {
  display: flex;
  flex-direction: row;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

// --- Sidebar ---
.sidebar {
  position: relative;
  display: flex;
  flex-shrink: 0;
  background: var(--n8n-desk--sidebar-bg);
  border-right: 1px solid var(--border-color--subtle);
  overflow: hidden;
  transition: width 0.2s ease, min-width 0.2s ease;

  &--resizing {
    transition: none;
  }

  &--collapsed {
    width: 0 !important;
    min-width: 0 !important;
    border-right: none;
  }
}

.sidebar-content {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.sidebar-inner {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 200px;
}

.sidebar-section {
  padding: var(--spacing--2xs) var(--spacing--xs);
}

// --- Sidebar Footer ---
.sidebar-footer {
  border-top: 1px solid var(--border-color--subtle);
  padding: var(--spacing--2xs) var(--spacing--xs);
}

.user-item {
  --background: transparent;
  --min-height: 48px;
  --padding-start: var(--spacing--2xs);
  border-radius: var(--radius--xs);
  overflow: hidden;

  &:hover {
    --background: var(--n8n-desk--surface-raised-bg);
  }

  ion-label {
    h3, p {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }
}

.user-avatar {
  width: 32px;
  height: 32px;
}

.avatar-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color--neutral-white);
  border-radius: 50%;
  font-size: 16px;
}

.footer-actions {
  display: flex;
  align-items: center;
  gap: var(--spacing--xs);
}

.settings-icon {
  color: var(--color--text--tint-1);
  cursor: pointer;

  &:hover {
    color: var(--color--text);
  }
}

// --- Connection Dot ---
.connection-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;

  &--connected {
    background: var(--color--success);
  }

  &--reconnecting {
    background: var(--color--warning);
    animation: pulse 1.5s ease-in-out infinite;
  }

  &--disconnected {
    background: var(--color--danger);
  }
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

// --- Connection Banner ---
.connection-banner {
  background: var(--color--warning--tint-1, #fef3cd);
  color: var(--color--warning--shade-1, #856404);
  padding: var(--spacing--3xs) var(--spacing--sm);
  font-size: var(--font-size--2xs);
  text-align: center;

  &--disconnected {
    background: var(--color--danger--tint-1, #f8d7da);
    color: var(--color--danger--shade-1, #721c24);
  }
}

// --- Resize Handle ---
.resize-handle {
  position: absolute;
  top: 0;
  right: -2px;
  width: 5px;
  height: 100%;
  cursor: ew-resize;
  z-index: 10;

  &::after {
    content: '';
    position: absolute;
    top: 0;
    left: 2px;
    width: 1px;
    height: 100%;
    background: transparent;
    transition: background 0.15s ease;
  }

  &:hover::after {
    background: var(--color--primary);
  }
}

// --- Mobile Drawer ---
.mobile-drawer {
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  width: 300px;
  background: var(--n8n-desk--sidebar-bg);
  border-right: 1px solid var(--border-color--subtle);
  z-index: 100;
  transform: translateX(-100%);
  transition: transform 0.25s ease;
  padding-top: var(--ion-safe-area-top, 0);

  .sidebar-inner {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  &--open {
    transform: translateX(0);
  }
}

.mobile-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 99;
}

// --- Mobile Segment ---
.mobile-segment {
  max-width: 240px;
}

// --- Main Content ---
.main-content {
  flex: 1;
  min-width: 0;
  position: relative !important;
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  contain: layout size style;
}
</style>
