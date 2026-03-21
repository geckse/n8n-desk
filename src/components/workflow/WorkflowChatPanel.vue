<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { IonIcon } from '@ionic/vue'
import { sendOutline, settingsOutline } from 'ionicons/icons'
import { Plus, ChevronDown, ChevronRight, Brain } from 'lucide-vue-next'
import { useWorkflowAgent } from '@/composables/useWorkflowAgent'
import { useSettingsStore } from '@/stores/settings'
import { useWorkflowSessionsStore } from '@/stores/workflow-sessions'
import { usePluginsStore } from '@/stores/plugins'
import type { WorkflowPreviewData, WorkflowJson } from '@/types/agent'
import type { LoadedSkill } from '@/types/plugin'
import { renderMarkdown } from '@/utils/markdown'
import ToolCallCard from './ToolCallCard.vue'
import ApprovalCard from './ApprovalCard.vue'
import WorkflowInlineCard from './WorkflowInlineCard.vue'
import PlusMenu from '@/components/plugins/PlusMenu.vue'

const {
  messages,
  isRunning,
  pendingApproval,
  toolCalls,
  sendMessage,
  approveAction,
} = useWorkflowAgent()

const settingsStore = useSettingsStore()
const sessionStore = useWorkflowSessionsStore()
const pluginsStore = usePluginsStore()
const hasLlmConfig = computed(() => settingsStore.hasLlmConfig)

const inputText = ref('')
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const scrollContainerRef = ref<HTMLDivElement | null>(null)

// --- Plus menu ---
const plusMenuOpen = ref(false)

// --- Thinking toggle ---
const expandedThinking = ref<Set<string>>(new Set())

function toggleThinking(msgId: string) {
  const next = new Set(expandedThinking.value)
  if (next.has(msgId)) {
    next.delete(msgId)
  } else {
    next.add(msgId)
  }
  expandedThinking.value = next
}
const sessionDisabledSkills = ref<Set<string>>(new Set())

function handleSessionSkillToggle(skillName: string) {
  const next = new Set(sessionDisabledSkills.value)
  if (next.has(skillName)) {
    next.delete(skillName)
  } else {
    next.add(skillName)
  }
  sessionDisabledSkills.value = next
}

// --- Skill autocomplete ---
const autocompleteIndex = ref(0)
const autocompleteDismissed = ref(false)

const invocableSkills = computed(() =>
  pluginsStore.skills.filter((s) => s.userInvocable),
)

const filteredSkills = computed((): LoadedSkill[] => {
  const text = inputText.value
  if (!text.startsWith('/')) return []
  // Only show while typing the command name (no space yet)
  if (text.includes(' ')) return []
  const prefix = text.slice(1).toLowerCase()
  const skills = invocableSkills.value
  if (!prefix) return skills.slice(0, 8)
  return skills
    .filter((s) => s.name.toLowerCase().startsWith(prefix))
    .slice(0, 8)
})

const showSkillAutocomplete = computed(() => {
  if (autocompleteDismissed.value) return false
  return filteredSkills.value.length > 0
})

// Reset dismissed state when input changes
watch(inputText, () => {
  autocompleteDismissed.value = false
  autocompleteIndex.value = 0
})

function selectSkillFromAutocomplete(skill: LoadedSkill) {
  inputText.value = `/${skill.name} `
  autocompleteDismissed.value = true
  nextTick(() => {
    resizeTextarea()
    textareaRef.value?.focus()
  })
}

/** Resolve /skill-name input: replace with skill content, substituting $ARGUMENTS */
function resolveSkillInput(text: string): string {
  if (!text.startsWith('/')) return text
  const spaceIdx = text.indexOf(' ')
  const skillName = spaceIdx === -1 ? text.slice(1) : text.slice(1, spaceIdx)
  const args = spaceIdx === -1 ? '' : text.slice(spaceIdx + 1).trim()

  const skill = invocableSkills.value.find((s) => s.name === skillName)
  if (!skill) return text // Not a known skill — send as-is

  return skill.content.replace(/\$ARGUMENTS/g, args)
}

const canSend = computed(() =>
  inputText.value.trim().length > 0 && !isRunning.value && hasLlmConfig.value
)

// Check if the last message is an assistant message still being streamed
const isStreaming = computed(() => {
  if (!isRunning.value) return false
  const last = messages.value[messages.value.length - 1]
  return last?.role === 'assistant'
})

// Auto-resize textarea
function resizeTextarea() {
  const el = textareaRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 150) + 'px'
}

function handleInput() {
  resizeTextarea()
}

function handleKeydown(e: KeyboardEvent) {
  // Skill autocomplete keyboard navigation
  if (showSkillAutocomplete.value) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      autocompleteIndex.value = Math.min(
        autocompleteIndex.value + 1,
        filteredSkills.value.length - 1,
      )
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      autocompleteIndex.value = Math.max(autocompleteIndex.value - 1, 0)
      return
    }
    if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
      e.preventDefault()
      const selected = filteredSkills.value[autocompleteIndex.value]
      if (selected) selectSkillFromAutocomplete(selected)
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      autocompleteDismissed.value = true
      return
    }
  }

  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    send()
  }
}

async function send() {
  if (!canSend.value) return
  const text = inputText.value.trim()
  inputText.value = ''
  autocompleteDismissed.value = true
  nextTick(resizeTextarea)
  const resolved = resolveSkillInput(text)
  await sendMessage(resolved)
}

function handleApprove(_id: string) {
  approveAction('approve')
}

function handleReject(_id: string) {
  approveAction('reject')
}

function handlePopOut(data: WorkflowPreviewData) {
  sessionStore.openPanel(data)
}

/** Extract a WorkflowJson from a raw result object */
function findWorkflowInResult(r: Record<string, unknown>): { id: string; name: string; wf: WorkflowJson } | null {
  // Direct: { nodes, connections }
  if (Array.isArray(r.nodes) && r.connections) {
    return { id: (r.id as string) ?? '', name: (r.name as string) ?? 'Workflow', wf: r as unknown as WorkflowJson }
  }
  // Nested: { workflow: { nodes, connections } }
  if (typeof r.workflow === 'object' && r.workflow !== null) {
    const w = r.workflow as Record<string, unknown>
    if (Array.isArray(w.nodes)) {
      return { id: (w.id as string) ?? '', name: (w.name as string) ?? 'Workflow', wf: w as unknown as WorkflowJson }
    }
  }
  // MCP structured: { structuredContent: { workflow: { nodes, connections } } }
  if (typeof r.structuredContent === 'object' && r.structuredContent !== null) {
    const sc = r.structuredContent as Record<string, unknown>
    if (typeof sc.workflow === 'object' && sc.workflow !== null) {
      const w = sc.workflow as Record<string, unknown>
      if (Array.isArray(w.nodes)) {
        return { id: (w.id as string) ?? '', name: (w.name as string) ?? 'Workflow', wf: w as unknown as WorkflowJson }
      }
    }
  }
  return null
}

/** Extract workflow JSON from a tool call result, with diff support via history */
function extractWorkflowFromToolResult(result: unknown): WorkflowPreviewData | null {
  if (!result) return null

  // Result may be a JSON string — parse it first
  let parsed = result
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed) } catch { return null }
  }
  if (typeof parsed !== 'object' || parsed === null) return null

  const found = findWorkflowInResult(parsed as Record<string, unknown>)
  if (!found) return null

  // Look up previous version for diff
  const previousVersion = found.id ? sessionStore.workflowHistory.get(found.id) : undefined

  // Store this version as latest for future diffs
  if (found.id) {
    sessionStore.workflowHistory.set(found.id, structuredClone(found.wf))
  }

  return {
    workflowId: found.id,
    name: found.name,
    workflow: found.wf,
    workflowBefore: previousVersion,
  }
}

/** Get inline preview data for a tool call by its ID */
function getInlinePreview(toolCallId: string): WorkflowPreviewData | null {
  const tc = toolCalls.value.find((t) => t.id === toolCallId)
  if (!tc || tc.status !== 'completed' || !tc.result) return null
  return extractWorkflowFromToolResult(tc.result)
}

// Find tool call for a given message
function getToolCallForMessage(msgId: string) {
  return toolCalls.value.find((tc) => tc.id === msgId) ?? null
}

// Auto-scroll to bottom on new messages
function scrollToBottom() {
  const el = scrollContainerRef.value
  if (!el) return
  el.scrollTop = el.scrollHeight
}

watch(
  () => messages.value.length,
  () => nextTick(scrollToBottom),
  { flush: 'post' },
)

// Also scroll when streaming text chunks update the last message (debounced)
let scrollDebounce: ReturnType<typeof setTimeout> | null = null
watch(
  () => messages.value[messages.value.length - 1]?.content?.length,
  () => {
    if (scrollDebounce) clearTimeout(scrollDebounce)
    scrollDebounce = setTimeout(scrollToBottom, 50)
  },
  { flush: 'post' },
)

watch(isRunning, () => nextTick(scrollToBottom), { flush: 'post' })

onMounted(scrollToBottom)
</script>

<template>
  <div :class="$style.panel">
    <!-- Dot-grid background -->
    <div :class="$style.dotBg" />

    <!-- Message list -->
    <div ref="scrollContainerRef" :class="$style.messages">
      <div :class="$style.messagesInner">
      <div v-if="messages.length === 0" :class="$style.empty">
        <p :class="$style.emptyTitle">Workflow Agent</p>
        <p :class="$style.emptyHint">Ask the agent to create, edit, or manage n8n workflows.</p>
      </div>

      <template v-for="msg in messages" :key="msg.id">
        <!-- User message -->
        <div v-if="msg.role === 'user'" :class="$style.userMsg">
          <div :class="$style.userBubble">{{ msg.content }}</div>
        </div>

        <!-- Thinking (collapsible) -->
        <div v-else-if="msg.role === 'thinking'" :class="$style.thinkingMsg">
          <button
            :class="$style.thinkingToggle"
            @click="toggleThinking(msg.id)"
          >
            <Brain :size="14" :class="$style.thinkingIcon" />
            <span>Thinking</span>
            <component
              :is="expandedThinking.has(msg.id) ? ChevronDown : ChevronRight"
              :size="14"
              :class="$style.thinkingChevron"
            />
          </button>
          <pre
            v-if="expandedThinking.has(msg.id)"
            :class="$style.thinkingContent"
          >{{ msg.content }}</pre>
        </div>

        <!-- Assistant message -->
        <div v-else-if="msg.role === 'assistant'" :class="$style.assistantMsg">
          <div :class="$style.assistantContent">
            <div
              :class="$style.markdown"
              v-html="renderMarkdown(msg.content)"
            />
            <span
              v-if="isStreaming && msg === messages[messages.length - 1]"
              :class="$style.cursor"
            />
          </div>
        </div>

        <!-- Tool call -->
        <div v-else-if="msg.role === 'tool'" :class="$style.toolMsg">
          <ToolCallCard
            v-if="getToolCallForMessage(msg.meta?.toolCallId as string)"
            :tool-call="getToolCallForMessage(msg.meta?.toolCallId as string)!"
            @preview="handlePopOut"
          />
          <!-- Inline workflow preview card -->
          <template v-if="getInlinePreview(msg.meta?.toolCallId as string)" >
            <WorkflowInlineCard
              v-bind="getInlinePreview(msg.meta?.toolCallId as string)!"
              :is-panel-active="sessionStore.isPanelOpen && sessionStore.panelWorkflowId === getInlinePreview(msg.meta?.toolCallId as string)!.workflowId"
              @pop-out="handlePopOut"
            />
          </template>
        </div>

        <!-- System/error message -->
        <div v-else-if="msg.role === 'system'" :class="[$style.systemMsg, msg.meta?.error && $style.errorMsg]">
          {{ msg.content }}
        </div>
      </template>

      <!-- Inline tool calls not tied to messages -->
      <template v-for="tc in toolCalls" :key="tc.id">
        <div v-if="tc.status === 'running' || tc.status === 'pending'" :class="$style.toolMsg">
          <ToolCallCard :tool-call="tc" @preview="handlePopOut" />
        </div>
      </template>

      <!-- Pending approval -->
      <div v-if="pendingApproval" :class="$style.toolMsg">
        <ApprovalCard
          :approval="pendingApproval"
          @approve="handleApprove"
          @reject="handleReject"
        />
      </div>

      <!-- Waiting for first token -->
      <div v-if="isRunning && !pendingApproval && !isStreaming" :class="$style.thinkingRow">
        <span :class="$style.thinkingDots">
          <span /><span /><span />
        </span>
      </div>
      </div>
    </div>

    <!-- Input area -->
    <div :class="$style.inputArea">
      <div :class="$style.inputInner">
        <div v-if="!hasLlmConfig" :class="$style.configHint">
          <ion-icon :icon="settingsOutline" :class="$style.configIcon" />
          Configure AI in Settings > AI/Agent
        </div>

        <!-- Skill autocomplete dropdown -->
        <div v-if="showSkillAutocomplete" :class="$style.autocomplete">
          <div
            v-for="(skill, idx) in filteredSkills"
            :key="skill.name"
            :class="[
              $style.autocompleteItem,
              idx === autocompleteIndex && $style.autocompleteItemActive,
            ]"
            @mousedown.prevent="selectSkillFromAutocomplete(skill)"
          >
            <span :class="$style.autocompleteCmd">/{{ skill.name }}</span>
            <span v-if="skill.description" :class="$style.autocompleteDesc">{{ skill.description }}</span>
          </div>
        </div>

        <div :class="$style.inputRow">
          <div :class="$style.plusBtnWrap">
            <button
              id="plus-menu-trigger"
              :class="$style.plusBtn"
              title="Skills, Connectors & Plugins"
              @click.stop="plusMenuOpen = !plusMenuOpen"
            >
              <Plus :size="18" />
            </button>
            <PlusMenu
              :is-open="plusMenuOpen"
              trigger="plus-menu-trigger"
              :session-disabled-skills="sessionDisabledSkills"
              @update:is-open="plusMenuOpen = $event"
              @toggle-session-skill="handleSessionSkillToggle"
            />
          </div>
          <textarea
            ref="textareaRef"
            v-model="inputText"
            :class="$style.textarea"
            :disabled="isRunning || !hasLlmConfig"
            placeholder="Describe a workflow to create or modify..."
            rows="1"
            @input="handleInput"
            @keydown="handleKeydown"
          />
          <button
            :class="$style.sendBtn"
            :disabled="!canSend"
            @click="send"
          >
            <ion-icon :icon="sendOutline" />
          </button>
        </div>
      </div>
    </div>

  </div>
</template>

<style lang="scss" module>
.panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--n8n-desk--content-bg, var(--color--background));
  position: relative;
}

.dotBg {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background-image: radial-gradient(circle, var(--n8n-desk--grid-dot-color, var(--canvas--dot--color, rgba(0, 0, 0, 0.12))) 1px, transparent 1px);
  background-size: 24px 24px;
}

.messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  position: relative;
  z-index: 1;
}

.messagesInner {
  width: 90%;
  max-width: 960px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
}

.emptyTitle {
  font-size: 16px;
  font-weight: 600;
  color: var(--color--text--shade-1);
  margin: 0 0 4px;
}

.emptyHint {
  font-size: 13px;
  color: var(--color--text--tint-1);
  margin: 0;
}

// --- Thinking ---
.thinkingMsg {
  max-width: 90%;
}

.thinkingToggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border: 1px solid var(--n8n-desk--surface-raised-bg, var(--color--foreground));
  border-radius: 8px;
  background: transparent;
  color: var(--color--text--tint-1);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.1s, color 0.1s;

  &:hover {
    background: var(--n8n-desk--surface-bg, var(--color--foreground));
    color: var(--color--text--shade-1);
  }
}

.thinkingIcon {
  color: var(--color--text--tint-2);
}

.thinkingChevron {
  color: var(--color--text--tint-2);
}

.thinkingContent {
  margin: 6px 0 0;
  padding: 12px;
  border-radius: 8px;
  background: var(--n8n-desk--surface-bg, var(--color--foreground));
  border: 1px solid var(--n8n-desk--surface-raised-bg, var(--color--foreground));
  font-size: 12px;
  font-family: 'SFMono-Regular', 'Consolas', 'Liberation Mono', 'Menlo', monospace;
  line-height: 1.5;
  color: var(--color--text--tint-1);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 300px;
  overflow-y: auto;
}

.userMsg {
  display: flex;
  justify-content: flex-end;
}

.userBubble {
  max-width: 80%;
  padding: 10px 14px;
  border-radius: 16px 16px 4px 16px;
  background: var(--color--primary, #ff6d5a);
  color: #fff;
  font-size: 14px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.assistantMsg {
  display: flex;
  justify-content: flex-start;
}

.assistantContent {
  max-width: 90%;
  position: relative;
}

.markdown {
  color: var(--color--text--shade-1);
  font-size: 14px;
  line-height: 1.6;
  word-break: break-word;

  :deep(p) {
    margin: 0 0 8px;
    &:last-child { margin-bottom: 0; }
  }

  :deep(ul),
  :deep(ol) {
    margin: 4px 0 8px;
    padding-left: 20px;

    li {
      margin-bottom: 2px;
    }
  }

  :deep(strong) {
    font-weight: 600;
    color: var(--color--text--shade-1);
  }

  :deep(a) {
    color: var(--color--primary);
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }

  :deep(code) {
    font-size: 12px;
    font-family: 'SFMono-Regular', 'Consolas', 'Liberation Mono', 'Menlo', monospace;
    background: var(--n8n-desk--surface-bg, var(--color--foreground));
    color: var(--color--text);
    padding: 2px 5px;
    border-radius: 4px;
  }

  :deep(pre) {
    background: var(--n8n-desk--surface-bg, var(--color--foreground));
    padding: 12px;
    border-radius: 6px;
    overflow-x: auto;
    margin: 8px 0;
    border: 1px solid var(--n8n-desk--surface-raised-bg, var(--color--foreground));

    code {
      background: none;
      padding: 0;
      border-radius: 0;
      font-size: 12.5px;
      line-height: 1.5;
      color: var(--color--text);
    }
  }

  :deep(blockquote) {
    margin: 8px 0;
    padding: 4px 12px;
    border-left: 3px solid var(--color--text--tint-1);
    color: var(--color--text);
  }

  :deep(hr) {
    border: none;
    border-top: 1px solid var(--n8n-desk--surface-raised-bg, var(--color--foreground));
    margin: 12px 0;
  }

  :deep(h1),
  :deep(h2),
  :deep(h3),
  :deep(h4) {
    color: var(--color--text--shade-1);
    margin: 12px 0 6px;
    font-weight: 600;

    &:first-child { margin-top: 0; }
  }

  :deep(h1) { font-size: 18px; }
  :deep(h2) { font-size: 16px; }
  :deep(h3) { font-size: 15px; }
  :deep(h4) { font-size: 14px; }
}

// Blinking cursor for streaming
.cursor {
  display: inline-block;
  width: 2px;
  height: 16px;
  background: var(--color--primary, #ff6d5a);
  margin-left: 2px;
  vertical-align: text-bottom;
  animation: blink 0.8s step-end infinite;
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

.toolMsg {
  max-width: 90%;
}

.systemMsg {
  text-align: center;
  font-size: 12px;
  color: var(--color--text--tint-1);
  padding: 4px 0;
}

.errorMsg {
  color: var(--color--danger, #ef4444);
}

// Thinking dots animation (before first token arrives)
.thinkingRow {
  display: flex;
  align-items: center;
  padding: 4px 0;
}

.thinkingDots {
  display: inline-flex;
  gap: 4px;

  span {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--color--text--tint-1);
    animation: thinking 1.4s infinite ease-in-out both;

    &:nth-child(1) { animation-delay: -0.32s; }
    &:nth-child(2) { animation-delay: -0.16s; }
  }
}

@keyframes thinking {
  0%, 80%, 100% {
    transform: scale(0.6);
    opacity: 0.4;
  }
  40% {
    transform: scale(1);
    opacity: 1;
  }
}

.inputArea {
  flex-shrink: 0;
  border-top: 1px solid var(--n8n-desk--surface-raised-bg, var(--color--foreground));
  padding: 8px 12px 12px;
  position: relative;
  z-index: 1;
}

.inputInner {
  width: 90%;
  max-width: 960px;
  margin: 0 auto;
}

.configHint {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--color--warning, #f59e0b);
  padding: 4px 0 8px;
}

.configIcon {
  font-size: 14px;
}

.inputRow {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}

.textarea {
  flex: 1;
  resize: none;
  border: 1px solid var(--n8n-desk--surface-raised-bg, var(--color--foreground));
  border-radius: 12px;
  padding: 10px 14px;
  font-size: 14px;
  font-family: inherit;
  line-height: 1.5;
  background: var(--n8n-desk--surface-bg, var(--color--foreground));
  color: var(--color--text--shade-1);
  outline: none;
  max-height: 150px;
  overflow-y: auto;

  &:focus {
    border-color: var(--color--primary, #ff6d5a);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  &::placeholder {
    color: var(--color--text--tint-1);
  }
}

.sendBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  background: var(--color--primary, #ff6d5a);
  color: #fff;
  cursor: pointer;
  flex-shrink: 0;
  font-size: 18px;

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  &:not(:disabled):hover {
    opacity: 0.9;
  }
}

.plusBtnWrap {
  position: relative;
  flex-shrink: 0;
}

.plusBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px solid var(--n8n-desk--surface-raised-bg, var(--color--foreground));
  background: var(--n8n-desk--surface-bg, var(--color--foreground));
  color: var(--color--text--tint-1);
  cursor: pointer;
  flex-shrink: 0;
  transition: color 0.15s, border-color 0.15s, background 0.15s;

  &:hover {
    color: var(--color--text--shade-1);
    border-color: var(--color--text--tint-2);
    background: var(--n8n-desk--surface-raised-bg, var(--color--foreground));
  }
}

// Skill autocomplete dropdown
.autocomplete {
  position: relative;
  background: var(--n8n-desk--surface-bg, var(--color--foreground));
  border: 1px solid var(--n8n-desk--surface-raised-bg, var(--color--foreground));
  border-radius: 10px;
  padding: 4px;
  margin-bottom: 6px;
  max-height: 240px;
  overflow-y: auto;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
}

.autocompleteItem {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.1s;

  &:hover {
    background: var(--n8n-desk--surface-raised-bg, var(--color--foreground));
  }
}

.autocompleteItemActive {
  background: var(--n8n-desk--surface-raised-bg, var(--color--foreground));
}

.autocompleteCmd {
  font-family: 'SFMono-Regular', 'Consolas', 'Liberation Mono', 'Menlo', monospace;
  font-size: 13px;
  font-weight: 600;
  color: var(--color--primary, #ff6d5a);
  white-space: nowrap;
  flex-shrink: 0;
}

.autocompleteDesc {
  font-size: 12px;
  color: var(--color--text--tint-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
</style>
