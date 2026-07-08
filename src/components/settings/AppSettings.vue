<script setup lang="ts">
import { IonInput, IonSelect, IonSelectOption, IonButton } from '@ionic/vue'
import { ref, reactive, watch, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Settings as SettingsIcon, Trash2, Bot, Zap, Plug, Package, ShieldCheck,
  CheckCircle2, TriangleAlert, RefreshCw, Loader2,
} from 'lucide-vue-next'
import SettingsModal from '@/components/ui/SettingsModal.vue'
import SettingsNavGroup from '@/components/ui/SettingsNavGroup.vue'
import SettingsNavItem from '@/components/ui/SettingsNavItem.vue'
import LlmSettings from '@/components/settings/LlmSettings.vue'
import SkillsSettings from '@/components/settings/SkillsSettings.vue'
import ConnectorsSettings from '@/components/settings/ConnectorsSettings.vue'
import PluginsSettings from '@/components/settings/PluginsSettings.vue'
import ToolApprovalSettings from '@/components/settings/ToolApprovalSettings.vue'
import { useSettingsStore } from '@/stores/settings'
import { useInstancesStore } from '@/stores/instances'
import { useAuthStore } from '@/stores/auth'
import { useTheme } from '@/composables/useTheme'
import { useInstanceReconnect } from '@/composables/useInstanceReconnect'
import { useInstanceSwitch } from '@/composables/useInstanceSwitch'
import type { ThemeMode, SupportedLocale } from '@/types/settings'
import type { McpStatusResult } from '@/types/mcp'

const props = defineProps<{
  isOpen: boolean
}>()

const emit = defineEmits<{
  'update:isOpen': [value: boolean]
}>()

const { t } = useI18n()
const settingsStore = useSettingsStore()
const instancesStore = useInstancesStore()
const authStore = useAuthStore()
const { applyTheme } = useTheme()

const activeSection = ref(settingsStore.settingsSection ?? 'general')

// --- Draft state (editable copies, saved on "Save") ---
const draft = reactive({
  theme: settingsStore.theme as ThemeMode,
  locale: settingsStore.locale as SupportedLocale,
  instances: [] as Array<{ id: string; label: string; color: string; url: string }>,
})

const PRESET_COLORS = [
  '#ff6d5a', '#7c3aed', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899',
]

// Reset draft when modal opens
watch(() => props.isOpen, async (open) => {
  if (open) {
    activeSection.value = settingsStore.settingsSection ?? 'general'
    await settingsStore.hydrateLlm()
    draft.theme = settingsStore.theme
    draft.locale = settingsStore.locale
    draft.instances = instancesStore.instances.map((i) => ({
      id: i.id,
      label: i.label,
      color: i.color,
      url: i.url,
    }))
  }
})

// --- Currently selected instance (for instance section) ---
const selectedInstanceId = computed(() => {
  if (activeSection.value.startsWith('instance:')) {
    return activeSection.value.replace('instance:', '')
  }
  return null
})

const selectedInstanceDraft = computed(() => {
  if (!selectedInstanceId.value) return null
  return draft.instances.find((i) => i.id === selectedInstanceId.value) ?? null
})

// --- Instance connection status + reconnect ---
const { reconnect, isReconnecting } = useInstanceReconnect()
const { switchTo } = useInstanceSwitch()

type InstanceConnStatus = McpStatusResult['status'] | 'checking' | 'unknown'
const connStatus = ref<InstanceConnStatus>('unknown')
const connToolCount = ref<number | null>(null)
const connError = ref<string | null>(null)

// --- n8n account (session cookie) status — the Chat-mode connection ---
type AccountConnStatus = 'unknown' | 'checking' | 'connected' | 'expired' | 'none' | 'unreachable'
const accountStatus = ref<AccountConnStatus>('unknown')
const accountEmail = ref<string | null>(null)

/**
 * Probe GET /rest/login ("check if the user is already logged in") with the
 * instance's stored session cookie. Works for non-active instances too — the
 * token is read per-instance instead of from the auth store.
 */
async function checkAccountConnection(id: string): Promise<void> {
  if (!window.n8nDesk) return
  accountStatus.value = 'checking'
  accountEmail.value = null

  const inst = instancesStore.getInstance(id)
  if (!inst) return

  const token = await window.n8nDesk.auth.getSessionToken(id)
  if (!token) {
    if (selectedInstanceId.value === id) accountStatus.value = 'none'
    return
  }

  const browserId = await window.n8nDesk.auth.getBrowserId(id)
  try {
    const res = await window.n8nDesk.api.fetch(`${inst.url.replace(/\/+$/, '')}/rest/login`, {
      method: 'GET',
      headers: {
        Cookie: `n8n-auth=${token}`,
        ...(browserId ? { 'browser-id': browserId } : {}),
      },
      timeoutMs: 10000,
    })
    if (selectedInstanceId.value !== id) return // user switched panes mid-check

    if (res.status >= 200 && res.status < 300) {
      accountStatus.value = 'connected'
      try {
        const parsed = JSON.parse(res.body) as { data?: { email?: string } }
        accountEmail.value = parsed.data?.email ?? null
      } catch {
        accountEmail.value = null
      }
    } else if (res.status === 401 || res.status === 403) {
      accountStatus.value = 'expired'
    } else {
      accountStatus.value = 'unreachable'
    }
  } catch {
    if (selectedInstanceId.value === id) accountStatus.value = 'unreachable'
  }
}

/**
 * Raise the credential sign-in modal for this instance. For a non-active
 * instance the swap happens first — its session validation raises the
 * "session expired" modal on its own when the session is dead.
 */
async function signInToAccount(id: string): Promise<void> {
  const wasExpired = accountStatus.value === 'expired'
  cancel() // close settings (reverts theme preview)
  if (instancesStore.activeInstanceId !== id) {
    await switchTo(id)
    if (authStore.sessionExpired) return // swap validation already raised the modal
  }
  if (wasExpired) {
    authStore.markSessionExpired()
  } else {
    authStore.requestReLogin()
  }
}

const accountStatusLabel = computed(() => {
  switch (accountStatus.value) {
    case 'checking':
      return t('settings.connection.statusChecking')
    case 'connected':
      return accountEmail.value
        ? t('settings.connection.statusSignedInAs', { email: accountEmail.value })
        : t('settings.connection.statusSignedIn')
    case 'expired':
      return t('settings.connection.statusSessionExpired')
    case 'none':
      return t('settings.connection.statusNotSignedIn')
    case 'unreachable':
      return t('settings.connection.statusInstanceUnreachable')
    default:
      return ''
  }
})

async function checkInstanceConnection(id: string): Promise<void> {
  if (!window.n8nDesk) return
  connStatus.value = 'checking'
  connToolCount.value = null
  connError.value = null
  try {
    const result = await window.n8nDesk.agent.mcpStatus(id)
    if (selectedInstanceId.value !== id) return // user switched panes mid-check
    connStatus.value = result.status
    connToolCount.value = result.toolCount ?? null
    connError.value = result.error ?? null
  } catch (err) {
    if (selectedInstanceId.value !== id) return
    connStatus.value = 'unreachable'
    connError.value = err instanceof Error ? err.message : String(err)
  }
}

async function reconnectInstance(id: string): Promise<void> {
  connError.value = null
  const result = await reconnect(id)
  if (selectedInstanceId.value !== id) return
  if (!result.success && result.error) {
    connError.value = result.error
  }
  await checkInstanceConnection(id)
}

// Check whenever an instance pane becomes visible.
watch(
  () => [props.isOpen, selectedInstanceId.value] as const,
  ([open, id]) => {
    if (open && id) {
      void checkInstanceConnection(id)
      void checkAccountConnection(id)
    } else {
      connStatus.value = 'unknown'
      connToolCount.value = null
      connError.value = null
      accountStatus.value = 'unknown'
      accountEmail.value = null
    }
  },
  { immediate: true },
)

const connStatusLabel = computed(() => {
  if (isReconnecting.value) return t('settings.connection.statusReconnecting')
  switch (connStatus.value) {
    case 'checking':
      return t('settings.connection.statusChecking')
    case 'connected':
      return connToolCount.value !== null
        ? t('settings.connection.statusConnectedTools', { count: connToolCount.value })
        : t('settings.connection.statusConnected')
    case 'unauthorized':
      return t('settings.connection.statusUnauthorized')
    case 'unreachable':
      return t('settings.connection.statusUnreachable')
    case 'not-configured':
      return t('settings.connection.statusNotConfigured')
    default:
      return ''
  }
})

// --- Theme preview (apply theme live while editing) ---
watch(() => draft.theme, (theme) => {
  applyTheme(theme)
})

// --- Save ---
async function save() {
  // Save preferences
  settingsStore.setTheme(draft.theme)
  settingsStore.setLocale(draft.locale)
  applyTheme(draft.theme)

  // Save instance changes
  for (const inst of draft.instances) {
    const original = instancesStore.instances.find((i) => i.id === inst.id)
    if (original && (original.label !== inst.label || original.color !== inst.color)) {
      await instancesStore.updateInstance(inst.id, {
        label: inst.label,
        color: inst.color,
      })
    }
  }

  emit('update:isOpen', false)
}

// --- Cancel (revert theme preview) ---
function cancel() {
  applyTheme(settingsStore.theme)
  emit('update:isOpen', false)
}

// --- Disconnect instance ---
async function disconnectInstance(instanceId: string) {
  await authStore.logout(instanceId)
  await instancesStore.removeInstance(instanceId)
  draft.instances = draft.instances.filter((i) => i.id !== instanceId)

  // If no instances left, close modal — router guard will redirect to onboarding
  if (draft.instances.length === 0) {
    emit('update:isOpen', false)
    return
  }

  // Switch to general section
  activeSection.value = 'general'
}

function getHostname(url: string): string {
  try {
    return new globalThis.URL(url).hostname
  } catch {
    return url
  }
}
</script>

<template>
  <SettingsModal
    :is-open="isOpen"
    :title="t('settings.title')"
    @update:is-open="$emit('update:isOpen', $event)"
    @save="save"
    @cancel="cancel"
  >
    <!-- Sidebar -->
    <template #sidebar>
      <SettingsNavGroup :label="t('settings.sections.preferences')">
        <SettingsNavItem
          :active="activeSection === 'general'"
          @click="activeSection = 'general'"
        >
          <template #icon><SettingsIcon :size="16" /></template>
          {{ t('settings.sections.general') }}
        </SettingsNavItem>
        <SettingsNavItem
          :active="activeSection === 'ai'"
          @click="activeSection = 'ai'"
        >
          <template #icon><Bot :size="16" /></template>
          {{ t('settings.sections.aiAgent') }}
        </SettingsNavItem>
        <SettingsNavItem
          :active="activeSection === 'toolApprovals'"
          @click="activeSection = 'toolApprovals'"
        >
          <template #icon><ShieldCheck :size="16" /></template>
          {{ t('settings.sections.toolApprovals') }}
        </SettingsNavItem>
        <SettingsNavItem
          :active="activeSection === 'skills'"
          @click="activeSection = 'skills'"
        >
          <template #icon><Zap :size="16" /></template>
          {{ t('settings.sections.skills') }}
        </SettingsNavItem>
        <SettingsNavItem
          :active="activeSection === 'connectors'"
          @click="activeSection = 'connectors'"
        >
          <template #icon><Plug :size="16" /></template>
          {{ t('settings.sections.connectors') }}
        </SettingsNavItem>
        <SettingsNavItem
          :active="activeSection === 'plugins'"
          @click="activeSection = 'plugins'"
        >
          <template #icon><Package :size="16" /></template>
          {{ t('settings.sections.plugins') }}
        </SettingsNavItem>
      </SettingsNavGroup>

      <SettingsNavGroup :label="t('settings.sections.instances')">
        <SettingsNavItem
          v-for="inst in draft.instances"
          :key="inst.id"
          :active="activeSection === `instance:${inst.id}`"
          @click="activeSection = `instance:${inst.id}`"
        >
          <template #icon>
            <div class="instance-dot" :style="{ background: inst.color }" />
          </template>
          {{ inst.label || getHostname(inst.url) }}
        </SettingsNavItem>
      </SettingsNavGroup>
    </template>

    <!-- Content -->
    <template #default>
      <!-- General Preferences -->
      <div v-if="activeSection === 'general'" class="section-content">
        <h3 class="section-title">{{ t('settings.sections.general') }}</h3>
        <p class="section-description">{{ t('settings.generalDescription') }}</p>

        <div class="section-group">
          <div class="section-group-label">{{ t('settings.sections.preferences') }}</div>

          <div class="form-field">
            <ion-select
              :label="t('settings.theme')"
              :value="draft.theme"
              interface="popover"
              fill="outline"
              label-placement="stacked"
              @ion-change="draft.theme = ($event as CustomEvent).detail.value"
            >
              <ion-select-option value="system">{{ t('settings.themeSystem') }}</ion-select-option>
              <ion-select-option value="light">{{ t('settings.themeLight') }}</ion-select-option>
              <ion-select-option value="dark">{{ t('settings.themeDark') }}</ion-select-option>
            </ion-select>
          </div>

          <div class="form-field">
            <ion-select
              :label="t('settings.language')"
              :value="draft.locale"
              interface="popover"
              fill="outline"
              label-placement="stacked"
              @ion-change="draft.locale = ($event as CustomEvent).detail.value"
            >
              <ion-select-option value="en">English</ion-select-option>
            </ion-select>
          </div>
        </div>
      </div>

      <!-- AI / Agent Settings -->
      <div v-else-if="activeSection === 'ai'" class="section-content">
        <h3 class="section-title">{{ t('settings.sections.aiAgent') }}</h3>
        <p class="section-description">{{ t('settings.ai.description') }}</p>
        <LlmSettings />
      </div>

      <!-- Tool Approvals -->
      <div v-else-if="activeSection === 'toolApprovals'" class="section-content">
        <ToolApprovalSettings />
      </div>

      <!-- Skills -->
      <div v-else-if="activeSection === 'skills'" class="section-content">
        <SkillsSettings />
      </div>

      <!-- Connectors -->
      <div v-else-if="activeSection === 'connectors'" class="section-content">
        <ConnectorsSettings />
      </div>

      <!-- Plugins -->
      <div v-else-if="activeSection === 'plugins'" class="section-content">
        <PluginsSettings />
      </div>

      <!-- Instance Settings -->
      <div v-else-if="selectedInstanceDraft" class="section-content">
        <h3 class="section-title">{{ selectedInstanceDraft.label || getHostname(selectedInstanceDraft.url) }}</h3>
        <p class="section-description">{{ t('settings.instanceDescription') }}</p>

        <div class="section-group">
          <div class="section-group-label">{{ t('settings.instanceInfo') }}</div>

          <div class="form-field">
            <ion-input
              v-model="selectedInstanceDraft.label"
              :label="t('settings.instanceName')"
              fill="outline"
              label-placement="stacked"
            />
          </div>

          <div class="form-field">
            <ion-input
              :value="selectedInstanceDraft.url"
              :label="t('settings.instanceUrl')"
              fill="outline"
              label-placement="stacked"
              :readonly="true"
              class="readonly-input"
            />
          </div>

          <div class="form-field">
            <label class="color-label">{{ t('settings.instanceColor') }}</label>
            <div class="color-dots">
              <button
                v-for="color in PRESET_COLORS"
                :key="color"
                class="color-dot"
                :class="{ 'color-dot--selected': selectedInstanceDraft.color === color }"
                :style="{ background: color }"
                @click="selectedInstanceDraft.color = color"
              />
            </div>
          </div>
        </div>

        <div class="section-group">
          <div class="section-group-label">{{ t('settings.connection.title') }}</div>
          <p class="connection-description">{{ t('settings.connection.description') }}</p>

          <!-- n8n account session — Chat mode -->
          <div class="connection-row">
            <div class="connection-main">
              <div class="connection-name">
                <Loader2
                  v-if="accountStatus === 'checking'"
                  :size="15"
                  class="connection-icon connection-icon--spin"
                />
                <CheckCircle2
                  v-else-if="accountStatus === 'connected'"
                  :size="15"
                  class="connection-icon connection-icon--ok"
                />
                <TriangleAlert
                  v-else
                  :size="15"
                  class="connection-icon connection-icon--warn"
                />
                <span>{{ t('settings.connection.accountLabel') }}</span>
              </div>
              <p class="connection-hint">{{ t('settings.connection.accountHint') }}</p>
              <p class="connection-status-text">{{ accountStatusLabel }}</p>
            </div>

            <ion-button
              v-if="accountStatus === 'expired' || accountStatus === 'none'"
              fill="outline"
              size="small"
              @click="signInToAccount(selectedInstanceDraft.id)"
            >
              {{ t('settings.connection.signIn') }}
            </ion-button>
          </div>

          <!-- MCP server — Cowork & Workflow mode -->
          <div class="connection-row">
            <div class="connection-main">
              <div class="connection-name">
                <Loader2
                  v-if="connStatus === 'checking' || isReconnecting"
                  :size="15"
                  class="connection-icon connection-icon--spin"
                />
                <CheckCircle2
                  v-else-if="connStatus === 'connected'"
                  :size="15"
                  class="connection-icon connection-icon--ok"
                />
                <TriangleAlert
                  v-else
                  :size="15"
                  class="connection-icon connection-icon--warn"
                />
                <span>{{ t('settings.connection.mcpLabel') }}</span>
              </div>
              <p class="connection-hint">{{ t('settings.connection.mcpHint') }}</p>
              <p class="connection-status-text">{{ connStatusLabel }}</p>
            </div>

            <ion-button
              fill="outline"
              size="small"
              :disabled="isReconnecting || connStatus === 'checking'"
              @click="reconnectInstance(selectedInstanceDraft.id)"
            >
              <RefreshCw :size="14" style="margin-right: 6px;" />
              {{ t('settings.connection.reconnect') }}
            </ion-button>
          </div>

          <p v-if="connError" class="connection-error">{{ connError }}</p>
        </div>

        <div class="section-group section-group--danger">
          <div class="section-group-label section-group-label--danger">
            {{ t('settings.sections.dangerZone') }}
          </div>
          <p class="danger-description">{{ t('settings.disconnectDescription') }}</p>
          <ion-button
            fill="outline"
            color="danger"
            size="small"
            @click="disconnectInstance(selectedInstanceDraft.id)"
          >
            <Trash2 :size="14" style="margin-right: 6px;" />
            {{ t('settings.disconnectInstance') }}
          </ion-button>
        </div>
      </div>
    </template>
  </SettingsModal>
</template>

<style scoped lang="scss">
// --- Instance dot in sidebar ---
.instance-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

// --- Section Content ---
.section-content {
  max-width: 520px;
}

.section-title {
  font-size: var(--font-size--lg);
  font-weight: var(--font-weight--bold);
  color: var(--color--text);
  margin: 0 0 var(--spacing--2xs);
}

.section-description {
  font-size: var(--font-size--sm);
  color: var(--color--text--tint-1);
  margin: 0 0 var(--spacing--lg);
}

// --- Section Groups ---
.section-group {
  margin-bottom: var(--spacing--lg);

  &--danger {
    margin-top: var(--spacing--xl);
    padding-top: var(--spacing--md);
    border-top: 1px solid var(--border-color--subtle);
  }
}

.section-group-label {
  font-size: var(--font-size--2xs);
  font-weight: var(--font-weight--bold);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color--text--tint-1);
  margin-bottom: var(--spacing--sm);

  &--danger {
    color: var(--color--danger);
  }
}

// --- Form Fields ---
.form-field {
  margin-bottom: var(--spacing--md);
}

.readonly-input {
  opacity: 0.7;
}

// --- Color Picker ---
.color-label {
  display: block;
  font-size: var(--font-size--sm);
  color: var(--color--text--tint-1);
  margin-bottom: var(--spacing--xs);
}

.color-dots {
  display: flex;
  gap: var(--spacing--sm);
}

.color-dot {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  padding: 0;
  transition: border-color 0.15s ease, transform 0.15s ease;

  &:hover {
    transform: scale(1.1);
  }

  &--selected {
    border-color: var(--color--text);
    transform: scale(1.15);
  }
}

// --- Connection ---
.connection-description {
  font-size: var(--font-size--sm);
  color: var(--color--text--tint-1);
  margin: 0 0 var(--spacing--sm);
}

.connection-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--spacing--sm);
  padding: var(--spacing--sm);
  border: 1px solid var(--border-color--subtle);
  border-radius: var(--radius--sm);

  & + & {
    margin-top: var(--spacing--sm);
  }

  ion-button {
    flex-shrink: 0;
  }
}

.connection-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.connection-name {
  display: flex;
  align-items: center;
  gap: var(--spacing--xs);
  font-size: var(--font-size--sm);
  font-weight: var(--font-weight--medium);
  color: var(--color--text);
}

.connection-hint {
  font-size: var(--font-size--2xs);
  color: var(--color--text--tint-1);
  margin: 0;
}

.connection-status-text {
  font-size: var(--font-size--2xs);
  color: var(--color--text);
  margin: var(--spacing--3xs) 0 0;
}

.connection-icon {
  flex-shrink: 0;

  &--ok {
    color: var(--color--success);
  }

  &--warn {
    color: var(--color--warning);
  }

  &--spin {
    animation: connection-spin 1s linear infinite;
  }
}

@keyframes connection-spin {
  to { transform: rotate(360deg); }
}

.connection-error {
  font-size: var(--font-size--2xs);
  color: var(--color--danger);
  margin: var(--spacing--xs) 0 0;
  word-break: break-word;
}

// --- Danger Zone ---
.danger-description {
  font-size: var(--font-size--sm);
  color: var(--color--text--tint-1);
  margin: 0 0 var(--spacing--sm);
}
</style>
