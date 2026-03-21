<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { IonToggle } from '@ionic/vue'
import {
  Zap, Plug, Package, ChevronRight, Settings, Plus, AlertTriangle, Lock,
} from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { usePluginsStore } from '@/stores/plugins'
import { useSettingsStore } from '@/stores/settings'

const props = defineProps<{
  trigger: string
  isOpen: boolean
  sessionDisabledSkills: Set<string>
}>()

const emit = defineEmits<{
  'update:isOpen': [value: boolean]
  toggleSessionSkill: [skillName: string]
}>()

const { t } = useI18n()
const pluginsStore = usePluginsStore()
const settingsStore = useSettingsStore()

const hoveredCategory = ref<'skills' | 'connectors' | 'plugins' | null>(null)

// Reset hovered category when menu closes
watch(() => props.isOpen, (open) => {
  if (!open) hoveredCategory.value = null
})

// --- Skills ---
const builtInSkills = computed(() =>
  pluginsStore.builtInSkills.filter((s) => s.enabled),
)
const userSkills = computed(() => pluginsStore.skills.filter((s) => !s.builtIn))
const allActiveSkills = computed(() => [...builtInSkills.value, ...userSkills.value])
const sessionActiveSkillCount = computed(() =>
  allActiveSkills.value.filter((s) => !props.sessionDisabledSkills.has(s.name)).length,
)

// --- Connectors ---
const servers = computed(() => pluginsStore.standaloneServers)
const enabledServerCount = computed(() => pluginsStore.enabledServers.length)

// --- Plugins ---
const installedPlugins = computed(() => pluginsStore.installedPlugins)
const enabledPluginCount = computed(() => pluginsStore.enabledPlugins.length)

function isSkillActive(name: string): boolean {
  return !props.sessionDisabledSkills.has(name)
}

function handleSkillToggle(name: string): void {
  emit('toggleSessionSkill', name)
}

async function handleServerToggle(serverId: string): Promise<void> {
  const server = servers.value.find((s) => s.id === serverId)
  if (!server) return
  try {
    await pluginsStore.updateServer(serverId, { enabled: !server.enabled })
  } catch { /* noop */ }
}

async function handlePluginToggle(pluginId: string): Promise<void> {
  try {
    await pluginsStore.togglePlugin(pluginId)
  } catch { /* noop */ }
}

function openSettings(section: string) {
  emit('update:isOpen', false)
  hoveredCategory.value = null
  requestAnimationFrame(() => {
    settingsStore.openSettings(section)
  })
}

function close() {
  emit('update:isOpen', false)
  hoveredCategory.value = null
}

</script>

<template>
  <div v-if="isOpen">
    <div :class="$style.backdrop" @mousedown.self="close" />
    <div :class="$style.anchor">
        <!-- Main menu -->
        <div :class="$style.main">
          <!-- Skills row -->
          <div
            :class="[$style.row, hoveredCategory === 'skills' && $style.rowActive]"
            @mouseenter="hoveredCategory = 'skills'"
          >
            <Zap :size="15" :class="$style.rowIcon" />
            <span :class="$style.rowLabel">{{ t('plugins.plusMenu.skills') }}</span>
            <span
              v-if="sessionDisabledSkills.size > 0"
              :class="$style.rowBadge"
            >
              <AlertTriangle :size="10" />
              {{ sessionActiveSkillCount }}
            </span>
            <ChevronRight :size="14" :class="$style.rowChevron" />
          </div>

          <!-- Connectors row -->
          <div
            :class="[$style.row, hoveredCategory === 'connectors' && $style.rowActive]"
            @mouseenter="hoveredCategory = 'connectors'"
          >
            <Plug :size="15" :class="$style.rowIcon" />
            <span :class="$style.rowLabel">{{ t('plugins.plusMenu.connectors') }}</span>
            <span :class="$style.rowCount">{{ enabledServerCount + 1 }}</span>
            <ChevronRight :size="14" :class="$style.rowChevron" />
          </div>

          <!-- Plugins row -->
          <div
            :class="[$style.row, hoveredCategory === 'plugins' && $style.rowActive]"
            @mouseenter="hoveredCategory = 'plugins'"
          >
            <Package :size="15" :class="$style.rowIcon" />
            <span :class="$style.rowLabel">{{ t('plugins.plusMenu.plugins') }}</span>
            <span v-if="installedPlugins.length > 0" :class="$style.rowCount">{{ enabledPluginCount }}</span>
            <ChevronRight :size="14" :class="$style.rowChevron" />
          </div>
        </div>

        <!-- Submenu (appears to the right) -->
        <div v-if="hoveredCategory" :class="$style.sub">
          <!-- Skills -->
          <template v-if="hoveredCategory === 'skills'">
            <div
              v-for="skill in allActiveSkills"
              :key="skill.name"
              :class="[$style.subRow, !isSkillActive(skill.name) && $style.subRowOff]"
            >
              <span :class="$style.subName">/{{ skill.name }}</span>
              <ion-toggle
                :checked="isSkillActive(skill.name)"
                :class="$style.toggle"
                @ion-change="handleSkillToggle(skill.name)"
              />
            </div>
            <div v-if="allActiveSkills.length === 0" :class="$style.subEmpty">
              {{ t('plugins.plusMenu.noSkills') }}
            </div>
            <div :class="$style.subDivider" />
            <button :class="$style.subAction" @click="openSettings('skills')">
              <Settings :size="13" />
              {{ t('plugins.plusMenu.manageSkills') }}
            </button>
          </template>

          <!-- Connectors -->
          <template v-if="hoveredCategory === 'connectors'">
            <!-- Built-in n8n MCP (always on) -->
            <div :class="[$style.subRow, $style.subRowBuiltIn]">
              <span :class="$style.subName">n8n MCP</span>
              <span :class="$style.builtInBadge">
                <Lock :size="10" />
                {{ t('plugins.popover.alwaysOn') }}
              </span>
            </div>
            <!-- User-added servers -->
            <div
              v-for="server in servers"
              :key="server.id"
              :class="$style.subRow"
            >
              <span :class="$style.subName">{{ server.name }}</span>
              <ion-toggle
                :checked="server.enabled"
                :class="$style.toggle"
                @ion-change="handleServerToggle(server.id)"
              />
            </div>
            <div :class="$style.subDivider" />
            <button :class="$style.subAction" @click="openSettings('connectors')">
              <Settings :size="13" />
              {{ t('plugins.plusMenu.manageConnectors') }}
            </button>
          </template>

          <!-- Plugins -->
          <template v-if="hoveredCategory === 'plugins'">
            <div
              v-for="plugin in installedPlugins"
              :key="plugin.id"
              :class="$style.subRow"
            >
              <span :class="$style.subName">{{ plugin.name }}</span>
              <ion-toggle
                :checked="plugin.enabled"
                :class="$style.toggle"
                @ion-change="handlePluginToggle(plugin.id)"
              />
            </div>
            <div v-if="installedPlugins.length === 0" :class="$style.subEmpty">
              {{ t('plugins.plusMenu.noPlugins') }}
            </div>
            <div :class="$style.subDivider" />
            <button :class="$style.subAction" @click="openSettings('plugins')">
              <Settings :size="13" />
              {{ t('plugins.plusMenu.managePlugins') }}
            </button>
            <button :class="$style.subAction" @click="openSettings('plugins')">
              <Plus :size="13" />
              {{ t('plugins.plusMenu.addPlugin') }}
            </button>
          </template>
        </div>
    </div>
  </div>
</template>

<style lang="scss" module>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 999;
}

.anchor {
  position: absolute;
  bottom: 100%;
  left: 0;
  margin-bottom: 8px;
  display: flex;
  align-items: flex-end;
  gap: 2px;
  z-index: 1000;
}

// --- Main panel ---
.main {
  background: var(--n8n-desk--surface-bg, var(--color--foreground));
  border: 1px solid var(--n8n-desk--content-bg, var(--color--background));
  border-radius: 12px;
  padding: 6px;
  min-width: 200px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.28), 0 2px 8px rgba(0, 0, 0, 0.14);
}

.row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  border-radius: 8px;
  cursor: default;
  font-size: 14px;
  color: var(--color--text--shade-1);
  transition: background 0.08s;

  &:hover {
    background: var(--n8n-desk--surface-raised-bg, var(--color--foreground--tint-2));
  }
}

.rowActive {
  background: var(--n8n-desk--surface-raised-bg, var(--color--foreground--tint-2));
}

.rowIcon {
  color: var(--color--text--tint-1);
  flex-shrink: 0;
}

.rowLabel {
  flex: 1;
  font-weight: 500;
}

.rowCount {
  font-size: 12px;
  color: var(--color--text--tint-2);
}

.rowBadge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  font-weight: 600;
  color: var(--color--warning, #f59e0b);
  padding: 1px 6px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--color--warning, #f59e0b) 12%, transparent);
}

.rowChevron {
  color: var(--color--text--tint-2);
  flex-shrink: 0;
}

// --- Sub panel ---
.sub {
  background: var(--n8n-desk--surface-bg, var(--color--foreground));
  border: 1px solid var(--n8n-desk--content-bg, var(--color--background));
  border-radius: 12px;
  padding: 6px;
  min-width: 200px;
  max-width: 260px;
  max-height: 50vh;
  overflow-y: auto;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.28), 0 2px 8px rgba(0, 0, 0, 0.14);
}

.subRow {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  transition: background 0.08s;

  &:hover {
    background: var(--n8n-desk--surface-raised-bg, var(--color--foreground--tint-2));
  }
}

.subRowBuiltIn {
  opacity: 0.85;
  cursor: default;

  &:hover {
    background: transparent;
  }
}

.builtInBadge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--color--success, #10b981);
  background: color-mix(in srgb, var(--color--success, #10b981) 10%, transparent);
  padding: 2px 6px;
  border-radius: 4px;
  flex-shrink: 0;
}

.subRowOff {
  opacity: 0.5;
}

.subName {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
  color: var(--color--text--shade-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.toggle {
  flex-shrink: 0;
  --track-background: var(--color--text--tint-2);
  --track-background-checked: var(--color--success, #10b981);
}

.subEmpty {
  padding: 14px 10px;
  font-size: 12px;
  color: var(--color--text--tint-2);
  text-align: center;
}

.subDivider {
  height: 1px;
  background: var(--n8n-desk--surface-raised-bg, var(--color--foreground--tint-2));
  margin: 4px 6px;
}

.subAction {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--color--text--tint-1);
  cursor: pointer;
  font-size: 13px;
  text-align: left;
  transition: background 0.08s, color 0.08s;

  &:hover {
    background: var(--n8n-desk--surface-raised-bg, var(--color--foreground--tint-2));
    color: var(--color--text--shade-1);
  }
}
</style>
