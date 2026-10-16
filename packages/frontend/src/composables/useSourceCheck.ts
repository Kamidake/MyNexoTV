import { computed, reactive, readonly } from 'vue'
import { buildAddonUrls } from './useConfigToken'
import type { AddonConfig, CheckResult, CheckStep } from '../types/config'

export type RowStatus = CheckStep['status'] | 'run'

export interface LogRow {
  key: string
  at: number
  status: RowStatus
  label: string
  detail: string
}

type Phase = 'idle' | 'running' | 'passed' | 'failed'

const state = reactive({
  phase: 'idle' as Phase,
  rows: [] as LogRow[],
  result: null as CheckResult | null,
  startedAt: 0,
  finishedAt: 0,
  now: 0,
  manifestUrl: '',
  stremioUrl: '',
})

let ticker: ReturnType<typeof setInterval> | null = null
let runId = 0

function stopTicker() {
  if (ticker) clearInterval(ticker)
  ticker = null
}

function replaceRow(key: string, row: Omit<LogRow, 'key'>) {
  const i = state.rows.findIndex(r => r.key === key)
  if (i >= 0) state.rows.splice(i, 1, { key, ...row })
  else state.rows.push({ key, ...row })
}

function finish(phase: Phase) {
  state.phase = phase
  state.finishedAt = Date.now()
  stopTicker()
}

function failRow(key: string, label: string, detail: string) {
  replaceRow(key, { at: Date.now(), status: 'fail', label, detail })
  finish('failed')
}

/** Encodes the config, asks the server to build the addon, and logs every step. */
async function run(config: AddonConfig): Promise<CheckResult | null> {
  const id = ++runId
  stopTicker()
  state.rows = []
  state.result = null
  state.manifestUrl = ''
  state.stremioUrl = ''
  state.phase = 'running'
  state.startedAt = Date.now()
  state.now = state.startedAt
  ticker = setInterval(() => { state.now = Date.now() }, 100)

  replaceRow('link', { at: Date.now(), status: 'run', label: 'Addon link', detail: '' })
  const urls = await buildAddonUrls(config)
  if (id !== runId) return null
  replaceRow('link', urls.encrypted
    ? { at: Date.now(), status: 'ok', label: 'Addon link encrypted', detail: 'AES-256-GCM' }
    : { at: Date.now(), status: 'skip', label: 'Addon link not encrypted', detail: 'This server has no CONFIG_SECRET, so the link holds the settings as plain text' })

  const sourceStarted = Date.now()
  replaceRow('source', { at: sourceStarted, status: 'run', label: 'Checking the source', detail: '' })

  let res: Response
  try {
    res = await fetch(`${urls.backendOrigin}/${urls.token}/check.json`, { cache: 'no-store' })
  } catch {
    if (id === runId) failRow('source', 'NexoTV server', 'Cannot reach the NexoTV server. Check your connection and try again.')
    return null
  }
  if (id !== runId) return null
  if (res.status === 429) {
    failRow('source', 'Rate limit', 'Too many checks with these settings. Wait a minute and try again.')
    return null
  }
  if (!res.ok) {
    failRow('source', 'NexoTV server', `The server could not build the addon (HTTP ${res.status}).`)
    return null
  }

  const result: CheckResult = await res.json()
  if (id !== runId) return null
  state.rows = state.rows.filter(r => r.key !== 'source')
  // Each step ended when the next began: count back from the arrival. A build from
  // the cache arrives sooner than its steps took, so its steps never start before the request.
  const arrived = Date.now()
  let at = arrived
  const stamped = [...result.steps].reverse().map(step => {
    const row = { key: `step-${step.id}`, at: Math.max(at, sourceStarted), status: step.status, label: step.label, detail: step.detail }
    at -= step.ms
    return row
  }).reverse()
  state.rows.push(...stamped)
  state.result = result
  if (result.ok) {
    state.manifestUrl = urls.manifestUrl
    state.stremioUrl = urls.stremioUrl
  }
  finish(result.ok ? 'passed' : 'failed')
  return result
}

function reset() {
  runId++
  stopTicker()
  state.phase = 'idle'
  state.rows = []
  state.result = null
  state.manifestUrl = ''
  state.stremioUrl = ''
}

const elapsedMs = computed(() => {
  if (state.phase === 'idle') return 0
  const end = state.phase === 'running' ? state.now : state.finishedAt
  return Math.max(0, end - state.startedAt)
})

export function useSourceCheck() {
  return { state: readonly(state), elapsedMs, run, reset }
}
