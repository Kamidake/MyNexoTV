<template>
  <form class="config-form" autocomplete="off" novalidate @submit.prevent="handleSubmit">
    <StepBlock :n="2" title="Panel login" :done="loginFilled">
      <div class="field">
        <label for="xtreamUrl">Server URL</label>
        <input type="url" id="xtreamUrl" class="mono" v-model="form.xtreamUrl" placeholder="http://panel.example.com:8080"
          :aria-invalid="!!errors.xtreamUrl" aria-describedby="xtreamUrl-error" @input="delete errors.xtreamUrl">
        <p v-if="errors.xtreamUrl" id="xtreamUrl-error" class="field-error">{{ errors.xtreamUrl }}</p>
      </div>
      <div class="field-row">
        <div class="field">
          <label for="xtreamUsername">Username</label>
          <input type="text" id="xtreamUsername" v-model="form.xtreamUsername" autocapitalize="off" spellcheck="false"
            :aria-invalid="!!errors.xtreamUsername" aria-describedby="xtreamUsername-error" @input="delete errors.xtreamUsername">
          <p v-if="errors.xtreamUsername" id="xtreamUsername-error" class="field-error">{{ errors.xtreamUsername }}</p>
        </div>
        <div class="field">
          <label for="xtreamPassword">Password</label>
          <div class="input-with-action">
            <input :type="showPwd ? 'text' : 'password'" id="xtreamPassword" v-model="form.xtreamPassword"
              autocomplete="new-password" :aria-invalid="!!errors.xtreamPassword" aria-describedby="xtreamPassword-error"
              @input="delete errors.xtreamPassword">
            <button type="button" class="input-action" :aria-pressed="showPwd" @click="showPwd = !showPwd">{{ showPwd ? 'Hide' : 'Show' }}</button>
          </div>
          <p v-if="errors.xtreamPassword" id="xtreamPassword-error" class="field-error">{{ errors.xtreamPassword }}</p>
        </div>
      </div>
    </StepBlock>

    <StepBlock :n="3" title="Options" :done="check.state.phase === 'passed'">
      <CheckBox id="enableEpg" v-model="form.enableEpg">Load the program guide</CheckBox>
      <AdvancedPanel id="xtream-advanced" v-model:open="advancedOpen">
        <div class="field">
          <label for="catalogName">Catalog name</label>
          <input type="text" id="catalogName" v-model="form.catalogName" :placeholder="addonName">
        </div>
        <div class="field">
          <label for="epgOffsetHours">Guide time offset (hours)</label>
          <input type="number" step="0.25" min="-48" max="48" id="epgOffsetHours" class="mono" v-model.number="form.epgOffsetHours"
            :disabled="!form.enableEpg" :aria-invalid="!!errors.epgOffsetHours" aria-describedby="epgOffsetHours-error"
            @input="delete errors.epgOffsetHours">
          <p v-if="errors.epgOffsetHours" id="epgOffsetHours-error" class="field-error">{{ errors.epgOffsetHours }}</p>
        </div>
        <div class="field field-wide">
          <label for="customEpgUrl">Custom guide URL</label>
          <input type="url" id="customEpgUrl" class="mono" v-model="form.customEpgUrl" placeholder="Use the panel's XMLTV"
            :disabled="!form.enableEpg" :aria-invalid="!!errors.customEpgUrl" aria-describedby="customEpgUrl-error"
            @input="delete errors.customEpgUrl">
          <p v-if="errors.customEpgUrl" id="customEpgUrl-error" class="field-error">{{ errors.customEpgUrl }}</p>
        </div>
        <div class="field-wide">
          <CheckBox id="reformatLogos" v-model="form.reformatLogos">Reformat channel logos</CheckBox>
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
import { useDecodedToken } from '../composables/useDecodedToken'
import { useAddonInfo } from '../composables/useAddonInfo'
import { useSourceCheck } from '../composables/useSourceCheck'
import { useFieldErrors, isHttpUrl } from '../composables/useFieldErrors'
import type { XtreamConfig } from '../types/config'

type FieldId = 'xtreamUrl' | 'xtreamUsername' | 'xtreamPassword' | 'epgOffsetHours' | 'customEpgUrl'
const FIELD_ORDER: readonly FieldId[] = ['xtreamUrl', 'xtreamUsername', 'xtreamPassword', 'epgOffsetHours', 'customEpgUrl']
const ADVANCED_FIELDS: readonly FieldId[] = ['epgOffsetHours', 'customEpgUrl']
const MASKED = '********'

const check = useSourceCheck()
const { info: addonInfo } = useAddonInfo()
const addonName = computed(() => addonInfo.value?.name ?? 'NexoTV')
const { errors, clear, set, has, focusFirst, applyResult } = useFieldErrors<FieldId>()

const showPwd = ref(false)
const advancedOpen = ref(false)
let originalPassword = ''

const defaults = () => ({
  xtreamUrl: '',
  xtreamUsername: '',
  xtreamPassword: '',
  enableEpg: true,
  customEpgUrl: '',
  epgOffsetHours: 0,
  reformatLogos: false,
  catalogName: '',
})
const form = reactive(defaults())

const loginFilled = computed(() => !!(form.xtreamUrl.trim() && form.xtreamUsername.trim() && form.xtreamPassword))

onMounted(() => {
  const { decodedConfig } = useDecodedToken()
  if (!decodedConfig || decodedConfig.provider !== 'xtream') return
  const d = decodedConfig as XtreamConfig
  form.xtreamUrl = d.xtreamUrl || ''
  form.xtreamUsername = d.xtreamUsername || ''
  if (d.xtreamPassword) {
    form.xtreamPassword = MASKED
    originalPassword = d.xtreamPassword
  }
  form.enableEpg = !!d.enableEpg
  form.customEpgUrl = d.epgUrl || ''
  form.epgOffsetHours = d.epgOffsetHours ?? 0
  form.reformatLogos = !!d.reformatLogos
  form.catalogName = decodedConfig.catalogName || ''
  advancedOpen.value = !!(d.epgUrl || d.epgOffsetHours || d.reformatLogos || decodedConfig.catalogName)
})

function normalizeUrl(raw: string) {
  const s = raw.trim()
  return s.endsWith('/') ? s.slice(0, -1) : s
}

function uuid() {
  return crypto?.randomUUID?.() ?? 'id-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

function validate() {
  clear()
  const baseUrl = normalizeUrl(form.xtreamUrl)
  if (!baseUrl) set('xtreamUrl', 'Enter the server URL.')
  else if (!isHttpUrl(baseUrl)) set('xtreamUrl', 'Enter a URL that starts with http:// or https://.')
  if (!form.xtreamUsername.trim()) set('xtreamUsername', 'Enter the username.')
  if (!form.xtreamPassword) set('xtreamPassword', 'Enter the password.')
  if (form.enableEpg) {
    const offset = form.epgOffsetHours
    if (typeof offset !== 'number' || !isFinite(offset) || Math.abs(offset) > 48) {
      set('epgOffsetHours', 'Enter a number of hours from -48 to 48.')
    }
    const custom = form.customEpgUrl.trim()
    if (custom && !isHttpUrl(custom)) set('customEpgUrl', 'Enter a URL that starts with http:// or https://.')
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

  let password = form.xtreamPassword
  if (password === MASKED && originalPassword) password = originalPassword
  const customEpg = form.enableEpg ? form.customEpgUrl.trim() : ''
  const offset = form.epgOffsetHours || 0

  const config: XtreamConfig & { catalogName?: string } = {
    provider: 'xtream',
    xtreamUrl: normalizeUrl(form.xtreamUrl),
    xtreamUsername: form.xtreamUsername.trim(),
    xtreamPassword: password,
    enableEpg: form.enableEpg,
    reformatLogos: form.reformatLogos,
    ...(customEpg ? { epgUrl: customEpg } : {}),
    ...(form.enableEpg && offset !== 0 ? { epgOffsetHours: offset } : {}),
    instanceId: uuid(),
    ...(form.catalogName.trim() ? { catalogName: form.catalogName.trim() } : {}),
  }

  const result = await check.run(config)
  const fields = applyResult(result, f => (f === 'epgUrl' ? 'customEpgUrl' : FIELD_ORDER.find(id => id === f)))
  openAdvancedIfNeeded()
  if (fields.length && !result?.ok) await focusFirst(FIELD_ORDER)
}

function resetForm() {
  Object.assign(form, defaults())
  originalPassword = ''
  showPwd.value = false
  advancedOpen.value = false
  clear()
  check.reset()
}
</script>
