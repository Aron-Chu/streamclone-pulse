import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getBackendUrl } from '../../lib/apiClient'
import { backendSourceCaption, resolveBackendSource } from '../../lib/backendSource'
import { PublicLayout } from '../../ui/components/PublicLayout'

interface PublicStatusPayload {
  status: string
  api: string
  degraded: boolean
  incident?: string | null
  updatedAt: string
}

interface ExtensionHealthPayload {
  ok?: boolean
  version?: string
}

const PORTAL_VERSION = import.meta.env.VITE_PORTAL_VERSION?.trim() || 'dev'

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
      <section className="panel">
        <h1>Status</h1>
        <p className="muted">
          Live data from <code>/v1/public/status</code>. Hub health uses the same hosted API — open{' '}
          <Link to="/analytics">Analytics</Link> for coverage and live roster detail.
        </p>

        <dl className="stack-sm" style={{ marginTop: '1rem' }}>
          <div>
            <dt className="muted">Portal build</dt>
            <dd>{PORTAL_VERSION}</dd>
          </div>
          <div>
            <dt className="muted">API source</dt>
            <dd>{backendSourceCaption(backendUrl)}</dd>
          </div>
        </dl>

        {loading ? <p className="muted">Loading status…</p> : null}
        {error ? (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        ) : null}

        {publicStatus ? (
          <div className="stack-md" style={{ marginTop: '1rem' }}>
            <p>
              <strong>{operational ? 'Operational' : 'Degraded'}</strong>
              {publicStatus.incident ? ` — ${publicStatus.incident}` : null}
            </p>
            <dl className="stack-sm">
              <div>
                <dt className="muted">Public status</dt>
                <dd>{publicStatus.status}</dd>
              </div>
              <div>
                <dt className="muted">API host</dt>
                <dd>{publicStatus.api || backendUrl}</dd>
              </div>
              <div>
                <dt className="muted">Degraded</dt>
                <dd>{publicStatus.degraded ? 'yes' : 'no'}</dd>
              </div>
              <div>
                <dt className="muted">Updated</dt>
                <dd>{publicStatus.updatedAt ? new Date(publicStatus.updatedAt).toLocaleString() : '—'}</dd>
              </div>
              {health?.version ? (
                <div>
                  <dt className="muted">Backend version</dt>
                  <dd>{health.version}</dd>
                </div>
              ) : null}
            </dl>
            {backendSource !== 'hosted' ? (
              <p className="muted">
                Local or custom API — status reflects that backend, not necessarily production hosted corpus.
              </p>
            ) : null}
          </div>
        ) : null}
      </section>
    </PublicLayout>
  )
}
