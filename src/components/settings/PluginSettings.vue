<script setup lang="ts">
import {
  IonSegment, IonSegmentButton, IonLabel,
  IonInput, IonSelect, IonSelectOption,
  IonButton, IonSpinner,
} from '@ionic/vue'
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Plus, RefreshCw, Trash2, Search, Store, Server, Lock,
} from 'lucide-vue-next'
import PluginCard from '@/components/plugins/PluginCard.vue'
import McpServerCard from '@/components/plugins/McpServerCard.vue'
import AddServerForm from '@/components/plugins/AddServerForm.vue'
import SkillCard from '@/components/plugins/SkillCard.vue'
import SkillEditor from '@/components/plugins/SkillEditor.vue'
import InstallConfirmDialog from '@/components/plugins/InstallConfirmDialog.vue'
import { usePluginsStore } from '@/stores/plugins'
import type {
  InstalledPlugin,
  StandaloneMcpServer,
  MarketplacePluginEntry,
  MarketplaceSource,
  LoadedSkill,
} from '@/types/plugin'

const props = defineProps<{
  initialTab?: 'installed' | 'discover' | 'marketplaces' | 'skills'
}>()

const { t } = useI18n()
const pluginsStore = usePluginsStore()

// --- Tab state ---
const activeTab = ref<'installed' | 'discover' | 'marketplaces' | 'skills'>(props.initialTab ?? 'installed')

function onTabChange(event: CustomEvent) {
  activeTab.value = event.detail.value
}

// Sync tab when parent changes the initialTab
watch(() => props.initialTab, (tab) => {
  if (tab) activeTab.value = tab
})

// --- Hydrate on mount ---
const isHydrating = ref(false)

async function hydrateAll(): Promise<void> {
  isHydrating.value = true
  try {
    await pluginsStore.hydrate()
  } finally {
    isHydrating.value = false
  }
}

// Hydrate when component is first shown
let hydrated = false
watch(() => activeTab.value, () => {
  if (!hydrated) {
    hydrated = true
    void hydrateAll()
  }
}, { immediate: true })

// =============================================================
// Installed Tab
// =============================================================

const showAddServerForm = ref(false)
const editingServer = ref<StandaloneMcpServer | undefined>(undefined)

function handlePluginToggle(plugin: InstalledPlugin) {
  void pluginsStore.togglePlugin(plugin.id)
}

function handlePluginUninstall(plugin: InstalledPlugin) {
  void pluginsStore.uninstallPlugin(plugin.id)
}

function handleServerToggle(server: StandaloneMcpServer) {
  void pluginsStore.updateServer(server.id, { enabled: !server.enabled })
}

function handleServerEdit(server: StandaloneMcpServer) {
  editingServer.value = server
  showAddServerForm.value = true
}

function handleServerDelete(server: StandaloneMcpServer) {
  void pluginsStore.removeServer(server.id)
}

function handleServerSaved() {
  showAddServerForm.value = false
  editingServer.value = undefined
}

function handleServerCancel() {
  showAddServerForm.value = false
  editingServer.value = undefined
}

function openAddServer() {
  editingServer.value = undefined
  showAddServerForm.value = true
}

// =============================================================
// Discover Tab
// =============================================================

const discoverSearch = ref('')
const discoverFilter = ref('all')
const discoverEntries = ref<MarketplacePluginEntry[]>([])
const isLoadingDiscover = ref(false)
const installingPluginName = ref<string | null>(null)

// Install confirm dialog state
const installDialogOpen = ref(false)
const installDialogEntry = ref<MarketplacePluginEntry | undefined>(undefined)
const installDialogMarketplaceId = ref<string | undefined>(undefined)

const discoverCategories = computed(() => {
  const cats = new Set<string>()
  for (const entry of discoverEntries.value) {
    if (entry.category) {
      cats.add(entry.category)
    }
  }
  return Array.from(cats).sort()
})

const filteredDiscoverEntries = computed(() => {
  let entries = discoverEntries.value

  // Filter by search
  const query = discoverSearch.value.trim().toLowerCase()
  if (query) {
    entries = entries.filter((e) =>
      e.name.toLowerCase().includes(query) ||
      (e.description?.toLowerCase().includes(query) ?? false) ||
      (e.keywords?.some((k) => k.toLowerCase().includes(query)) ?? false),
    )
  }

  // Filter by category
  if (discoverFilter.value !== 'all') {
    entries = entries.filter((e) => e.category === discoverFilter.value)
  }

  // Exclude already-installed plugins
  const installedNames = new Set(pluginsStore.installedPlugins.map((p) => p.name))
  entries = entries.filter((e) => !installedNames.has(e.name))

  return entries
})

watch(activeTab, async (tab) => {
  if (tab === 'discover' && discoverEntries.value.length === 0) {
    await loadDiscoverEntries()
  }
})

async function loadDiscoverEntries(): Promise<void> {
  isLoadingDiscover.value = true
  try {
    discoverEntries.value = await pluginsStore.browsePlugins()
  } catch {
    discoverEntries.value = []
  } finally {
    isLoadingDiscover.value = false
  }
}

function handleInstallRequest(entry: MarketplacePluginEntry) {
  // Determine marketplace ID from entry source
  const marketplaceId = typeof entry.source === 'string'
    ? entry.source
    : pluginsStore.marketplaces[0]?.id

  if (!marketplaceId) return

  installDialogEntry.value = entry
  installDialogMarketplaceId.value = marketplaceId
  installDialogOpen.value = true
}

function handleInstallComplete(_plugin: InstalledPlugin) {
  installDialogOpen.value = false
  installingPluginName.value = null
  // The store already has the plugin added via installPlugin
  void loadDiscoverEntries()
}

// =============================================================
// Marketplaces Tab
// =============================================================

const showAddMarketplace = ref(false)
const addMarketplaceSource = ref<'github' | 'url' | 'local'>('github')
const addMarketplaceRepo = ref('')
const addMarketplaceUrl = ref('')
const addMarketplaceRef = ref('')
const isAddingMarketplace = ref(false)
const addMarketplaceError = ref('')
const refreshingMarketplaceId = ref<string | null>(null)

function onMarketplaceSourceChange(event: CustomEvent) {
  addMarketplaceSource.value = event.detail.value
}

async function handleAddMarketplace(): Promise<void> {
  const source: MarketplaceSource = {
    source: addMarketplaceSource.value,
  }

  if (addMarketplaceSource.value === 'github') {
    if (!addMarketplaceRepo.value.trim()) return
    source.repo = addMarketplaceRepo.value.trim()
    if (addMarketplaceRef.value.trim()) {
      source.ref = addMarketplaceRef.value.trim()
    }
  } else if (addMarketplaceSource.value === 'url') {
    if (!addMarketplaceUrl.value.trim()) return
    source.url = addMarketplaceUrl.value.trim()
  }

  isAddingMarketplace.value = true
  addMarketplaceError.value = ''

  try {
    await pluginsStore.addMarketplace(source)
    // Reset form
    showAddMarketplace.value = false
    addMarketplaceRepo.value = ''
    addMarketplaceUrl.value = ''
    addMarketplaceRef.value = ''
  } catch (err: unknown) {
    addMarketplaceError.value = err instanceof Error
      ? err.message
      : t('plugins.settings.marketplaces.addFailed')
  } finally {
    isAddingMarketplace.value = false
  }
}

async function handleRefreshMarketplace(id: string): Promise<void> {
  refreshingMarketplaceId.value = id
  try {
    await pluginsStore.refreshMarketplace(id)
  } finally {
    refreshingMarketplaceId.value = null
  }
}

async function handleRemoveMarketplace(id: string): Promise<void> {
  await pluginsStore.removeMarketplace(id)
}

// =============================================================
// Skills Tab
// =============================================================

const showSkillEditor = ref(false)
const editingSkill = ref<LoadedSkill | undefined>(undefined)

function handleSkillEdit(skill: LoadedSkill) {
  editingSkill.value = skill
  showSkillEditor.value = true
}

async function handleSkillDelete(skill: LoadedSkill): Promise<void> {
  if (!confirm(t('plugins.settings.skills.deleteConfirm', { name: skill.name }))) {
    return
  }
  await pluginsStore.deleteSkill(skill.name)
}

function handleSkillSaved() {
  showSkillEditor.value = false
  editingSkill.value = undefined
}

function handleSkillCancel() {
  showSkillEditor.value = false
  editingSkill.value = undefined
}

function handleBuiltInSkillToggle(skill: LoadedSkill) {
  void pluginsStore.toggleBuiltInSkill(skill.name)
}

function openCreateSkill() {
  editingSkill.value = undefined
  showSkillEditor.value = true
}
</script>

<template>
  <div :class="$style.container">
    <h3 :class="$style.title">{{ t('plugins.settings.title') }}</h3>
    <p :class="$style.description">{{ t('plugins.settings.description') }}</p>

    <!-- Tab Segment -->
    <ion-segment
      :value="activeTab"
      mode="ios"
      :class="$style.segment"
      @ion-change="onTabChange"
    >
      <ion-segment-button value="installed">
        <ion-label>{{ t('plugins.settings.tabs.installed') }}</ion-label>
      </ion-segment-button>
      <ion-segment-button value="discover">
        <ion-label>{{ t('plugins.settings.tabs.discover') }}</ion-label>
      </ion-segment-button>
      <ion-segment-button value="marketplaces">
        <ion-label>{{ t('plugins.settings.tabs.marketplaces') }}</ion-label>
      </ion-segment-button>
      <ion-segment-button value="skills">
        <ion-label>{{ t('plugins.settings.tabs.skills') }}</ion-label>
      </ion-segment-button>
    </ion-segment>

    <!-- Loading spinner -->
    <div v-if="isHydrating" :class="$style.loadingWrap">
      <ion-spinner name="crescent" />
    </div>

    <!-- ===================== Installed Tab ===================== -->
    <div v-else-if="activeTab === 'installed'" :class="$style.tabContent">
      <!-- Add Server Form (replaces content when open) -->
      <template v-if="showAddServerForm">
        <AddServerForm
          :edit-server="editingServer"
          @saved="handleServerSaved"
          @cancel="handleServerCancel"
        />
      </template>

      <template v-else>
        <!-- Built-in n8n MCP Server (always on, non-removable) -->
        <div :class="$style.sectionGroup">
          <div :class="$style.sectionGroupLabel">
            {{ t('plugins.settings.installed.builtInTitle') }}
          </div>
          <div :class="$style.builtInCard">
            <div :class="$style.builtInMain">
              <div :class="$style.builtInIconWrap">
                <Server :size="16" :class="$style.builtInIcon" />
              </div>
              <div :class="$style.builtInInfo">
                <div :class="$style.builtInName">
                  n8n MCP
                  <span :class="$style.builtInBadge">{{ t('plugins.settings.installed.builtInBadge') }}</span>
                </div>
                <div :class="$style.builtInMeta">
                  {{ t('plugins.settings.installed.builtInDescription') }}
                </div>
              </div>
              <div :class="$style.builtInStatus">
                <Lock :size="12" :class="$style.builtInLockIcon" />
                <span :class="$style.builtInStatusText">{{ t('plugins.settings.installed.builtInAlwaysOn') }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Installed Plugins -->
        <div :class="$style.sectionGroup">
          <div :class="$style.sectionGroupLabel">
            {{ t('plugins.settings.installed.pluginsTitle') }}
          </div>

          <div v-if="pluginsStore.installedPlugins.length === 0" :class="$style.emptyState">
            {{ t('plugins.settings.installed.pluginsEmpty') }}
          </div>
          <div v-else :class="$style.cardGrid">
            <PluginCard
              v-for="plugin in pluginsStore.installedPlugins"
              :key="plugin.id"
              :installed="plugin"
              @toggle="handlePluginToggle"
              @uninstall="handlePluginUninstall"
            />
          </div>
        </div>

        <!-- Standalone MCP Servers -->
        <div :class="$style.sectionGroup">
          <div :class="$style.sectionGroupHeader">
            <div :class="$style.sectionGroupLabel">
              {{ t('plugins.settings.installed.serversTitle') }}
            </div>
            <ion-button
              fill="clear"
              size="small"
              @click="openAddServer"
            >
              <Plus :size="14" style="margin-right: 4px;" />
              {{ t('plugins.settings.installed.addServer') }}
            </ion-button>
          </div>

          <div v-if="pluginsStore.standaloneServers.length === 0" :class="$style.emptyState">
            {{ t('plugins.settings.installed.serversEmpty') }}
          </div>
          <div v-else :class="$style.cardList">
            <McpServerCard
              v-for="server in pluginsStore.standaloneServers"
              :key="server.id"
              :server="server"
              @toggle="handleServerToggle"
              @edit="handleServerEdit"
              @delete="handleServerDelete"
            />
          </div>
        </div>
      </template>
    </div>

    <!-- ===================== Discover Tab ===================== -->
    <div v-else-if="activeTab === 'discover'" :class="$style.tabContent">
      <template v-if="pluginsStore.marketplaces.length === 0">
        <div :class="$style.emptyState">
          {{ t('plugins.settings.discover.noMarketplaces') }}
        </div>
      </template>

      <template v-else>
        <!-- Search & Filter -->
        <div :class="$style.searchRow">
          <div :class="$style.searchWrap">
            <Search :size="16" :class="$style.searchIcon" />
            <ion-input
              v-model="discoverSearch"
              :placeholder="t('plugins.settings.discover.search')"
              fill="outline"
              label-placement="stacked"
              :class="$style.searchInput"
            />
          </div>
          <ion-select
            v-if="discoverCategories.length > 0"
            :value="discoverFilter"
            interface="popover"
            fill="outline"
            label-placement="stacked"
            :label="' '"
            :class="$style.filterSelect"
            @ion-change="discoverFilter = ($event as CustomEvent).detail.value"
          >
            <ion-select-option value="all">
              {{ t('plugins.settings.discover.filterAll') }}
            </ion-select-option>
            <ion-select-option
              v-for="cat in discoverCategories"
              :key="cat"
              :value="cat"
            >
              {{ cat }}
            </ion-select-option>
          </ion-select>
        </div>

        <!-- Loading -->
        <div v-if="isLoadingDiscover" :class="$style.loadingWrap">
          <ion-spinner name="crescent" />
          <span :class="$style.loadingText">{{ t('plugins.settings.discover.loading') }}</span>
        </div>

        <!-- Results -->
        <template v-else>
          <div v-if="filteredDiscoverEntries.length === 0" :class="$style.emptyState">
            {{ t('plugins.settings.discover.empty') }}
          </div>
          <div v-else :class="$style.cardGrid">
            <PluginCard
              v-for="entry in filteredDiscoverEntries"
              :key="entry.name"
              :entry="entry"
              :installing="installingPluginName === entry.name"
              @install="handleInstallRequest"
            />
          </div>
        </template>
      </template>
    </div>

    <!-- ===================== Marketplaces Tab ===================== -->
    <div v-else-if="activeTab === 'marketplaces'" :class="$style.tabContent">
      <div :class="$style.sectionGroupHeader">
        <div>
          <div :class="$style.sectionGroupLabel">
            {{ t('plugins.settings.marketplaces.title') }}
          </div>
          <p :class="$style.sectionDescription">
            {{ t('plugins.settings.marketplaces.description') }}
          </p>
        </div>
        <ion-button
          fill="clear"
          size="small"
          @click="showAddMarketplace = !showAddMarketplace"
        >
          <Plus :size="14" style="margin-right: 4px;" />
          {{ t('plugins.settings.marketplaces.addTitle') }}
        </ion-button>
      </div>

      <!-- Add Marketplace Form -->
      <div v-if="showAddMarketplace" :class="$style.addMarketplaceForm">
        <div :class="$style.formField">
          <ion-segment
            :value="addMarketplaceSource"
            mode="ios"
            @ion-change="onMarketplaceSourceChange"
          >
            <ion-segment-button value="github">
              <ion-label>{{ t('plugins.settings.marketplaces.sourceGithub') }}</ion-label>
            </ion-segment-button>
            <ion-segment-button value="url">
              <ion-label>{{ t('plugins.settings.marketplaces.sourceUrl') }}</ion-label>
            </ion-segment-button>
            <ion-segment-button value="local">
              <ion-label>{{ t('plugins.settings.marketplaces.sourceLocal') }}</ion-label>
            </ion-segment-button>
          </ion-segment>
        </div>

        <div v-if="addMarketplaceSource === 'github'" :class="$style.formField">
          <ion-input
            v-model="addMarketplaceRepo"
            :label="t('plugins.settings.marketplaces.repoLabel')"
            fill="outline"
            label-placement="stacked"
            :placeholder="t('plugins.settings.marketplaces.repoPlaceholder')"
          />
        </div>

        <div v-if="addMarketplaceSource === 'github'" :class="$style.formField">
          <ion-input
            v-model="addMarketplaceRef"
            :label="t('plugins.settings.marketplaces.refLabel')"
            fill="outline"
            label-placement="stacked"
            :placeholder="t('plugins.settings.marketplaces.refPlaceholder')"
          />
        </div>

        <div v-if="addMarketplaceSource === 'url'" :class="$style.formField">
          <ion-input
            v-model="addMarketplaceUrl"
            :label="t('plugins.settings.marketplaces.urlLabel')"
            fill="outline"
            label-placement="stacked"
            :placeholder="t('plugins.settings.marketplaces.urlPlaceholder')"
            type="url"
          />
        </div>

        <div v-if="addMarketplaceError" :class="$style.errorText">
          {{ addMarketplaceError }}
        </div>

        <div :class="$style.formActions">
          <ion-button
            fill="clear"
            size="small"
            @click="showAddMarketplace = false"
          >
            {{ t('plugins.addServer.cancel') }}
          </ion-button>
          <ion-button
            fill="solid"
            size="small"
            :disabled="isAddingMarketplace"
            @click="handleAddMarketplace"
          >
            <ion-spinner v-if="isAddingMarketplace" name="crescent" style="margin-right: 6px;" />
            {{ t('plugins.settings.marketplaces.add') }}
          </ion-button>
        </div>
      </div>

      <!-- Marketplace list -->
      <div v-if="pluginsStore.marketplaces.length === 0 && !showAddMarketplace" :class="$style.emptyState">
        {{ t('plugins.settings.marketplaces.empty') }}
      </div>
      <div v-else :class="$style.cardList">
        <div
          v-for="marketplace in pluginsStore.marketplaces"
          :key="marketplace.id"
          :class="$style.marketplaceCard"
        >
          <div :class="$style.marketplaceMain">
            <div :class="$style.marketplaceIconWrap">
              <Store :size="16" :class="$style.marketplaceIcon" />
            </div>
            <div :class="$style.marketplaceInfo">
              <div :class="$style.marketplaceName">{{ marketplace.name }}</div>
              <div :class="$style.marketplaceMeta">
                <span>{{ marketplace.owner.name }}</span>
                <span :class="$style.marketplaceDot">·</span>
                <span>{{ t('plugins.settings.marketplaces.pluginCount', { count: marketplace.plugins.length }, marketplace.plugins.length) }}</span>
              </div>
            </div>
            <div :class="$style.marketplaceActions">
              <ion-button
                fill="clear"
                size="small"
                :class="$style.actionBtn"
                :disabled="refreshingMarketplaceId === marketplace.id"
                :title="t('plugins.settings.marketplaces.refresh')"
                @click="handleRefreshMarketplace(marketplace.id)"
              >
                <ion-spinner
                  v-if="refreshingMarketplaceId === marketplace.id"
                  name="crescent"
                  :class="$style.actionSpinner"
                />
                <RefreshCw v-else :size="14" />
              </ion-button>
              <ion-button
                fill="clear"
                size="small"
                color="danger"
                :class="$style.actionBtn"
                :title="t('plugins.settings.marketplaces.remove')"
                @click="handleRemoveMarketplace(marketplace.id)"
              >
                <Trash2 :size="14" />
              </ion-button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ===================== Skills Tab ===================== -->
    <div v-else-if="activeTab === 'skills'" :class="$style.tabContent">
      <!-- Skill Editor (replaces content when open) -->
      <template v-if="showSkillEditor">
        <SkillEditor
          :edit-skill="editingSkill"
          @saved="handleSkillSaved"
          @cancel="handleSkillCancel"
        />
      </template>

      <template v-else>
        <!-- Default Skills (built-in, shipped with the app) -->
        <div :class="$style.sectionGroup">
          <div :class="$style.sectionGroupLabel">
            {{ t('plugins.settings.skills.defaultTitle') }}
          </div>
          <p :class="$style.sectionDescription" style="margin-bottom: var(--spacing--sm);">
            {{ t('plugins.settings.skills.defaultDescription') }}
          </p>
          <div :class="$style.cardGrid">
            <SkillCard
              v-for="builtIn in pluginsStore.builtInSkills"
              :key="builtIn.name"
              :skill="builtIn"
              :enabled="builtIn.enabled"
              @toggle="handleBuiltInSkillToggle"
            />
          </div>
        </div>

        <!-- User / Plugin Skills -->
        <div :class="$style.sectionGroup">
          <div :class="$style.sectionGroupHeader">
            <div>
              <div :class="$style.sectionGroupLabel">
                {{ t('plugins.settings.skills.title') }}
              </div>
              <p :class="$style.sectionDescription">
                {{ t('plugins.settings.skills.description') }}
              </p>
            </div>
            <ion-button
              fill="clear"
              size="small"
              @click="openCreateSkill"
            >
              <Plus :size="14" style="margin-right: 4px;" />
              {{ t('plugins.settings.skills.createSkill') }}
            </ion-button>
          </div>

          <div v-if="pluginsStore.skills.length === 0" :class="$style.emptyState">
            {{ t('plugins.settings.skills.empty') }}
          </div>
          <div v-else :class="$style.cardGrid">
            <SkillCard
              v-for="skill in pluginsStore.skills"
              :key="skill.name"
              :skill="skill"
              @edit="handleSkillEdit"
              @delete="handleSkillDelete"
            />
          </div>
        </div>
      </template>
    </div>

    <!-- Install Confirm Dialog -->
    <InstallConfirmDialog
      :is-open="installDialogOpen"
      :entry="installDialogEntry"
      :marketplace-id="installDialogMarketplaceId"
      @update:is-open="installDialogOpen = $event"
      @installed="handleInstallComplete"
    />
  </div>
</template>

<style lang="scss" module>
.container {
  max-width: 640px;
}

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

.segment {
  margin-bottom: var(--spacing--lg);
}

.tabContent {
  min-height: 200px;
}

// --- Loading ---
.loadingWrap {
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

// --- Section Groups ---
.sectionGroup {
  margin-bottom: var(--spacing--lg);
}

.sectionGroupHeader {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: var(--spacing--sm);
  gap: var(--spacing--sm);
}

.sectionGroupLabel {
  font-size: var(--font-size--2xs);
  font-weight: var(--font-weight--bold);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color--text--tint-1);
  margin-bottom: var(--spacing--sm);
}

.sectionDescription {
  font-size: var(--font-size--2xs);
  color: var(--color--text--tint-2);
  margin: 2px 0 0;
}

// --- Cards ---
.cardGrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--spacing--sm);
}

.cardList {
  display: flex;
  flex-direction: column;
  gap: var(--spacing--sm);
}

// --- Empty State ---
// --- Built-in n8n MCP Card ---
.builtInCard {
  background: var(--n8n-desk--surface-bg, var(--color--foreground));
  border: 1px solid var(--color--primary, #ff6d5a);
  border-radius: 10px;
  padding: 12px 16px;
  opacity: 0.95;
}

.builtInMain {
  display: flex;
  align-items: center;
  gap: 10px;
}

.builtInIconWrap {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--color--primary, #ff6d5a) 15%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.builtInIcon {
  color: var(--color--primary, #ff6d5a);
}

.builtInInfo {
  flex: 1;
  min-width: 0;
}

.builtInName {
  font-size: 14px;
  font-weight: 600;
  color: var(--color--text--shade-1);
  display: flex;
  align-items: center;
  gap: 6px;
}

.builtInBadge {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color--primary, #ff6d5a);
  background: color-mix(in srgb, var(--color--primary, #ff6d5a) 12%, transparent);
  padding: 1px 6px;
  border-radius: 4px;
}

.builtInMeta {
  font-size: 12px;
  color: var(--color--text--tint-1);
  margin-top: 2px;
}

.builtInStatus {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  padding: 4px 10px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--color--success, #10b981) 10%, transparent);
}

.builtInLockIcon {
  color: var(--color--success, #10b981);
}

.builtInStatusText {
  font-size: 11px;
  font-weight: 600;
  color: var(--color--success, #10b981);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

// --- Empty State ---
.emptyState {
  text-align: center;
  font-size: var(--font-size--sm);
  color: var(--color--text--tint-2);
  padding: var(--spacing--xl) var(--spacing--md);
  background: var(--n8n-desk--surface-bg, var(--color--foreground));
  border: 1px dashed var(--n8n-desk--content-bg, var(--color--background));
  border-radius: 10px;
}

// --- Discover: Search Row ---
.searchRow {
  display: flex;
  gap: var(--spacing--sm);
  margin-bottom: var(--spacing--md);
  align-items: flex-end;
}

.searchWrap {
  flex: 1;
  position: relative;
  min-width: 0;
}

.searchIcon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--color--text--tint-2);
  z-index: 1;
  pointer-events: none;
}

.searchInput {
  --padding-start: 36px;
}

.filterSelect {
  max-width: 160px;
  flex-shrink: 0;
}

// --- Marketplace Card ---
.marketplaceCard {
  background: var(--n8n-desk--surface-bg, var(--color--foreground));
  border: 1px solid var(--n8n-desk--content-bg, var(--color--background));
  border-radius: 10px;
  padding: 12px 16px;
  transition: border-color 0.15s ease;

  &:hover {
    border-color: var(--color--text--tint-2, rgba(0, 0, 0, 0.1));
  }
}

.marketplaceMain {
  display: flex;
  align-items: center;
  gap: 10px;
}

.marketplaceIconWrap {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: var(--n8n-desk--surface-raised-bg, var(--color--foreground--tint-2));
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.marketplaceIcon {
  color: var(--color--primary, #ff6d5a);
}

.marketplaceInfo {
  flex: 1;
  min-width: 0;
}

.marketplaceName {
  font-size: 14px;
  font-weight: 600;
  color: var(--color--text--shade-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.marketplaceMeta {
  font-size: 12px;
  color: var(--color--text--tint-1);
  margin-top: 2px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.marketplaceDot {
  color: var(--color--text--tint-2);
}

.marketplaceActions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.actionBtn {
  --padding-start: 6px;
  --padding-end: 6px;
  --padding-top: 4px;
  --padding-bottom: 4px;
  min-height: 28px;
}

.actionSpinner {
  width: 14px;
  height: 14px;
}

// --- Add Marketplace Form ---
.addMarketplaceForm {
  background: var(--n8n-desk--surface-bg, var(--color--foreground));
  border: 1px solid var(--n8n-desk--content-bg, var(--color--background));
  border-radius: 10px;
  padding: 16px;
  margin-bottom: var(--spacing--md);
}

.formField {
  margin-bottom: var(--spacing--md);
}

.formActions {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing--sm);
}

.errorText {
  font-size: var(--font-size--sm, 13px);
  color: var(--color--danger, #dc2626);
  margin-bottom: var(--spacing--sm);
}
</style>
