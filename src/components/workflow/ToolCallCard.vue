<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
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
import { toolDisplayName } from '@/utils/tool-display'
import WorkflowEmbed from './WorkflowEmbed.vue'

interface Props {
  toolCall: AgentToolCall
}

const props = defineProps<Props>()

const emit = defineEmits<{
  preview: [data: WorkflowPreviewData]
}>()

const { t } = useI18n()
const expanded = ref(false)

const statusIcon = computed(() => {
  switch (props.toolCall.status) {
    case 'completed': return checkmarkCircleOutline
    case 'failed': return closeCircleOutline
    case 'awaiting_approval': return timeOutline
    case 'awaiting_input': return timeOutline
    default: return undefined
  }
})

const statusColor = computed(() => {
  switch (props.toolCall.status) {
    case 'completed': return 'var(--color--success, #10b981)'
    case 'failed': return 'var(--color--danger, #ef4444)'
    case 'awaiting_approval': return 'var(--color--warning, #f59e0b)'
    case 'awaiting_input': return 'var(--color--warning, #f59e0b)'
    default: return 'var(--color--text--tint-1)'
  }
})

const isRunning = computed(() =>
  props.toolCall.status === 'pending' || props.toolCall.status === 'running'
)

const resultWorkflow = computed<WorkflowJson | null>(() => {
  if (!props.toolCall.result) return null

  // Result may be a JSON string from the agent runner
  let parsed: unknown = props.toolCall.result
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed) } catch { return null }
  }
  if (typeof parsed !== 'object' || parsed === null) return null

  const r = parsed as Record<string, unknown>
  if (Array.isArray(r.nodes) && r.connections) return r as unknown as WorkflowJson
  if (typeof r.workflow === 'object' && r.workflow !== null) {
    const w = r.workflow as Record<string, unknown>
    if (Array.isArray(w.nodes)) return w as unknown as WorkflowJson
  }
  // MCP structured format
  if (typeof r.structuredContent === 'object' && r.structuredContent !== null) {
    const sc = r.structuredContent as Record<string, unknown>
    if (typeof sc.workflow === 'object' && sc.workflow !== null) {
      const w = sc.workflow as Record<string, unknown>
      if (Array.isArray(w.nodes)) return w as unknown as WorkflowJson
    }
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

</script>

<template>
  <div :class="$style.card">
    <div :class="$style.header" @click="expanded = !expanded">
      <div :class="$style.left">
        <ion-spinner v-if="isRunning" name="crescent" :class="$style.spinner" />
        <ion-icon v-else-if="statusIcon" :icon="statusIcon" :style="{ color: statusColor }" :class="$style.statusIcon" />
        <ion-icon :icon="buildOutline" :class="$style.toolIcon" />
        <span :class="$style.toolName">{{ toolDisplayName(toolCall.name) }}</span>
      </div>
      <ion-icon
        :icon="expanded ? chevronDownOutline : chevronForwardOutline"
        :class="$style.chevron"
      />
    </div>

    <div v-if="expanded" :class="$style.body">
      <div v-if="Object.keys(toolCall.args).length > 0" :class="$style.section">
        <div :class="$style.sectionLabel">{{ t('agentPanel.toolCard.arguments') }}</div>
        <pre :class="$style.code">{{ JSON.stringify(toolCall.args, null, 2) }}</pre>
      </div>

      <div v-if="toolCall.result !== undefined" :class="$style.section">
        <div :class="$style.sectionLabel">{{ t('agentPanel.toolCard.result') }}</div>
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
  border: none;
  border-radius: 0;
  overflow: hidden;
  background: none;
  margin: 2px 0;
}

.header {
  display: inline-flex;
  align-items: center;
  gap: 0;
  padding: 4px 0;
  cursor: pointer;
  user-select: none;
  border-radius: 6px;

  &:hover {
    background: var(--n8n-desk--surface-bg, var(--color--foreground));
    padding: 4px 8px;
    margin: 0 -8px;
  }
}

.left {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.spinner {
  width: 16px;
  height: 16px;
  --color: var(--color--text--tint-1);
}

.statusIcon {
  font-size: 16px;
  flex-shrink: 0;
}

.toolIcon {
  font-size: 14px;
  color: var(--color--text--tint-1);
  flex-shrink: 0;
}

.toolName {
  font-size: 13px;
  font-weight: 500;
  color: var(--color--text--shade-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chevron {
  font-size: 14px;
  color: var(--color--text--tint-1);
  flex-shrink: 0;
  margin-left: 4px;
}

.body {
  padding: 4px 0 8px 22px;
}

.section {
  margin-top: 8px;
}

.sectionLabel {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--color--text--tint-1);
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
  color: var(--color--text--shade-1);
}
</style>
