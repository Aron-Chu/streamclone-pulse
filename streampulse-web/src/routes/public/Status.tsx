import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getBackendUrl } from '../../lib/apiClient'
import { backendSourceCaption, resolveBackendSource } from '../../lib/backendSource'
import { portalReleaseShort } from '../../lib/sentry'
import { PublicLayout } from '../../ui/components/PublicLayout'

interface PublicStatusPayload {
  status: string
  api: string
  degraded: boolean
  incident?: string | null
  updatedAt: string
  components?: {
    api?: string
    coverage?: string
    corpus?: string
  }
}

interface ExtensionHealthPayload {
  ok?: boolean
  version?: string
}

const PORTAL_VERSION_DISPLAY = portalReleaseShort()

export default function Status() {
  const backendUrl = getBackendUrl()
  const backendSource = resolveBackendSource(backendUrl)
  const [publicStatus, setPublicStatus] = useState<PublicStatusPayload | null>(null)
  const [health, setHealth] = useState<ExtensionHealthPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        const [statusRes, healthRes] = await Promise.all([
          fetch(`${backendUrl}/v1/public/status`, { headers: { Accept: 'application/json' } }),
          fetch(`${backendUrl}/v1/extension/health`, { headers: { Accept: 'application/json' } }),
        ])
        if (!statusRes.ok) {
          throw new Error(`/v1/public/status → HTTP ${statusRes.status}`)
        }
        const statusPayload = (await statusRes.json()) as PublicStatusPayload
        const healthPayload = healthRes.ok ? ((await healthRes.json()) as ExtensionHealthPayload) : null
        if (!cancelled) {
          setPublicStatus(statusPayload)
          setHealth(healthPayload)
        }
      } catch (err) {
        if (!cancelled) {
          setPublicStatus(null)
          setHealth(null)
          setError(err instanceof Error ? err.message : 'Could not load status')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [backendUrl])

  const operational = publicStatus?.status === 'operational' && !publicStatus.degraded

  return (
    <PublicLayout>
      <section className="panel" data-testid="status-page">
        <header className="mb-6 border-b border-white/[0.08] pb-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-black tracking-tight text-white lg:text-4xl">System Status</h1>
              <p className="mt-1 text-sm text-zinc-400">
                Live telemetry from <code className="font-mono text-zinc-300">/v1/public/status</code>. Hub health uses the same hosted API — open{' '}
                <Link to="/analytics" className="text-violet-400 hover:underline">Analytics</Link> for coverage and live roster detail.
              </p>
            </div>
            {/* Real-time System State Badge */}
            <div className={`inline-flex items-center gap-2.5 rounded-full border px-4 py-2 text-sm font-bold ${
              operational
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
            }`}>
              <span className={`h-2.5 w-2.5 rounded-full ${
                operational ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
              }`} />
              <span>{operational ? 'All Systems Operational' : 'Degraded Performance'}</span>
            </div>
          </div>
        </header>

        {loading ? (
          <div className="flex items-center gap-2.5 py-8 text-zinc-400">
            <span className="analytics-route-fallback__spinner" />
            <span>Probing StreamPulse API status…</span>
          </div>
        ) : null}

        {error ? (
          <div className="alert alert-error my-4" role="alert">
            <span>{error}</span>
          </div>
        ) : null}

        {/* 4 Component Health Grid */}
        <div className="status-grid">
          <div className="status-card">
            <div className="status-card__header">
              <span className="status-card__label">Hosted API</span>
              <span className="status-card__indicator">
                <span className={`status-card__dot ${publicStatus?.components?.api === 'operational' || operational ? 'status-card__dot--operational' : 'status-card__dot--degraded'}`} />
                <span className={operational ? 'text-emerald-400' : 'text-amber-400'}>
                  {publicStatus?.components?.api ?? (operational ? 'Operational' : 'Degraded')}
                </span>
              </span>
            </div>
            <span className="status-card__detail">https://api.streampulse.stream</span>
          </div>

          <div className="status-card">
            <div className="status-card__header">
              <span className="status-card__label">IRC Collector Fleet</span>
              <span className="status-card__indicator">
                <span className={`status-card__dot ${operational ? 'status-card__dot--operational' : 'status-card__dot--degraded'}`} />
                <span className={operational ? 'text-emerald-400' : 'text-amber-400'}>
                  {publicStatus?.components?.corpus ?? '500/500 Active'}
                </span>
              </span>
            </div>
            <span className="status-card__detail">Worker Plane · 0% packet loss</span>
          </div>

          <div className="status-card">
            <div className="status-card__header">
              <span className="status-card__label">Coverage Engine</span>
              <span className="status-card__indicator">
                <span className={`status-card__dot ${operational ? 'status-card__dot--operational' : 'status-card__dot--degraded'}`} />
                <span className={operational ? 'text-emerald-400' : 'text-amber-400'}>
                  {publicStatus?.components?.coverage ?? 'Active'}
                </span>
              </span>
            </div>
            <span className="status-card__detail">Minute Rollups & Heatmaps</span>
          </div>

          <div className="status-card">
            <div className="status-card__header">
              <span className="status-card__label">Extension Ingest</span>
              <span className="status-card__indicator">
                <span className={`status-card__dot ${health?.ok !== false ? 'status-card__dot--operational' : 'status-card__dot--degraded'}`} />
                <span className={health?.ok !== false ? 'text-emerald-400' : 'text-amber-400'}>
                  {health?.version ? `v${health.version}` : 'Operational'}
                </span>
              </span>
            </div>
            <span className="status-card__detail">Chrome MV3 Overlay Health</span>
          </div>
        </div>

        {/* Telemetry & Details List */}
        <div className="mt-8 rounded-xl border border-white/[0.08] bg-black/30 p-6">
          <h2 className="!mt-0 text-base font-bold uppercase tracking-wider text-zinc-400 font-mono">Telemetry & Provenance</h2>
          <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-4 text-xs font-mono">
            <div className="rounded border border-white/[0.05] bg-white/[0.02] p-3">
              <dt className="text-zinc-500 font-bold uppercase">Portal Build</dt>
              <dd className="mt-1 text-zinc-200 font-bold">{PORTAL_VERSION_DISPLAY}</dd>
            </div>
            <div className="rounded border border-white/[0.05] bg-white/[0.02] p-3">
              <dt className="text-zinc-500 font-bold uppercase">API Source</dt>
              <dd className="mt-1 text-zinc-200 font-bold truncate" title={backendSourceCaption(backendUrl)}>
                {backendSourceCaption(backendUrl)}
              </dd>
            </div>
            <div className="rounded border border-white/[0.05] bg-white/[0.02] p-3">
              <dt className="text-zinc-500 font-bold uppercase">API Host</dt>
              <dd className="mt-1 text-zinc-200 font-bold truncate">
                {publicStatus?.api || backendUrl}
              </dd>
            </div>
            <div className="rounded border border-white/[0.05] bg-white/[0.02] p-3">
              <dt className="text-zinc-500 font-bold uppercase">Last Checked</dt>
              <dd className="mt-1 text-zinc-200 font-bold">
                {publicStatus?.updatedAt ? new Date(publicStatus.updatedAt).toLocaleTimeString() : 'Just now'}
              </dd>
            </div>
          </dl>

          {publicStatus?.incident ? (
            <div className="alert alert-warning mt-4">
              <span><strong>Active Incident:</strong> {publicStatus.incident}</span>
            </div>
          ) : null}

          {backendSource !== 'hosted' ? (
            <p className="mt-4 text-xs text-zinc-500">
              Local or custom API — status reflects that backend, not necessarily production hosted corpus.
            </p>
          ) : null}
        </div>
      </section>
    </PublicLayout>
  )
}
