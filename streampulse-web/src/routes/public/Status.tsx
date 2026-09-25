import { useEffect, useState } from 'react'
import { measurementTimeMs } from '@streampulse/pulse-core'
import { Link } from 'react-router-dom'
import { apiClient, getBackendUrl } from '../../lib/apiClient'
import { backendSourceCaption, resolveBackendSource } from '../../lib/backendSource'
import { portalReleaseShort } from '../../lib/sentry'
import { PublicLayout } from '../../ui/components/PublicLayout'

interface PublicStatusPayload {
  status?: string; api?: string; degraded?: boolean; incident?: string | null; updatedAt?: string
  components?: { api?: string; coverage?: string; corpus?: string }
}
interface ExtensionHealthPayload { ok?: boolean; version?: string }
type ProbeResult<T> = { data: T | null; error: string | null }
type State = 'operational' | 'degraded' | 'unavailable' | 'unknown'

const PORTAL_VERSION_DISPLAY = portalReleaseShort()

function normalizedState(value: unknown): State {
  if (typeof value !== 'string') return 'unknown'
  const state = value.trim().toLowerCase()
  if (['up', 'ok', 'healthy', 'active', 'operational'].includes(state)) return 'operational'
  if (['down', 'offline', 'failed', 'unavailable'].includes(state)) return 'unavailable'
  if (['degraded', 'partial', 'stale'].includes(state)) return 'degraded'
  return 'unknown'
}
function stateLabel(state: State) {
  return state === 'operational' ? 'Operational' : state === 'degraded' ? 'Degraded' : state === 'unavailable' ? 'Unavailable' : 'Unknown'
}
function safeDataTime(value?: string): string {
  const timestamp = measurementTimeMs(value)
  return timestamp != null ? new Date(timestamp).toLocaleString() : 'Unknown'
}
function versionLabel(value?: string): string {
  const clean = value?.trim().replace(/^v+/i, '')
  return clean ? `v${clean}` : 'Unknown'
}
async function probeJson<T>(url: string, signal: AbortSignal): Promise<ProbeResult<T>> {
  try {
    const response = await apiClient<T>(url, { signal, timeoutMs: 8_000, maxResponseBytes: 64 * 1024 })
    return { data: response.data, error: null }
  } catch (error) {
    return { data: null, error: signal.aborted ? 'Status probe timed out' : error instanceof Error ? error.message : 'Status probe failed' }
  }
}

export default function Status() {
  const backendUrl = getBackendUrl().replace(/\/+$/, '')
  const backendSource = resolveBackendSource(backendUrl)
  const [statusProbe, setStatusProbe] = useState<ProbeResult<PublicStatusPayload>>({ data: null, error: null })
  const [healthProbe, setHealthProbe] = useState<ProbeResult<ExtensionHealthPayload>>({ data: null, error: null })
  const [checkedAt, setCheckedAt] = useState<Date | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 8_000)
    let cancelled = false
    void Promise.all([
      probeJson<PublicStatusPayload>(`${backendUrl}/v1/public/status`, controller.signal),
      probeJson<ExtensionHealthPayload>(`${backendUrl}/v1/extension/health`, controller.signal),
    ]).then(([status, health]) => {
      if (cancelled) return
      setStatusProbe(status); setHealthProbe(health); setCheckedAt(new Date()); setLoading(false)
    }).finally(() => window.clearTimeout(timeout))
    return () => { cancelled = true; window.clearTimeout(timeout); controller.abort() }
  }, [backendUrl])

  const statusState: State = statusProbe.error ? 'unavailable' : normalizedState(statusProbe.data?.status)
  const componentStates = Object.values(statusProbe.data?.components ?? {}).map(normalizedState)
  const overall: State = loading ? 'unknown'
    : statusProbe.error || healthProbe.error || componentStates.includes('unavailable') ? 'unavailable'
    : statusProbe.data?.degraded || healthProbe.data?.ok === false || componentStates.includes('degraded') ? 'degraded'
    : statusState === 'operational' && healthProbe.data?.ok === true ? 'operational' : statusState === 'operational' ? 'unknown' : statusState
  const errors = [statusProbe.error, healthProbe.error].filter(Boolean)
  const card = (label: string, state: State, detail: string) => <div className="status-card">
    <div className="status-card__header"><span className="status-card__label">{label}</span><span className="status-card__indicator">
      <span className={`status-card__dot ${state === 'operational' ? 'status-card__dot--operational' : 'status-card__dot--degraded'}`} />
      <span className={state === 'operational' ? 'text-emerald-400' : state === 'unknown' ? 'text-zinc-400' : 'text-amber-400'}>{stateLabel(state)}</span>
    </span></div><span className="status-card__detail">{detail}</span>
  </div>

  return <PublicLayout><section className="panel" data-testid="status-page">
    <header className="mb-6 border-b border-white/[0.08] pb-6"><div className="flex flex-wrap items-center justify-between gap-4">
      <div><h1 className="text-3xl font-black tracking-tight text-white lg:text-4xl">System Status</h1><p className="mt-1 text-sm text-zinc-400">Public service health. Open <Link to="/analytics" className="text-violet-400 hover:underline">Analytics</Link> for coverage detail.</p></div>
      <div className={`inline-flex items-center gap-2.5 rounded-full border px-4 py-2 text-sm font-bold ${overall === 'operational' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : overall === 'unknown' ? 'border-white/15 bg-white/5 text-zinc-300' : 'border-amber-500/30 bg-amber-500/10 text-amber-300'}`}>
        <span>{loading ? 'Checking systems…' : overall === 'operational' ? 'Reported Services Operational' : overall === 'degraded' ? 'Degraded Performance' : overall === 'unavailable' ? 'Status Unavailable' : 'Status Unknown'}</span>
      </div>
    </div></header>
    {loading ? <div className="flex items-center gap-2.5 py-8 text-zinc-400"><span className="analytics-route-fallback__spinner" /><span>Probing StreamPulse services…</span></div> : null}
    {errors.length ? <div className="alert alert-error my-4" role="alert">Some checks could not be completed: {errors.join('; ')}</div> : null}
    <div className="status-grid">
      {card('Hosted API', loading ? 'unknown' : statusProbe.error ? 'unavailable' : normalizedState(statusProbe.data?.components?.api ?? statusProbe.data?.api), backendSourceCaption(backendUrl))}
      {card('IRC collection', loading ? 'unknown' : statusProbe.error ? 'unavailable' : normalizedState(statusProbe.data?.components?.corpus), 'Public status does not expose fleet counts or packet loss')}
      {card('Coverage Engine', loading ? 'unknown' : statusProbe.error ? 'unavailable' : normalizedState(statusProbe.data?.components?.coverage), 'Minute rollups and heatmaps')}
      {card('Extension Ingest', loading ? 'unknown' : healthProbe.error ? 'unavailable' : healthProbe.data?.ok === true ? 'operational' : healthProbe.data?.ok === false ? 'degraded' : 'unknown', `API version ${versionLabel(healthProbe.data?.version)}`)}
    </div>
    <div className="mt-8 rounded-xl border border-white/[0.08] bg-black/30 p-6"><h2 className="!mt-0 text-base font-bold uppercase tracking-wider text-zinc-400 font-mono">Telemetry &amp; Provenance</h2>
      <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-4 text-xs font-mono">
        <div><dt className="text-zinc-500 font-bold uppercase">Portal Build</dt><dd className="mt-1 text-zinc-200 font-bold">{PORTAL_VERSION_DISPLAY}</dd></div>
        <div><dt className="text-zinc-500 font-bold uppercase">API Source</dt><dd className="mt-1 text-zinc-200 font-bold">{backendSourceCaption(backendUrl)}</dd></div>
        <div><dt className="text-zinc-500 font-bold uppercase">Checked at</dt><dd className="mt-1 text-zinc-200 font-bold">{checkedAt ? checkedAt.toLocaleString() : 'Not checked yet'}</dd></div>
        <div><dt className="text-zinc-500 font-bold uppercase">Data as of</dt><dd className="mt-1 text-zinc-200 font-bold">{safeDataTime(statusProbe.data?.updatedAt)}</dd></div>
      </dl>
      {statusProbe.data?.incident ? <div className="alert alert-warning mt-4"><strong>Active incident:</strong> {statusProbe.data.incident}</div> : null}
      {backendSource !== 'hosted' ? <p className="mt-4 text-xs text-zinc-500">Local or custom API — status reflects that backend, not necessarily production.</p> : null}
    </div>
  </section></PublicLayout>
}
