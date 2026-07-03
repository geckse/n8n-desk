<script setup lang="ts">
import { IonInput, IonButton, IonSpinner, IonIcon } from '@ionic/vue'
import { lockClosed } from 'ionicons/icons'
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { useInstancesStore } from '@/stores/instances'

const props = defineProps<{
  isOpen: boolean
}>()

const emit = defineEmits<{
  'update:isOpen': [value: boolean]
}>()

const { t } = useI18n()
const authStore = useAuthStore()
const instancesStore = useInstancesStore()

const email = ref('')
const password = ref('')
const mfaCode = ref('')
const isMfaRequired = ref(false)
const error = ref<string | null>(null)
const isLoading = ref(false)

// Reset form when modal opens
watch(() => props.isOpen, (open) => {
  if (open) {
    email.value = authStore.userProfile?.email ?? ''
    password.value = ''
    mfaCode.value = ''
    isMfaRequired.value = false
    error.value = null
    isLoading.value = false
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
</script>

<template>
  <Teleport to="body">
    <div v-if="isOpen" class="relogin-backdrop">
      <div class="relogin-modal">
        <h2 class="relogin-title">{{ t('reLogin.title') }}</h2>
        <p class="relogin-description">
          {{ t('reLogin.description', { instance: instancesStore.activeInstance?.label ?? '' }) }}
        </p>

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
            :disabled="!email || !password || isLoading"
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
  background: var(--n8n-desk--surface-bg);
  border: 1px solid var(--border-color--subtle);
  border-radius: var(--radius--sm);
  padding: var(--spacing--lg);
  width: 100%;
  max-width: 400px;
  margin: var(--spacing--md);
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
  margin: 0 0 var(--spacing--md) 0;
  line-height: 1.5;
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
