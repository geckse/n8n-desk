<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { IonPage } from '@ionic/vue'
import { useWorkflowSessionsStore } from '@/stores/workflow-sessions'
import { usePluginsStore } from '@/stores/plugins'
import WorkflowChatPanel from '@/components/workflow/WorkflowChatPanel.vue'
import WorkflowPreviewPanel from '@/components/workflow/WorkflowPreviewPanel.vue'

const DEFAULT_PREVIEW_WIDTH = 420
const MIN_PREVIEW_WIDTH = 280
const MAX_PREVIEW_WIDTH = 700

const sessionStore = useWorkflowSessionsStore()
const pluginsStore = usePluginsStore()

// Hydrate plugins/connectors/skills on view mount so the PlusMenu has data
onMounted(() => {
  void pluginsStore.hydrate()
})
const previewWidth = ref(DEFAULT_PREVIEW_WIDTH)
const isResizing = ref(false)

const showPreview = computed(() => sessionStore.isPanelOpen)

const previewStyle = computed(() => {
  if (!showPreview.value) return { width: '0px', minWidth: '0px' }
  return {
    width: `${previewWidth.value}px`,
    minWidth: `${previewWidth.value}px`,
  }
})

function handleClosePanel() {
  sessionStore.closePanel()
}

// Resize logic for the preview panel divider
let startX = 0
let startWidth = 0

function onResizeStart(event: MouseEvent) {
  event.preventDefault()
  isResizing.value = true
  startX = event.clientX
  startWidth = previewWidth.value

  document.body.style.cursor = 'ew-resize'
  document.body.style.userSelect = 'none'

  window.addEventListener('mousemove', onResizeMove)
  window.addEventListener('mouseup', onResizeEnd)
}

function onResizeMove(event: MouseEvent) {
  // Dragging left increases preview width (divider is on the left edge of preview)
  const delta = startX - event.clientX
  const newWidth = startWidth + delta
  previewWidth.value = Math.max(MIN_PREVIEW_WIDTH, Math.min(MAX_PREVIEW_WIDTH, newWidth))
}

function onResizeEnd() {
  isResizing.value = false
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  window.removeEventListener('mousemove', onResizeMove)
  window.removeEventListener('mouseup', onResizeEnd)
}
</script>

<template>
  <ion-page>
    <div
      :class="[
        $style.splitLayout,
        isResizing && $style.resizing,
      ]"
    >
      <!-- Chat Panel (left, flex-grow) -->
      <div :class="$style.chatPane">
        <WorkflowChatPanel />
      </div>

      <!-- Resize divider -->
      <div
        v-if="showPreview"
        :class="$style.resizeHandle"
        @mousedown="onResizeStart"
      />

      <!-- Preview Panel (right, collapsible) -->
      <div
        :class="[
          $style.previewPane,
          !showPreview && $style.previewPaneCollapsed,
        ]"
        :style="previewStyle"
      >
        <WorkflowPreviewPanel
          :preview-data="sessionStore.previewData"
          @close="handleClosePanel"
        />
      </div>
    </div>
  </ion-page>
</template>

<style lang="scss" module>
.splitLayout {
  display: flex;
  height: 100%;
  overflow: hidden;
}

.resizing {
  user-select: none;
}

.chatPane {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.previewPane {
  overflow: hidden;
  transition: width 0.2s ease, min-width 0.2s ease;
  border-left: 1px solid var(--n8n-desk--surface-bg, var(--color--foreground));
}

.previewPaneCollapsed {
  width: 0 !important;
  min-width: 0 !important;
  border-left: none;
}

.resizing .previewPane {
  transition: none;
}

.resizeHandle {
  width: 4px;
  cursor: ew-resize;
  background: transparent;
  flex-shrink: 0;
  position: relative;
  z-index: 10;

  &:hover,
  &:active {
    background: var(--color--primary, #ff6d5a);
    opacity: 0.5;
  }
}
</style>
