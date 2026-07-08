<script setup lang="ts">
import { IonInput, IonButton, IonSpinner, IonIcon } from '@ionic/vue'
import { lockClosed } from 'ionicons/icons'
import { ArrowLeftRight, X } from 'lucide-vue-next'
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { useInstancesStore } from '@/stores/instances'
import { useInstanceSwitch } from '@/composables/useInstanceSwitch'

const props = defineProps<{
  isOpen: boolean
}>()

const emit = defineEmits<{
  'update:isOpen': [value: boolean]
}>()

const { t } = useI18n()
const authStore = useAuthStore()
const instancesStore = useInstancesStore()
const { switchTo } = useInstanceSwitch()

const email = ref('')
const password = ref('')
const mfaCode = ref('')
const isMfaRequired = ref(false)
const error = ref<string | null>(null)
const isLoading = ref(false)

// --- Instance identity + switcher ---
const showSwitcher = ref(false)
const isSwitching = ref(false)
const switchTargetId = ref<string | null>(null)

const activeInstance = computed(() => instancesStore.activeInstance)
const otherInstances = computed(() =>
  instancesStore.instances.filter((i) => i.id !== instancesStore.activeInstanceId),
)

// The modal serves two cases: a genuinely expired session (blocking — no
// dismiss) and an explicit sign-in request from Settings (dismissible).
const isExpiredReason = computed(() => authStore.sessionExpired)

function getHostname(url: string): string {
  try {
    return new globalThis.URL(url).hostname
  } catch {
    return url
  }
}

// Reset form when modal opens
watch(() => props.isOpen, (open) => {
  if (open) {
    email.value = authStore.userProfile?.email ?? ''
    password.value = ''
    mfaCode.value = ''
    isMfaRequired.value = false
    error.value = null
    isLoading.value = false
    showSwitcher.value = false
    isSwitching.value = false
    switchTargetId.value = null
  }
})

async function submit(): Promise<void> {
  const instance = instancesStore.activeInstance
  if (!instance) return

  error.value = null
  isLoading.value = true

  try {
    const result = await authStore.credentialLogin(instance.id, {
      email: email.value,
      password: password.value,
      mfaCode: isMfaRequired.value ? mfaCode.value : undefined,
    })

    if (result.success) {
      authStore.clearSessionExpired()
      emit('update:isOpen', false)
    } else {
      if (result.errorCode === 'mfa_required') {
        isMfaRequired.value = true
        error.value = null
      } else {
        error.value = result.error || t('reLogin.error')
      }
    }
  } catch {
    error.value = t('reLogin.error')
  } finally {
    isLoading.value = false
  }
}

async function handleSwitch(instanceId: string): Promise<void> {
  if (isSwitching.value) return
  isSwitching.value = true
  switchTargetId.value = instanceId
  try {
    // Full context swap. Visibility is driven entirely by
    // authStore.sessionExpired: the swap's reset clears it (modal closes),
    // and if the target instance's session turns out to be dead too, the
    // swap's validation re-marks it and the modal reappears showing the new
    // instance. Do NOT emit update:isOpen here — MenuLayout responds to it
    // with clearSessionExpired(), which would wipe that fresh verdict.
    await switchTo(instanceId)
  } finally {
    isSwitching.value = false
    switchTargetId.value = null
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="isOpen" class="relogin-backdrop">
      <div class="relogin-modal">
        <button
          v-if="!isExpiredReason"
          type="button"
          class="relogin-close"
          :aria-label="t('settingsModal.cancel')"
          @click="emit('update:isOpen', false)"
        >
          <X :size="16" />
        </button>
        <h2 class="relogin-title">{{ isExpiredReason ? t('reLogin.title') : t('reLogin.signInTitle') }}</h2>
        <p class="relogin-description">{{ isExpiredReason ? t('reLogin.description') : t('reLogin.signInDescription') }}</p>

        <!-- Instance identity -->
        <div class="relogin-instance">
          <span
            class="instance-dot"
            :style="{ background: activeInstance?.color ?? 'var(--color--primary)' }"
          />
          <div class="instance-meta">
            <span class="instance-label">{{ activeInstance?.label }}</span>
            <span class="instance-url">{{ getHostname(activeInstance?.url ?? '') }}</span>
          </div>
          <button
            v-if="otherInstances.length > 0"
            type="button"
            class="switch-toggle"
            @click="showSwitcher = !showSwitcher"
          >
            <ArrowLeftRight :size="12" />
            {{ t('reLogin.switchInstance') }}
          </button>
        </div>

        <!-- Inline instance switcher -->
        <div v-if="showSwitcher && otherInstances.length > 0" class="relogin-switch-list">
          <p class="switch-list-hint">{{ t('reLogin.switchHint') }}</p>
          <button
            v-for="inst in otherInstances"
            :key="inst.id"
            type="button"
            class="switch-item"
            :disabled="isSwitching"
            @click="handleSwitch(inst.id)"
          >
            <span class="instance-dot" :style="{ background: inst.color }" />
            <div class="instance-meta">
              <span class="instance-label">{{ inst.label }}</span>
              <span class="instance-url">{{ getHostname(inst.url) }}</span>
            </div>
            <ion-spinner
              v-if="isSwitching && switchTargetId === inst.id"
              name="crescent"
              class="switch-spinner"
            />
          </button>
        </div>

        <form class="relogin-form" @submit.prevent="submit">
          <ion-input
            v-model="email"
            type="email"
            :label="t('onboarding.emailLabel')"
            label-placement="stacked"
            fill="outline"
            :placeholder="t('onboarding.emailPlaceholder')"
            autocomplete="email"
          />

          <ion-input
            v-model="password"
            type="password"
            :label="t('onboarding.passwordLabel')"
            label-placement="stacked"
            fill="outline"
            autocomplete="current-password"
          />

          <ion-input
            v-if="isMfaRequired"
            v-model="mfaCode"
            type="text"
            inputmode="numeric"
            :label="t('onboarding.mfaLabel')"
            label-placement="stacked"
            fill="outline"
            :placeholder="t('onboarding.mfaPlaceholder')"
            autocomplete="one-time-code"
            :maxlength="6"
          />

          <p v-if="error" class="relogin-error">{{ error }}</p>

          <ion-button
            expand="block"
            type="submit"
            :disabled="!email || !password || isLoading || isSwitching"
          >
            <ion-spinner v-if="isLoading" name="crescent" />
            <span v-else>{{ t('reLogin.signInButton') }}</span>
          </ion-button>

          <p class="relogin-privacy-note">
            <ion-icon :icon="lockClosed" aria-hidden="true" />
            <span>{{ t('reLogin.privacyNote') }}</span>
          </p>
        </form>
      </div>
    </div>
  </Teleport>
</template>

<style scoped lang="scss">
.relogin-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
}

.relogin-modal {
  position: relative;
  background: var(--n8n-desk--surface-bg);
  border: 1px solid var(--border-color--subtle);
  border-radius: var(--radius--sm);
  padding: var(--spacing--lg);
  width: 100%;
  max-width: 400px;
  margin: var(--spacing--md);
}

.relogin-close {
  position: absolute;
  top: var(--spacing--sm);
  right: var(--spacing--sm);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--radius--2xs);
  background: transparent;
  color: var(--color--text--tint-1);
  cursor: pointer;

  &:hover {
    background: var(--n8n-desk--surface-raised-bg);
    color: var(--color--text);
  }
}

.relogin-title {
  font-size: var(--font-size--lg);
  font-weight: var(--font-weight--bold);
  color: var(--color--text);
  margin: 0 0 var(--spacing--2xs) 0;
}

.relogin-description {
  font-size: var(--font-size--sm);
  color: var(--color--text--tint-1);
  margin: 0 0 var(--spacing--sm) 0;
  line-height: 1.5;
}

// --- Instance identity card ---
.relogin-instance {
  display: flex;
  align-items: center;
  gap: var(--spacing--xs);
  padding: var(--spacing--xs) var(--spacing--sm);
  border: 1px solid var(--border-color--subtle);
  border-radius: var(--radius--sm);
  background: var(--n8n-desk--surface-raised-bg);
  margin-bottom: var(--spacing--sm);
}

.instance-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.instance-meta {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  flex: 1;
  text-align: left;
}

.instance-label {
  font-size: var(--font-size--sm);
  font-weight: var(--font-weight--medium);
  color: var(--color--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.instance-url {
  font-size: var(--font-size--2xs);
  color: var(--color--text--tint-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.switch-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  padding: 4px 10px;
  border: 1px solid var(--border-color--subtle);
  border-radius: var(--radius--2xs);
  background: transparent;
  color: var(--color--text--tint-1);
  font-size: var(--font-size--2xs);
  cursor: pointer;
  transition: color 0.15s ease, background 0.15s ease;

  &:hover {
    color: var(--color--text);
    background: var(--n8n-desk--surface-bg);
  }
}

// --- Inline switcher list ---
.relogin-switch-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing--3xs);
  margin-bottom: var(--spacing--sm);
}

.switch-list-hint {
  font-size: var(--font-size--2xs);
  color: var(--color--text--tint-1);
  margin: 0 0 var(--spacing--3xs);
}

.switch-item {
  display: flex;
  align-items: center;
  gap: var(--spacing--xs);
  width: 100%;
  padding: var(--spacing--xs) var(--spacing--sm);
  border: 1px solid var(--border-color--subtle);
  border-radius: var(--radius--sm);
  background: transparent;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;

  &:hover:not(:disabled) {
    background: var(--n8n-desk--surface-raised-bg);
    border-color: var(--color--primary);
  }

  &:disabled {
    opacity: 0.6;
    cursor: default;
  }
}

.switch-spinner {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.relogin-form {
  display: flex;
  flex-direction: column;
  gap: var(--spacing--sm);
}

.relogin-error {
  color: var(--color--danger);
  font-size: var(--font-size--2xs);
  margin: 0;
}

.relogin-privacy-note {
  display: flex;
  align-items: flex-start;
  gap: var(--spacing--3xs);
  font-size: var(--font-size--2xs);
  color: var(--color--text--tint-1);
  line-height: 1.5;
  margin: var(--spacing--2xs) 0 0 0;

  ion-icon {
    flex-shrink: 0;
    font-size: var(--font-size--xs);
    margin-top: 2px;
  }
}
</style>
