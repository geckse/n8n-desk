<script setup lang="ts">
import { IonInput, IonButton, IonSpinner } from '@ionic/vue'
import { ref, watch, computed } from 'vue'
import { Shield, Globe, Key, Wrench, Info } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { usePluginsStore } from '@/stores/plugins'
import type { MarketplacePluginEntry, InstalledPlugin } from '@/types/plugin'

interface Props {
  /** Whether the dialog is visible */
  isOpen: boolean
  /** The marketplace plugin entry to install */
  entry?: MarketplacePluginEntry
  /** The marketplace ID where this plugin was found */
  marketplaceId?: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:isOpen': [value: boolean]
  installed: [plugin: InstalledPlugin]
}>()

const { t } = useI18n()
const pluginsStore = usePluginsStore()

// --- Preview data ---

const isLoadingPreview = ref(false)
const previewError = ref<string | null>(null)
const serverUrls = ref<string[]>([])
const requiredHeaderNames = ref<string[]>([])
const discoveredToolCount = ref<number | null>(null)

// --- Header value inputs ---

interface HeaderInput {
  name: string
  value: string
}

const headerInputs = ref<HeaderInput[]>([])

// --- Install state ---

const isInstalling = ref(false)
const installError = ref<string | null>(null)

// --- Computed ---

const pluginName = computed(() => props.entry?.name ?? '')

const hasHeaders = computed(() => requiredHeaderNames.value.length > 0)

const showHeaderInputs = computed(() => hasHeaders.value)

const allHeadersFilled = computed(() => {
  if (!hasHeaders.value) return true
  return headerInputs.value.every((h) => h.value.trim().length > 0)
})

const canConfirm = computed(() =>
  !isLoadingPreview.value &&
  !isInstalling.value &&
  allHeadersFilled.value &&
  !previewError.value,
)

// --- Lifecycle ---

watch(() => props.isOpen, async (open) => {
  if (open && props.entry && props.marketplaceId) {
    await loadPreview()
  } else if (!open) {
    resetState()
  }
})

function resetState(): void {
  isLoadingPreview.value = false
  previewError.value = null
  serverUrls.value = []
  requiredHeaderNames.value = []
  discoveredToolCount.value = null
  headerInputs.value = []
  isInstalling.value = false
  installError.value = null
}

async function loadPreview(): Promise<void> {
  if (!props.entry || !props.marketplaceId) return

  isLoadingPreview.value = true
  previewError.value = null

  try {
    const bridge = window.n8nDesk?.plugins
    if (!bridge) throw new Error('Plugin bridge not available')

    const result = await bridge.previewInstall(props.entry.name, props.marketplaceId)

    if (result.error) {
      previewError.value = result.error
      return
    }

    serverUrls.value = result.urls
    requiredHeaderNames.value = result.headerNames
    discoveredToolCount.value = result.toolCount

    // Build header input fields
    headerInputs.value = result.headerNames.map((name) => ({
      name,
      value: '',
    }))
  } catch (err: unknown) {
    previewError.value = err instanceof Error
      ? err.message
      : t('plugins.installConfirm.previewFailed')
  } finally {
    isLoadingPreview.value = false
  }
}

// --- Actions ---

async function handleConfirm(): Promise<void> {
  if (!props.entry || !props.marketplaceId) return

  isInstalling.value = true
  installError.value = null

  try {
    // Install the plugin
    const plugin = await pluginsStore.installPlugin(
      props.entry.name,
      props.marketplaceId,
    )

    // Store header secret values in keychain
    for (const header of headerInputs.value) {
      const name = header.name.trim()
      const value = header.value.trim()
      if (name && value) {
        await pluginsStore.setSecret('plugin', plugin.id, name, value)
      }
    }

    emit('installed', plugin)
    emit('update:isOpen', false)
  } catch (err: unknown) {
    installError.value = err instanceof Error
      ? err.message
      : t('plugins.installConfirm.installFailed')
  } finally {
    isInstalling.value = false
  }
}

function handleCancel(): void {
  emit('update:isOpen', false)
}
</script>

<template>
  <Teleport to="body">
    <div v-if="isOpen" :class="$style.backdrop" @click.self="handleCancel">
      <div :class="$style.modal">
        <!-- Header -->
        <div :class="$style.header">
          <Shield :size="20" :class="$style.headerIcon" />
          <h2 :class="$style.title">{{ t('plugins.installConfirm.title') }}</h2>
        </div>

        <p :class="$style.description">
          {{ t('plugins.installConfirm.description', { name: pluginName }) }}
        </p>

        <!-- Loading state -->
        <div v-if="isLoadingPreview" :class="$style.loadingWrap">
          <ion-spinner name="crescent" />
        </div>

        <!-- Preview error -->
        <p v-else-if="previewError" :class="$style.errorText">
          {{ previewError }}
        </p>

        <!-- Preview details -->
        <template v-else>
          <!-- Server URLs -->
          <div v-if="serverUrls.length > 0" :class="$style.section">
            <div :class="$style.sectionHeader">
              <Globe :size="14" :class="$style.sectionIcon" />
              <span :class="$style.sectionLabel">
                {{ t('plugins.installConfirm.serverUrls') }}
              </span>
            </div>
            <ul :class="$style.urlList">
              <li v-for="url in serverUrls" :key="url" :class="$style.urlItem">
                {{ url }}
              </li>
            </ul>
          </div>

          <!-- Required auth headers -->
          <div :class="$style.section">
            <div :class="$style.sectionHeader">
              <Key :size="14" :class="$style.sectionIcon" />
              <span :class="$style.sectionLabel">
                {{ t('plugins.installConfirm.authHeaders') }}
              </span>
            </div>
            <div v-if="hasHeaders" :class="$style.headerNameList">
              <span
                v-for="name in requiredHeaderNames"
                :key="name"
                :class="$style.headerBadge"
              >
                {{ name }}
              </span>
            </div>
            <span v-else :class="$style.noHeaders">
              {{ t('plugins.installConfirm.noHeaders') }}
            </span>
          </div>

          <!-- Tool count -->
          <div :class="$style.section">
            <div :class="$style.sectionHeader">
              <Wrench :size="14" :class="$style.sectionIcon" />
              <span :class="$style.sectionLabel">
                <template v-if="discoveredToolCount !== null && discoveredToolCount > 0">
                  {{ t('plugins.installConfirm.toolCount', { count: discoveredToolCount }) }}
                </template>
                <template v-else>
                  {{ t('plugins.installConfirm.toolCountUnknown') }}
                </template>
              </span>
            </div>
          </div>

          <!-- Security info callout -->
          <div :class="$style.callout">
            <Info :size="16" :class="$style.calloutIcon" />
            <span :class="$style.calloutText">
              {{ t('plugins.installConfirm.securityInfo') }}
            </span>
          </div>

          <!-- Header value inputs (shown when headers are required) -->
          <div v-if="showHeaderInputs" :class="$style.headerInputSection">
            <p :class="$style.headerInputHint">
              {{ t('plugins.installConfirm.enterHeaderValues') }}
            </p>
            <div
              v-for="(header, index) in headerInputs"
              :key="header.name"
              :class="$style.headerInputField"
            >
              <ion-input
                v-model="headerInputs[index].value"
                :label="t('plugins.installConfirm.headerValue', { name: header.name })"
                fill="outline"
                label-placement="stacked"
                :placeholder="t('plugins.installConfirm.headerPlaceholder')"
                type="password"
              />
            </div>
          </div>
        </template>

        <!-- Install error -->
        <p v-if="installError" :class="$style.errorText">{{ installError }}</p>

        <!-- Actions -->
        <div :class="$style.actions">
          <ion-button
            fill="clear"
            size="default"
            :disabled="isInstalling"
            @click="handleCancel"
          >
            {{ t('plugins.installConfirm.cancel') }}
          </ion-button>
          <ion-button
            fill="solid"
            size="default"
            :disabled="!canConfirm"
            @click="handleConfirm"
          >
            <ion-spinner v-if="isInstalling" name="crescent" :class="$style.spinner" />
            <span v-else>{{ t('plugins.installConfirm.confirm') }}</span>
          </ion-button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style lang="scss" module>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
}

.modal {
  background: var(--n8n-desk--surface-bg);
  border: 1px solid var(--border-color--subtle);
  border-radius: var(--radius--sm);
  padding: var(--spacing--lg);
  width: 100%;
  max-width: 480px;
  margin: var(--spacing--md);
  max-height: 90vh;
  overflow-y: auto;
}

.header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: var(--spacing--2xs);
}

.headerIcon {
  color: var(--color--primary, #ff6d5a);
  flex-shrink: 0;
}

.title {
  font-size: var(--font-size--lg);
  font-weight: var(--font-weight--bold);
  color: var(--color--text);
  margin: 0;
}

.description {
  font-size: var(--font-size--sm);
  color: var(--color--text--tint-1);
  margin: 0 0 var(--spacing--md) 0;
  line-height: 1.5;
}

.loadingWrap {
  display: flex;
  justify-content: center;
  padding: var(--spacing--lg) 0;
}

.section {
  margin-bottom: var(--spacing--sm);
}

.sectionHeader {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.sectionIcon {
  color: var(--color--text--tint-1);
  flex-shrink: 0;
}

.sectionLabel {
  font-size: var(--font-size--sm, 13px);
  font-weight: 500;
  color: var(--color--text--tint-1);
}

.urlList {
  list-style: none;
  margin: 0;
  padding: 0;
}

.urlItem {
  font-size: 12px;
  font-family: monospace;
  color: var(--color--text);
  background: var(--n8n-desk--surface-raised-bg, var(--color--foreground--tint-2));
  border-radius: 4px;
  padding: 4px 8px;
  margin-bottom: 4px;
  word-break: break-all;
}

.headerNameList {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.headerBadge {
  display: inline-block;
  font-size: 12px;
  font-family: monospace;
  font-weight: 500;
  color: var(--color--text);
  background: var(--n8n-desk--surface-raised-bg, var(--color--foreground--tint-2));
  border-radius: 4px;
  padding: 2px 8px;
}

.noHeaders {
  font-size: var(--font-size--sm, 13px);
  color: var(--color--text--tint-2);
}

.callout {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  background: var(--n8n-desk--surface-raised-bg, var(--color--foreground--tint-2));
  border: 1px solid var(--n8n-desk--content-bg, var(--color--background));
  border-radius: 6px;
  padding: 10px 12px;
  margin: var(--spacing--md) 0;
}

.calloutIcon {
  color: var(--color--primary, #ff6d5a);
  flex-shrink: 0;
  margin-top: 1px;
}

.calloutText {
  font-size: var(--font-size--2xs, 12px);
  color: var(--color--text--tint-1);
  line-height: 1.4;
}

.headerInputSection {
  margin-bottom: var(--spacing--sm);
}

.headerInputHint {
  font-size: 12px;
  color: var(--color--text--tint-2);
  margin: 0 0 var(--spacing--xs, 4px);
}

.headerInputField {
  margin-bottom: var(--spacing--xs, 4px);
}

.errorText {
  color: var(--color--danger);
  font-size: var(--font-size--2xs);
  margin: var(--spacing--xs) 0;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing--sm, 8px);
  margin-top: var(--spacing--md);
}

.spinner {
  width: 16px;
  height: 16px;
}
</style>
