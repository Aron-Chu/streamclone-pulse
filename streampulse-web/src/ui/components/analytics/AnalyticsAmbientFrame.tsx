import { useMemo } from 'react'
import type { HubEmoteIntel, HubProviderShare } from '../../../lib/publicHub'
import { compact, emoteProviderColor, providerLabel } from './hubFormat'

export interface AnalyticsAmbientProps {
  emoteIntel: HubEmoteIntel
  liveCount: number
  channelCount: number
  loading?: boolean
}

/** Fixed grid backdrop - fills side margins on ultrawide viewports. */
export function AnalyticsAmbientBackdrop() {
  return (
    <div className="figma-analytics__ambient-bg" aria-hidden="true">
      <div className="figma-analytics__ambient-grid" />
      <div className="figma-analytics__scanline" />
    </div>
  )
}

function ProviderSpectrum({ shares, loading }: { shares: HubProviderShare[]; loading?: boolean }) {
  const rows = shares.length > 0
    ? shares.slice(0, 4)
    : [
        { provider: '7TV', sharePct: 0, count: 0 },
        { provider: 'Twitch', sharePct: 0, count: 0 },
        { provider: 'BTTV', sharePct: 0, count: 0 },
        { provider: 'FFZ', sharePct: 0, count: 0 },
      ]

  return (
    <div className="figma-side-rail__card" aria-label="Provider mix">
      <div className="figma-side-rail__card-head">
        <span>Provider mix</span>
        <small>rollup window</small>
      </div>
      <ul className="figma-side-rail__spectrum">
        {rows.map((row) => (
          <li key={row.provider}>
            <span className="figma-side-rail__spectrum-label">
              {providerLabel(row.provider)}
            </span>
            <div className="figma-side-rail__spectrum-track" aria-hidden="true">
              <span
                className="figma-side-rail__spectrum-fill"
                style={{
                  width: loading ? '0%' : `${Math.max(2, Math.min(100, row.sharePct))}%`,
                  background: emoteProviderColor(row.provider),
                }}
              />
            </div>
            <span className="figma-side-rail__spectrum-pct">
              {loading ? '…' : `${Math.round(row.sharePct)}%`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function SignalTicker({
  liveCount,
  channelCount,
  emotesPerMin,
  uniqueEmotes,
  loading,
}: {
  liveCount: number
  channelCount: number
  emotesPerMin: number
  uniqueEmotes: number
  loading?: boolean
}) {
  const lines = useMemo(
    () => [
      `${compact(liveCount)} live channels tracked`,
      `${compact(channelCount)} rooms in rollup`,
      emotesPerMin > 0 ? `${compact(emotesPerMin)} emotes/min network avg` : 'Emote velocity warming up',
      uniqueEmotes > 0 ? `${compact(uniqueEmotes)} unique emotes seen` : 'Unique emote index building',
      'Hosted API + IRC worker plane - sanitized',
    ],
    [channelCount, emotesPerMin, liveCount, uniqueEmotes],
  )

  return (
    <div className="figma-side-rail__ticker" aria-hidden="true">
      <div className="figma-side-rail__ticker-track">
        {[...lines, ...lines].map((line, index) => (
          <span key={`${line}-${index}`}>{loading ? '…' : line}</span>
        ))}
      </div>
    </div>
  )
}

export function AnalyticsSideRailLeft({
  emoteIntel,
  liveCount,
  channelCount,
  loading,
}: AnalyticsAmbientProps) {
  return (
    <aside className="figma-analytics__side-rail figma-analytics__side-rail--left" aria-label="Network sidebar">
      <div className="figma-side-rail__sticky">
        <div className="figma-side-rail__pulse" aria-hidden="true">
          <span className="figma-side-rail__pulse-ring" />
          <span className="figma-side-rail__pulse-core" />
        </div>
        <p className="figma-side-rail__eyebrow">Live network</p>
        <p className="figma-side-rail__stat">
          <strong>{loading ? '…' : compact(liveCount)}</strong>
          <span>channels live</span>
        </p>
        <ProviderSpectrum shares={emoteIntel.providerShares} loading={loading} />
        <SignalTicker
          liveCount={liveCount}
          channelCount={channelCount}
          emotesPerMin={emoteIntel.emotesPerMin}
          uniqueEmotes={emoteIntel.uniqueEmotes}
          loading={loading}
        />
      </div>
    </aside>
  )
}
