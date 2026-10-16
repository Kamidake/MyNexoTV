<template>
  <section class="check-panel" aria-labelledby="check-title">
    <div class="check-head">
      <h2 id="check-title">Source check</h2>
      <span class="pill" :class="`pill-${state.phase}`" role="status">{{ pillText }}</span>
    </div>

    <div class="tiles">
      <div class="tile">
        <span class="tile-label">Channels</span>
        <span class="tile-value">{{ count(state.result?.channels) }}</span>
      </div>
      <div class="tile">
        <span class="tile-label">Groups</span>
        <span class="tile-value">{{ count(state.result?.groups) }}</span>
      </div>
      <div class="tile">
        <span class="tile-label">Programmes</span>
        <span class="tile-value">{{ count(state.result?.programmes) }}</span>
      </div>
    </div>

    <div class="log" :class="{ empty: state.phase === 'idle' }">
      <p v-if="state.phase === 'idle'" class="log-empty">No check yet.</p>
      <ol v-else class="log-rows" aria-live="polite">
        <li v-for="row in state.rows" :key="row.key" class="log-row" :class="`row-${row.status}`">
          <span class="log-time">{{ clock(row.at) }}</span>
          <span class="log-status">{{ STATUS_TEXT[row.status] }}</span>
          <span class="log-label">{{ row.label }}</span>
          <span class="log-detail">{{ row.status === 'run' ? runningDetail : row.detail }}</span>
        </li>
      </ol>

      <div v-if="state.phase === 'passed' && state.manifestUrl" class="log-actions">
        <a class="btn btn-primary" :href="state.stremioUrl">Open in Stremio</a>
        <button type="button" class="btn" @click="copyManifest">{{ copyLabel }}</button>
      </div>
    </div>

    <p v-if="state.phase === 'passed'" class="check-foot">Stremio keeps addons in your account, so the TV gets this one after you sign in there.</p>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useSourceCheck, type RowStatus } from '../composables/useSourceCheck'

const { state, elapsedMs } = useSourceCheck()

const STATUS_TEXT: Record<RowStatus, string> = { ok: 'OK', skip: 'SKIP', fail: 'FAIL', run: '···' }

const seconds = computed(() => `${(elapsedMs.value / 1000).toFixed(1)} s`)
const runningDetail = computed(() => seconds.value)

const pillText = computed(() => {
  switch (state.phase) {
    case 'running': return `RUNNING · ${seconds.value}`
    case 'passed': return `PASSED · ${seconds.value}`
    case 'failed': return `FAILED · ${seconds.value}`
    default: return 'NOT RUN'
  }
})

const fmt = new Intl.NumberFormat('en-US')
function count(n: number | undefined) {
  return n === undefined ? '–' : fmt.format(n)
}

function clock(ms: number) {
  return new Date(ms).toLocaleTimeString('en-GB', { hour12: false })
}

const copyLabel = ref('Copy manifest URL')
async function copyManifest() {
  try {
    await navigator.clipboard.writeText(state.manifestUrl)
    copyLabel.value = 'Copied'
  } catch {
    copyLabel.value = 'Copy failed'
  }
  setTimeout(() => { copyLabel.value = 'Copy manifest URL' }, 1600)
}
</script>
