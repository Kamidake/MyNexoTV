import { ref } from 'vue'
import type { AddonInfo } from '../types/config'

const FALLBACK: AddonInfo = { name: 'NexoTV', description: '', logoUrl: '', encryptionEnabled: false }

const info = ref<AddonInfo | null>(null)
const loading = ref(true)
let request: Promise<void> | null = null

async function load() {
  try {
    const [infoData, capsData] = await Promise.all([
      fetch(`/api/addon-info?_t=${Date.now()}`).then(r => r.json()),
      fetch('/api/capabilities').then(r => r.json()).catch(() => ({ encryptionEnabled: false }))
    ])
    info.value = {
      name: infoData.name || FALLBACK.name,
      description: infoData.description || '',
      logoUrl: infoData.logoUrl || '',
      encryptionEnabled: capsData.encryptionEnabled ?? false
    }
  } catch {
    info.value = FALLBACK
  } finally {
    loading.value = false
  }
}

/** Addon name and server capabilities, fetched once per page load. */
export function useAddonInfo() {
  request ??= load()
  return { info, loading }
}
