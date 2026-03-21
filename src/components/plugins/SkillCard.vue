<script setup lang="ts">
import { computed } from 'vue'
import { IonCard, IonCardContent, IonButton, IonToggle } from '@ionic/vue'
import { Pencil, Trash2, Zap, Hand, Terminal, ShieldAlert, Eye } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import type { LoadedSkill } from '@/types/plugin'

interface Props {
  skill: LoadedSkill
  /** For built-in skills: whether the skill is currently enabled */
  enabled?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  enabled: true,
})

const emit = defineEmits<{
  edit: [skill: LoadedSkill]
  delete: [skill: LoadedSkill]
  toggle: [skill: LoadedSkill]
  view: [skill: LoadedSkill]
}>()

const { t } = useI18n()

const isUserCreated = computed(() => props.skill.source === 'user')
const isBuiltIn = computed(() => props.skill.builtIn === true)

const slashCommand = computed(() => `/${props.skill.name}`)

const invocationMode = computed(() =>
  props.skill.disableModelInvocation ? 'manual' : 'auto',
)

const invocationLabel = computed(() =>
  invocationMode.value === 'auto'
    ? t('plugins.skill.auto')
    : t('plugins.skill.manual'),
)

const sourceLabel = computed(() => {
  if (isBuiltIn.value) return t('plugins.skill.sourceBuiltIn')
  if (isUserCreated.value) return t('plugins.skill.sourceUser')
  return props.skill.source
})

const initial = computed(() => {
  const n = props.skill.name
  return n ? n.charAt(0).toUpperCase() : 'S'
})

function handleEdit() {
  emit('edit', props.skill)
}

function handleDelete() {
  emit('delete', props.skill)
}

function handleToggle() {
  emit('toggle', props.skill)
}
</script>

<template>
  <ion-card :class="[$style.card, isBuiltIn && !enabled && $style.cardDisabled]">
    <ion-card-content :class="$style.content">
      <div :class="$style.header">
        <div :class="$style.iconWrap">
          <span :class="$style.initial">{{ initial }}</span>
        </div>
        <div :class="$style.info">
          <div :class="$style.nameRow">
            <span :class="$style.name">{{ skill.name }}</span>
          </div>
          <span :class="$style.slashCommand">
            <Terminal :size="11" :class="$style.terminalIcon" />
            {{ slashCommand }}
          </span>
        </div>
        <div :class="$style.badges">
          <span :class="[$style.sourceBadge, isBuiltIn && $style.sourceBadgeBuiltIn]">{{ sourceLabel }}</span>
          <span
            :class="[
              $style.modeBadge,
              invocationMode === 'auto' && $style.modeBadgeAuto,
            ]"
          >
            <component
              :is="invocationMode === 'auto' ? Zap : Hand"
              :size="11"
            />
            {{ invocationLabel }}
          </span>
        </div>
      </div>

      <p v-if="skill.description" :class="$style.description">
        {{ skill.description }}
      </p>

      <!-- Warning when a built-in skill is disabled -->
      <div v-if="isBuiltIn && !enabled" :class="$style.disabledWarning">
        <ShieldAlert :size="14" :class="$style.warningIcon" />
        <span>{{ t('plugins.skill.builtInDisabledWarning') }}</span>
      </div>

      <!-- Built-in skills: view + toggle (no edit/delete) -->
      <div v-if="isBuiltIn" :class="$style.actions">
        <ion-button
          fill="clear"
          size="small"
          :class="$style.actionBtn"
          @click="emit('view', skill)"
        >
          <Eye :size="14" />
          {{ t('plugins.skill.view') }}
        </ion-button>
        <div :class="$style.actionsSpacer" />
        <ion-toggle
          :checked="enabled"
          :class="$style.builtInToggle"
          @ion-change="handleToggle"
        />
      </div>

      <!-- User skills: edit/delete -->
      <div v-else-if="isUserCreated" :class="$style.actions">
        <ion-button
          fill="clear"
          size="small"
          :class="$style.actionBtn"
          :title="t('plugins.skill.edit')"
          @click="handleEdit"
        >
          <Pencil :size="14" />
          {{ t('plugins.skill.edit') }}
        </ion-button>
        <ion-button
          fill="clear"
          size="small"
          color="danger"
          :class="$style.actionBtn"
          :title="t('plugins.skill.delete')"
          @click="handleDelete"
        >
          <Trash2 :size="14" />
          {{ t('plugins.skill.delete') }}
        </ion-button>
      </div>
    </ion-card-content>
  </ion-card>
</template>

<style lang="scss" module>
.card {
  --background: var(--n8n-desk--surface-bg, var(--color--foreground));
  --color: var(--color--text--shade-1);
  margin: 0;
  border-radius: 10px;
  border: 1px solid var(--n8n-desk--content-bg, var(--color--background));
  box-shadow: none;

  &:hover {
    border-color: var(--color--text--tint-2, rgba(0, 0, 0, 0.1));
  }
}

.content {
  padding: 14px 16px;
}

.header {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 8px;
}

.iconWrap {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: var(--n8n-desk--surface-raised-bg, var(--color--foreground--tint-2));
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.initial {
  font-size: 16px;
  font-weight: 600;
  color: var(--color--primary, #ff6d5a);
  line-height: 1;
}

.info {
  flex: 1;
  min-width: 0;
}

.nameRow {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.name {
  font-size: 14px;
  font-weight: 600;
  color: var(--color--text--shade-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.slashCommand {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 12px;
  font-family: monospace;
  color: var(--color--text--tint-1);
  margin-top: 2px;
}

.terminalIcon {
  color: var(--color--text--tint-1);
  flex-shrink: 0;
}

.badges {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  flex-shrink: 0;
}

.cardDisabled {
  opacity: 0.6;
}

.sourceBadge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 500;
  color: var(--color--primary, #ff6d5a);
  background: var(--n8n-desk--surface-raised-bg, var(--color--foreground--tint-2));
  white-space: nowrap;
}

.sourceBadgeBuiltIn {
  color: var(--color--primary, #ff6d5a);
  background: color-mix(in srgb, var(--color--primary, #ff6d5a) 12%, transparent);
}

.modeBadge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 500;
  color: var(--color--text--tint-1);
  background: var(--n8n-desk--surface-raised-bg, var(--color--foreground--tint-2));
  white-space: nowrap;
}

.modeBadgeAuto {
  color: var(--color--success, #10b981);
}

.description {
  font-size: 13px;
  color: var(--color--text--tint-1);
  line-height: 1.4;
  margin: 0 0 10px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.actions {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: flex-end;
}

.disabledWarning {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 8px 10px;
  margin-bottom: 10px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--color--warning, #f59e0b) 10%, transparent);
  font-size: 12px;
  line-height: 1.4;
  color: var(--color--warning, #f59e0b);
}

.warningIcon {
  flex-shrink: 0;
  margin-top: 1px;
}

.actionsSpacer { flex: 1; }

.builtInToggle {
  --track-background: var(--color--text--tint-2);
  --track-background-checked: var(--color--success, #10b981);
}

.actionBtn {
  --padding-start: 6px;
  --padding-end: 8px;
  font-size: 12px;
  gap: 4px;
}
</style>
