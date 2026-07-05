#!/usr/bin/env node
/**
 * IRC + corpus status against the configured hosted API (default: api.streampulse.stream).
 * Usage: npm run status:hosted
 */

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_API = 'https://api.streampulse.stream'

function readBackendUrl() {
  for (const name of ['.env.development.local', '.env.local', '.env']) {
    const path = resolve(webRoot, name)
    if (!existsSync(path)) continue
    const text = readFileSync(path, 'utf8')
    const match = text.match(/^VITE_BACKEND_URL=(.+)$/m)
    if (match) return match[1].trim().replace(/^["']|["']$/g, '').replace(/\/+$/, '')
  }
  return process.env.VITE_BACKEND_URL?.trim().replace(/\/+$/, '') || DEFAULT_API
}

async function fetchJson(url) {
  const started = Date.now()
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12_000) })
  const latencyMs = Date.now() - started
  if (!res.ok) {
    throw new Error(`${url} → HTTP ${res.status}`)
  }
  return { data: await res.json(), latencyMs }
}

function line(label, value) {
  console.log(`  ${label.padEnd(22)} ${value}`)
}

const base = readBackendUrl()
console.log(`\nStreamPulse hosted status\n  API: ${base}\n`)

try {
  const { data: health, latencyMs: healthMs } = await fetchJson(`${base}/v1/extension/health`)
  line('Extension health', health.ok ? `OK (${healthMs}ms)` : 'FAIL')
  line('Version', health.version ?? '—')
  const deg = health.degraded ?? {}
  line(
    'Degraded flags',
    Object.entries(deg)
      .filter(([, v]) => v)
      .map(([k]) => k)
      .join(', ') || 'none',
  )
  line('Live tracking', String(health.capabilities?.liveTracking ?? '—'))
} catch (err) {
  console.error(`  Extension health FAIL: ${err instanceof Error ? err.message : err}`)
  process.exitCode = 1
}

try {
  const { data: hub, latencyMs: hubMs } = await fetchJson(`${base}/v1/public/hub`)
  const pipe = hub.corpusPipeline ?? {}
  const roster = pipe.roster ?? {}
  const cov = hub.coverage ?? {}
  const corpus = hub.corpus ?? {}

  console.log('\nIRC (live collector)')
  line('Hub latency', `${hubMs}ms`)
  line('Pipeline state', pipe.state ?? '—')
  line('Collector active', `${pipe.collectorActive ?? '—'} / ${pipe.collectorMax ?? '—'}`)
  line('Live roster rows', String(roster.live ?? '—'))
  line('Tracking rows', String(roster.collectorTracking ?? '—'))
  line('Collector deficit', String(roster.liveCollectorDeficitRows ?? '—'))
  line('Metadata stale', String(roster.metadataStale ?? '—'))
  line('Warming (hub KPI)', String(roster.warming ?? '—'))
  line('Collecting (hub KPI)', String(roster.collecting ?? '—'))
  line('Coverage state', cov.state ?? '—')
  line('Live channels (cov)', String(cov.liveChannels ?? '—'))

  console.log('\nCorpus (aggregates)')
  line('Streams tracked', String(corpus.streamsTracked ?? '—'))
  line('Chat processed', String(corpus.chatMessagesProcessed ?? '—'))
  line('VODs analyzed', String(corpus.vodsAnalyzed ?? '—'))
  line('Emotes indexed', String(corpus.emotesIndexed ?? '—'))
  line('Silver jobs', formatTier(pipe.silver))
  line('Gold jobs', formatTier(pipe.gold))
  line('Hub live rows', String((hub.liveChannels ?? []).length))
  line('Activity points', String((hub.activity?.points ?? []).length))
} catch (err) {
  console.error(`  Hub/corpus FAIL: ${err instanceof Error ? err.message : err}`)
  process.exitCode = 1
}

try {
  const { data: live, latencyMs } = await fetchJson(
    `${base}/v1/portal/analytics/channels/xqc/live`,
  )
  line('\nSample channel (xqc)', `HTTP OK (${latencyMs}ms)`)
  line('  state', live.state ?? '—')
  line('  rollup buckets', String(live.rollups?.length ?? 0))
} catch (err) {
  console.error(`  Portal sample FAIL: ${err instanceof Error ? err.message : err}`)
  process.exitCode = 1
}

console.log('\nDev backend hints')
line('Portal env file', existsSync(resolve(webRoot, '.env.development.local')) ? 'present' : 'missing (uses code default)')
line('Expected VITE_BACKEND_URL', base)
console.log(
  '\nIf charts still load localhost data in the browser, clear sessionStorage:\n  sessionStorage.removeItem("sp.backendUrlOverride")\n',
)

function formatTier(tier) {
  if (!tier) return '—'
  return `done ${tier.done ?? 0}, failed ${tier.failed ?? 0}, queued ${tier.queued ?? 0}, running ${tier.running ?? 0}`
}
