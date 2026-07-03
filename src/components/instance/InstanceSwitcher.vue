<script setup lang="ts">
import {
  IonPopover, IonList, IonItem, IonLabel, IonIcon,
} from '@ionic/vue'
import { checkmark, addOutline, createOutline } from 'ionicons/icons'
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useInstancesStore } from '@/stores/instances'
import { useAuthStore } from '@/stores/auth'
import { useWorkflowSessionsStore } from '@/stores/workflow-sessions'
import { useCoworkSessionsStore } from '@/stores/cowork-sessions'
import InstanceEditModal from './InstanceEditModal.vue'

defineProps<{
  trigger?: string
}>()

const router = useRouter()
const { t } = useI18n()
const instancesStore = useInstancesStore()
const authStore = useAuthStore()
const workflowSessionsStore = useWorkflowSessionsStore()
const coworkSessionsStore = useCoworkSessionsStore()

const popover = defineModel<boolean>('isOpen', { default: false })

const editModalOpen = ref(false)
const editTargetId = ref<string | null>(null)

function openEdit(event: Event, instanceId: string): void {
  event.stopPropagation()
  editTargetId.value = instanceId
  editModalOpen.value = true
  popover.value = false
}

async function switchTo(instanceId: string): Promise<void> {
  if (instanceId === instancesStore.activeInstanceId) {
    popover.value = false
    return
  }

  // Full context swap
  authStore.reset()
  workflowSessionsStore.reset()
  coworkSessionsStore.reset()
  await instancesStore.setActive(instanceId)
  await authStore.hydrate(instanceId)
  await workflowSessionsStore.hydrate(instanceId)
  await coworkSessionsStore.hydrate(instanceId)

  popover.value = false

  // Navigate to chat as default landing
  router.replace('/chat')
}

function addInstance(): void {
  popover.value = false
  router.push('/onboarding')
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
  <ion-popover
    :trigger="trigger"
    :is-open="popover"
    @did-dismiss="popover = false"
    side="top"
    alignment="start"
    :dismiss-on-select="true"
  >
    <ion-list lines="none" class="instance-list">
      <ion-item
        v-for="instance in instancesStore.instances"
        :key="instance.id"
        button
        :detail="false"
        @click="switchTo(instance.id)"
        class="instance-item"
      >
        <div slot="start" class="instance-dot" :style="{ background: instance.color }" />
        <ion-label>
          <h3>{{ instance.label }}</h3>
          <p>{{ getHostname(instance.url) }}</p>
        </ion-label>
        <button
          type="button"
          class="edit-button"
          :aria-label="t('settings.instances.editInstance')"
          @click.stop="openEdit($event, instance.id)"
        >
          <ion-icon :icon="createOutline" />
        </button>
        <ion-icon
          v-if="instance.id === instancesStore.activeInstanceId"
          :icon="checkmark"
          slot="end"
          color="primary"
        />
      </ion-item>

      <ion-item button :detail="false" @click="addInstance" class="add-instance-item">
        <ion-icon :icon="addOutline" slot="start" color="medium" />
        <ion-label color="medium">{{ t('sidebar.addInstance') }}</ion-label>
      </ion-item>
    </ion-list>
  </ion-popover>

  <instance-edit-modal
    v-model:is-open="editModalOpen"
    :instance-id="editTargetId"
  />
</template>

<style scoped lang="scss">
.instance-list {
  padding: var(--spacing--2xs) 0;
}

.instance-item {
  --min-height: 48px;

  h3 {
    font-size: var(--font-size--sm);
    font-weight: var(--font-weight--medium);
  }

  p {
    font-size: var(--font-size--2xs);
    color: var(--color--text--tint-1);
  }
}

.instance-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  margin-right: var(--spacing--xs);
}

.add-instance-item {
  --min-height: 40px;
  border-top: 1px solid var(--border-color--subtle);
}

.edit-button {
  background: none;
  border: none;
  padding: var(--spacing--3xs);
  margin-right: var(--spacing--2xs);
  color: var(--color--text--tint-1);
  cursor: pointer;
  display: flex;
  align-items: center;
  border-radius: var(--radius--sm);

  &:hover {
    color: var(--color--primary);
    background: var(--n8n-desk--surface-raised-bg);
  }

  ion-icon {
    font-size: var(--font-size--md);
  }
}
</style>
