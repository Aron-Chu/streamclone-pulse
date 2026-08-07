import { useEffect, useState } from 'react'

const buildMeta = typeof __STREAMPULSE_BUILD_META__ === 'undefined' ? null : __STREAMPULSE_BUILD_META__

/**
 * Development-only identity surface. It intentionally renders hashes and
 * checkout state, never paths, environment values, hostnames, or tokens.
 */
export function BuildIdentityBanner() {
  const [identity, setIdentity] = useState(buildMeta)

  useEffect(() => {
    if (!import.meta.env.DEV || !buildMeta) return
    let active = true
    void fetch('/healthz', { cache: 'no-store' })
      .then(response => (response.ok ? response.json() : null))
      .then(payload => {
        if (!active || !payload || typeof payload !== 'object') return
        const candidate = payload as Partial<NonNullable<typeof buildMeta>>
        if (typeof candidate.buildId === 'string' && candidate.buildId.trim()) {
          setIdentity(current =>
            current
              ? {
                  ...current,
                  repository: candidate.repository ?? current.repository,
                  commit: candidate.commit ?? current.commit,
                  dirty: candidate.dirty ?? current.dirty,
                  dirtyTreeHash: candidate.dirtyTreeHash ?? current.dirtyTreeHash,
                  sourceFingerprint: candidate.sourceFingerprint ?? current.sourceFingerprint,
                  packageCohortFingerprint: candidate.packageCohortFingerprint ?? current.packageCohortFingerprint,
                  snapshotId: candidate.snapshotId ?? current.snapshotId,
                  mode: candidate.mode ?? current.mode,
                  buildId: candidate.buildId ?? current.buildId,
                  builtAt: candidate.builtAt ?? current.builtAt,
                }
              : current,
          )
        }
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  if (!import.meta.env.DEV || !identity) return null
  return (
    <aside
      aria-label="Development build identity"
      style={{
        background: '#17151f',
        border: '1px solid #3d3453',
        borderRadius: 6,
        color: '#c4b5fd',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: 10,
        lineHeight: 1.4,
        margin: '8px auto',
        maxWidth: 980,
        padding: '5px 9px',
      }}
    >
      <strong>{identity.buildId}</strong> · {identity.mode} · {identity.dirty ? 'dirty' : 'clean'} · input{' '}
      {identity.sourceFingerprint.slice(0, 12)} · cohort {identity.packageCohortFingerprint.slice(0, 12)}
      {identity.snapshotId ? ` · snapshot ${identity.snapshotId}` : ''}
    </aside>
  )
}
