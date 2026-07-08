<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { IonButton, IonIcon } from '@ionic/vue'
import { shieldCheckmarkOutline } from 'ionicons/icons'
import type { WorkflowJson } from '@/types/agent'
import { toolDisplayName, parseToolName } from '@/utils/tool-display'
import WorkflowEmbed from './WorkflowEmbed.vue'

interface PendingApproval {
  id: string
  toolName: string
  description: string
  /** Tool arguments — shown so the user never approves blind (audit #22) */
  args?: Record<string, unknown>
  workflowPreview?: WorkflowJson
}

interface Props {
  approval: PendingApproval
}

const props = defineProps<Props>()

const emit = defineEmits<{
  approve: [id: string]
  approveAlways: [id: string]
  reject: [id: string]
}>()

/**
 * Static destructive n8n tool set (mirrors DESTRUCTIVE_TOOLS in
 * electron/agent/approval.ts) — the "always allow" button gets warning
 * styling for these so a lasting grant on a destructive tool stands out.
 */
const DESTRUCTIVE_TOOL_NAMES = new Set([
  'create_workflow_from_code',
  'update_workflow',
  'execute_workflow',
  'publish_workflow',
  'unpublish_workflow',
  'archive_workflow',
])

const { t, te } = useI18n()

/**
 * Localized approval prompt (audit #29): the runners emit a neutral
 * machine description; the renderer owns the user-facing text. Known
 * destructive tools get their dedicated prompt (with the workflow name
 * from the args); everything else falls back to a generic localized line.
 * A non-generic backend description (custom-server HITL text) is kept.
 */
const promptText = computed(() => {
  const backendText = props.approval.description
  if (backendText && !/^Approve .+\?$/.test(backendText)) {
    return backendText
  }

  const { name: bareTool } = parseToolName(props.approval.toolName)
  const args = props.approval.args ?? {}
  const name = String(args.workflowId ?? args.name ?? args.id ?? '')
  const key = `agentPanel.approval.prompts.${bareTool}`
  if (te(key)) {
    return t(key, { name })
  }
  return t('agentPanel.approval.generic', { tool: toolDisplayName(props.approval.toolName) })
})

/**
 * Render the tool arguments so the user sees exactly what they approve —
 * which workflow, what inputs, what code. Long string values (e.g. workflow
 * SDK code) are rendered readably instead of as escaped JSON.
 */
const argEntries = computed(() => {
  const args = props.approval.args ?? {}
  return Object.entries(args).map(([key, value]) => {
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
    return { key, text: text ?? String(value) }
  })
})

const isDestructiveTool = computed(() => {
  const { name: bareTool } = parseToolName(props.approval.toolName)
  return DESTRUCTIVE_TOOL_NAMES.has(bareTool)
})

function handlePreviewClick() {
  // Preview click in approval context is informational only
}
</script>

<template>
  <div :class="$style.card">
    <div :class="$style.header">
      <ion-icon :icon="shieldCheckmarkOutline" :class="$style.icon" />
      <span :class="$style.title">{{ t('agentPanel.approval.title') }}</span>
    </div>

    <div :class="$style.body">
      <div :class="$style.operation">
        <span :class="$style.operationLabel">{{ t('agentPanel.approval.operation') }}</span>
        <span :class="$style.operationName">{{ toolDisplayName(approval.toolName) }}</span>
      </div>

      <p :class="$style.description">{{ promptText }}</p>

      <div v-if="argEntries.length > 0" :class="$style.args">
        <div :class="$style.argsLabel">{{ t('agentPanel.approval.arguments') }}</div>
        <div v-for="entry in argEntries" :key="entry.key" :class="$style.argRow">
          <span :class="$style.argKey">{{ entry.key }}</span>
          <pre :class="$style.argValue">{{ entry.text }}</pre>
        </div>
      </div>

      <WorkflowEmbed
        v-if="approval.workflowPreview"
        :workflow="approval.workflowPreview"
        compact
        @click="handlePreviewClick"
      />

      <div :class="$style.actions">
        <ion-button fill="outline" color="medium" size="small" @click="emit('reject', approval.id)">
          {{ t('agentPanel.approval.reject') }}
        </ion-button>
        <ion-button
          fill="outline"
          :color="isDestructiveTool ? 'warning' : 'primary'"
          size="small"
          @click="emit('approveAlways', approval.id)"
        >
          {{ t('agentPanel.approval.approveAlways') }}
        </ion-button>
        <ion-button color="primary" size="small" @click="emit('approve', approval.id)">
          {{ t('agentPanel.approval.approve') }}
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
  color: var(--color--text--shade-1);
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
  color: var(--color--text--tint-1);
}

.operationName {
  font-size: 13px;
  font-weight: 500;
  color: var(--color--text--shade-1);
}

.description {
  font-size: 13px;
  line-height: 1.5;
  color: var(--color--text);
  margin: 0 0 12px;
}

.args {
  margin-bottom: 12px;
}

.argsLabel {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--color--text--tint-1);
  margin-bottom: 4px;
}

.argRow {
  margin-bottom: 6px;

  &:last-child {
    margin-bottom: 0;
  }
}

.argKey {
  display: block;
  font-family: monospace;
  font-size: 11px;
  font-weight: 600;
  color: var(--color--text--tint-1);
  margin-bottom: 2px;
}

.argValue {
  font-family: monospace;
  font-size: 12px;
  line-height: 1.5;
  background: var(--n8n-desk--content-bg, var(--color--background));
  border-radius: 4px;
  padding: 8px;
  margin: 0;
  overflow: auto;
  max-height: 220px;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--color--text--shade-1);
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
