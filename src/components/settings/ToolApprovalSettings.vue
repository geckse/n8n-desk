<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { IonToggle, IonButton, IonSpinner } from '@ionic/vue'
import { Server, TriangleAlert, ShieldCheck, X } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useInstancesStore } from '@/stores/instances'
import { localStorageService } from '@/services/local-storage'
import { toolDisplayName } from '@/utils/tool-display'
import type { McpToolCatalog, McpToolCatalogEntry, ToolApprovalPresets } from '@/types/mcp'

const { t } = useI18n()
const instancesStore = useInstancesStore()

const isLoading = ref(true)
const loadError = ref<string | null>(null)
const catalog = ref<McpToolCatalog | null>(null)
/** Canonical keys with an "always allow" preset (tool-approvals.json). */
const alwaysAllow = ref<Set<string>>(new Set())

const presetsPath = computed(() => {
  const id = instancesStore.activeInstanceId
  return id ? `instances/${id}/tool-approvals.json` : null
})

onMounted(async () => {
  isLoading.value = true
  loadError.value = null
  try {
    if (presetsPath.value) {
      const presets = await localStorageService.readJson<ToolApprovalPresets>(presetsPath.value)
      if (presets && Array.isArray(presets.alwaysAllow)) {
        alwaysAllow.value = new Set(presets.alwaysAllow.filter((k) => typeof k === 'string'))
      }
    }
    if (window.n8nDesk) {
      catalog.value = await window.n8nDesk.agent.listMcpTools(
        instancesStore.activeInstanceId ?? undefined,
      )
    }
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : String(err)
  } finally {
    isLoading.value = false
  }
})

/** Preset keys that no reachable server currently offers — always revocable. */
const orphanedKeys = computed(() => {
  const known = new Set<string>()
  const c = catalog.value
  if (!c) return []
  for (const tool of c.n8n.tools) known.add(tool.key)
  for (const server of c.customServers) {
    for (const tool of server.tools) known.add(tool.key)
  }
  return [...alwaysAllow.value].filter((key) => !known.has(key))
})

async function persist(): Promise<void> {
  if (!presetsPath.value) return
  const data: ToolApprovalPresets = { version: 1, alwaysAllow: [...alwaysAllow.value].sort() }
  await localStorageService.writeJson(presetsPath.value, data)
}

function handleToggle(key: string): void {
  if (alwaysAllow.value.has(key)) {
    alwaysAllow.value.delete(key)
  } else {
    alwaysAllow.value.add(key)
  }
  // Reassign so the Set change is reactive, then commit immediately
  alwaysAllow.value = new Set(alwaysAllow.value)
  void persist()
}

function removeOrphan(key: string): void {
  alwaysAllow.value.delete(key)
  alwaysAllow.value = new Set(alwaysAllow.value)
  void persist()
}

function rowTitle(tool: McpToolCatalogEntry): string {
  return toolDisplayName(tool.name)
}
</script>

<template>
  <div :class="$style.container">
    <h3 :class="$style.title">{{ t('settings.sections.toolApprovals') }}</h3>
    <p :class="$style.description">{{ t('settings.toolApprovals.description') }}</p>

    <div v-if="isLoading" :class="$style.loading">
      <ion-spinner name="crescent" />
      <span :class="$style.loadingText">{{ t('settings.toolApprovals.loading') }}</span>
    </div>

    <div v-else-if="loadError" :class="$style.empty">
      {{ t('settings.toolApprovals.loadError', { error: loadError }) }}
    </div>

    <template v-else-if="catalog">
      <!-- n8n server tools -->
      <div :class="$style.section">
        <div :class="$style.sectionLabel">
          <Server :size="12" />
          {{ t('settings.toolApprovals.n8nServerTitle') }}
        </div>
        <div v-if="!catalog.n8n.reachable" :class="$style.serverError">
          {{ t('settings.toolApprovals.unreachable', { error: catalog.n8n.error ?? '' }) }}
        </div>
        <div v-else-if="catalog.n8n.tools.length === 0" :class="$style.empty">
          {{ t('settings.toolApprovals.empty') }}
        </div>
        <div v-else :class="$style.list">
          <div v-for="tool in catalog.n8n.tools" :key="tool.key" :class="$style.row">
            <div :class="$style.rowInfo">
              <div :class="$style.rowName">
                {{ rowTitle(tool) }}
                <span v-if="tool.destructive" :class="[$style.badge, $style.badgeWarning]">
                  <TriangleAlert :size="10" />
                  {{ t('settings.toolApprovals.destructiveBadge') }}
                </span>
                <span v-else-if="tool.gated" :class="$style.badge">
                  <ShieldCheck :size="10" />
                  {{ t('settings.toolApprovals.requiresApprovalBadge') }}
                </span>
              </div>
              <div v-if="tool.description" :class="$style.rowDescription">{{ tool.description }}</div>
              <div v-if="!tool.gated" :class="$style.rowHint">{{ t('settings.toolApprovals.neverPrompts') }}</div>
            </div>
            <ion-toggle
              :checked="alwaysAllow.has(tool.key)"
              :aria-label="`${t('settings.toolApprovals.alwaysAllow')}: ${rowTitle(tool)}`"
              @ion-change="handleToggle(tool.key)"
            />
          </div>
        </div>
      </div>

      <!-- Custom / connector server tools -->
      <div v-for="server in catalog.customServers" :key="server.serverName" :class="$style.section">
        <div :class="$style.sectionLabel">
          <Server :size="12" />
          {{ t('settings.toolApprovals.customServersTitle') }} — {{ server.serverName }}
        </div>
        <div v-if="!server.reachable" :class="$style.serverError">
          {{ t('settings.toolApprovals.unreachable', { error: server.error ?? '' }) }}
        </div>
        <div v-else :class="$style.list">
          <div v-for="tool in server.tools" :key="tool.key" :class="$style.row">
            <div :class="$style.rowInfo">
              <div :class="$style.rowName">
                {{ rowTitle(tool) }}
                <span v-if="tool.gated" :class="$style.badge">
                  <ShieldCheck :size="10" />
                  {{ t('settings.toolApprovals.requiresApprovalBadge') }}
                </span>
              </div>
              <div v-if="tool.description" :class="$style.rowDescription">{{ tool.description }}</div>
              <div v-if="!tool.gated" :class="$style.rowHint">{{ t('settings.toolApprovals.neverPrompts') }}</div>
            </div>
            <ion-toggle
              :checked="alwaysAllow.has(tool.key)"
              :aria-label="`${t('settings.toolApprovals.alwaysAllow')}: ${rowTitle(tool)}`"
              @ion-change="handleToggle(tool.key)"
            />
          </div>
        </div>
      </div>

      <!-- Presets whose tools are not currently discoverable -->
      <div v-if="orphanedKeys.length > 0" :class="$style.section">
        <div :class="$style.sectionLabel">
          <TriangleAlert :size="12" />
          {{ t('settings.toolApprovals.unavailableTitle') }}
        </div>
        <p :class="$style.rowDescription">{{ t('settings.toolApprovals.unavailableDescription') }}</p>
        <div :class="$style.list">
          <div v-for="key in orphanedKeys" :key="key" :class="$style.row">
            <div :class="$style.rowInfo">
              <div :class="$style.rowName">{{ toolDisplayName(key) }}</div>
              <div :class="$style.rowDescription">{{ key }}</div>
            </div>
            <ion-button fill="clear" size="small" color="medium" @click="removeOrphan(key)">
              <X :size="14" style="margin-right: 4px;" />
              {{ t('settings.toolApprovals.remove') }}
            </ion-button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style lang="scss" module>
.container { max-width: 640px; }

.title {
  font-size: var(--font-size--lg);
  font-weight: var(--font-weight--bold);
  color: var(--color--text);
  margin: 0 0 var(--spacing--2xs);
}

.description {
  font-size: var(--font-size--sm);
  color: var(--color--text--tint-1);
  margin: 0 0 var(--spacing--lg);
}

.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing--sm);
  padding: var(--spacing--xl) 0;
}

.loadingText {
  font-size: var(--font-size--sm);
  color: var(--color--text--tint-1);
}

.section { margin-bottom: var(--spacing--lg); }

.sectionLabel {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-size--2xs);
  font-weight: var(--font-weight--bold);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color--text--tint-1);
  margin-bottom: var(--spacing--sm);
}

.list {
  display: flex;
  flex-direction: column;
  background: var(--n8n-desk--surface-bg, var(--color--foreground));
  border: 1px solid var(--n8n-desk--content-bg, var(--color--background));
  border-radius: 10px;
  overflow: hidden;
}

.row {
  display: flex;
  align-items: center;
  gap: var(--spacing--md);
  padding: 10px 16px;

  & + & {
    border-top: 1px solid var(--n8n-desk--content-bg, var(--color--background));
  }
}

.rowInfo {
  flex: 1;
  min-width: 0;
}

.rowName {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--font-size--sm);
  font-weight: var(--font-weight--medium);
  color: var(--color--text--shade-1);
}

.rowDescription {
  font-size: var(--font-size--2xs);
  color: var(--color--text--tint-1);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.rowHint {
  font-size: var(--font-size--2xs);
  color: var(--color--text--tint-2);
  margin-top: 2px;
}

.badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  font-weight: var(--font-weight--bold);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--color--text--tint-1);
  background: var(--n8n-desk--content-bg, var(--color--background));
  border-radius: 4px;
  padding: 2px 6px;
}

.badgeWarning {
  color: var(--color--warning, #f59e0b);
  background: color-mix(in srgb, var(--color--warning, #f59e0b) 12%, transparent);
}

.serverError {
  font-size: var(--font-size--sm);
  color: var(--color--text--tint-1);
  padding: var(--spacing--md);
  background: var(--n8n-desk--surface-bg, var(--color--foreground));
  border: 1px dashed var(--color--warning, #f59e0b);
  border-radius: 10px;
}

.empty {
  text-align: center;
  font-size: var(--font-size--sm);
  color: var(--color--text--tint-2);
  padding: var(--spacing--xl) var(--spacing--md);
  background: var(--n8n-desk--surface-bg, var(--color--foreground));
  border: 1px dashed var(--n8n-desk--content-bg, var(--color--background));
  border-radius: 10px;
}
</style>
