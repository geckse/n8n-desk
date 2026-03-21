<script setup lang="ts">
import { computed } from 'vue'
import {
  IonPopover, IonList, IonItem, IonLabel, IonToggle, IonItemDivider,
} from '@ionic/vue'
import { Zap, ShieldCheck } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { usePluginsStore } from '@/stores/plugins'
import type { LoadedSkill } from '@/types/plugin'

const props = defineProps<{
  trigger?: string
  /** Set of skill names disabled for this session */
  sessionDisabled: Set<string>
}>()

const emit = defineEmits<{
  toggle: [skillName: string]
}>()

const { t } = useI18n()
const pluginsStore = usePluginsStore()

const popover = defineModel<boolean>('isOpen', { default: false })

const builtInSkills = computed(() =>
  pluginsStore.builtInSkills.filter((s) => s.enabled),
)

const userSkills = computed(() =>
  pluginsStore.skills.filter((s) => !s.builtIn),
)

const hasUserSkills = computed(() => userSkills.value.length > 0)

const activeCount = computed(() => {
  const all = [...builtInSkills.value, ...userSkills.value]
  return all.filter((s) => !props.sessionDisabled.has(s.name)).length
})

function handleToggle(skill: LoadedSkill | { name: string }) {
  emit('toggle', skill.name)
}

function isActive(name: string): boolean {
  return !props.sessionDisabled.has(name)
}
</script>

<template>
  <ion-popover
    :trigger="trigger"
    :is-open="popover"
    side="top"
    alignment="start"
    :dismiss-on-select="false"
    :class="$style.popover"
    @did-dismiss="popover = false"
  >
    <div :class="$style.container">
      <!-- Header -->
      <div :class="$style.header">
        <Zap :size="14" :class="$style.headerIcon" />
        <span :class="$style.headerTitle">{{ t('plugins.skillsPopover.title') }}</span>
        <span :class="$style.headerCount">{{ activeCount }} {{ t('plugins.popover.active') }}</span>
      </div>
      <p :class="$style.hint">{{ t('plugins.skillsPopover.hint') }}</p>

      <!-- Built-in skills -->
      <ion-list v-if="builtInSkills.length > 0" lines="none" :class="$style.list">
        <ion-item-divider :class="$style.sectionHeader">
          <ion-label>
            <ShieldCheck :size="11" style="margin-right: 4px; vertical-align: -1px;" />
            {{ t('plugins.skillsPopover.builtIn') }}
          </ion-label>
        </ion-item-divider>
        <ion-item
          v-for="skill in builtInSkills"
          :key="skill.name"
          :class="[$style.toggleItem, !isActive(skill.name) && $style.toggleItemOff]"
          :detail="false"
        >
          <ion-label>
            <h3>/{{ skill.name }}</h3>
            <p>{{ skill.description }}</p>
          </ion-label>
          <ion-toggle
            slot="end"
            :checked="isActive(skill.name)"
            @ion-change="handleToggle(skill)"
          />
        </ion-item>
      </ion-list>

      <!-- User / plugin skills -->
      <ion-list v-if="hasUserSkills" lines="none" :class="$style.list">
        <ion-item-divider :class="$style.sectionHeader">
          <ion-label>{{ t('plugins.skillsPopover.custom') }}</ion-label>
        </ion-item-divider>
        <ion-item
          v-for="skill in userSkills"
          :key="skill.name"
          :class="[$style.toggleItem, !isActive(skill.name) && $style.toggleItemOff]"
          :detail="false"
        >
          <ion-label>
            <h3>/{{ skill.name }}</h3>
            <p>{{ skill.description }}</p>
          </ion-label>
          <ion-toggle
            slot="end"
            :checked="isActive(skill.name)"
            @ion-change="handleToggle(skill)"
          />
        </ion-item>
      </ion-list>
    </div>
  </ion-popover>
</template>

<style lang="scss" module>
.popover {
  --width: 340px;
  --max-height: 420px;
  --background: var(--n8n-desk--surface-bg, var(--color--foreground));
}

.container {
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 12px 16px 0;
}

.headerIcon {
  color: var(--color--primary, #ff6d5a);
  flex-shrink: 0;
}

.headerTitle {
  font-size: 14px;
  font-weight: 600;
  color: var(--color--text--shade-1);
  flex: 1;
}

.headerCount {
  font-size: 12px;
  color: var(--color--text--tint-1);
}

.hint {
  font-size: 11px;
  color: var(--color--text--tint-2);
  padding: 4px 16px 8px;
  margin: 0;
  border-bottom: 1px solid var(--border-color--subtle, rgba(0, 0, 0, 0.08));
}

.list {
  padding: 0;
  background: transparent;
}

.sectionHeader {
  --background: transparent;
  --color: var(--color--text--tint-1);
  --padding-start: 16px;
  --inner-padding-end: 16px;
  --min-height: 28px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-bottom: none;
}

.toggleItem {
  --min-height: 48px;
  --padding-start: 16px;
  --inner-padding-end: 12px;
  --background: transparent;

  h3 {
    font-size: 13px;
    font-weight: 500;
    font-family: 'SFMono-Regular', 'Consolas', 'Liberation Mono', 'Menlo', monospace;
    color: var(--color--text--shade-1);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  p {
    font-size: 11px;
    color: var(--color--text--tint-1);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-top: 1px;
  }
}

.toggleItemOff {
  opacity: 0.5;
}
</style>
