<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import {
  IonInput, IonSelect, IonSelectOption, IonButton, IonSpinner,
  IonSegment, IonSegmentButton, IonLabel,
} from '@ionic/vue'
import { Plus, RefreshCw, Trash2, Search, Store } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import PluginCard from '@/components/plugins/PluginCard.vue'
import InstallConfirmDialog from '@/components/plugins/InstallConfirmDialog.vue'
import { usePluginsStore } from '@/stores/plugins'
import type {
  InstalledPlugin,
  MarketplacePluginEntry,
  MarketplaceSource,
} from '@/types/plugin'

const { t } = useI18n()
const pluginsStore = usePluginsStore()

const isLoading = ref(false)
const activeTab = ref<'installed' | 'discover' | 'marketplaces'>('installed')

function onTabChange(event: CustomEvent) {
  activeTab.value = event.detail.value
}

onMounted(async () => {
  isLoading.value = true
  try {
    await pluginsStore.hydrate()
  } finally {
    isLoading.value = false
  }
})

// --- Installed ---

function handlePluginToggle(plugin: InstalledPlugin) {
  void pluginsStore.togglePlugin(plugin.id)
}

function handlePluginUninstall(plugin: InstalledPlugin) {
  void pluginsStore.uninstallPlugin(plugin.id)
}

// --- Discover ---

const discoverSearch = ref('')
const discoverFilter = ref('all')
const discoverEntries = ref<MarketplacePluginEntry[]>([])
const isLoadingDiscover = ref(false)
const installingPluginName = ref<string | null>(null)

const installDialogOpen = ref(false)
const installDialogEntry = ref<MarketplacePluginEntry | undefined>(undefined)
const installDialogMarketplaceId = ref<string | undefined>(undefined)

const discoverCategories = computed(() => {
  const cats = new Set<string>()
  for (const entry of discoverEntries.value) {
    if (entry.category) cats.add(entry.category)
  }
  return Array.from(cats).sort()
})

const filteredDiscoverEntries = computed(() => {
  let entries = discoverEntries.value
  const query = discoverSearch.value.trim().toLowerCase()
  if (query) {
    entries = entries.filter((e) =>
      e.name.toLowerCase().includes(query) ||
      (e.description?.toLowerCase().includes(query) ?? false) ||
      (e.keywords?.some((k) => k.toLowerCase().includes(query)) ?? false),
    )
  }
  if (discoverFilter.value !== 'all') {
    entries = entries.filter((e) => e.category === discoverFilter.value)
  }
  const installedNames = new Set(pluginsStore.installedPlugins.map((p) => p.name))
  return entries.filter((e) => !installedNames.has(e.name))
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
  void loadDiscoverEntries()
}

// --- Marketplaces ---

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
  const source: MarketplaceSource = { source: addMarketplaceSource.value }
  if (addMarketplaceSource.value === 'github') {
    if (!addMarketplaceRepo.value.trim()) return
    source.repo = addMarketplaceRepo.value.trim()
    if (addMarketplaceRef.value.trim()) source.ref = addMarketplaceRef.value.trim()
  } else if (addMarketplaceSource.value === 'url') {
    if (!addMarketplaceUrl.value.trim()) return
    source.url = addMarketplaceUrl.value.trim()
  }
  isAddingMarketplace.value = true
  addMarketplaceError.value = ''
  try {
    await pluginsStore.addMarketplace(source)
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
  try { await pluginsStore.refreshMarketplace(id) }
  finally { refreshingMarketplaceId.value = null }
}

async function handleRemoveMarketplace(id: string): Promise<void> {
  await pluginsStore.removeMarketplace(id)
}
</script>

<template>
  <div :class="$style.container">
    <h3 :class="$style.title">{{ t('settings.sections.plugins') }}</h3>
    <p :class="$style.description">{{ t('plugins.settings.pluginsDescription') }}</p>

    <!-- Sub-tabs: Installed / Discover / Marketplaces -->
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
    </ion-segment>

    <div v-if="isLoading" :class="$style.loading">
      <ion-spinner name="crescent" />
    </div>

    <!-- ======= Installed ======= -->
    <div v-else-if="activeTab === 'installed'">
      <div v-if="pluginsStore.installedPlugins.length === 0" :class="$style.empty">
        {{ t('plugins.settings.installed.pluginsEmpty') }}
      </div>
      <div v-else :class="$style.grid">
        <PluginCard
          v-for="plugin in pluginsStore.installedPlugins"
          :key="plugin.id"
          :installed="plugin"
          @toggle="handlePluginToggle"
          @uninstall="handlePluginUninstall"
        />
      </div>
    </div>

    <!-- ======= Discover ======= -->
    <div v-else-if="activeTab === 'discover'">
      <template v-if="pluginsStore.marketplaces.length === 0">
        <div :class="$style.empty">{{ t('plugins.settings.discover.noMarketplaces') }}</div>
      </template>
      <template v-else>
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
            <ion-select-option value="all">{{ t('plugins.settings.discover.filterAll') }}</ion-select-option>
            <ion-select-option v-for="cat in discoverCategories" :key="cat" :value="cat">{{ cat }}</ion-select-option>
          </ion-select>
        </div>
        <div v-if="isLoadingDiscover" :class="$style.loading">
          <ion-spinner name="crescent" />
        </div>
        <template v-else>
          <div v-if="filteredDiscoverEntries.length === 0" :class="$style.empty">{{ t('plugins.settings.discover.empty') }}</div>
          <div v-else :class="$style.grid">
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

    <!-- ======= Marketplaces ======= -->
    <div v-else-if="activeTab === 'marketplaces'">
      <div :class="$style.sectionHeader">
        <div>
          <p :class="$style.sectionHint">{{ t('plugins.settings.marketplaces.description') }}</p>
        </div>
        <ion-button fill="clear" size="small" @click="showAddMarketplace = !showAddMarketplace">
          <Plus :size="14" style="margin-right: 4px;" />
          {{ t('plugins.settings.marketplaces.addTitle') }}
        </ion-button>
      </div>

      <!-- Add form -->
      <div v-if="showAddMarketplace" :class="$style.addForm">
        <div :class="$style.formField">
          <ion-segment :value="addMarketplaceSource" mode="ios" @ion-change="onMarketplaceSourceChange">
            <ion-segment-button value="github"><ion-label>{{ t('plugins.settings.marketplaces.sourceGithub') }}</ion-label></ion-segment-button>
            <ion-segment-button value="url"><ion-label>{{ t('plugins.settings.marketplaces.sourceUrl') }}</ion-label></ion-segment-button>
            <ion-segment-button value="local"><ion-label>{{ t('plugins.settings.marketplaces.sourceLocal') }}</ion-label></ion-segment-button>
          </ion-segment>
        </div>
        <div v-if="addMarketplaceSource === 'github'" :class="$style.formField">
          <ion-input v-model="addMarketplaceRepo" :label="t('plugins.settings.marketplaces.repoLabel')" fill="outline" label-placement="stacked" :placeholder="t('plugins.settings.marketplaces.repoPlaceholder')" />
        </div>
        <div v-if="addMarketplaceSource === 'github'" :class="$style.formField">
          <ion-input v-model="addMarketplaceRef" :label="t('plugins.settings.marketplaces.refLabel')" fill="outline" label-placement="stacked" :placeholder="t('plugins.settings.marketplaces.refPlaceholder')" />
        </div>
        <div v-if="addMarketplaceSource === 'url'" :class="$style.formField">
          <ion-input v-model="addMarketplaceUrl" :label="t('plugins.settings.marketplaces.urlLabel')" fill="outline" label-placement="stacked" :placeholder="t('plugins.settings.marketplaces.urlPlaceholder')" type="url" />
        </div>
        <div v-if="addMarketplaceError" :class="$style.errorText">{{ addMarketplaceError }}</div>
        <div :class="$style.formActions">
          <ion-button fill="clear" size="small" @click="showAddMarketplace = false">{{ t('plugins.addServer.cancel') }}</ion-button>
          <ion-button fill="solid" size="small" :disabled="isAddingMarketplace" @click="handleAddMarketplace">
            <ion-spinner v-if="isAddingMarketplace" name="crescent" style="margin-right: 6px;" />
            {{ t('plugins.settings.marketplaces.add') }}
          </ion-button>
        </div>
      </div>

      <!-- List -->
      <div v-if="pluginsStore.marketplaces.length === 0 && !showAddMarketplace" :class="$style.empty">
        {{ t('plugins.settings.marketplaces.empty') }}
      </div>
      <div v-else :class="$style.list">
        <div v-for="marketplace in pluginsStore.marketplaces" :key="marketplace.id" :class="$style.marketplaceCard">
          <div :class="$style.marketplaceRow">
            <div :class="$style.marketplaceIconWrap"><Store :size="16" :class="$style.marketplaceIcon" /></div>
            <div :class="$style.marketplaceInfo">
              <div :class="$style.marketplaceName">{{ marketplace.name }}</div>
              <div :class="$style.marketplaceMeta">
                <span>{{ marketplace.owner.name }}</span>
                <span :class="$style.dot">·</span>
                <span>{{ t('plugins.settings.marketplaces.pluginCount', { count: marketplace.plugins.length }, marketplace.plugins.length) }}</span>
              </div>
            </div>
            <div :class="$style.marketplaceActions">
              <ion-button fill="clear" size="small" :disabled="refreshingMarketplaceId === marketplace.id" @click="handleRefreshMarketplace(marketplace.id)">
                <ion-spinner v-if="refreshingMarketplaceId === marketplace.id" name="crescent" style="width:14px;height:14px;" />
                <RefreshCw v-else :size="14" />
              </ion-button>
              <ion-button fill="clear" size="small" color="danger" @click="handleRemoveMarketplace(marketplace.id)">
                <Trash2 :size="14" />
              </ion-button>
            </div>
          </div>
        </div>
      </div>
    </div>

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

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--spacing--sm);
}

.list {
  display: flex;
  flex-direction: column;
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

// --- Search ---
.searchRow { display: flex; gap: var(--spacing--sm); margin-bottom: var(--spacing--md); align-items: flex-end; }
.searchWrap { flex: 1; position: relative; min-width: 0; }
.searchIcon { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--color--text--tint-2); z-index: 1; pointer-events: none; }
.searchInput { --padding-start: 36px; }
.filterSelect { max-width: 160px; flex-shrink: 0; }

// --- Section ---
.sectionHeader { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: var(--spacing--sm); gap: var(--spacing--sm); }
.sectionHint { font-size: var(--font-size--2xs); color: var(--color--text--tint-2); margin: 0; }

// --- Marketplace cards ---
.marketplaceCard {
  background: var(--n8n-desk--surface-bg, var(--color--foreground));
  border: 1px solid var(--n8n-desk--content-bg, var(--color--background));
  border-radius: 10px;
  padding: 12px 16px;
  transition: border-color 0.15s;
  &:hover { border-color: var(--color--text--tint-2, rgba(0, 0, 0, 0.1)); }
}
.marketplaceRow { display: flex; align-items: center; gap: 10px; }
.marketplaceIconWrap { width: 36px; height: 36px; border-radius: 8px; background: var(--n8n-desk--surface-raised-bg, var(--color--foreground--tint-2)); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.marketplaceIcon { color: var(--color--primary, #ff6d5a); }
.marketplaceInfo { flex: 1; min-width: 0; }
.marketplaceName { font-size: 14px; font-weight: 600; color: var(--color--text--shade-1); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.marketplaceMeta { font-size: 12px; color: var(--color--text--tint-1); margin-top: 2px; display: flex; align-items: center; gap: 4px; }
.dot { color: var(--color--text--tint-2); }
.marketplaceActions { display: flex; align-items: center; gap: 2px; flex-shrink: 0; }

// --- Add form ---
.addForm {
  background: var(--n8n-desk--surface-bg, var(--color--foreground));
  border: 1px solid var(--n8n-desk--content-bg, var(--color--background));
  border-radius: 10px;
  padding: 16px;
  margin-bottom: var(--spacing--md);
}
.formField { margin-bottom: var(--spacing--md); }
.formActions { display: flex; justify-content: flex-end; gap: var(--spacing--sm); }
.errorText { font-size: var(--font-size--sm, 13px); color: var(--color--danger, #dc2626); margin-bottom: var(--spacing--sm); }
</style>
