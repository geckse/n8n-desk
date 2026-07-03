<script setup lang="ts">
import { IonPage, IonHeader, IonToolbar, IonTitle, IonContent, IonList, IonListHeader, IonItem, IonLabel, IonSelect, IonSelectOption, IonButtons, IonBackButton, IonIcon, IonBadge, IonButton, IonNote } from '@ionic/vue'
import { chevronForward, addOutline } from 'ionicons/icons'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useSettingsStore } from '@/stores/settings'
import { useInstancesStore } from '@/stores/instances'
import { useTheme } from '@/composables/useTheme'
import type { ThemeMode, SupportedLocale } from '@/types/settings'
import InstanceEditModal from '@/components/instance/InstanceEditModal.vue'

const { t } = useI18n()
const router = useRouter()
const settingsStore = useSettingsStore()
const instancesStore = useInstancesStore()
const { applyTheme } = useTheme()

const editModalOpen = ref(false)
const editTargetId = ref<string | null>(null)

function onThemeChange(event: CustomEvent) {
  const value = event.detail.value as ThemeMode
  settingsStore.setTheme(value)
  applyTheme(value)
}

function onLocaleChange(event: CustomEvent) {
  const value = event.detail.value as SupportedLocale
  settingsStore.setLocale(value)
}

function openEdit(instanceId: string): void {
  editTargetId.value = instanceId
  editModalOpen.value = true
}

function addInstance(): void {
  router.push('/onboarding')
}

function getHostname(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}
</script>

<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/chat" />
        </ion-buttons>
        <ion-title>{{ t('settings.title') }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <ion-list>
        <!-- Instances section -->
        <ion-list-header>
          <ion-label>{{ t('settings.instances.title') }}</ion-label>
        </ion-list-header>
        <ion-item lines="none">
          <ion-note>{{ t('settings.instances.description') }}</ion-note>
        </ion-item>

        <ion-item v-if="!instancesStore.hasInstances" lines="full">
          <ion-label color="medium">{{ t('settings.instances.empty') }}</ion-label>
        </ion-item>

        <ion-item
          v-for="inst in instancesStore.instances"
          :key="inst.id"
          button
          :detail="false"
          @click="openEdit(inst.id)"
        >
          <div slot="start" class="instance-dot" :style="{ background: inst.color }" />
          <ion-label>
            <h3>{{ inst.label }}</h3>
            <p>{{ getHostname(inst.url) }}</p>
          </ion-label>
          <ion-badge v-if="inst.mcpServerUrl" slot="end" color="tertiary" class="mcp-badge">
            {{ t('settings.instances.customMcpBadge') }}
          </ion-badge>
          <ion-icon slot="end" :icon="chevronForward" color="medium" />
        </ion-item>

        <ion-item button :detail="false" @click="addInstance" lines="full">
          <ion-icon :icon="addOutline" slot="start" color="medium" />
          <ion-label color="medium">{{ t('settings.instances.addInstance') }}</ion-label>
        </ion-item>

        <!-- Preferences section -->
        <ion-list-header>
          <ion-label>{{ t('settings.sections.preferences') }}</ion-label>
        </ion-list-header>
        <ion-item>
          <ion-label>{{ t('settings.theme') }}</ion-label>
          <ion-select
            :value="settingsStore.theme"
            interface="popover"
            @ion-change="onThemeChange"
          >
            <ion-select-option value="system">{{ t('settings.themeSystem') }}</ion-select-option>
            <ion-select-option value="light">{{ t('settings.themeLight') }}</ion-select-option>
            <ion-select-option value="dark">{{ t('settings.themeDark') }}</ion-select-option>
          </ion-select>
        </ion-item>
        <ion-item>
          <ion-label>{{ t('settings.language') }}</ion-label>
          <ion-select
            :value="settingsStore.locale"
            interface="popover"
            @ion-change="onLocaleChange"
          >
            <ion-select-option value="en">English</ion-select-option>
          </ion-select>
        </ion-item>
      </ion-list>

      <!-- Instance edit modal -->
      <instance-edit-modal
        v-model:is-open="editModalOpen"
        :instance-id="editTargetId"
      />
    </ion-content>
  </ion-page>
</template>

<style scoped lang="scss">
.instance-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  margin-right: var(--spacing--sm);
}

.mcp-badge {
  margin-right: var(--spacing--xs);
  font-size: var(--font-size--2xs);
}
</style>
