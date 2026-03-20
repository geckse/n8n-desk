<script setup lang="ts">
import { computed } from 'vue'
import { IonCard, IonCardContent, IonButton } from '@ionic/vue'
import { Pencil, Trash2, Zap, Hand, Terminal } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import type { LoadedSkill } from '@/types/plugin'

interface Props {
  skill: LoadedSkill
}

const props = defineProps<Props>()

const emit = defineEmits<{
  edit: [skill: LoadedSkill]
  delete: [skill: LoadedSkill]
}>()

const { t } = useI18n()

const isUserCreated = computed(() => props.skill.source === 'user')

const slashCommand = computed(() => `/${props.skill.name}`)

const invocationMode = computed(() =>
  props.skill.disableModelInvocation ? 'manual' : 'auto',
)

const invocationLabel = computed(() =>
  invocationMode.value === 'auto'
    ? t('plugins.skill.auto')
    : t('plugins.skill.manual'),
)

const sourceLabel = computed(() =>
  isUserCreated.value
    ? t('plugins.skill.sourceUser')
    : props.skill.source,
)

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
</script>

<template>
  <ion-card :class="$style.card">
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
          <span :class="$style.sourceBadge">{{ sourceLabel }}</span>
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

      <div v-if="isUserCreated" :class="$style.actions">
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

.actionBtn {
  --padding-start: 6px;
  --padding-end: 8px;
  font-size: 12px;
  gap: 4px;
}
</style>
