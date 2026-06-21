import { formatHeatOffset, LIVE_HEAT_MIN_COMPLETED_ROLLUPS, LIVE_HEAT_TITLE } from '@streamclone/pulse-core'
import type { PulsePayload } from '../shared/messages.ts'

interface OverlayProps {
  login: string
  payload: PulsePayload | null
  error?: string
}

export function Overlay({ login, payload, error }: OverlayProps) {
  const peaks = payload?.peaks ?? []
  const warming = payload && peaks.length === 0 && (payload.rollups?.length ?? 0) < LIVE_HEAT_MIN_COMPLETED_ROLLUPS

  return (
    <div>
      <header style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 11, opacity: 0.65, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Streamclone Pulse
        </div>
        <div style={{ fontSize: 16, fontWeight: 600 }}>{login}</div>
        <div style={{ fontSize: 12, opacity: 0.75 }}>
          {payload?.tracking ? 'Tracking' : 'Not tracking'}
          {payload?.isLive ? ' · Live' : ''}
        </div>
      </header>

      {error ? (
        <p style={{ color: '#fca5a5', fontSize: 13 }}>{error}</p>
      ) : null}

      {warming ? (
        <p style={{ fontSize: 13, opacity: 0.85 }}>
          Warming up — need at least {LIVE_HEAT_MIN_COMPLETED_ROLLUPS} completed minutes before Top Moments appear.
        </p>
      ) : null}

      {!error && peaks.length > 0 ? (
        <section>
          <h2 style={{ fontSize: 13, margin: '0 0 8px', fontWeight: 600 }}>{LIVE_HEAT_TITLE}</h2>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
            {peaks.map(peak => (
              <li
                key={`${peak.offsetSeconds}-${peak.score}`}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 8,
                  fontSize: 13,
                  padding: '8px 10px',
                  borderRadius: 8,
                  background: 'rgba(255,255,255,0.04)',
                }}
              >
                <span>{formatHeatOffset(peak.offsetSeconds)}</span>
                <span style={{ opacity: 0.8 }}>{peak.dominantSignal}</span>
                <strong>{peak.score}</strong>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {!error && !warming && peaks.length === 0 ? (
        <p style={{ fontSize: 13, opacity: 0.75 }}>No peaks yet for this channel.</p>
      ) : null}
    </div>
  )
}
