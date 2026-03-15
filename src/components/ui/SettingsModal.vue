<script setup lang="ts">
import { IonModal, IonButton, IonIcon } from '@ionic/vue'
import { X } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  isOpen: boolean
  title: string
  saveLabel?: string
  cancelLabel?: string
  saveDisabled?: boolean
}>()

const emit = defineEmits<{
  'update:isOpen': [value: boolean]
  save: []
  cancel: []
}>()

const { t } = useI18n()

function close() {
  emit('update:isOpen', false)
  emit('cancel')
}

function onSave() {
  emit('save')
}
</script>

<template>
  <ion-modal
    :is-open="isOpen"
    @did-dismiss="close"
    class="settings-modal"
  >
    <div class="settings-modal-container">
      <!-- Header -->
      <div class="settings-header">
        <h2 class="settings-header-title">{{ title }}</h2>
        <button class="settings-close-btn" @click="close">
          <X :size="20" />
        </button>
      </div>

      <!-- Body: sidebar + content -->
      <div class="settings-body">
        <nav class="settings-sidebar">
          <slot name="sidebar" />
        </nav>
        <div class="settings-content">
          <slot />
        </div>
      </div>

      <!-- Footer -->
      <div class="settings-footer">
        <ion-button fill="outline" class="footer-cancel" @click="close">
          {{ cancelLabel || t('settingsModal.cancel') }}
        </ion-button>
        <ion-button class="footer-save" :disabled="saveDisabled" @click="onSave">
          {{ saveLabel || t('settingsModal.save') }}
        </ion-button>
      </div>
    </div>
  </ion-modal>
</template>

<style scoped lang="scss">
// --- Modal sizing via Ionic CSS custom properties ---
.settings-modal {
  --width: min(900px, 90vw);
  --height: min(640px, 85vh);
  --border-radius: var(--radius--sm, 12px);
  --background: var(--n8n-desk--surface-bg);
}

.settings-modal-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

// --- Header ---
.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing--sm) var(--spacing--md);
  border-bottom: 1px solid var(--border-color--subtle);
  flex-shrink: 0;
}

.settings-header-title {
  font-size: var(--font-size--lg);
  font-weight: var(--font-weight--bold);
  color: var(--color--text);
  margin: 0;
}

.settings-close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: var(--radius--2xs);
  background: transparent;
  color: var(--color--text--tint-1);
  cursor: pointer;
  padding: 0;
  transition: background 0.15s ease, color 0.15s ease;

  &:hover {
    background: var(--n8n-desk--surface-raised-bg);
    color: var(--color--text);
  }
}

// --- Body ---
.settings-body {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

// --- Sidebar ---
.settings-sidebar {
  width: 220px;
  min-width: 220px;
  border-right: 1px solid var(--border-color--subtle);
  padding: var(--spacing--sm) 0;
  overflow-y: auto;
  flex-shrink: 0;
}

// --- Content ---
.settings-content {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: var(--spacing--md) var(--spacing--lg);
}

// --- Footer ---
.settings-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing--sm);
  padding: var(--spacing--sm) var(--spacing--md);
  border-top: 1px solid var(--border-color--subtle);
  flex-shrink: 0;
}

.footer-cancel {
  --color: var(--color--primary);
  --border-color: var(--color--primary);
}

.footer-save {
  --background: var(--color--primary);
  --color: var(--color--neutral-white, #fff);
}
</style>
