<template>
  <form class="config-form" autocomplete="off" novalidate @submit.prevent="handleSubmit">
    <StepBlock :n="2" title="Channels" :done="true">
      <div class="field-row">
        <div class="field">
          <label for="iptvCountry">Countries</label>
          <div class="multi" :class="{ open: countryOpen }">
            <input type="text" id="iptvCountry" class="multi-input" v-model="countrySearch"
              :placeholder="selectedCountries.length ? 'Add a country' : 'All countries'" autocomplete="off"
              role="combobox" :aria-expanded="countryOpen" aria-controls="iptvCountry-list"
              @focus="countryOpen = true" @blur="onCountryBlur" @input="countryOpen = true"
              @keydown="onCountryKeydown">
            <ul v-show="countryOpen" id="iptvCountry-list" class="multi-list" role="listbox">
              <li v-if="filteredCountries.length === 0" class="multi-empty">No match</li>
              <li v-for="(item, i) in filteredCountries" :key="item.value" role="option"
                :class="{ highlighted: countryHighlight === i }" :aria-selected="countryHighlight === i"
                @mousedown.prevent="selectCountry(item)">
                {{ item.label }}
              </li>
            </ul>
            <div v-if="selectedCountries.length" class="multi-tags">
              <span v-for="item in selectedCountries" :key="item.value" class="tag">
                {{ item.label.split(' (')[0].trim() }}
                <button type="button" class="tag-remove" :aria-label="`Remove ${item.label}`" @mousedown.prevent.stop="removeCountry(item.value)">×</button>
              </span>
            </div>
          </div>
        </div>
        <div class="field">
          <label for="iptvCategory">Categories</label>
          <div class="multi" :class="{ open: categoryOpen }">
            <input type="text" id="iptvCategory" class="multi-input" v-model="categorySearch"
              :placeholder="selectedCategories.length ? 'Add a category' : 'All categories'" autocomplete="off"
              role="combobox" :aria-expanded="categoryOpen" aria-controls="iptvCategory-list"
              @focus="categoryOpen = true" @blur="onCategoryBlur" @input="categoryOpen = true"
              @keydown="onCategoryKeydown">
            <ul v-show="categoryOpen" id="iptvCategory-list" class="multi-list" role="listbox">
              <li v-if="filteredCategories.length === 0" class="multi-empty">No match</li>
              <li v-for="(item, i) in filteredCategories" :key="item.value" role="option"
                :class="{ highlighted: categoryHighlight === i }" :aria-selected="categoryHighlight === i"
                @mousedown.prevent="selectCategory(item)">
                {{ item.label }}
              </li>
            </ul>
            <div v-if="selectedCategories.length" class="multi-tags">
              <span v-for="item in selectedCategories" :key="item.value" class="tag">
                {{ item.label }}
                <button type="button" class="tag-remove" :aria-label="`Remove ${item.label}`" @mousedown.prevent.stop="removeCategory(item.value)">×</button>
              </span>
            </div>
          </div>
        </div>
      </div>
      <p v-if="listError" class="field-error">{{ listError }}</p>
    </StepBlock>

    <StepBlock :n="3" title="Options" :done="check.state.phase === 'passed'">
      <AdvancedPanel id="iptv-advanced" v-model:open="advancedOpen">
        <div class="field">
          <label for="iptvCatalogName">Catalog name</label>
          <input type="text" id="iptvCatalogName" v-model="catalogName" :placeholder="addonName">
        </div>
      </AdvancedPanel>
    </StepBlock>

    <div class="form-actions">
      <button type="submit" class="btn btn-primary" id="iptv-org-submit" :disabled="check.state.phase === 'running'">
        {{ check.state.phase === 'running' ? 'Checking…' : 'Check and install' }}
      </button>
      <button type="button" class="btn" @click="resetForm">Reset</button>
    </div>
  </form>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import StepBlock from './StepBlock.vue'
import AdvancedPanel from './AdvancedPanel.vue'
import { useDecodedToken } from '../composables/useDecodedToken'
import { useAddonInfo } from '../composables/useAddonInfo'
import { useSourceCheck } from '../composables/useSourceCheck'
import type { IptvOrgConfig } from '../types/config'

const check = useSourceCheck()
const { info: addonInfo } = useAddonInfo()
const addonName = computed(() => addonInfo.value?.name ?? 'NexoTV')
const catalogName = ref('')
const advancedOpen = ref(false)
const listError = ref('')

const IPTV_ORG_BASE = 'https://iptv-org.github.io/api'

interface SelectItem { label: string; value: string }

const allCountries = ref<SelectItem[]>([])
const allCategories = ref<SelectItem[]>([])
const selectedCountries = ref<SelectItem[]>([])
const selectedCategories = ref<SelectItem[]>([])

const countrySearch = ref('')
const categorySearch = ref('')
const countryOpen = ref(false)
const categoryOpen = ref(false)
const countryHighlight = ref(-1)
const categoryHighlight = ref(-1)

const filteredCountries = computed(() => {
  const q = countrySearch.value.toLowerCase().trim()
  const available = allCountries.value.filter(i => !selectedCountries.value.some(s => s.value === i.value))
  return q ? available.filter(i => i.label.toLowerCase().includes(q)) : available
})

const filteredCategories = computed(() => {
  const q = categorySearch.value.toLowerCase().trim()
  const available = allCategories.value.filter(i => !selectedCategories.value.some(s => s.value === i.value))
  return q ? available.filter(i => i.label.toLowerCase().includes(q)) : available
})

function selectCountry(item: SelectItem) {
  if (!selectedCountries.value.some(s => s.value === item.value)) {
    selectedCountries.value.push(item)
  }
  countrySearch.value = ''
  countryOpen.value = false
  countryHighlight.value = -1
}

function selectCategory(item: SelectItem) {
  if (!selectedCategories.value.some(s => s.value === item.value)) {
    selectedCategories.value.push(item)
  }
  categorySearch.value = ''
  categoryOpen.value = false
  categoryHighlight.value = -1
}

function removeCountry(value: string) {
  selectedCountries.value = selectedCountries.value.filter(s => s.value !== value)
}

function removeCategory(value: string) {
  selectedCategories.value = selectedCategories.value.filter(s => s.value !== value)
}

function onCountryBlur() { setTimeout(() => { countryOpen.value = false }, 150) }
function onCategoryBlur() { setTimeout(() => { categoryOpen.value = false }, 150) }

function onCountryKeydown(e: KeyboardEvent) {
  const opts = filteredCountries.value
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    countryOpen.value = true
    countryHighlight.value = Math.min(countryHighlight.value + 1, opts.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    countryHighlight.value = Math.max(countryHighlight.value - 1, 0)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    if (countryHighlight.value >= 0 && opts[countryHighlight.value]) {
      selectCountry(opts[countryHighlight.value])
    }
  } else if (e.key === 'Escape') {
    countryOpen.value = false
  } else if (e.key === 'Backspace' && countrySearch.value === '' && selectedCountries.value.length > 0) {
    selectedCountries.value.pop()
  }
}

function onCategoryKeydown(e: KeyboardEvent) {
  const opts = filteredCategories.value
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    categoryOpen.value = true
    categoryHighlight.value = Math.min(categoryHighlight.value + 1, opts.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    categoryHighlight.value = Math.max(categoryHighlight.value - 1, 0)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    if (categoryHighlight.value >= 0 && opts[categoryHighlight.value]) {
      selectCategory(opts[categoryHighlight.value])
    }
  } else if (e.key === 'Escape') {
    categoryOpen.value = false
  } else if (e.key === 'Backspace' && categorySearch.value === '' && selectedCategories.value.length > 0) {
    selectedCategories.value.pop()
  }
}

onMounted(async () => {
  try {
    const [countriesRaw, categoriesRaw] = await Promise.all([
      fetch(`${IPTV_ORG_BASE}/countries.json`).then(r => r.json()),
      fetch(`${IPTV_ORG_BASE}/categories.json`).then(r => r.json()),
    ])

    allCountries.value = [...countriesRaw]
      .sort((a: any, b: any) => a.name.localeCompare(b.name))
      .map((c: any) => ({ label: `${c.name} (${c.code.toUpperCase()})`, value: c.code.toUpperCase() }))

    allCategories.value = [...categoriesRaw]
      .sort((a: any, b: any) => a.name.localeCompare(b.name))
      .map((c: any) => ({
        label: c.name.charAt(0).toUpperCase() + c.name.slice(1),
        value: c.id
      }))

    // Prefill on reconfigure
    const { decodedConfig } = useDecodedToken()
    if (decodedConfig && decodedConfig.provider === 'iptv-org') {
      const d = decodedConfig as IptvOrgConfig
      if (d.iptvOrgCountry) {
        const codes = d.iptvOrgCountry.split(',').map(c => c.trim().toUpperCase())
        selectedCountries.value = codes
          .map(code => allCountries.value.find(c => c.value === code))
          .filter(Boolean) as SelectItem[]
      }
      if (d.iptvOrgCategory) {
        const cats = d.iptvOrgCategory.split(',').map(c => c.trim().toLowerCase())
        selectedCategories.value = cats
          .map(cat => allCategories.value.find(c => c.value === cat))
          .filter(Boolean) as SelectItem[]
      }
      catalogName.value = decodedConfig.catalogName || ''
      advancedOpen.value = !!catalogName.value
    }
  } catch (err) {
    console.error('[IPTV-ORG] Failed to load countries/categories', err)
    listError.value = 'Cannot load the country and category lists from iptv-org. The install still works with all channels.'
  }
})

async function handleSubmit() {
  const country = selectedCountries.value.map(c => c.value).join(',') || null
  const category = selectedCategories.value.map(c => c.value).join(',') || null
  const config: IptvOrgConfig & { catalogName?: string } = {
    provider: 'iptv-org',
    iptvOrgCountry: country,
    iptvOrgCategory: category,
    ...(catalogName.value.trim() ? { catalogName: catalogName.value.trim() } : {}),
  }
  await check.run(config)
}

function resetForm() {
  selectedCountries.value = []
  selectedCategories.value = []
  countrySearch.value = ''
  categorySearch.value = ''
  catalogName.value = ''
  advancedOpen.value = false
  check.reset()
}
</script>
