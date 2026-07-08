<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { IonIcon } from '@ionic/vue'
import { sendOutline, settingsOutline } from 'ionicons/icons'
import { Plus, ChevronDown, ChevronRight, ChevronUp, Brain, Folder, FolderPlus, Paperclip, X, FileText, FileSpreadsheet, FileImage, Sparkles, Workflow, ArrowRight, Square, Circle, Loader2, CheckCircle2, XCircle, ListChecks } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useCoworkAgent } from '@/composables/useCoworkAgent'
import { useWorkflowAgent } from '@/composables/useWorkflowAgent'
import { useSettingsStore } from '@/stores/settings'
import { useCoworkSessionsStore } from '@/stores/cowork-sessions'
import { useWorkflowSessionsStore } from '@/stores/workflow-sessions'
import { usePluginsStore } from '@/stores/plugins'
import type { WorkflowPreviewData, WorkflowJson } from '@/types/agent'
import type { AttachedFolder } from '@/types/session'
import type { LoadedSkill } from '@/types/plugin'
import { renderMarkdown } from '@/utils/markdown'
import ToolCallCard from '@/components/workflow/ToolCallCard.vue'
import ApprovalCard from '@/components/workflow/ApprovalCard.vue'
import AskUserQuestionCard from '@/components/agent/AskUserQuestionCard.vue'
import WorkflowInlineCard from '@/components/workflow/WorkflowInlineCard.vue'
import PlusMenu from '@/components/plugins/PlusMenu.vue'
import McpStatusBanner from '@/components/agent/McpStatusBanner.vue'

/**
 * Shared chat panel for BOTH agent modes (audit #64 — the Cowork and
 * Workflow panels were ~1500-line near-verbatim copies). The mode selects
 * the composable/store pair and the i18n namespace; everything else is
 * identical behavior.
 */
const props = defineProps<{
  mode: 'cowork' | 'workflow'
}>()

const { t } = useI18n()

// Mode selection happens once at setup — the prop is a literal per wrapper
// and never changes at runtime.
const {
  messages,
  isRunning,
  pendingApproval,
  pendingQuestion,
  toolCalls,
  todos,
  sendMessage,
  stopAgent,
  approveAction,
  answerQuestion,
} = props.mode === 'cowork' ? useCoworkAgent() : useWorkflowAgent()

const settingsStore = useSettingsStore()
const coworkStore = useCoworkSessionsStore()
const workflowStore = useWorkflowSessionsStore()
const sessionStore = props.mode === 'cowork' ? coworkStore : workflowStore
const pluginsStore = usePluginsStore()
const hasLlmConfig = computed(() => settingsStore.hasLlmConfig)

const emptyIcon = props.mode === 'cowork' ? Sparkles : Workflow

const EXAMPLE_KEYS: Record<'cowork' | 'workflow', string[]> = {
  cowork: ['csvInvoices', 'syncServices', 'weeklyReport', 'cleanDuplicates'],
  workflow: ['emailDigest', 'leadEnrichment', 'scheduledBackup', 'webhookNotification'],
}

const examplePrompts = computed(() =>
  EXAMPLE_KEYS[props.mode].map((key) => ({
    label: t(`${props.mode}.examples.${key}.label`),
    prompt: t(`${props.mode}.examples.${key}.prompt`),
  })),
)

const inputText = ref('')
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const scrollContainerRef = ref<HTMLDivElement | null>(null)

// --- Folder attachment (scoped to session) ---
const sessionFolders = computed(() => sessionStore.activeSession?.attachedFolders ?? [])

// Folders can only be attached before the first message is sent.
// Once the session has messages, the folder list is locked.
const sessionHasMessages = computed(() => messages.value.length > 0)
const canModifyFolders = computed(() => !sessionHasMessages.value && !isRunning.value)

async function handleAttachFolder() {
  if (!canModifyFolders.value) return

  const folderPath = await window.n8nDesk?.dialog.openFolder()
  if (!folderPath) return

  const sessionId = sessionStore.activeSessionId
  if (!sessionId) {
    // Create session first, then attach
    const newId = await sessionStore.createSession()
    const label = folderPath.split(/[\\/]/).pop() ?? folderPath
    await sessionStore.attachFolder(newId, { path: folderPath, label, mode: 'rw' })
    return
  }

  const label = folderPath.split(/[\\/]/).pop() ?? folderPath
  await sessionStore.attachFolder(sessionId, { path: folderPath, label, mode: 'rw' })
}

async function handleDetachFolder(folderPath: string) {
  if (!canModifyFolders.value) return
  const sessionId = sessionStore.activeSessionId
  if (!sessionId) return
  await sessionStore.detachFolder(sessionId, folderPath)
}

async function toggleFolderMode(folder: AttachedFolder) {
  if (!canModifyFolders.value) return
  const sessionId = sessionStore.activeSessionId
  if (!sessionId) return
  await sessionStore.setFolderMode(sessionId, folder.path, folder.mode === 'ro' ? 'rw' : 'ro')
}

// --- File attachment (direct files, allowed any time) ---

/** Extensions the user is allowed to attach as files. */
const ALLOWED_FILE_EXTENSIONS = new Set([
  '.csv', '.xlsx', '.xls',
  '.json', '.jsonl',
  '.yaml', '.yml',
  '.txt', '.md', '.log',
  '.pdf',
  '.docx',
  '.xml', '.html', '.svg',
  '.toml',
])

interface AttachedFile {
  name: string
  path: string
  size: number
}

const attachedFiles = ref<AttachedFile[]>([])
const isDragOver = ref(false)

function fileExtAllowed(filename: string): boolean {
  const ext = filename.lastIndexOf('.') >= 0
    ? filename.slice(filename.lastIndexOf('.')).toLowerCase()
    : ''
  return ALLOWED_FILE_EXTENSIONS.has(ext)
}

function fileIcon(filename: string) {
  const ext = filename.lastIndexOf('.') >= 0
    ? filename.slice(filename.lastIndexOf('.')).toLowerCase()
    : ''
  if (['.xlsx', '.xls', '.csv'].includes(ext)) return FileSpreadsheet
  if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'].includes(ext)) return FileImage
  return FileText
}

async function handleAttachFiles() {
  const files = await window.n8nDesk?.dialog.openFiles()
  if (!files || files.length === 0) return
  addFiles(files)
}

function addFiles(filePaths: string[]) {
  for (const fp of filePaths) {
    const name = fp.split(/[\\/]/).pop() ?? fp
    if (!fileExtAllowed(name)) continue
    if (attachedFiles.value.some((f) => f.path === fp)) continue
    attachedFiles.value.push({ name, path: fp, size: 0 })
  }
}

function removeFile(filePath: string) {
  attachedFiles.value = attachedFiles.value.filter((f) => f.path !== filePath)
}

function handleDragOver(e: DragEvent) {
  e.preventDefault()
  isDragOver.value = true
}

function handleDragLeave() {
  isDragOver.value = false
}

function handleDrop(e: DragEvent) {
  e.preventDefault()
  isDragOver.value = false
  if (!e.dataTransfer?.files) return
  const paths: string[] = []
  for (const file of Array.from(e.dataTransfer.files)) {
    // Electron exposes .path on dropped File objects
    const fp = (file as File & { path?: string }).path
    if (fp && fileExtAllowed(file.name)) {
      paths.push(fp)
    }
  }
  addFiles(paths)
}

// --- Folder context menu ---
const folderContextMenu = ref<{ x: number; y: number; path: string } | null>(null)

function handleFolderContextMenu(e: MouseEvent, folderPath: string) {
  e.preventDefault()
  folderContextMenu.value = { x: e.clientX, y: e.clientY, path: folderPath }

  const close = () => {
    folderContextMenu.value = null
    document.removeEventListener('click', close)
  }
  // Close on next click anywhere
  setTimeout(() => document.addEventListener('click', close), 0)
}

async function showInFinder(folderPath: string) {
  folderContextMenu.value = null
  await window.n8nDesk?.shell.showInFolder(folderPath)
}

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
  // Pass attached file paths so the agent can access them
  const filePaths = attachedFiles.value.map((f) => f.path)
  await sendMessage(resolved, filePaths)
  // Clear attached files after sending (they're captured by the agent)
  attachedFiles.value = []
}

function handleApprove(_id: string) {
  approveAction('approve')
}

function handleApproveAlways(_id: string) {
  approveAction('approve_always')
}

function handleQuestionSubmit(_id: string, answers: import('@/types/agent').AskUserAnswers) {
  void answerQuestion(answers)
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

/** Extract workflow JSON from a tool call result (pure — no side effects). */
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

  // Look up previous version for diff (read only — no mutation here)
  const previousVersion = found.id ? sessionStore.workflowHistory.get(found.id) : undefined

  return {
    workflowId: found.id,
    name: found.name,
    workflow: found.wf,
    workflowBefore: previousVersion,
  }
}

/**
 * Pre-computed inline previews keyed by toolCallId.
 * Built by a watcher on toolCalls — never mutated during render.
 */
const inlinePreviewMap = ref<Map<string, WorkflowPreviewData>>(new Map())

// Recompute previews when tool calls change (completions arrive or results are injected).
// Deep-watch toolCalls so we detect result replacement from workflow_preview events.
watch(
  toolCalls,
  () => {
    for (const tc of toolCalls.value) {
      if (tc.status !== 'completed' || !tc.result) continue
      if (inlinePreviewMap.value.has(tc.id)) continue

      const preview = extractWorkflowFromToolResult(tc.result)
      if (!preview) continue

      inlinePreviewMap.value.set(tc.id, preview)
      // Update workflow history for future diffs
      if (preview.workflowId) {
        sessionStore.workflowHistory.set(preview.workflowId, structuredClone(preview.workflow))
      }
    }
  },
  { immediate: true, deep: true },
)

/** Get inline preview data for a tool call by its ID (pure read — no mutations). */
function getInlinePreview(toolCallId: string): WorkflowPreviewData | null {
  return inlinePreviewMap.value.get(toolCallId) ?? null
}

// Find tool call for a given message
function getToolCallForMessage(msgId: string) {
  return toolCalls.value.find((tc) => tc.id === msgId) ?? null
}

// Tool calls with no tool message in the conversation (defensive fallback).
// Every tracked call already renders via its message — rendering all
// running calls a second time duplicated the card (audit #47).
const orphanToolCalls = computed(() =>
  toolCalls.value.filter(
    (tc) => !messages.value.some((m) => m.meta?.toolCallId === tc.id),
  ),
)

// --- Agent plan (todo_update events) ---
const planCollapsed = ref(false)
const planDoneCount = computed(
  () => todos.value.filter((todo) => todo.status === 'completed').length,
)

// Drag the plan card by its header. `planPos` is null until the first drag —
// the card then switches from its default top-right anchor to explicit
// left/top coordinates within the panel.
const planCardRef = ref<HTMLElement | null>(null)
const planPos = ref<{ x: number; y: number } | null>(null)
let planDragMoved = false

const planPosStyle = computed(() =>
  planPos.value
    ? { left: `${planPos.value.x}px`, top: `${planPos.value.y}px`, right: 'auto' }
    : undefined,
)

function onPlanDragStart(e: PointerEvent) {
  const card = planCardRef.value
  const panel = card?.offsetParent as HTMLElement | null
  if (!card || !panel) return
  planDragMoved = false
  const startX = e.clientX
  const startY = e.clientY
  const cardRect = card.getBoundingClientRect()
  const panelRect = panel.getBoundingClientRect()
  const originX = cardRect.left - panelRect.left
  const originY = cardRect.top - panelRect.top
  const maxX = Math.max(4, panelRect.width - cardRect.width - 4)
  const maxY = Math.max(4, panelRect.height - cardRect.height - 4)

  function onMove(ev: PointerEvent) {
    const dx = ev.clientX - startX
    const dy = ev.clientY - startY
    // Small movements stay a click (toggle collapse), not a drag
    if (!planDragMoved && Math.abs(dx) + Math.abs(dy) < 4) return
    planDragMoved = true
    planPos.value = {
      x: Math.min(Math.max(originX + dx, 4), maxX),
      y: Math.min(Math.max(originY + dy, 4), maxY),
    }
  }
  function onUp() {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

function onPlanHeaderClick() {
  if (planDragMoved) return
  planCollapsed.value = !planCollapsed.value
}

function todoIcon(status: string) {
  switch (status) {
    case 'in_progress': return Loader2
    case 'completed': return CheckCircle2
    case 'failed': return XCircle
    default: return Circle
  }
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

function useExamplePrompt(prompt: string) {
  inputText.value = prompt
  nextTick(() => {
    resizeTextarea()
    textareaRef.value?.focus()
  })
}
</script>

<template>
  <div :class="$style.panel">
    <!-- Dot-grid background -->
    <div :class="$style.dotBg" />

    <!-- Message list -->
    <div ref="scrollContainerRef" :class="$style.messages">
      <div :class="$style.messagesInner">
        <div v-if="messages.length === 0" :class="$style.empty">
          <div :class="$style.emptyIcon">
            <component :is="emptyIcon" :size="28" />
          </div>
          <p :class="$style.emptyTitle">{{ t(`${mode}.emptyState.title`) }}</p>
          <p :class="$style.emptyHint">{{ t(`${mode}.emptyState.description`) }}</p>
          <div :class="$style.exampleGrid">
            <button
              v-for="ex in examplePrompts"
              :key="ex.label"
              :class="$style.exampleChip"
              :disabled="!hasLlmConfig"
              @click="useExamplePrompt(ex.prompt)"
            >
              <span :class="$style.exampleLabel">{{ ex.label }}</span>
              <ArrowRight :size="14" :class="$style.exampleArrow" />
            </button>
          </div>
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
              <span>{{ t('agentPanel.thinking') }}</span>
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
            <template v-if="getInlinePreview(msg.meta?.toolCallId as string)">
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

        <!-- Tool calls without a conversation message (fallback — audit #47) -->
        <div v-for="tc in orphanToolCalls" :key="tc.id" :class="$style.toolMsg">
          <ToolCallCard :tool-call="tc" @preview="handlePopOut" />
        </div>

        <!-- Pending approval -->
        <div v-if="pendingApproval" :class="$style.toolMsg">
          <ApprovalCard
            :approval="pendingApproval"
            @approve="handleApprove"
            @approve-always="handleApproveAlways"
            @reject="handleReject"
          />
        </div>

        <!-- Pending agent question -->
        <div v-if="pendingQuestion" :class="$style.toolMsg">
          <AskUserQuestionCard
            :key="pendingQuestion.id"
            :request="pendingQuestion"
            @submit="handleQuestionSubmit"
          />
        </div>

        <!-- Waiting for first token -->
        <div v-if="isRunning && !pendingApproval && !pendingQuestion && !isStreaming" :class="$style.thinkingRow">
          <span :class="$style.thinkingDots">
            <span /><span /><span />
          </span>
        </div>
      </div>
    </div>

    <!-- Agent plan (todo_update events) — fixed top-right overlay -->
    <div
      v-if="todos.length > 0"
      ref="planCardRef"
      :class="[$style.planCard, planCollapsed && $style.planCardCollapsed]"
      :style="planPosStyle"
    >
      <button
        :class="$style.planHeader"
        @pointerdown="onPlanDragStart"
        @click="onPlanHeaderClick"
      >
        <ListChecks :size="14" />
        <span>{{ t('agentPanel.plan') }}</span>
        <span :class="$style.planCount">{{ planDoneCount }}/{{ todos.length }}</span>
        <component
          :is="planCollapsed ? ChevronDown : ChevronUp"
          :size="14"
          :class="$style.planChevron"
        />
      </button>
      <ul v-if="!planCollapsed" :class="$style.planList">
        <li
          v-for="todo in todos"
          :key="todo.id"
          :class="[$style.planItem, todo.status === 'completed' && $style.planItemDone]"
        >
          <component
            :is="todoIcon(todo.status)"
            :size="14"
            :class="[$style.planIcon, todo.status === 'in_progress' && $style.planIconSpin]"
          />
          <span>{{ todo.title }}</span>
        </li>
      </ul>
    </div>

    <!-- Input area (drop zone) -->
    <div
      :class="[$style.inputArea, isDragOver && $style.inputAreaDragOver]"
      @dragover="handleDragOver"
      @dragleave="handleDragLeave"
      @drop="handleDrop"
    >
      <div :class="$style.inputInner">
        <div v-if="!hasLlmConfig" :class="$style.configHint">
          <ion-icon :icon="settingsOutline" :class="$style.configIcon" />
          {{ t('agentPanel.configHint') }}
        </div>

        <!-- MCP connectivity banner — n8n tools unavailable -->
        <McpStatusBanner />

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

        <!-- Input box (textarea + action bar) -->
        <div :class="$style.inputBox">
          <!-- Attached folder & file tiles -->
          <div v-if="sessionFolders.length > 0 || attachedFiles.length > 0" :class="$style.fileTiles">
            <!-- Folder chips: always visible, with access mode and detach (audit #48) -->
            <div
              v-for="folder in sessionFolders"
              :key="folder.path"
              :class="$style.fileTile"
              :title="folder.path"
              @contextmenu="handleFolderContextMenu($event, folder.path)"
            >
              <Folder :size="14" :class="$style.fileTileIcon" />
              <span :class="$style.fileTileName">{{ folder.label }}</span>
              <button
                :class="[$style.modeBadge, folder.mode === 'ro' && $style.modeBadgeRo]"
                type="button"
                :disabled="!canModifyFolders"
                :title="folder.mode === 'ro'
                  ? t(canModifyFolders ? 'agentPanel.folderModeRoHint' : 'agentPanel.folderModeRo')
                  : t(canModifyFolders ? 'agentPanel.folderModeRwHint' : 'agentPanel.folderModeRw')"
                @click="toggleFolderMode(folder)"
              >
                {{ folder.mode === 'ro' ? 'RO' : 'RW' }}
              </button>
              <button
                v-if="canModifyFolders"
                :class="$style.fileTileRemove"
                type="button"
                :aria-label="t('agentPanel.detachFolder', { name: folder.label })"
                @click="handleDetachFolder(folder.path)"
              >
                <X :size="10" />
              </button>
            </div>
            <div
              v-for="file in attachedFiles"
              :key="file.path"
              :class="$style.fileTile"
              :title="file.path"
            >
              <component :is="fileIcon(file.name)" :size="14" :class="$style.fileTileIcon" />
              <span :class="$style.fileTileName">{{ file.name }}</span>
              <button
                :class="$style.fileTileRemove"
                type="button"
                :aria-label="t('agentPanel.removeFile', { name: file.name })"
                @click="removeFile(file.path)"
              >
                <X :size="10" />
              </button>
            </div>
          </div>

          <textarea
            ref="textareaRef"
            v-model="inputText"
            :class="$style.textarea"
            :disabled="isRunning || !hasLlmConfig"
            :placeholder="t(`${mode}.input.placeholder`)"
            rows="1"
            @input="handleInput"
            @keydown="handleKeydown"
          />
          <div :class="$style.actionRow">
            <div :class="$style.actionRowLeft">
              <div :class="$style.plusBtnWrap">
                <button
                  id="plus-menu-trigger"
                  :class="$style.actionIconBtn"
                  :title="t('agentPanel.plusMenu')"
                  @click.stop="plusMenuOpen = !plusMenuOpen"
                >
                  <Plus :size="16" />
                </button>
                <PlusMenu
                  :is-open="plusMenuOpen"
                  trigger="plus-menu-trigger"
                  :session-disabled-skills="sessionDisabledSkills"
                  @update:is-open="plusMenuOpen = $event"
                  @toggle-session-skill="handleSessionSkillToggle"
                />
              </div>
              <button
                v-if="canModifyFolders"
                :class="$style.actionIconBtn"
                :title="t('agentPanel.attachFolder')"
                @click="handleAttachFolder"
              >
                <FolderPlus :size="16" />
              </button>
              <button
                :class="$style.actionIconBtn"
                :title="t('agentPanel.attachFiles')"
                :disabled="isRunning"
                @click="handleAttachFiles"
              >
                <Paperclip :size="16" />
              </button>
            </div>
            <!-- Stop while running (audit #20), send otherwise -->
            <button
              v-if="isRunning"
              :class="$style.stopBtn"
              :title="t('agentPanel.stopAgent')"
              @click="stopAgent"
            >
              <Square :size="13" fill="currentColor" />
            </button>
            <button
              v-else
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

    <!-- Folder context menu -->
    <Teleport to="body">
      <div
        v-if="folderContextMenu"
        :class="$style.contextMenu"
        :style="{ left: folderContextMenu.x + 'px', top: folderContextMenu.y + 'px' }"
      >
        <button
          :class="$style.contextMenuItem"
          @click="showInFinder(folderContextMenu!.path)"
        >
          {{ t('agentPanel.showInFinder') }}
        </button>
      </div>
    </Teleport>
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
  min-height: 60vh;
  padding: 24px 16px;
}

.emptyIcon {
  width: 52px;
  height: 52px;
  border-radius: 14px;
  background: var(--n8n-desk--surface-bg, var(--color--foreground));
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 16px;
  color: var(--color--text--tint-1);
}

.emptyTitle {
  font-size: 18px;
  font-weight: 600;
  color: var(--color--text--shade-1);
  margin: 0 0 6px;
}

.emptyHint {
  font-size: 13px;
  color: var(--color--text--tint-1);
  margin: 0 0 24px;
  max-width: 400px;
  line-height: 1.5;
}

.exampleGrid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  max-width: 480px;
  width: 100%;
}

.exampleChip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 10px;
  border: 1px solid var(--n8n-desk--surface-raised-bg, var(--color--foreground));
  background: var(--n8n-desk--surface-bg, var(--color--foreground));
  color: var(--color--text);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;

  &:hover:not(:disabled) {
    background: var(--n8n-desk--surface-raised-bg, var(--color--foreground--tint-1));
    border-color: var(--color--text--tint-2);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.exampleLabel {
  flex: 1;
  line-height: 1.4;
}

.exampleArrow {
  flex-shrink: 0;
  color: var(--color--text--tint-1);
  opacity: 0;
  transition: opacity 0.15s;

  .exampleChip:hover:not(:disabled) & {
    opacity: 1;
  }
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

.inputBox {
  background: var(--n8n-desk--surface-bg, var(--color--foreground));
  border: 1px solid var(--n8n-desk--surface-raised-bg, var(--color--foreground));
  border-radius: 12px;
  padding: 10px 14px 6px;
  transition: border-color 0.15s;

  &:focus-within {
    border-color: var(--color--primary, #ff6d5a);
  }
}

.textarea {
  width: 100%;
  box-sizing: border-box;
  resize: none;
  border: none;
  padding: 0;
  font-size: 14px;
  font-family: inherit;
  line-height: 1.5;
  background: transparent;
  color: var(--color--text--shade-1);
  outline: none;
  max-height: 150px;
  overflow-y: auto;

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

// --- Stop button (replaces send while the agent runs) ---
.stopBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  background: var(--color--danger, #ef4444);
  color: #fff;
  cursor: pointer;
  flex-shrink: 0;

  &:hover {
    opacity: 0.9;
  }
}

// --- Attached folder mode badge (ro/rw) ---
.modeBadge {
  flex-shrink: 0;
  padding: 1px 5px;
  border: none;
  border-radius: 4px;
  background: var(--n8n-desk--surface-bg, var(--color--foreground));
  color: var(--color--text--tint-1);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  cursor: pointer;

  &:disabled {
    cursor: default;
    opacity: 0.7;
  }

  &:not(:disabled):hover {
    color: var(--color--text--shade-1);
  }
}

.modeBadgeRo {
  color: var(--color--warning, #f59e0b);

  &:not(:disabled):hover {
    color: var(--color--warning, #f59e0b);
    opacity: 0.8;
  }
}

// --- Agent plan (todo list) — fixed top-right overlay ---
.planCard {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 4;
  width: 280px;
  max-width: calc(100% - 24px);
  max-height: 50%;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--n8n-desk--surface-raised-bg, var(--color--foreground));
  border-radius: 10px;
  background: var(--n8n-desk--surface-bg, var(--color--foreground));
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
  padding: 10px 12px;
  transition: opacity 0.15s ease;

  // See what's beneath while hovering
  &:hover {
    opacity: 0.35;
  }
}

.planCardCollapsed {
  width: auto;
  padding: 6px 10px;
}

.planHeader {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  border: none;
  background: none;
  cursor: grab;
  padding: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--color--text--tint-1);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  touch-action: none;
  user-select: none;

  &:active {
    cursor: grabbing;
  }

  .planCard:not(.planCardCollapsed) & {
    margin-bottom: 8px;
  }
}

.planCount {
  margin-left: auto;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.planChevron {
  flex-shrink: 0;
}

.planList {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
}

.planItem {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 13px;
  line-height: 1.4;
  color: var(--color--text--shade-1);
}

.planItemDone {
  color: var(--color--text--tint-1);

  span {
    text-decoration: line-through;
  }
}

.planIcon {
  flex-shrink: 0;
  margin-top: 2px;
  color: var(--color--text--tint-1);

  .planItemDone & {
    color: var(--color--success, #10b981);
  }
}

.planIconSpin {
  color: var(--color--primary, #ff6d5a);
  animation: planSpin 1.2s linear infinite;
}

@keyframes planSpin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

// --- File tiles (above textarea) ---
.fileTiles {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding-bottom: 8px;
}

.fileTile {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 6px 4px 8px;
  background: var(--n8n-desk--surface-raised-bg, var(--color--foreground));
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.3;
  color: var(--color--text--shade-1, inherit);
  max-width: 180px;
}

.fileTileIcon {
  flex-shrink: 0;
  color: var(--color--text--tint-1);
}

.fileTileName {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fileTileRemove {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: none;
  color: var(--color--text--tint-1, #999);
  cursor: pointer;
  transition: color 0.15s, background-color 0.15s;

  &:hover {
    color: var(--color--text--shade-1, inherit);
    background: rgba(0, 0, 0, 0.08);
  }
}

// --- Context menu ---
.contextMenu {
  position: fixed;
  z-index: 9999;
  min-width: 160px;
  background: var(--n8n-desk--surface-bg, var(--color--foreground));
  border: 1px solid var(--n8n-desk--surface-raised-bg, var(--color--foreground));
  border-radius: 8px;
  padding: 4px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
}

.contextMenuItem {
  display: block;
  width: 100%;
  text-align: left;
  padding: 6px 10px;
  border: none;
  border-radius: 5px;
  background: none;
  color: var(--color--text--shade-1);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.1s;

  &:hover {
    background: var(--n8n-desk--surface-raised-bg, var(--color--foreground));
  }
}

.contextMenuSep {
  height: 1px;
  background: var(--n8n-desk--surface-raised-bg, var(--color--foreground));
  margin: 4px 6px;
}

// --- Drag-over state ---
.inputAreaDragOver {
  &::after {
    content: '';
    position: absolute;
    inset: 0;
    border: 2px dashed var(--color--primary, #ff6d5a);
    border-radius: 12px;
    background: rgba(255, 109, 90, 0.05);
    pointer-events: none;
    z-index: 2;
  }
}

// --- Action row (below textarea) ---
.actionRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 6px;
}

.actionRowLeft {
  display: flex;
  align-items: center;
  gap: 4px;
}

.actionIconBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: none;
  background: none;
  color: var(--color--text--tint-1);
  cursor: pointer;
  flex-shrink: 0;
  transition: color 0.15s, background 0.15s;

  &:hover {
    color: var(--color--text--shade-1);
    background: var(--n8n-desk--surface-raised-bg, var(--color--foreground));
  }
}

.actionIconBtnDisabled {
  opacity: 0.3;
  cursor: not-allowed;
  pointer-events: none;
}

.plusBtnWrap {
  position: relative;
  flex-shrink: 0;
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
