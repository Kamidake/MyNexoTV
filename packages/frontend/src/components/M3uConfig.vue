<template>
  <form class="config-form" autocomplete="off" novalidate @submit.prevent="handleSubmit">
    <StepBlock :n="2" title="Playlist" :done="!!form.m3uUrl.trim()">
      <div class="field">
        <label for="m3uUrl">Playlist URL</label>
        <input type="url" id="m3uUrl" class="mono" v-model="form.m3uUrl"
          placeholder="http://provider.com/get.php?username=X&password=Y&type=m3u_plus"
          :aria-invalid="!!errors.m3uUrl" aria-describedby="m3uUrl-error" @input="delete errors.m3uUrl">
        <p v-if="errors.m3uUrl" id="m3uUrl-error" class="field-error">{{ errors.m3uUrl }}</p>
      </div>
      <div v-if="playlists.length" class="field">
        <span class="field-label" id="m3uPublic-label">Public playlists, third-party</span>
        <div class="chips" role="group" aria-labelledby="m3uPublic-label">
          <button v-for="pl in playlists" :key="pl.url" type="button" class="chip"
            :class="{ active: form.m3uUrl === pl.url }" :title="pl.url" @click="usePlaylist(pl.url)">
            {{ pl.label }}<span v-if="pl.note" class="chip-note">{{ pl.note }}</span>
          </button>
        </div>
      </div>
    </StepBlock>

    <StepBlock :n="3" title="Options" :done="check.state.phase === 'passed'">
      <CheckBox id="m3uEnableEpg" v-model="form.enableEpg">Load the program guide</CheckBox>
      <AdvancedPanel id="m3u-advanced" v-model:open="advancedOpen">
        <div class="field">
          <label for="m3uCatalogName">Catalog name</label>
          <input type="text" id="m3uCatalogName" v-model="form.catalogName" :placeholder="addonName">
        </div>
        <div class="field">
          <label for="m3uEpgOffsetHours">Guide time offset (hours)</label>
          <input type="number" step="0.25" min="-48" max="48" id="m3uEpgOffsetHours" class="mono" v-model.number="form.epgOffsetHours"
            :disabled="!form.enableEpg" :aria-invalid="!!errors.m3uEpgOffsetHours" aria-describedby="m3uEpgOffsetHours-error"
            @input="delete errors.m3uEpgOffsetHours">
          <p v-if="errors.m3uEpgOffsetHours" id="m3uEpgOffsetHours-error" class="field-error">{{ errors.m3uEpgOffsetHours }}</p>
        </div>
        <div class="field field-wide">
          <label for="m3uCustomEpgUrl">Custom guide URL</label>
          <input type="url" id="m3uCustomEpgUrl" class="mono" v-model="form.customEpgUrl" placeholder="Use the playlist's url-tvg"
            :disabled="!form.enableEpg" :aria-invalid="!!errors.m3uCustomEpgUrl" aria-describedby="m3uCustomEpgUrl-error"
            @input="delete errors.m3uCustomEpgUrl">
          <p v-if="errors.m3uCustomEpgUrl" id="m3uCustomEpgUrl-error" class="field-error">{{ errors.m3uCustomEpgUrl }}</p>
        </div>
        <div class="field field-wide">
          <span class="field-label" id="m3uUa-label">User-Agent</span>
          <div class="chips" role="group" aria-labelledby="m3uUa-label">
            <button v-for="p in USER_AGENT_PRESETS" :key="p.value" type="button" class="chip"
              :class="{ active: form.userAgentPreset === p.value }" :aria-pressed="form.userAgentPreset === p.value"
              @click="selectPreset(p.value)">{{ p.label }}</button>
            <button type="button" class="chip" :class="{ active: form.userAgentPreset === 'custom' }"
              :aria-pressed="form.userAgentPreset === 'custom'" @click="selectPreset('custom')">Custom</button>
          </div>
          <input v-if="form.userAgentPreset === 'custom'" type="text" id="m3uGlobalUserAgent" class="mono"
            v-model="form.globalUserAgent" placeholder="MyPlayer/1.0" aria-label="Custom User-Agent">
        </div>
        <div class="field-wide">
          <CheckBox id="m3uReformatLogos" v-model="form.reformatLogos">Reformat channel logos</CheckBox>
        </div>
      </AdvancedPanel>
    </StepBlock>

    <div class="form-actions">
      <button type="submit" class="btn btn-primary" :disabled="check.state.phase === 'running'">
        {{ check.state.phase === 'running' ? 'Checking…' : 'Check and install' }}
      </button>
      <button type="button" class="btn" @click="resetForm">Reset</button>
    </div>
  </form>
</template>

<script setup lang="ts">
import { reactive, ref, computed, onMounted } from 'vue'
import StepBlock from './StepBlock.vue'
import CheckBox from './CheckBox.vue'
import AdvancedPanel from './AdvancedPanel.vue'
import { usePublicPlaylists } from '../composables/usePublicPlaylists'
import { useDecodedToken } from '../composables/useDecodedToken'
import { useAddonInfo } from '../composables/useAddonInfo'
import { useSourceCheck } from '../composables/useSourceCheck'
import { useFieldErrors, isHttpUrl } from '../composables/useFieldErrors'
import type { M3uConfig } from '../types/config'

type FieldId = 'm3uUrl' | 'm3uEpgOffsetHours' | 'm3uCustomEpgUrl'
const FIELD_ORDER: readonly FieldId[] = ['m3uUrl', 'm3uEpgOffsetHours', 'm3uCustomEpgUrl']
const ADVANCED_FIELDS: readonly FieldId[] = ['m3uEpgOffsetHours', 'm3uCustomEpgUrl']

const USER_AGENT_PRESETS = [
  { label: 'TiviMate',          value: 'TiviMate/4.7.0 (Android)' },
  { label: 'IPTV Smarters Pro', value: 'IPTV Smarters Pro' },
  { label: 'GSE Smart IPTV',    value: 'GSE/7.6 CFNetwork/1410.1 Darwin/22.6.0' },
  { label: 'VLC',               value: 'VLC/3.0.18 LibVLC/3.0.18' },
  { label: 'Kodi',              value: 'Kodi/21.0 (X11; Linux x86_64) App_Bitness/64 Version/21.0' },
]

const check = useSourceCheck()
const { playlists } = usePublicPlaylists()
const { info: addonInfo } = useAddonInfo()
const addonName = computed(() => addonInfo.value?.name ?? 'NexoTV')
const { errors, clear, set, has, focusFirst, applyResult } = useFieldErrors<FieldId>()
const advancedOpen = ref(false)

const defaults = () => ({
  m3uUrl: '',
  enableEpg: false,
  customEpgUrl: '',
  epgOffsetHours: 0,
  reformatLogos: false,
  catalogName: '',
  userAgentPreset: '',
  globalUserAgent: '',
})
const form = reactive(defaults())

function usePlaylist(url: string) {
  form.m3uUrl = url
  delete errors.m3uUrl
}

function selectPreset(value: string) {
  if (form.userAgentPreset === value) {
    form.userAgentPreset = ''
    form.globalUserAgent = ''
    return
  }
  form.userAgentPreset = value
  form.globalUserAgent = value !== 'custom' ? value : ''
}

onMounted(() => {
  const { decodedConfig } = useDecodedToken()
  if (!decodedConfig || decodedConfig.provider !== 'm3u') return
  const d = decodedConfig as M3uConfig
  form.m3uUrl = d.m3uUrl || ''
  form.enableEpg = !!d.enableEpg
  form.customEpgUrl = d.epgUrl || ''
  form.epgOffsetHours = d.epgOffsetHours ?? 0
  form.reformatLogos = !!d.reformatLogos
  form.catalogName = decodedConfig.catalogName || ''
  const savedUa = d.globalUserAgent || ''
  if (savedUa) {
    const match = USER_AGENT_PRESETS.find(p => p.value === savedUa)
    form.userAgentPreset = match ? match.value : 'custom'
    form.globalUserAgent = savedUa
  }
  advancedOpen.value = !!(d.epgUrl || d.epgOffsetHours || d.reformatLogos || savedUa || decodedConfig.catalogName)
})

function validate() {
  clear()
  const url = form.m3uUrl.trim()
  if (!url) set('m3uUrl', 'Enter the playlist URL.')
  else if (!isHttpUrl(url)) set('m3uUrl', 'Enter a URL that starts with http:// or https://.')
  if (form.enableEpg) {
    const offset = form.epgOffsetHours
    if (typeof offset !== 'number' || !isFinite(offset) || Math.abs(offset) > 48) {
      set('m3uEpgOffsetHours', 'Enter a number of hours from -48 to 48.')
    }
    const custom = form.customEpgUrl.trim()
    if (custom && !isHttpUrl(custom)) set('m3uCustomEpgUrl', 'Enter a URL that starts with http:// or https://.')
  }
}

function openAdvancedIfNeeded() {
  if (ADVANCED_FIELDS.some(f => errors[f])) advancedOpen.value = true
}

async function handleSubmit() {
  validate()
  if (has()) {
    openAdvancedIfNeeded()
    await focusFirst(FIELD_ORDER)
    return
  }

  const enableEpg = form.enableEpg
  const customEpgUrl = enableEpg ? form.customEpgUrl.trim() : ''
  const epgOffsetHours = form.epgOffsetHours || 0

  const config: M3uConfig & { catalogName?: string } = {
    provider: 'm3u',
    m3uUrl: form.m3uUrl.trim(),
    enableEpg,
    reformatLogos: form.reformatLogos,
    ...(enableEpg && epgOffsetHours !== 0 ? { epgOffsetHours } : {}),
    ...(customEpgUrl ? { epgUrl: customEpgUrl } : {}),
    ...(form.catalogName.trim() ? { catalogName: form.catalogName.trim() } : {}),
    ...(form.globalUserAgent.trim() ? { globalUserAgent: form.globalUserAgent.trim() } : {}),
  }

  const result = await check.run(config)
  const fields = applyResult(result, f => (f === 'm3uUrl' ? 'm3uUrl' : f === 'epgUrl' ? 'm3uCustomEpgUrl' : undefined))
  openAdvancedIfNeeded()
  if (fields.length && !result?.ok) await focusFirst(FIELD_ORDER)
}

function resetForm() {
  Object.assign(form, defaults())
  advancedOpen.value = false
  clear()
  check.reset()
}
</script>
