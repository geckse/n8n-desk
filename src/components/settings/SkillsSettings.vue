<script setup lang="ts">
import { ref, onMounted } from 'vue'
import {
  IonSegment, IonSegmentButton, IonLabel,
  IonButton, IonSpinner, IonToggle,
} from '@ionic/vue'
import { Plus, ChevronLeft, BookOpen } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import SkillCard from '@/components/plugins/SkillCard.vue'
import SkillEditor from '@/components/plugins/SkillEditor.vue'
import { usePluginsStore } from '@/stores/plugins'
import type { LoadedSkill } from '@/types/plugin'

const { t } = useI18n()
const pluginsStore = usePluginsStore()

const isLoading = ref(false)
const activeTab = ref<'custom' | 'builtin'>('custom')

// --- Editor state (custom skills) ---
const showEditor = ref(false)
const editingSkill = ref<LoadedSkill | undefined>(undefined)

// --- Viewer state (built-in skills) ---
const viewingSkill = ref<(LoadedSkill & { enabled: boolean }) | null>(null)

onMounted(async () => {
  isLoading.value = true
  try {
    await pluginsStore.hydrate()
  } finally {
    isLoading.value = false
  }
})

function onTabChange(event: CustomEvent) {
  activeTab.value = event.detail.value
  // Reset sub-views when switching tabs
  showEditor.value = false
  editingSkill.value = undefined
  viewingSkill.value = null
}

// --- Custom skill actions ---
function handleEdit(skill: LoadedSkill) {
  editingSkill.value = skill
  showEditor.value = true
}

async function handleDelete(skill: LoadedSkill): Promise<void> {
  if (!confirm(t('plugins.settings.skills.deleteConfirm', { name: skill.name }))) return
  await pluginsStore.deleteSkill(skill.name)
}

function handleSaved() {
  showEditor.value = false
  editingSkill.value = undefined
}

function handleCancel() {
  showEditor.value = false
  editingSkill.value = undefined
}

function openCreate() {
  editingSkill.value = undefined
  showEditor.value = true
}

// --- Built-in skill actions ---
function handleBuiltInToggle(skill: LoadedSkill) {
  void pluginsStore.toggleBuiltInSkill(skill.name)
}

function viewBuiltIn(skill: LoadedSkill & { enabled: boolean }) {
  viewingSkill.value = skill
}

function closeViewer() {
  viewingSkill.value = null
}
</script>

<template>
  <div :class="$style.container">
    <h3 :class="$style.title">{{ t('settings.sections.skills') }}</h3>
    <p :class="$style.description">{{ t('plugins.settings.skills.settingsDescription') }}</p>

    <!-- Tab bar -->
    <ion-segment
      :value="activeTab"
      mode="ios"
      :class="$style.segment"
      @ion-change="onTabChange"
    >
      <ion-segment-button value="custom">
        <ion-label>{{ t('plugins.settings.skills.title') }}</ion-label>
      </ion-segment-button>
      <ion-segment-button value="builtin">
        <ion-label>{{ t('plugins.settings.skills.builtInTitle') }}</ion-label>
      </ion-segment-button>
    </ion-segment>

    <div v-if="isLoading" :class="$style.loading">
      <ion-spinner name="crescent" />
    </div>

    <!-- ======= Custom Skills Tab ======= -->
    <template v-else-if="activeTab === 'custom'">
      <!-- Editor (replaces list when open) -->
      <template v-if="showEditor">
        <SkillEditor
          :edit-skill="editingSkill"
          @saved="handleSaved"
          @cancel="handleCancel"
        />
      </template>

      <template v-else>
        <div :class="$style.sectionHeader">
          <p :class="$style.sectionHint">{{ t('plugins.settings.skills.description') }}</p>
          <ion-button fill="clear" size="small" @click="openCreate">
            <Plus :size="14" style="margin-right: 4px;" />
            {{ t('plugins.settings.skills.createSkill') }}
          </ion-button>
        </div>

        <div v-if="pluginsStore.skills.length === 0" :class="$style.empty">
          {{ t('plugins.settings.skills.empty') }}
        </div>
        <div v-else :class="$style.grid">
          <SkillCard
            v-for="skill in pluginsStore.skills"
            :key="skill.name"
            :skill="skill"
            @edit="handleEdit"
            @delete="handleDelete"
          />
        </div>
      </template>
    </template>

    <!-- ======= Built-in Skills Tab ======= -->
    <template v-else-if="activeTab === 'builtin'">
      <!-- Skill viewer (replaces list when viewing) -->
      <template v-if="viewingSkill">
        <div :class="$style.viewer">
          <button :class="$style.backBtn" @click="closeViewer">
            <ChevronLeft :size="14" />
            {{ t('plugins.settings.skills.backToList') }}
          </button>

          <div :class="$style.viewerHeader">
            <BookOpen :size="18" :class="$style.viewerIcon" />
            <span :class="$style.viewerName">{{ viewingSkill.name }}</span>
            <ion-toggle
              :checked="viewingSkill.enabled"
              @ion-change="handleBuiltInToggle(viewingSkill!)"
            />
          </div>

          <p :class="$style.viewerDescription">{{ viewingSkill.description }}</p>

          <!-- Metadata -->
          <div :class="$style.viewerMeta">
            <div :class="$style.viewerMetaRow">
              <span :class="$style.viewerMetaLabel">{{ t('plugins.skillEditor.userInvocable') }}</span>
              <span :class="$style.viewerMetaValue">{{ viewingSkill.userInvocable ? 'Yes' : 'No' }}</span>
            </div>
            <div :class="$style.viewerMetaRow">
              <span :class="$style.viewerMetaLabel">{{ t('plugins.skillEditor.disableModelInvocation') }}</span>
              <span :class="$style.viewerMetaValue">{{ viewingSkill.disableModelInvocation ? 'Yes' : 'No' }}</span>
            </div>
            <div v-if="viewingSkill.allowedTools?.length" :class="$style.viewerMetaRow">
              <span :class="$style.viewerMetaLabel">{{ t('plugins.skillEditor.allowedTools') }}</span>
              <span :class="$style.viewerMetaValue">{{ viewingSkill.allowedTools.join(', ') }}</span>
            </div>
          </div>

          <!-- Instructions (read-only) -->
          <div :class="$style.viewerSection">
            <div :class="$style.viewerSectionLabel">{{ t('plugins.skillEditor.instructions') }}</div>
            <pre :class="$style.viewerCode">{{ viewingSkill.content }}</pre>
          </div>
        </div>
      </template>

      <!-- Built-in skill list -->
      <template v-else>
        <p :class="$style.sectionHint" style="margin-bottom: var(--spacing--md);">
          {{ t('plugins.settings.skills.builtInDescription') }}
        </p>
        <div :class="$style.grid">
          <SkillCard
            v-for="builtIn in pluginsStore.builtInSkills"
            :key="builtIn.name"
            :skill="builtIn"
            :enabled="builtIn.enabled"
            @toggle="handleBuiltInToggle"
            @view="viewBuiltIn(builtIn)"
          />
        </div>
      </template>
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
  margin: 0 0 var(--spacing--md);
}

.segment { margin-bottom: var(--spacing--lg); }

.loading {
  display: flex;
  justify-content: center;
  padding: var(--spacing--xl) 0;
}

.sectionHeader {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: var(--spacing--sm);
  gap: var(--spacing--sm);
}

.sectionHint {
  font-size: var(--font-size--2xs);
  color: var(--color--text--tint-2);
  margin: 0;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--spacing--sm);
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

// --- Back button ---
.backBtn {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 6px 10px 6px 6px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--color--text--tint-1);
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  margin-bottom: var(--spacing--md);
  transition: background 0.1s, color 0.1s;

  &:hover {
    background: var(--n8n-desk--surface-raised-bg, var(--color--foreground--tint-2));
    color: var(--color--text--shade-1);
  }
}

// --- Viewer ---
.viewer { max-width: 560px; }

.viewerHeader {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: var(--spacing--sm);
}

.viewerIcon { color: var(--color--primary, #ff6d5a); flex-shrink: 0; }

.viewerName {
  flex: 1;
  font-size: 18px;
  font-weight: 600;
  color: var(--color--text--shade-1);
}

.viewerDescription {
  font-size: 14px;
  color: var(--color--text--tint-1);
  line-height: 1.5;
  margin: 0 0 var(--spacing--md);
}

.viewerMeta {
  background: var(--n8n-desk--surface-bg, var(--color--foreground));
  border: 1px solid var(--n8n-desk--content-bg, var(--color--background));
  border-radius: 10px;
  padding: 12px 16px;
  margin-bottom: var(--spacing--md);
}

.viewerMetaRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 0;

  & + & {
    border-top: 1px solid var(--n8n-desk--content-bg, var(--color--background));
  }
}

.viewerMetaLabel {
  font-size: 13px;
  font-weight: 500;
  color: var(--color--text--tint-1);
}

.viewerMetaValue {
  font-size: 13px;
  color: var(--color--text--shade-1);
  font-family: 'SFMono-Regular', 'Consolas', 'Liberation Mono', 'Menlo', monospace;
}

.viewerSection { margin-bottom: var(--spacing--md); }

.viewerSectionLabel {
  font-size: var(--font-size--2xs);
  font-weight: var(--font-weight--bold);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color--text--tint-1);
  margin-bottom: var(--spacing--xs);
}

.viewerCode {
  background: var(--n8n-desk--surface-bg, var(--color--foreground));
  border: 1px solid var(--n8n-desk--content-bg, var(--color--background));
  border-radius: 10px;
  padding: 16px;
  font-family: 'SFMono-Regular', 'Consolas', 'Liberation Mono', 'Menlo', monospace;
  font-size: 13px;
  line-height: 1.6;
  color: var(--color--text--shade-1);
  white-space: pre-wrap;
  word-break: break-word;
  overflow-x: auto;
  margin: 0;
}
</style>
