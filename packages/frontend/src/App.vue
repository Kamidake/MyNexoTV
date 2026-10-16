<template>
  <div class="app-shell">
    <aside class="rail">
      <TheHeader />

      <div class="guide-art" aria-hidden="true">
        <div class="guide-row"><span style="flex: 3"></span><span class="on" style="flex: 5"></span><span style="flex: 2"></span></div>
        <div class="guide-row"><span style="flex: 5"></span><span class="on" style="flex: 3"></span><span style="flex: 2"></span></div>
        <div class="guide-row"><span style="flex: 2"></span><span class="on" style="flex: 4"></span><span style="flex: 4"></span></div>
        <div class="guide-row"><span style="flex: 4"></span><span class="on" style="flex: 4"></span><span style="flex: 2"></span></div>
        <div class="guide-now"></div>
      </div>

      <footer class="rail-foot">
        <a href="https://github.com/joaosavi/nexotv" target="_blank" rel="noopener">Source on GitHub</a>
        <span>By <a href="https://github.com/joaosavi" target="_blank" rel="noopener">joaosavi</a></span>
      </footer>
    </aside>

    <main class="console">
      <div class="provider-tabs" role="tablist" aria-label="Provider">
        <button class="tab-btn" :class="{ active: activeTab === 'iptv-org' }"
          id="tab-iptv-org" role="tab"
          :aria-selected="activeTab === 'iptv-org'"
          aria-controls="panel-iptv-org"
          @click="activeTab = 'iptv-org'">
          <span class="tab-name">IPTV-org</span>
          <span class="tab-meta">Free public channels</span>
        </button>
        <button class="tab-btn" :class="{ active: activeTab === 'xtream' }"
          id="tab-xtream" role="tab"
          :aria-selected="activeTab === 'xtream'"
          aria-controls="panel-xtream"
          @click="activeTab = 'xtream'">
          <span class="tab-name">Xtream API</span>
          <span class="tab-meta">Your panel login</span>
        </button>
        <button class="tab-btn" :class="{ active: activeTab === 'm3u' }"
          id="tab-m3u" role="tab"
          :aria-selected="activeTab === 'm3u'"
          aria-controls="panel-m3u"
          @click="activeTab = 'm3u'">
          <span class="tab-name">M3U / M3U+</span>
          <span class="tab-meta">Any playlist URL</span>
        </button>
      </div>

      <div id="panel-iptv-org" class="tab-panel" :class="{ active: activeTab === 'iptv-org' }"
        role="tabpanel" aria-labelledby="tab-iptv-org">
        <IptvOrgConfig v-if="activeTab === 'iptv-org'" />
      </div>

      <div id="panel-xtream" class="tab-panel" :class="{ active: activeTab === 'xtream' }"
        role="tabpanel" aria-labelledby="tab-xtream">
        <XtreamConfig v-if="activeTab === 'xtream'" />
      </div>

      <div id="panel-m3u" class="tab-panel" :class="{ active: activeTab === 'm3u' }"
        role="tabpanel" aria-labelledby="tab-m3u">
        <M3uConfig v-if="activeTab === 'm3u'" />
      </div>
    </main>

    <TheOverlay
      :visible="poll.visible.value"
      :progress="poll.progress.value"
      :message="poll.message.value"
      :details="poll.details.value"
      :manifestUrl="poll.manifestUrl.value"
      :stremioUrl="poll.stremioUrl.value"
      :isReady="poll.isReady.value"
      @close="poll.hideOverlay()"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, provide, onMounted } from 'vue'
import TheHeader from './components/TheHeader.vue'
import TheOverlay from './components/TheOverlay.vue'
import XtreamConfig from './components/XtreamConfig.vue'
import IptvOrgConfig from './components/IptvOrgConfig.vue'
import M3uConfig from './components/M3uConfig.vue'
import { useManifestPoll } from './composables/useManifestPoll'
import { useConfigToken } from './composables/useConfigToken'
import { useDecodedToken } from './composables/useDecodedToken'
import type { Provider } from './types/config'

const poll = useManifestPoll()
const { buildUrls } = useConfigToken(poll.appendDetail)

// Provide overlay control to all child components
provide('overlayControl', {
  showOverlay: poll.showOverlay,
  hideOverlay: poll.hideOverlay,
  appendDetail: poll.appendDetail,
  setProgress: poll.setProgress,
  startPolling: poll.startPolling,
  markError: poll.markError,
  buildUrls,
})

// Active tab state — default to iptv-org
const activeTab = ref<Provider>('iptv-org')

// Reconfiguration: switch to the correct tab based on the decoded token
onMounted(() => {
  const { decodedConfig } = useDecodedToken()
  if (decodedConfig && decodedConfig.provider) {
    activeTab.value = decodedConfig.provider as Provider
  }
})
</script>
