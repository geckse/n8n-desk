<script setup lang="ts">
import {
  IonPopover, IonList, IonItem, IonLabel, IonIcon,
} from '@ionic/vue'
import { checkmark, addOutline } from 'ionicons/icons'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useInstancesStore } from '@/stores/instances'
import { useAuthStore } from '@/stores/auth'

const props = defineProps<{
  trigger?: string
}>()

const router = useRouter()
const { t } = useI18n()
const instancesStore = useInstancesStore()
const authStore = useAuthStore()

const popover = defineModel<boolean>('isOpen', { default: false })

async function switchTo(instanceId: string): Promise<void> {
  if (instanceId === instancesStore.activeInstanceId) {
    popover.value = false
    return
  }

  // Full context swap
  authStore.reset()
  await instancesStore.setActive(instanceId)
  await authStore.hydrate(instanceId)

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
</style>
