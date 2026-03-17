<script setup lang="ts">
import { IonButton, IonIcon } from '@ionic/vue'
import { shieldCheckmarkOutline } from 'ionicons/icons'
import type { WorkflowJson, WorkflowPreviewData } from '@/types/agent'
import WorkflowEmbed from './WorkflowEmbed.vue'

interface PendingApproval {
  id: string
  toolName: string
  description: string
  workflowPreview?: WorkflowJson
}

interface Props {
  approval: PendingApproval
}

const props = defineProps<Props>()

const emit = defineEmits<{
  approve: [id: string]
  reject: [id: string]
}>()

function formatToolName(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function handlePreviewClick() {
  // Preview click in approval context is informational only
}
</script>

<template>
  <div :class="$style.card">
    <div :class="$style.header">
      <ion-icon :icon="shieldCheckmarkOutline" :class="$style.icon" />
      <span :class="$style.title">Approval Required</span>
    </div>

    <div :class="$style.body">
      <div :class="$style.operation">
        <span :class="$style.operationLabel">Operation:</span>
        <span :class="$style.operationName">{{ formatToolName(approval.toolName) }}</span>
      </div>

      <p :class="$style.description">{{ approval.description }}</p>

      <WorkflowEmbed
        v-if="approval.workflowPreview"
        :workflow="approval.workflowPreview"
        compact
        @click="handlePreviewClick"
      />

      <div :class="$style.actions">
        <ion-button fill="outline" color="medium" size="small" @click="emit('reject', approval.id)">
          Reject
        </ion-button>
        <ion-button color="primary" size="small" @click="emit('approve', approval.id)">
          Approve
        </ion-button>
      </div>
    </div>
  </div>
</template>

<style lang="scss" module>
.card {
  border: 1px solid var(--color--warning, #f59e0b);
  border-radius: 8px;
  overflow: hidden;
  background: var(--n8n-desk--surface-bg, var(--color--foreground));
  margin: 4px 0;
}

.header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: color-mix(in srgb, var(--color--warning, #f59e0b) 10%, transparent);
  border-bottom: 1px solid var(--color--warning, #f59e0b);
}

.icon {
  font-size: 18px;
  color: var(--color--warning, #f59e0b);
  flex-shrink: 0;
}

.title {
  font-size: 13px;
  font-weight: 600;
  color: var(--color--text-dark, #333);
}

.body {
  padding: 12px;
}

.operation {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}

.operationLabel {
  font-size: 12px;
  color: var(--color--text-light, #999);
}

.operationName {
  font-size: 13px;
  font-weight: 500;
  color: var(--color--text-dark, #333);
}

.description {
  font-size: 13px;
  line-height: 1.5;
  color: var(--color--text-base, #666);
  margin: 0 0 12px;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;

  ion-button {
    --border-radius: 6px;
  }
}
</style>
