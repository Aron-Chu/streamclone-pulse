import { TrendingDown, TrendingUp } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { HubLiveChannel } from '../../../lib/publicHub'
import { buildAnalyticsHref } from '../../../lib/analyticsLinks'
import { compact } from './hubFormat'

export interface FigmaLiveSessionsTableProps {
  channels: HubLiveChannel[]
  compact?: boolean
}

function TrendArrow({ value }: { value: string }) {
  const up = !value.startsWith('-')
  const color = up ? 'var(--fma-green)' : 'var(--fma-red)'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color, fontFamily: 'var(--fma-mono)', fontSize: 11, fontWeight: 600 }}>
      {up ? <TrendingUp size={11} strokeWidth={2.5} /> : <TrendingDown size={11} strokeWidth={2.5} />}
      {value}
    </span>
  )
}

export function FigmaLiveSessionsTable({ channels, compact: compactMode }: FigmaLiveSessionsTableProps) {
  const rows = channels.slice(0, compactMode ? 5 : 8)

  return (
    <div className="figma-panel">
      <div className="figma-panel__head">
        <span className="figma-panel__head-label">Live sessions</span>
        <span style={{ fontFamily: 'var(--fma-mono)', fontSize: 9, color: 'var(--fma-accent-text)' }}>
          {rows.length} tracked
        </span>
      </div>
      {rows.length === 0 ? (
        <div className="figma-panel__body muted">No live sessions in the current window.</div>
      ) : (
        <table className="figma-table">
          <thead>
            <tr>
              {['Channel', 'Game', 'Viewers', 'Chat/m', 'Peak', 'Trend'].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((ch) => {
              const name = ch.displayName?.trim() || ch.login
              const trend = ch.emotesPerMin && ch.emotesPerMin > 0 ? `+${Math.min(99, Math.round(ch.emotesPerMin))}%` : '+0%'
              return (
                <tr key={ch.login}>
                  <td>
                    <Link
                      to={buildAnalyticsHref({ login: ch.login, streamId: ch.streamId })}
                      className="figma-channel-cell"
                    >
                      {ch.profileImageUrl ? (
                        <img src={ch.profileImageUrl} alt="" loading="lazy" decoding="async" />
                      ) : (
                        <span aria-hidden="true">{name.slice(0, 2).toUpperCase()}</span>
                      )}
                      <strong>{name}</strong>
                    </Link>
                  </td>
                  <td className="muted">{ch.category?.trim() || '—'}</td>
                  <td>{compact(ch.viewers)}</td>
                  <td style={{ color: 'var(--fma-accent-text)', fontFamily: 'var(--fma-mono)' }}>{compact(ch.chatPerMin)}/m</td>
                  <td style={{ fontFamily: 'var(--fma-mono)' }}>{compact(Math.max(ch.emotesPerMin ?? 0, ch.seventvPerMin ?? 0))}</td>
                  <td><TrendArrow value={trend} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
