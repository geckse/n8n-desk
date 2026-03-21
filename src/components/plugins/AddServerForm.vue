<script setup lang="ts">
import {
  IonInput, IonTextarea, IonToggle, IonButton, IonSpinner,
  IonSegment, IonSegmentButton, IonLabel,
} from '@ionic/vue'
import { ref, reactive, computed, watch } from 'vue'
import { Plus, Minus, Server, CheckCircle2, LogIn, LogOut, AlertCircle } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { usePluginsStore } from '@/stores/plugins'
import type { StandaloneMcpServer, ServerAuthType } from '@/types/plugin'

interface Props {
  /** Pre-fill the form for editing an existing server */
  editServer?: StandaloneMcpServer
}

const props = defineProps<Props>()

const emit = defineEmits<{
  saved: [server: StandaloneMcpServer]
  cancel: []
}>()

const { t } = useI18n()
const pluginsStore = usePluginsStore()

// --- Form draft ---

interface HeaderRow {
  name: string
  value: string
}

const draft = reactive({
  name: props.editServer?.name ?? '',
  url: props.editServer?.url ?? '',
  description: props.editServer?.description ?? '',
  requireApproval: props.editServer?.requireApproval ?? true,
  authType: (props.editServer?.authType ?? 'static-headers') as ServerAuthType,
})

const headers = ref<HeaderRow[]>(
  props.editServer?.headerNames?.length
    ? props.editServer.headerNames.map((name) => ({ name, value: '' }))
    : [],
)

// --- OAuth state ---
const oauthStatus = ref<'idle' | 'connecting' | 'connected' | 'error'>(
  props.editServer?.oauthStatus?.connected ? 'connected' : 'idle',
)
const oauthExpiresAt = ref(props.editServer?.oauthStatus?.expiresAt ?? '')
const oauthError = ref('')
const oauthProbed = ref(false)
const oauthClientId = ref('')
const oauthClientSecret = ref('')

// Probe for OAuth support when URL changes (debounced)
let probeTimer: ReturnType<typeof setTimeout> | null = null
watch(() => draft.url, (url) => {
  oauthProbed.value = false
  if (probeTimer) clearTimeout(probeTimer)
  if (!url || !isValidUrl(url.trim())) return
  probeTimer = setTimeout(async () => {
    try {
      const supports = await pluginsStore.serverProbeOAuth(url.trim())
      oauthProbed.value = supports
      // Auto-select OAuth for new servers if supported
      if (supports && !props.editServer) {
        draft.authType = 'oauth'
      }
    } catch {
      oauthProbed.value = false
    }
  }, 500)
})

async function connectOAuth(): Promise<void> {
  oauthStatus.value = 'connecting'
  oauthError.value = ''

  // For new servers, save first to get an ID
  let serverId = props.editServer?.id
  let isNewlyCreated = false
  if (!serverId) {
    try {
      const server = await pluginsStore.addServer({
        name: draft.name.trim() || draft.url.trim(),
        url: draft.url.trim(),
        description: draft.description.trim() || undefined,
        authType: 'oauth',
        enabled: false, // disabled until OAuth completes
        requireApproval: draft.requireApproval,
      })
      serverId = server.id
      isNewlyCreated = true
    } catch (err) {
      oauthStatus.value = 'error'
      oauthError.value = err instanceof Error ? err.message : 'Failed to save server'
      return
    }
  }

  const result = await pluginsStore.serverOAuthConnect(
    serverId,
    draft.url.trim(),
    oauthClientId.value.trim() || undefined,
    oauthClientSecret.value.trim() || undefined,
  )
  if (result.success) {
    oauthStatus.value = 'connected'
    oauthExpiresAt.value = result.expiresAt ?? ''
    // Enable the server now that OAuth is connected
    if (isNewlyCreated) {
      await pluginsStore.updateServer(serverId, { enabled: true })
    }
  } else if (result.needsManualClient) {
    oauthStatus.value = 'error'
    oauthError.value = t('plugins.addServer.oauthNeedsClientId')
  } else {
    oauthStatus.value = 'error'
    oauthError.value = result.error ?? t('plugins.addServer.oauthError')
  }
}

async function disconnectOAuth(): Promise<void> {
  const serverId = props.editServer?.id
  if (!serverId) return
  try {
    await pluginsStore.serverOAuthDisconnect(serverId)
    oauthStatus.value = 'idle'
    oauthExpiresAt.value = ''
  } catch {
    // best-effort
  }
}

function onAuthTypeChange(event: CustomEvent) {
  draft.authType = event.detail.value
}

// --- Validation ---

const urlError = ref<string | null>(null)

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

const isFormValid = computed(() => {
  return draft.url.trim().length > 0 && isValidUrl(draft.url.trim())
})

function validateUrl(): void {
  const url = draft.url.trim()
  if (!url) {
    urlError.value = t('plugins.addServer.urlRequired')
    return
  }
  if (!isValidUrl(url)) {
    urlError.value = t('plugins.addServer.urlInvalid')
    return
  }
  urlError.value = null
}

// --- Header rows ---

function addHeaderRow(): void {
  headers.value.push({ name: '', value: '' })
}

function removeHeaderRow(index: number): void {
  headers.value.splice(index, 1)
}

// --- Test connection ---

const testStatus = ref<'idle' | 'testing' | 'success' | 'error'>('idle')
const testError = ref('')
const discoveredToolCount = ref(0)

function buildHeadersRecord(): Record<string, string> {
  const record: Record<string, string> = {}
  for (const row of headers.value) {
    const name = row.name.trim()
    const value = row.value.trim()
    if (name && value) {
      record[name] = value
    }
  }
  return record
}

async function testConnection(): Promise<void> {
  validateUrl()
  if (urlError.value) return

  testStatus.value = 'testing'
  testError.value = ''
  discoveredToolCount.value = 0

  try {
    let tools: import('@/types/plugin').DiscoveredTool[]

    // For OAuth servers with a saved ID, use stored credentials
    const serverId = props.editServer?.id
    if (draft.authType === 'oauth' && serverId && oauthStatus.value === 'connected') {
      tools = await pluginsStore.testServerById(serverId)
    } else {
      tools = await pluginsStore.testServer(
        draft.url.trim(),
        buildHeadersRecord(),
      )
    }

    discoveredToolCount.value = tools.length
    testStatus.value = 'success'
  } catch (err: unknown) {
    testStatus.value = 'error'
    testError.value = err instanceof Error
      ? err.message
      : t('plugins.addServer.testFailed')
  }
}

// --- Save ---

const isSaving = ref(false)

async function handleSave(): Promise<void> {
  validateUrl()
  if (urlError.value) return

  isSaving.value = true

  try {
    const isOAuth = draft.authType === 'oauth'
    const headerNames = isOAuth ? [] : headers.value
      .map((h) => h.name.trim())
      .filter((n) => n.length > 0)

    if (props.editServer) {
      const switchedAwayFromOAuth = !isOAuth && (props.editServer.authType ?? 'static-headers') === 'oauth'

      // Update existing server
      await pluginsStore.updateServer(props.editServer.id, {
        name: draft.name.trim() || draft.url.trim(),
        url: draft.url.trim(),
        description: draft.description.trim() || undefined,
        authType: draft.authType,
        headerNames: !isOAuth && headerNames.length > 0 ? headerNames : undefined,
        requireApproval: draft.requireApproval,
        // Clear OAuth fields when switching away from OAuth
        ...(switchedAwayFromOAuth ? { oauthClientId: undefined, oauthDiscoveryUrl: undefined, oauthStatus: undefined } : {}),
      })

      // Clean up OAuth tokens if switching away from OAuth
      if (switchedAwayFromOAuth) {
        await pluginsStore.serverOAuthDisconnect(props.editServer.id)
      }

      // Store any header values that were (re-)entered (static headers only)
      if (!isOAuth) {
        for (const row of headers.value) {
          const name = row.name.trim()
          const value = row.value.trim()
          if (name && value) {
            await pluginsStore.setSecret('server', props.editServer.id, name, value)
          }
        }
      }

      emit('saved', {
        ...props.editServer,
        name: draft.name.trim() || draft.url.trim(),
        url: draft.url.trim(),
        description: draft.description.trim(),
        authType: draft.authType,
        headerNames: isOAuth ? undefined : headerNames,
        requireApproval: draft.requireApproval,
      })
    } else if (isOAuth && oauthStatus.value === 'connected') {
      // OAuth server already saved + connected during the connect flow
      emit('saved', {} as StandaloneMcpServer)
    } else {
      // Add new server (static headers)
      const server = await pluginsStore.addServer({
        name: draft.name.trim() || draft.url.trim(),
        url: draft.url.trim(),
        description: draft.description.trim() || undefined,
        authType: draft.authType,
        headerNames: !isOAuth && headerNames.length > 0 ? headerNames : undefined,
        enabled: true,
        requireApproval: draft.requireApproval,
      })

      // Store header secret values in keychain (static headers only)
      if (!isOAuth) {
        for (const row of headers.value) {
          const name = row.name.trim()
          const value = row.value.trim()
          if (name && value) {
            await pluginsStore.setSecret('server', server.id, name, value)
          }
        }
      }

      emit('saved', server)
    }
  } catch (err: unknown) {
    testStatus.value = 'error'
    testError.value = err instanceof Error
      ? err.message
      : t('plugins.addServer.saveFailed')
  } finally {
    isSaving.value = false
  }
}

const isEditing = computed(() => !!props.editServer)
</script>

<template>
  <div :class="$style.form">
    <div :class="$style.header">
      <Server :size="18" :class="$style.headerIcon" />
      <span :class="$style.headerTitle">
        {{ isEditing ? t('plugins.addServer.titleEdit') : t('plugins.addServer.title') }}
      </span>
    </div>

    <!-- Name -->
    <div :class="$style.field">
      <ion-input
        v-model="draft.name"
        :label="t('plugins.addServer.name')"
        fill="outline"
        label-placement="stacked"
        :placeholder="t('plugins.addServer.namePlaceholder')"
      />
    </div>

    <!-- URL (required) -->
    <div :class="$style.field">
      <ion-input
        v-model="draft.url"
        :label="t('plugins.addServer.url')"
        fill="outline"
        label-placement="stacked"
        :placeholder="t('plugins.addServer.urlPlaceholder')"
        type="url"
        required
        :class="{ [$style.inputError]: urlError }"
        @ion-blur="validateUrl"
      />
      <span v-if="urlError" :class="$style.errorText">{{ urlError }}</span>
    </div>

    <!-- Description -->
    <div :class="$style.field">
      <ion-textarea
        v-model="draft.description"
        :label="t('plugins.addServer.description')"
        fill="outline"
        label-placement="stacked"
        :placeholder="t('plugins.addServer.descriptionPlaceholder')"
        :rows="2"
        auto-grow
      />
    </div>

    <!-- Auth Type Selector -->
    <div :class="$style.field">
      <label :class="$style.fieldLabel">{{ t('plugins.addServer.authType') }}</label>
      <ion-segment
        :value="draft.authType"
        mode="ios"
        @ion-change="onAuthTypeChange"
      >
        <ion-segment-button value="static-headers">
          <ion-label>{{ t('plugins.addServer.authTypeStaticHeaders') }}</ion-label>
        </ion-segment-button>
        <ion-segment-button value="oauth">
          <ion-label>{{ t('plugins.addServer.authTypeOAuth') }}</ion-label>
        </ion-segment-button>
      </ion-segment>
      <span v-if="oauthProbed && draft.authType !== 'oauth'" :class="$style.oauthProbeHint">
        {{ t('plugins.addServer.oauthProbed') }}
      </span>
    </div>

    <!-- OAuth Section (when authType is oauth) -->
    <template v-if="draft.authType === 'oauth'">
      <!-- Client ID & Secret (always visible, optional) -->
      <div :class="$style.field">
        <ion-input
          v-model="oauthClientId"
          :label="t('plugins.addServer.oauthClientId')"
          fill="outline"
          label-placement="stacked"
          :placeholder="t('plugins.addServer.oauthClientIdPlaceholder')"
        />
        <span :class="$style.fieldHint">{{ t('plugins.addServer.oauthClientIdHint') }}</span>
      </div>
      <div :class="$style.field">
        <ion-input
          v-model="oauthClientSecret"
          :label="t('plugins.addServer.oauthClientSecret')"
          fill="outline"
          label-placement="stacked"
          :placeholder="t('plugins.addServer.oauthClientSecretPlaceholder')"
          type="password"
        />
        <span :class="$style.fieldHint">{{ t('plugins.addServer.oauthClientSecretHint') }}</span>
      </div>

      <!-- Redirect URI hint -->
      <div :class="$style.field">
        <label :class="$style.fieldLabel">{{ t('plugins.addServer.oauthRedirectUri') }}</label>
        <div :class="$style.redirectUriBox">
          <code>http://127.0.0.1:27182/callback</code>
        </div>
        <span :class="$style.fieldHint">{{ t('plugins.addServer.oauthRedirectUriHint') }}</span>
      </div>

      <!-- Connection status -->
      <div :class="$style.oauthSection">
        <!-- Connected -->
        <div v-if="oauthStatus === 'connected'" :class="$style.oauthConnected">
          <CheckCircle2 :size="16" :class="$style.oauthConnectedIcon" />
          <div :class="$style.oauthConnectedInfo">
            <span :class="$style.oauthConnectedLabel">{{ t('plugins.addServer.oauthConnected') }}</span>
            <span v-if="oauthExpiresAt" :class="$style.oauthExpiry">
              {{ t('plugins.addServer.oauthExpiry', { time: new Date(oauthExpiresAt).toLocaleString() }) }}
            </span>
          </div>
          <ion-button fill="clear" size="small" color="danger" @click="disconnectOAuth">
            <LogOut :size="14" style="margin-right: 4px;" />
            {{ t('plugins.addServer.oauthDisconnect') }}
          </ion-button>
        </div>

        <!-- Connecting -->
        <div v-else-if="oauthStatus === 'connecting'" :class="$style.oauthConnecting">
          <ion-spinner name="crescent" />
          <span>{{ t('plugins.addServer.oauthConnecting') }}</span>
        </div>

        <!-- Error -->
        <div v-else-if="oauthStatus === 'error'" :class="$style.oauthError">
          <AlertCircle :size="16" :class="$style.oauthErrorIcon" />
          <span>{{ oauthError }}</span>
          <ion-button fill="clear" size="small" @click="connectOAuth">
            {{ t('plugins.addServer.oauthTryAgain') }}
          </ion-button>
        </div>

        <!-- Idle (not connected) -->
        <div v-else :class="$style.oauthIdle">
          <p :class="$style.oauthHint">{{ t('plugins.addServer.oauthHint') }}</p>
          <ion-button fill="outline" size="small" :disabled="!isFormValid" @click="connectOAuth">
            <LogIn :size="14" style="margin-right: 4px;" />
            {{ t('plugins.addServer.oauthConnect') }}
          </ion-button>
        </div>
      </div>
    </template>

    <!-- Static Headers (when authType is static-headers) -->
    <div v-if="draft.authType === 'static-headers'" :class="$style.field">
      <label :class="$style.fieldLabel">{{ t('plugins.addServer.headers') }}</label>
      <p :class="$style.fieldHint">{{ t('plugins.addServer.headersHint') }}</p>

      <div
        v-for="(row, index) in headers"
        :key="index"
        :class="$style.headerRow"
      >
        <ion-input
          v-model="row.name"
          :label="t('plugins.addServer.headerName')"
          fill="outline"
          label-placement="stacked"
          :placeholder="t('plugins.addServer.headerNamePlaceholder')"
          :class="$style.headerInput"
        />
        <ion-input
          v-model="row.value"
          :label="t('plugins.addServer.headerValue')"
          fill="outline"
          label-placement="stacked"
          :placeholder="isEditing && !row.value ? t('plugins.addServer.headerValueKept') : t('plugins.addServer.headerValuePlaceholder')"
          type="password"
          :class="$style.headerInput"
        />
        <ion-button
          fill="clear"
          size="small"
          color="danger"
          :class="$style.removeBtn"
          :title="t('plugins.addServer.removeHeader')"
          @click="removeHeaderRow(index)"
        >
          <Minus :size="16" />
        </ion-button>
      </div>

      <ion-button
        fill="clear"
        size="small"
        :class="$style.addHeaderBtn"
        @click="addHeaderRow"
      >
        <Plus :size="14" style="margin-right: 4px;" />
        {{ t('plugins.addServer.addHeader') }}
      </ion-button>
    </div>

    <!-- Require Approval toggle -->
    <div :class="$style.toggleField">
      <div :class="$style.toggleInfo">
        <span :class="$style.toggleLabel">{{ t('plugins.addServer.requireApproval') }}</span>
        <span :class="$style.toggleHint">{{ t('plugins.addServer.requireApprovalHint') }}</span>
      </div>
      <ion-toggle
        :checked="draft.requireApproval"
        @ion-change="draft.requireApproval = $event.detail.checked"
      />
    </div>

    <!-- Test Connection -->
    <div :class="$style.testSection">
      <ion-button
        fill="outline"
        size="small"
        :disabled="!isFormValid || testStatus === 'testing'"
        @click="testConnection"
      >
        <ion-spinner v-if="testStatus === 'testing'" name="crescent" style="margin-right: 6px;" />
        {{ t('plugins.addServer.testConnection') }}
      </ion-button>
      <span v-if="testStatus === 'success'" :class="$style.testSuccess">
        <CheckCircle2 :size="14" style="margin-right: 4px;" />
        {{ t('plugins.addServer.toolsDiscovered', { count: discoveredToolCount }) }}
      </span>
      <span v-if="testStatus === 'error'" :class="$style.testError">
        {{ testError }}
      </span>
    </div>

    <!-- Actions -->
    <div :class="$style.actions">
      <ion-button
        fill="clear"
        size="default"
        @click="emit('cancel')"
      >
        {{ t('plugins.addServer.cancel') }}
      </ion-button>
      <ion-button
        fill="solid"
        size="default"
        :disabled="!isFormValid || isSaving"
        @click="handleSave"
      >
        <ion-spinner v-if="isSaving" name="crescent" style="margin-right: 6px;" />
        {{ isEditing ? t('plugins.addServer.save') : t('plugins.addServer.add') }}
      </ion-button>
    </div>
  </div>
</template>

<style lang="scss" module>
.form {
  max-width: 520px;
}

.header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: var(--spacing--lg, 20px);
}

.headerIcon {
  color: var(--color--primary, #ff6d5a);
}

.headerTitle {
  font-size: 16px;
  font-weight: 600;
  color: var(--color--text--shade-1);
}

.field {
  margin-bottom: var(--spacing--md, 16px);
}

.fieldLabel {
  display: block;
  font-size: var(--font-size--sm, 13px);
  font-weight: 500;
  color: var(--color--text--tint-1);
  margin-bottom: var(--spacing--xs, 4px);
}

.fieldHint {
  font-size: 12px;
  color: var(--color--text--tint-2);
  margin: 0 0 var(--spacing--xs, 4px);
}

.inputError {
  --border-color: var(--color--danger, #dc2626);
}

.errorText {
  display: block;
  font-size: 12px;
  color: var(--color--danger, #dc2626);
  margin-top: 4px;
}

.headerRow {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  margin-bottom: var(--spacing--xs, 4px);
}

.headerInput {
  flex: 1;
  min-width: 0;
}

.removeBtn {
  --padding-start: 6px;
  --padding-end: 6px;
  --padding-top: 4px;
  --padding-bottom: 4px;
  min-height: 28px;
  flex-shrink: 0;
  margin-bottom: 2px;
}

.addHeaderBtn {
  --padding-start: 4px;
  --padding-end: 8px;
  font-size: 13px;
}

.toggleField {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0;
  margin-bottom: var(--spacing--md, 16px);
  border-top: 1px solid var(--n8n-desk--content-bg, var(--color--background));
  border-bottom: 1px solid var(--n8n-desk--content-bg, var(--color--background));
}

.toggleInfo {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.toggleLabel {
  font-size: 14px;
  font-weight: 500;
  color: var(--color--text--shade-1);
}

.toggleHint {
  font-size: 12px;
  color: var(--color--text--tint-2);
}

.testSection {
  display: flex;
  align-items: center;
  gap: var(--spacing--sm, 8px);
  margin-bottom: var(--spacing--lg, 20px);
  flex-wrap: wrap;
}

.testSuccess {
  display: inline-flex;
  align-items: center;
  font-size: var(--font-size--sm, 13px);
  color: var(--color--success, #10b981);
}

.testError {
  font-size: var(--font-size--sm, 13px);
  color: var(--color--danger, #dc2626);
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing--sm, 8px);
}

// --- OAuth ---
.redirectUriBox {
  background: var(--n8n-desk--surface-bg, var(--color--foreground));
  border: 1px solid var(--n8n-desk--content-bg, var(--color--background));
  border-radius: 8px;
  padding: 8px 12px;

  code {
    font-size: 13px;
    font-family: 'SFMono-Regular', 'Consolas', 'Liberation Mono', 'Menlo', monospace;
    color: var(--color--text--shade-1);
    user-select: all;
  }
}

.oauthProbeHint {
  display: block;
  font-size: 12px;
  color: var(--color--success, #10b981);
  margin-top: 6px;
  font-weight: 500;
}

.oauthSection {
  margin-bottom: var(--spacing--md, 16px);
  padding: 16px;
  border-radius: 10px;
  background: var(--n8n-desk--surface-bg, var(--color--foreground));
  border: 1px solid var(--n8n-desk--content-bg, var(--color--background));
}

.oauthConnected {
  display: flex;
  align-items: center;
  gap: 10px;
}

.oauthConnectedIcon { color: var(--color--success, #10b981); flex-shrink: 0; }

.oauthConnectedInfo { flex: 1; }

.oauthConnectedLabel {
  font-size: 14px;
  font-weight: 600;
  color: var(--color--success, #10b981);
}

.oauthExpiry {
  display: block;
  font-size: 12px;
  color: var(--color--text--tint-1);
  margin-top: 2px;
}

.oauthConnecting {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  color: var(--color--text--tint-1);
}

.oauthError {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 13px;
  color: var(--color--danger, #dc2626);
}

.oauthErrorIcon { flex-shrink: 0; }

.oauthIdle {
  text-align: center;
}

.oauthHint {
  font-size: 13px;
  color: var(--color--text--tint-1);
  margin: 0 0 12px;
}
</style>
