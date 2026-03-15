<script setup lang="ts">
import { IonInput, IonSelect, IonSelectOption, IonButton, IonIcon } from '@ionic/vue'
import { ref, reactive, watch, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Settings as SettingsIcon, Globe, Trash2, Server,
} from 'lucide-vue-next'
import SettingsModal from '@/components/ui/SettingsModal.vue'
import SettingsNavGroup from '@/components/ui/SettingsNavGroup.vue'
import SettingsNavItem from '@/components/ui/SettingsNavItem.vue'
import { useSettingsStore } from '@/stores/settings'
import { useInstancesStore } from '@/stores/instances'
import { useAuthStore } from '@/stores/auth'
import { useTheme } from '@/composables/useTheme'
import type { ThemeMode, SupportedLocale } from '@/types/settings'

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

const activeSection = ref('general')

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
watch(() => props.isOpen, (open) => {
  if (open) {
    draft.theme = settingsStore.theme
    draft.locale = settingsStore.locale
    draft.instances = instancesStore.instances.map((i) => ({
      id: i.id,
      label: i.label,
      color: i.color,
      url: i.url,
    }))
    activeSection.value = 'general'
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

// --- Danger Zone ---
.danger-description {
  font-size: var(--font-size--sm);
  color: var(--color--text--tint-1);
  margin: 0 0 var(--spacing--sm);
}
</style>
