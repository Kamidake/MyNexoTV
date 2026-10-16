<template>
  <div class="page">
    <TheHeader :reconfigure="!!decodedConfig" />

    <main class="layout">
      <section class="form-col" aria-labelledby="page-title">
        <h1 id="page-title">Connect a source</h1>

        <StepBlock :n="1" title="Source type" done>
          <div class="segmented" role="radiogroup" aria-labelledby="step-1-title">
            <button v-for="t in TABS" :key="t.id" type="button" role="radio" class="seg"
              :class="{ active: activeTab === t.id }" :aria-checked="activeTab === t.id"
              @click="selectTab(t.id)">{{ t.label }}</button>
          </div>
        </StepBlock>

        <XtreamConfig v-if="activeTab === 'xtream'" />
        <M3uConfig v-else-if="activeTab === 'm3u'" />
        <IptvOrgConfig v-else />
      </section>

      <CheckPanel class="check-col" />
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import TheHeader from './components/TheHeader.vue'
import StepBlock from './components/StepBlock.vue'
import CheckPanel from './components/CheckPanel.vue'
import XtreamConfig from './components/XtreamConfig.vue'
import IptvOrgConfig from './components/IptvOrgConfig.vue'
import M3uConfig from './components/M3uConfig.vue'
import { useDecodedToken } from './composables/useDecodedToken'
import { useSourceCheck } from './composables/useSourceCheck'
import type { Provider } from './types/config'

const TABS: ReadonlyArray<{ id: Provider; label: string }> = [
  { id: 'xtream', label: 'Xtream Codes' },
  { id: 'm3u', label: 'M3U playlist' },
  { id: 'iptv-org', label: 'IPTV-org · free' },
]

const { decodedConfig } = useDecodedToken()
const check = useSourceCheck()

// Reconfiguration opens the provider of the token; a fresh install opens the free source
const activeTab = ref<Provider>((decodedConfig?.provider as Provider) || 'iptv-org')

function selectTab(id: Provider) {
  if (id === activeTab.value) return
  activeTab.value = id
  check.reset()
}
</script>
