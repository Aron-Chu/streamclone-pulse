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
type ProbeResult<T> = { data: T | null; error: string | null; unchecked?: boolean }
/** The overall line when the service runs and only coverage or chat tracking is behind. */
export const QUIET_ONLY_LINE = 'Running · a few channels are quiet'

// 'unchecked' is this browser failing to ask (timeout, no network), not the service being down.
type State = 'operational' | 'degraded' | 'unavailable' | 'unchecked' | 'unknown'

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
  return state === 'operational' ? 'Working' : state === 'degraded' ? 'Slow' : state === 'unavailable' ? 'Down' : state === 'unchecked' ? "Couldn't check" : 'Unknown'
}
/** The worst of several states; an unknown one is never read as working. */
function worstState(states: State[]): State {
  for (const state of ['unavailable', 'unchecked', 'degraded', 'unknown'] as const) if (states.includes(state)) return state
  return 'operational'
}
function safeDataTime(value?: string): string {
  const timestamp = measurementTimeMs(value)
  return timestamp != null ? new Date(timestamp).toLocaleString() : 'Unknown'
}
function versionLabel(value?: unknown): string {
  const clean = typeof value === 'string' ? value.trim().replace(/^v+/i, '') : ''
  return clean ? `v${clean}` : 'Unknown'
}
async function probeJson<T>(url: string, signal: AbortSignal): Promise<ProbeResult<T>> {
  try {
    const response = await apiClient<T>(url, { signal, timeoutMs: 8_000, maxResponseBytes: 64 * 1024 })
    return { data: response.data, error: null }
  } catch (error) {
    const kind = (error as { kind?: unknown } | null)?.kind
    const unchecked = signal.aborted || kind === 'timeout' || kind === 'unreachable' || kind === 'aborted'
    return { data: null, error: signal.aborted ? 'Status probe timed out' : error instanceof Error ? error.message : 'Status probe failed', unchecked }
  }
}

export default function Status() {
  const backendUrl = getBackendUrl().replace(/\/+$/, '')
  const backendSource = resolveBackendSource(backendUrl)
  const [statusProbe, setStatusProbe] = useState<ProbeResult<PublicStatusPayload>>({ data: null, error: null })
  const [healthProbe, setHealthProbe] = useState<ProbeResult<ExtensionHealthPayload>>({ data: null, error: null })
  const [checkedAt, setCheckedAt] = useState<Date | null>(null)
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)

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
  }, [backendUrl, attempt])

  const probeState = (probe: ProbeResult<unknown>): State => probe.unchecked ? 'unchecked' : 'unavailable'
  const statusState: State = statusProbe.error ? probeState(statusProbe) : normalizedState(statusProbe.data?.status)
  const componentStates = Object.values(statusProbe.data?.components ?? {}).map(normalizedState)
  const probeFailures = [statusProbe, healthProbe].filter(probe => probe.error)
  const overall: State = loading ? 'unknown'
    : probeFailures.some(probe => !probe.unchecked) || componentStates.includes('unavailable') ? 'unavailable'
    : probeFailures.length ? 'unchecked'
    : statusProbe.data?.degraded || healthProbe.data?.ok === false || componentStates.includes('degraded') ? 'degraded'
    : statusState === 'operational' && healthProbe.data?.ok === true ? 'operational' : statusState === 'operational' ? 'unknown' : statusState
  const errors = [statusProbe.error, healthProbe.error].filter(Boolean)
  // Only coverage or chat tracking is behind while the API and the panel answer: the service is
  // running and some channels are quiet. That reads neutral, not as an outage; amber stays for Down.
  const components = statusProbe.data?.components ?? {}
  // A top-level "down" still reads as Down, never as a quiet line.
  const quietOnly = overall === 'degraded' && statusState !== 'unavailable' && healthProbe.data?.ok === true &&
    normalizedState(components.api ?? statusProbe.data?.api ?? 'operational') === 'operational' &&
    (['coverage', 'corpus'] as const).some((key) => normalizedState(components[key]) === 'degraded') &&
    Object.entries(components).every(([key, value]) => key === 'coverage' || key === 'corpus' || normalizedState(value) === 'operational')
  const fromStatus = (value: unknown): State => loading ? 'unknown' : statusProbe.error ? probeState(statusProbe) : normalizedState(value)
  const websiteState = fromStatus(statusProbe.data?.components?.api ?? statusProbe.data?.api)
  const chatTrackingState = fromStatus(statusProbe.data?.components?.corpus)
  // What the Twitch panel shows comes from the extension API and the coverage engine behind it.
  const panelState = worstState([
    loading ? 'unknown' : healthProbe.error ? probeState(healthProbe) : healthProbe.data?.ok === true ? 'operational' : healthProbe.data?.ok === false ? 'degraded' : 'unknown',
    fromStatus(statusProbe.data?.components?.coverage),
  ])
  const dotClass = (state: State) => state === 'operational' ? 'status-card__dot--operational' : state === 'degraded' ? 'status-card__dot--degraded' : state === 'unavailable' ? 'status-card__dot--down' : 'status-card__dot--unchecked'
  const textClass = (state: State) => state === 'operational' ? 'text-emerald-400' : state === 'degraded' ? 'text-amber-400' : state === 'unavailable' ? 'text-red-400' : 'text-zinc-400'
  const row = (label: string, state: State) => <div className="status-card">
    <div className="status-card__header"><span className="status-card__label">{label}</span><span className="status-card__indicator">
      <span className={`status-card__dot ${dotClass(state)}`} />
      <span className={textClass(state)}>{stateLabel(state)}</span>
    </span></div>
  </div>
  const couldntCheck = !loading && probeFailures.some(probe => probe.unchecked)

  return <PublicLayout><section className="panel" data-testid="status-page">
    <header className="mb-6 border-b border-white/[0.08] pb-6"><div className="flex flex-wrap items-center justify-between gap-4">
      <div><h1 className="public-title">System Status</h1><p className="mt-1 text-sm text-zinc-400">Public service health. Open the <Link to="/analytics" className="public-inline-link">Hub</Link> for coverage detail.</p></div>
      <div data-testid="status-overall" className={`inline-flex items-center gap-2.5 rounded-full border px-4 py-2 text-sm font-bold ${overall === 'operational' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : overall === 'unknown' || overall === 'unchecked' || quietOnly ? 'border-white/15 bg-white/5 text-zinc-300' : overall === 'unavailable' ? 'border-red-500/30 bg-red-500/10 text-red-300' : 'border-amber-500/30 bg-amber-500/10 text-amber-300'}`}>
        <span>{loading ? 'Checking systems…' : quietOnly ? QUIET_ONLY_LINE : stateLabel(overall)}</span>
      </div>
    </div></header>
    {loading ? <div className="flex items-center gap-2.5 py-8 text-zinc-400"><span className="analytics-route-fallback__spinner" /><span>Probing StreamPulse services…</span></div> : null}
    {errors.length ? <div className="alert alert-error my-4" role="alert">Some checks could not be completed: {errors.join('; ')}</div> : null}
    {couldntCheck ? <button type="button" className="btn btn-secondary" onClick={() => { setLoading(true); setAttempt(value => value + 1) }}>Retry</button> : null}
    <div className="status-grid">
      {row('Website', websiteState)}
      {row('Live chat tracking', chatTrackingState)}
      {row('Twitch panel data', panelState)}
    </div>
    {checkedAt ? <p className="mt-4 text-sm text-zinc-400" data-testid="status-checked">Checked {checkedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</p> : null}
    {typeof statusProbe.data?.incident === 'string' && statusProbe.data.incident ? <div className="alert alert-warning mt-4"><strong>Active incident:</strong> {statusProbe.data.incident}</div> : null}
    <details className="mt-8 rounded-lg border border-white/[0.08] px-4 py-3" data-testid="status-details">
      <summary className="cursor-pointer font-semibold text-zinc-200">Details</summary>
      <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-4 text-xs font-mono">
        <div><dt className="text-zinc-400 font-bold uppercase">Portal Build</dt><dd className="mt-1 text-zinc-200 font-bold">{PORTAL_VERSION_DISPLAY}</dd></div>
        <div><dt className="text-zinc-400 font-bold uppercase">API Source</dt><dd className="mt-1 text-zinc-200 font-bold">{backendSourceCaption(backendUrl)}</dd></div>
        <div><dt className="text-zinc-400 font-bold uppercase">Checked at</dt><dd className="mt-1 text-zinc-200 font-bold">{checkedAt ? checkedAt.toLocaleString() : 'Not checked yet'}</dd></div>
        <div><dt className="text-zinc-400 font-bold uppercase">Data as of</dt><dd className="mt-1 text-zinc-200 font-bold">{safeDataTime(statusProbe.data?.updatedAt)}</dd></div>
      </dl>
      <p className="mt-4 text-xs text-zinc-300 font-mono">{`API version ${versionLabel(healthProbe.data?.version)}`}</p>
      <p className="mt-4 text-xs text-zinc-400">Public status does not expose fleet counts or packet loss</p>
      {backendSource !== 'hosted' ? <p className="mt-4 text-xs text-zinc-400">Local or custom API — status reflects that backend, not necessarily production.</p> : null}
    </details>
  </section></PublicLayout>
}
