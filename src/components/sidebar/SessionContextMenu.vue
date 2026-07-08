<script setup lang="ts">
import { IonPopover, IonList, IonItem, IonLabel, isPlatform, actionSheetController, alertController } from '@ionic/vue'
import { Pencil, RotateCcw, Trash2 } from 'lucide-vue-next'
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  sessionId: string
  sessionTitle: string
  isOpen: boolean
  event: Event | null
  /** Show the "Re-run" action (agent sessions only — audit #50) */
  showRerun?: boolean
}>()

const emit = defineEmits<{
  rename: [id: string]
  rerun: [id: string]
  delete: [id: string]
  dismiss: []
}>()

const { t } = useI18n()
const popoverOpen = ref(false)

watch(() => props.isOpen, async (open) => {
  if (!open) {
    popoverOpen.value = false
    return
  }

  if (isPlatform('mobile') || isPlatform('mobileweb')) {
    await showActionSheet()
  } else {
    popoverOpen.value = true
  }
})

async function showActionSheet() {
  const sheet = await actionSheetController.create({
    header: props.sessionTitle,
    buttons: [
      ...(props.showRerun ? [{
        text: t('sidebar.rerun'),
        handler: () => {
          emit('rerun', props.sessionId)
        },
      }] : []),
      {
        text: t('sidebar.rename'),
        handler: () => {
          emit('rename', props.sessionId)
        },
      },
      {
        text: t('sidebar.delete'),
        role: 'destructive',
        handler: () => {
          confirmDelete()
        },
      },
      {
        text: t('sidebar.cancel'),
        role: 'cancel',
        handler: () => {
          emit('dismiss')
        },
      },
    ],
  })
  await sheet.present()
  const { role } = await sheet.onDidDismiss()
  if (role === 'cancel' || role === 'backdrop') {
    emit('dismiss')
  }
}

async function confirmDelete() {
  const alert = await alertController.create({
    header: t('sidebar.deleteConfirmTitle'),
    message: t('sidebar.deleteConfirmMessage'),
    buttons: [
      {
        text: t('sidebar.cancel'),
        role: 'cancel',
      },
      {
        text: t('sidebar.deleteConfirmButton'),
        role: 'destructive',
        handler: () => {
          emit('delete', props.sessionId)
        },
      },
    ],
  })
  await alert.present()
  const { role } = await alert.onDidDismiss()
  if (role === 'cancel') {
    emit('dismiss')
  }
}

function handleRename() {
  popoverOpen.value = false
  emit('rename', props.sessionId)
}

function handleRerun() {
  popoverOpen.value = false
  emit('rerun', props.sessionId)
}

function handleDelete() {
  popoverOpen.value = false
  confirmDelete()
}

function onPopoverDismiss() {
  popoverOpen.value = false
  emit('dismiss')
}
</script>

<template>
  <ion-popover
    :is-open="popoverOpen"
    :event="event"
    :dismiss-on-select="true"
    @did-dismiss="onPopoverDismiss"
  >
    <ion-list lines="none" class="context-menu-list">
      <ion-item v-if="showRerun" button @click="handleRerun">
        <RotateCcw :size="14" class="context-menu-icon" />
        <ion-label>{{ t('sidebar.rerun') }}</ion-label>
      </ion-item>
      <ion-item button @click="handleRename">
        <Pencil :size="14" class="context-menu-icon" />
        <ion-label>{{ t('sidebar.rename') }}</ion-label>
      </ion-item>
      <ion-item button class="context-menu-delete" @click="handleDelete">
        <Trash2 :size="14" class="context-menu-icon context-menu-icon--danger" />
        <ion-label color="danger">{{ t('sidebar.delete') }}</ion-label>
      </ion-item>
    </ion-list>
  </ion-popover>
</template>

<style scoped lang="scss">
.context-menu-list {
  padding: 4px;

  ion-item {
    --background: transparent;
    --min-height: 34px;
    --padding-start: 10px;
    --inner-padding-end: 12px;
    font-size: var(--font-size--sm);
    border-radius: var(--radius--2xs);
    cursor: pointer;

    &:hover {
      --background: var(--n8n-desk--surface-raised-bg);
    }
  }
}

.context-menu-icon {
  margin-right: 8px;
  color: var(--color--text--tint-1);
  flex-shrink: 0;

  &--danger {
    color: var(--color--danger);
  }
}
</style>
