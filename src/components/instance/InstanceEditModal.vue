<script setup lang="ts">
import {
  IonModal, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent,
  IonList, IonItem, IonInput, IonNote, IonIcon, IonSpinner, IonText, IonBadge,
  alertController, toastController,
} from '@ionic/vue'
import { closeOutline, checkmarkCircle, alertCircle, warningOutline, refreshOutline, logOutOutline, trashOutline } from 'ionicons/icons'
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useInstancesStore } from '@/stores/instances'

const props = defineProps<{
  isOpen: boolean
  instanceId: string | null
}>()

const emit = defineEmits<{
  'update:isOpen': [value: boolean]
  removed: [instanceId: string]
}>()

const { t } = useI18n()
const instancesStore = useInstancesStore()

const PRESET_COLORS = [
  '#ff6d5a', '#7c3aed', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899',
]

// --- Form state ---
const label = ref('')
const color = ref(PRESET_COLORS[0])
const mcpUrl = ref('')
const originalMcpUrl = ref('')

// --- MCP status ---
type McpStatus = 'not-configured' | 'unauthorized' | 'connected' | 'checking'
const mcpStatus = ref<McpStatus>('not-configured')
const mcpToolCount = ref<number | null>(null)
const mcpTestError = ref<string | null>(null)
const isMcpAuthing = ref(false)
const isTestingConnection = ref(false)

const instance = computed(() =>
  props.instanceId ? instancesStore.getInstance(props.instanceId) : null,
)

const hasMcpUrl = computed(() => mcpUrl.value.trim().length > 0)
const isValidMcpUrl = computed(() => {
  const v = mcpUrl.value.trim()
  if (!v) return false
  try {
    const u = new URL(v)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
})

// Hydrate the form when the modal opens or the target instance changes.
watch(
  () => [props.isOpen, props.instanceId] as const,
  ([open, id]) => {
    if (!open || !id) return
    const inst = instancesStore.getInstance(id)
    if (!inst) return
    label.value = inst.label
    color.value = inst.color
    mcpUrl.value = inst.mcpServerUrl ?? ''
    originalMcpUrl.value = inst.mcpServerUrl ?? ''
    mcpToolCount.value = null
    mcpTestError.value = null
    void refreshMcpStatus()
  },
  { immediate: true },
)

async function refreshMcpStatus(): Promise<void> {
  const id = props.instanceId
  if (!id) return
  const inst = instancesStore.getInstance(id)
  if (!inst?.mcpServerUrl) {
    mcpStatus.value = 'not-configured'
    return
  }
  // If a custom URL is set on disk, we need to know whether tokens exist.
  // We check by attempting a listTools via the auth:mcp-refresh path — but
  // a lighter approach: read window.n8nDesk.keychain… — actually the simplest
  // is to try to refresh; if refresh succeeds we're connected, else unauthorized.
  if (!window.n8nDesk) return
  try {
    const result = await window.n8nDesk.auth.mcp.refresh(id)
    if (result.success) {
      mcpStatus.value = 'connected'
    } else {
      mcpStatus.value = 'unauthorized'
    }
  } catch {
    mcpStatus.value = 'unauthorized'
  }
}

function close(): void {
  emit('update:isOpen', false)
}

async function save(): Promise<void> {
  if (!props.instanceId) return

  const trimmedMcpUrl = mcpUrl.value.trim()
  const mcpUrlChanged = trimmedMcpUrl !== originalMcpUrl.value

  // If MCP URL changed to a different non-empty value, confirm re-auth.
  if (mcpUrlChanged && originalMcpUrl.value && trimmedMcpUrl && trimmedMcpUrl !== originalMcpUrl.value) {
    const alert = await alertController.create({
      header: t('settings.mcpServer.changeConfirmTitle'),
      message: t('settings.mcpServer.changeConfirmMessage'),
      buttons: [
        { text: t('settings.mcpServer.changeConfirmCancel'), role: 'cancel' },
        { text: t('settings.mcpServer.changeConfirmProceed'), role: 'confirm' },
      ],
    })
    await alert.present()
    const { role } = await alert.onDidDismiss()
    if (role !== 'confirm') return
    // Clear old tokens so the user must re-auth
    if (window.n8nDesk) {
      await window.n8nDesk.auth.mcp.logout(props.instanceId)
    }
  }

  // If MCP URL was cleared, run mcp-clear-url (revokes tokens + drops mcpServerUrl).
  if (mcpUrlChanged && !trimmedMcpUrl && originalMcpUrl.value) {
    if (window.n8nDesk) {
      await window.n8nDesk.auth.mcp.clearUrl(props.instanceId)
    }
  }

  await instancesStore.updateInstance(props.instanceId, {
    label: label.value,
    color: color.value,
    ...(mcpUrlChanged
      ? { mcpServerUrl: trimmedMcpUrl || undefined }
      : {}),
  })

  originalMcpUrl.value = trimmedMcpUrl
  await refreshMcpStatus()

  // Background validation for a newly-set MCP URL (fire-and-forget)
  if (trimmedMcpUrl && mcpStatus.value === 'connected') {
    void backgroundValidate()
  }

  close()
}

async function backgroundValidate(): Promise<void> {
  const id = props.instanceId
  if (!id || !window.n8nDesk) return
  const result = await window.n8nDesk.auth.mcp.validate(mcpUrl.value.trim())
  if (!result.success) {
    const toast = await toastController.create({
      message: t('settings.mcpServer.backgroundValidationFailed'),
      duration: 4000,
      color: 'warning',
    })
    await toast.present()
  }
}

async function signInToMcp(): Promise<void> {
  if (!props.instanceId || !window.n8nDesk) return
  const trimmed = mcpUrl.value.trim()
  if (!trimmed) return
  isMcpAuthing.value = true
  mcpTestError.value = null
  try {
    // Pre-flight discovery
    const validate = await window.n8nDesk.auth.mcp.validate(trimmed)
    if (!validate.success) {
      mcpTestError.value = validate.error ?? t('onboarding.errors.mcpDiscoveryFailed')
      return
    }
    const result = await window.n8nDesk.auth.mcp.login(props.instanceId, trimmed)
    if (result.success) {
      mcpStatus.value = 'connected'
      originalMcpUrl.value = trimmed
      // Refresh instance from store (mcpServerUrl is now persisted in instance.json but
      // the Pinia copy hasn't been re-read — update it via updateInstance).
      await instancesStore.updateInstance(props.instanceId, { mcpServerUrl: trimmed })
    } else {
      mcpTestError.value = result.error ?? t('onboarding.errors.mcpAuthFailed')
      mcpStatus.value = 'unauthorized'
    }
  } finally {
    isMcpAuthing.value = false
  }
}

async function signOutOfMcp(): Promise<void> {
  if (!props.instanceId || !window.n8nDesk) return
  await window.n8nDesk.auth.mcp.logout(props.instanceId)
  mcpStatus.value = 'unauthorized'
  mcpToolCount.value = null
}

async function testConnection(): Promise<void> {
  if (!window.n8nDesk) return
  const trimmed = mcpUrl.value.trim()
  if (!trimmed) return
  isTestingConnection.value = true
  mcpTestError.value = null
  try {
    const result = await window.n8nDesk.auth.mcp.validate(trimmed)
    if (!result.success) {
      mcpTestError.value = result.error ?? t('onboarding.errors.mcpDiscoveryFailed')
      return
    }
    const toast = await toastController.create({
      message: t('settings.mcpServer.testSuccess', { count: '—' }),
      duration: 3000,
      color: 'success',
    })
    await toast.present()
  } catch (err) {
    mcpTestError.value = err instanceof Error ? err.message : String(err)
  } finally {
    isTestingConnection.value = false
  }
}

async function resetToDefault(): Promise<void> {
  if (!props.instanceId || !window.n8nDesk) return
  await window.n8nDesk.auth.mcp.clearUrl(props.instanceId)
  mcpUrl.value = ''
  originalMcpUrl.value = ''
  mcpStatus.value = 'not-configured'
  mcpToolCount.value = null
  await instancesStore.updateInstance(props.instanceId, { mcpServerUrl: undefined })
}

async function removeInstance(): Promise<void> {
  if (!props.instanceId) return
  const alert = await alertController.create({
    header: t('settings.disconnectInstance'),
    message: t('settings.disconnectDescription'),
    buttons: [
      { text: t('settingsModal.cancel'), role: 'cancel' },
      { text: t('settings.disconnectInstance'), role: 'destructive' },
    ],
  })
  await alert.present()
  const { role } = await alert.onDidDismiss()
  if (role !== 'destructive') return

  const id = props.instanceId
  // Best-effort auth logout (revoke + delete tokens) for both contexts.
  if (window.n8nDesk) {
    try { await window.n8nDesk.auth.mcp.logout(id) } catch { /* ignore */ }
    try { await window.n8nDesk.auth.logout(id) } catch { /* ignore */ }
  }
  await instancesStore.removeInstance(id)
  emit('removed', id)
  close()
}
</script>

<template>
  <ion-modal :is-open="isOpen" @did-dismiss="close">
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ t('settings.instances.editInstance') }}</ion-title>
        <ion-buttons slot="end">
          <ion-button fill="clear" @click="close">
            <ion-icon slot="icon-only" :icon="closeOutline" />
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <div v-if="instance" class="edit-container">
        <!-- Label -->
        <ion-input
          v-model="label"
          :label="t('settings.instanceName')"
          fill="outline"
          label-placement="stacked"
        />

        <!-- Color picker -->
        <div class="color-picker">
          <label class="color-label">{{ t('settings.instanceColor') }}</label>
          <div class="color-dots">
            <button
              v-for="preset in PRESET_COLORS"
              :key="preset"
              type="button"
              class="color-dot"
              :class="{ 'color-dot--selected': color === preset }"
              :style="{ background: preset }"
              @click="color = preset"
            />
          </div>
        </div>

        <!-- Instance URL (read-only reference) -->
        <ion-input
          :model-value="instance.url"
          :label="t('settings.instanceUrl')"
          fill="outline"
          label-placement="stacked"
          readonly
        />

        <!-- Custom MCP Server section -->
        <div class="mcp-section">
          <h3 class="section-title">{{ t('settings.mcpServer.title') }}</h3>
          <p class="section-description">{{ t('settings.mcpServer.description') }}</p>

          <ion-input
            v-model="mcpUrl"
            :label="t('settings.mcpServer.urlLabel')"
            :placeholder="t('settings.mcpServer.urlPlaceholder')"
            fill="outline"
            label-placement="stacked"
            type="url"
          />
          <ion-note>{{ t('settings.mcpServer.urlHelp') }}</ion-note>

          <!-- Status row -->
          <div class="mcp-status">
            <template v-if="mcpStatus === 'not-configured'">
              <ion-icon :icon="checkmarkCircle" color="medium" />
              <span>{{ t('settings.mcpServer.statusNotConfigured') }}</span>
            </template>
            <template v-else-if="mcpStatus === 'checking'">
              <ion-spinner name="dots" />
              <span>{{ t('settings.mcpServer.statusChecking') }}</span>
            </template>
            <template v-else-if="mcpStatus === 'unauthorized'">
              <ion-icon :icon="warningOutline" color="warning" />
              <span>{{ t('settings.mcpServer.statusUnauthorized') }}</span>
            </template>
            <template v-else-if="mcpStatus === 'connected'">
              <ion-icon :icon="checkmarkCircle" color="success" />
              <span>{{ t('settings.mcpServer.statusConnected') }}</span>
            </template>
          </div>

          <div v-if="mcpTestError" class="mcp-error">
            <ion-icon :icon="alertCircle" color="danger" />
            <ion-text color="danger">
              <p>{{ mcpTestError }}</p>
            </ion-text>
          </div>

          <!-- MCP actions -->
          <div class="mcp-actions">
            <ion-button
              v-if="hasMcpUrl && mcpStatus !== 'connected'"
              :disabled="!isValidMcpUrl || isMcpAuthing"
              @click="signInToMcp"
            >
              <ion-spinner v-if="isMcpAuthing" name="crescent" />
              <span v-else>{{ t('settings.mcpServer.signIn') }}</span>
            </ion-button>
            <ion-button
              v-if="hasMcpUrl && mcpStatus === 'connected'"
              fill="outline"
              @click="signOutOfMcp"
            >
              <ion-icon :icon="logOutOutline" slot="start" />
              {{ t('settings.mcpServer.signOut') }}
            </ion-button>
            <ion-button
              v-if="hasMcpUrl"
              fill="outline"
              :disabled="!isValidMcpUrl || isTestingConnection"
              @click="testConnection"
            >
              <ion-spinner v-if="isTestingConnection" name="crescent" />
              <template v-else>
                <ion-icon :icon="refreshOutline" slot="start" />
                {{ t('settings.mcpServer.testConnection') }}
              </template>
            </ion-button>
            <ion-button
              v-if="originalMcpUrl"
              fill="clear"
              color="medium"
              @click="resetToDefault"
            >
              {{ t('settings.mcpServer.resetToDefault') }}
            </ion-button>
          </div>
        </div>

        <!-- Danger zone -->
        <div class="danger-zone">
          <ion-button color="danger" fill="outline" expand="block" @click="removeInstance">
            <ion-icon :icon="trashOutline" slot="start" />
            {{ t('settings.disconnectInstance') }}
          </ion-button>
        </div>

        <!-- Save / cancel -->
        <div class="footer-actions">
          <ion-button fill="outline" @click="close">
            {{ t('settingsModal.cancel') }}
          </ion-button>
          <ion-button @click="save">
            {{ t('settingsModal.save') }}
          </ion-button>
        </div>
      </div>
    </ion-content>
  </ion-modal>
</template>

<style scoped lang="scss">
.edit-container {
  display: flex;
  flex-direction: column;
  gap: var(--spacing--md);
  max-width: 560px;
  margin: 0 auto;
}

.color-picker {
  display: flex;
  flex-direction: column;
  gap: var(--spacing--xs);
}

.color-label {
  font-size: var(--font-size--sm);
  color: var(--color--text--tint-1);
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
  transition: border-color 0.15s ease, transform 0.15s ease;

  &:hover {
    transform: scale(1.1);
  }

  &--selected {
    border-color: var(--color--text);
    transform: scale(1.15);
  }
}

.mcp-section {
  display: flex;
  flex-direction: column;
  gap: var(--spacing--xs);
  padding: var(--spacing--sm);
  border: 1px solid var(--border-color--subtle);
  border-radius: var(--radius--sm);
  background: var(--n8n-desk--surface-bg);
}

.section-title {
  font-size: var(--font-size--md);
  font-weight: var(--font-weight--medium);
  color: var(--color--text);
  margin: 0;
}

.section-description {
  font-size: var(--font-size--sm);
  color: var(--color--text--tint-1);
  margin: 0 0 var(--spacing--xs) 0;
}

.mcp-status {
  display: flex;
  align-items: center;
  gap: var(--spacing--xs);
  font-size: var(--font-size--sm);
  color: var(--color--text);
  margin-top: var(--spacing--xs);
}

.mcp-error {
  display: flex;
  align-items: flex-start;
  gap: var(--spacing--xs);

  p {
    margin: 0;
    font-size: var(--font-size--sm);
  }
}

.mcp-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing--xs);
  margin-top: var(--spacing--xs);
}

.danger-zone {
  margin-top: var(--spacing--md);
  padding-top: var(--spacing--md);
  border-top: 1px solid var(--border-color--subtle);
}

.footer-actions {
  display: flex;
  gap: var(--spacing--sm);
  justify-content: flex-end;
  margin-top: var(--spacing--md);
}
</style>
