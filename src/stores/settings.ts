import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import type { ThemeMode, AppMode, AppSettings, SupportedLocale, LlmConfig } from '@/types/settings'
import { localStorageService } from '@/services/local-storage'
import { setAppLocale } from '@/i18n'

const CONFIG_PATH = 'config.json'
const LLM_CONFIG_PATH = 'llm.json'

const DEFAULTS: AppSettings = {
  theme: 'system',
  defaultInstanceId: null,
  lastMode: 'chat',
  locale: 'en',
}

export const useSettingsStore = defineStore('settings', () => {
  const theme = ref<ThemeMode>(DEFAULTS.theme)
  const defaultInstanceId = ref<string | null>(DEFAULTS.defaultInstanceId)
  const lastMode = ref<AppMode>(DEFAULTS.lastMode)
  const locale = ref<SupportedLocale>(DEFAULTS.locale)
  const llmConfig = ref<LlmConfig | null>(null)

  const hasLlmConfig = computed(() => llmConfig.value !== null)

  // --- Settings modal state (global so any component can open it) ---
  const settingsOpen = ref(false)
  const settingsSection = ref<string | null>(null)

  /** Open the settings modal, optionally jumping to a specific section */
  function openSettings(section?: string): void {
    settingsSection.value = section ?? null
    settingsOpen.value = true
  }

  function closeSettings(): void {
    settingsOpen.value = false
    settingsSection.value = null
  }

  async function hydrate(): Promise<void> {
    const saved = await localStorageService.readJson<AppSettings>(CONFIG_PATH)
    if (saved) {
      theme.value = saved.theme ?? DEFAULTS.theme
      defaultInstanceId.value = saved.defaultInstanceId ?? DEFAULTS.defaultInstanceId
      lastMode.value = saved.lastMode ?? DEFAULTS.lastMode
      locale.value = saved.locale ?? DEFAULTS.locale
      setAppLocale(locale.value)
    }
  }

  async function save(): Promise<void> {
    const data: AppSettings = {
      theme: theme.value,
      defaultInstanceId: defaultInstanceId.value,
      lastMode: lastMode.value,
      locale: locale.value,
    }
    await localStorageService.writeJson(CONFIG_PATH, data)
  }

  function setTheme(mode: ThemeMode): void {
    theme.value = mode
    void save()
  }

  function setLastMode(mode: AppMode): void {
    lastMode.value = mode
    void save()
  }

  function setLocale(newLocale: SupportedLocale): void {
    locale.value = newLocale
    setAppLocale(newLocale)
    void save()
  }

  async function hydrateLlm(): Promise<void> {
    const saved = await localStorageService.readJson<LlmConfig>(LLM_CONFIG_PATH)
    llmConfig.value = saved ?? null
  }

  async function saveLlm(config: LlmConfig): Promise<void> {
    llmConfig.value = config
    await localStorageService.writeJson(LLM_CONFIG_PATH, config)
  }

  return {
    theme,
    defaultInstanceId,
    lastMode,
    locale,
    llmConfig,
    hasLlmConfig,
    hydrate,
    save,
    setTheme,
    setLastMode,
    setLocale,
    hydrateLlm,
    saveLlm,
    settingsOpen,
    settingsSection,
    openSettings,
    closeSettings,
  }
})
