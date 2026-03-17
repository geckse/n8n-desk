<script setup lang="ts">
import { computed, ref } from 'vue'
import { IonIcon, IonSpinner } from '@ionic/vue'
import {
  checkmarkCircleOutline,
  closeCircleOutline,
  timeOutline,
  buildOutline,
  chevronDownOutline,
  chevronForwardOutline,
} from 'ionicons/icons'
import type { AgentToolCall, WorkflowJson, WorkflowPreviewData } from '@/types/agent'
import WorkflowEmbed from './WorkflowEmbed.vue'

interface Props {
  toolCall: AgentToolCall
}

const props = defineProps<Props>()

const emit = defineEmits<{
  preview: [data: WorkflowPreviewData]
}>()

const expanded = ref(false)

const statusIcon = computed(() => {
  switch (props.toolCall.status) {
    case 'completed': return checkmarkCircleOutline
    case 'failed': return closeCircleOutline
    case 'awaiting_approval': return timeOutline
    default: return undefined
  }
})

const statusColor = computed(() => {
  switch (props.toolCall.status) {
    case 'completed': return 'var(--color--success, #10b981)'
    case 'failed': return 'var(--color--danger, #ef4444)'
    case 'awaiting_approval': return 'var(--color--warning, #f59e0b)'
    default: return 'var(--color--text-light, #999)'
  }
})

const isRunning = computed(() =>
  props.toolCall.status === 'pending' || props.toolCall.status === 'running'
)

const resultWorkflow = computed<WorkflowJson | null>(() => {
  if (!props.toolCall.result || typeof props.toolCall.result !== 'object') return null
  const r = props.toolCall.result as Record<string, unknown>
  if (Array.isArray(r.nodes) && r.connections) return r as unknown as WorkflowJson
  if (typeof r.workflow === 'object' && r.workflow !== null) {
    const w = r.workflow as Record<string, unknown>
    if (Array.isArray(w.nodes)) return w as unknown as WorkflowJson
  }
  return null
})

function handlePreviewClick() {
  if (!resultWorkflow.value) return
  emit('preview', {
    workflowId: (resultWorkflow.value.id as string) ?? '',
    name: resultWorkflow.value.name ?? 'Workflow',
    workflow: resultWorkflow.value,
  })
}

function formatToolName(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
</script>

<template>
  <div :class="$style.card">
    <div :class="$style.header" @click="expanded = !expanded">
      <div :class="$style.left">
        <ion-spinner v-if="isRunning" name="crescent" :class="$style.spinner" />
        <ion-icon v-else-if="statusIcon" :icon="statusIcon" :style="{ color: statusColor }" :class="$style.statusIcon" />
        <ion-icon :icon="buildOutline" :class="$style.toolIcon" />
        <span :class="$style.toolName">{{ formatToolName(toolCall.name) }}</span>
      </div>
      <ion-icon
        :icon="expanded ? chevronDownOutline : chevronForwardOutline"
        :class="$style.chevron"
      />
    </div>

    <div v-if="expanded" :class="$style.body">
      <div v-if="Object.keys(toolCall.args).length > 0" :class="$style.section">
        <div :class="$style.sectionLabel">Arguments</div>
        <pre :class="$style.code">{{ JSON.stringify(toolCall.args, null, 2) }}</pre>
      </div>

      <div v-if="toolCall.result !== undefined" :class="$style.section">
        <div :class="$style.sectionLabel">Result</div>
        <WorkflowEmbed
          v-if="resultWorkflow"
          :workflow="resultWorkflow"
          compact
          @click="handlePreviewClick"
        />
        <pre v-else :class="$style.code">{{ typeof toolCall.result === 'string' ? toolCall.result : JSON.stringify(toolCall.result, null, 2) }}</pre>
      </div>
    </div>
  </div>
</template>

<style lang="scss" module>
.card {
  border: 1px solid var(--n8n-desk--surface-bg, var(--color--foreground));
  border-radius: 8px;
  overflow: hidden;
  background: var(--n8n-desk--surface-bg, var(--color--foreground));
  margin: 4px 0;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  cursor: pointer;
  user-select: none;

  &:hover {
    background: var(--n8n-desk--surface-raised-bg, var(--color--foreground--tint-2));
  }
}

.left {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.spinner {
  width: 16px;
  height: 16px;
  --color: var(--color--text-light, #999);
}

.statusIcon {
  font-size: 16px;
  flex-shrink: 0;
}

.toolIcon {
  font-size: 14px;
  color: var(--color--text-light, #999);
  flex-shrink: 0;
}

.toolName {
  font-size: 13px;
  font-weight: 500;
  color: var(--color--text-dark, #333);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chevron {
  font-size: 14px;
  color: var(--color--text-light, #999);
  flex-shrink: 0;
}

.body {
  padding: 0 12px 12px;
}

.section {
  margin-top: 8px;
}

.sectionLabel {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--color--text-light, #999);
  margin-bottom: 4px;
}

.code {
  font-family: monospace;
  font-size: 12px;
  line-height: 1.5;
  background: var(--n8n-desk--content-bg, var(--color--background));
  border-radius: 4px;
  padding: 8px;
  overflow-x: auto;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--color--text-dark, #333);
}
</style>
