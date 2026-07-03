import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import type { Instance } from '@/types/instance'
import { localStorageService } from '@/services/local-storage'
import { useSettingsStore } from './settings'
import { useChatStore } from './chat'

const INSTANCES_INDEX_PATH = 'instances/index.json'

function instancePath(instanceId: string, file: string): string {
  return `instances/${instanceId}/${file}`
}

export const useInstancesStore = defineStore('instances', () => {
  const instances = ref<Instance[]>([])
  const activeInstanceId = ref<string | null>(null)

  const activeInstance = computed(() =>
    instances.value.find((i) => i.id === activeInstanceId.value) ?? null
  )

  const hasInstances = computed(() => instances.value.length > 0)

  async function hydrate(): Promise<void> {
    // Read instance index
    const ids = await localStorageService.readJson<string[]>(INSTANCES_INDEX_PATH)
    if (!ids || ids.length === 0) {
      instances.value = []
      activeInstanceId.value = null
      return
    }

    // Read each instance config
    const loaded: Instance[] = []
    for (const id of ids) {
      const config = await localStorageService.readJson<Instance>(instancePath(id, 'instance.json'))
      if (config) {
        loaded.push(config)
      }
    }

    instances.value = loaded

    // Set active instance from settings
    const settingsStore = useSettingsStore()
    if (settingsStore.defaultInstanceId && ids.includes(settingsStore.defaultInstanceId)) {
      activeInstanceId.value = settingsStore.defaultInstanceId
    } else if (loaded.length > 0) {
      activeInstanceId.value = loaded[0].id
    }
  }

  function reset(): void {
    instances.value = []
    activeInstanceId.value = null
  }

  async function addInstance(instance: Instance): Promise<void> {
    // Avoid duplicates
    if (instances.value.some((i) => i.id === instance.id)) {
      // Update existing
      const idx = instances.value.findIndex((i) => i.id === instance.id)
      instances.value[idx] = instance
    } else {
      instances.value.push(instance)
    }

    // Persist instance config
    await localStorageService.writeJson(instancePath(instance.id, 'instance.json'), instance)

    // Update index
    const ids = instances.value.map((i) => i.id)
    await localStorageService.writeJson(INSTANCES_INDEX_PATH, ids)

    // If this is the first instance, set as active
    if (instances.value.length === 1 || !activeInstanceId.value) {
      await setActive(instance.id)
    }
  }

  async function updateInstance(
    id: string,
    updates: Partial<Pick<Instance, 'label' | 'color' | 'mcpServerUrl'>>,
  ): Promise<void> {
    const idx = instances.value.findIndex((i) => i.id === id)
    if (idx === -1) return

    // Merge, then strip an explicitly-undefined mcpServerUrl so callers can
    // remove the override by passing `mcpServerUrl: undefined`.
    const updated: Instance = { ...instances.value[idx], ...updates }
    if ('mcpServerUrl' in updates && updates.mcpServerUrl === undefined) {
      delete updated.mcpServerUrl
    }
    instances.value[idx] = updated

    await localStorageService.writeJson(instancePath(id, 'instance.json'), updated)
  }

  function getInstance(id: string): Instance | null {
    return instances.value.find((i) => i.id === id) ?? null
  }

  async function removeInstance(id: string): Promise<void> {
    instances.value = instances.value.filter((i) => i.id !== id)

    // Update index
    const ids = instances.value.map((i) => i.id)
    await localStorageService.writeJson(INSTANCES_INDEX_PATH, ids)

    // If removing the active instance, switch to another
    if (activeInstanceId.value === id) {
      activeInstanceId.value = instances.value.length > 0 ? instances.value[0].id : null
      const settingsStore = useSettingsStore()
      settingsStore.defaultInstanceId = activeInstanceId.value
      await settingsStore.save()
    }
  }

  async function setActive(id: string): Promise<void> {
    const previousId = activeInstanceId.value
    activeInstanceId.value = id

    // Reset chat store on instance switch to clear stale data
    if (previousId !== null && previousId !== id) {
      const chatStore = useChatStore()
      chatStore.reset()
    }

    const settingsStore = useSettingsStore()
    settingsStore.defaultInstanceId = id
    await settingsStore.save()
  }

  return {
    instances,
    activeInstanceId,
    activeInstance,
    hasInstances,
    hydrate,
    reset,
    addInstance,
    updateInstance,
    getInstance,
    removeInstance,
    setActive,
  }
})
