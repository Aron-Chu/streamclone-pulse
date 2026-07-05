import { memo, useMemo } from 'react'
import type { HubActivityPoint, HubEmote } from '../../../lib/publicHub'
import { bucketMinutes } from '../../../lib/hubActivitySummary'
import type { HubEmoteWithShare } from '../../../lib/emoteShare'
import { compact } from './hubFormat'
import { HubTopEmotesTable } from './HubTopEmotesTable'
import {
  type InspectorMode,
  inspectorEmoteListSignature,
  resolveInspectorTableEmotes,
} from './activityBucketInspectorUtils'
import '../hub/hub.css'

export interface ActivityBucketInspectorProps {
  rangeEmotes: HubEmote[]
  windowLabel: string
  windowMinutes: number
  updatedAgo?: string
  /** Aggregated emotes from bucket-filtered Pulse Moments when hub points omit topEmotes. */
  bucketMomentEmotes?: HubEmote[]
  /** Locked bucket from chart click */
  selectedPoint: HubActivityPoint | null
  /** Hover preview bucket (when not locked) */
  hoverPoint: HubActivityPoint | null
  className?: string
}

function formatBucketTime(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return '—'
  return new Date(ts).toLocaleString([], {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatEmoteProviderLabel(provider?: string): string | null {
  if (!provider) return null
  const key = provider.toLowerCase()
  if (key === '7tv' || key === 'seventv') return '7TV'
  if (key === 'twitch') return 'Twitch'
  if (key === 'bttv') return 'BTTV'
  if (key === 'ffz') return 'FFZ'
  return provider
}

function busiestEmoteSummary(point: HubActivityPoint): string | null {
  const top = point.topEmotes?.[0]
  if (!top) return null
  const provider =
    formatEmoteProviderLabel(top.provider) ?? dominantProvider(point)
  const providerNote = provider ? ` · mostly ${provider}` : ''
  return `Busiest emote: ${top.name} (${compact(top.count)})${providerNote}`
}

function dominantProvider(point: HubActivityPoint): string | null {
  const entries: Array<{ key: string; label: string; value: number }> = [
    { key: '7tv', label: '7TV', value: point.seventv ?? 0 },
    { key: 'twitch', label: 'Twitch', value: point.twitch ?? 0 },
    { key: 'bttv', label: 'BTTV', value: point.bttv ?? 0 },
    { key: 'ffz', label: 'FFZ', value: point.ffz ?? 0 },
  ]
  const best = entries.reduce((a, b) => (b.value > a.value ? b : a), entries[0])
  return best.value > 0 ? best.label : null
}

const InspectorChrome = memo(function InspectorChrome({
  headLabel,
  headMeta,
  statsViewers,
  statsChat,
  statsChatLabel,
  statsProvider,
}: {
  headLabel: string
  headMeta: string | null
  statsViewers: string
  statsChat: string
  statsChatLabel: string
  statsProvider: string
}) {
  return (
    <div className="activity-bucket-inspector__chrome">
      <div className="activity-bucket-inspector__head">
        <span className="activity-bucket-inspector__head-label pulse-moments__inspector-top-emote-label">
          {headLabel}
        </span>
        <span className="activity-bucket-inspector__head-meta">{headMeta ?? '\u00a0'}</span>
      </div>

      <div className="pulse-moments__inspector-grid activity-bucket-inspector__stats">
        <div className="pulse-moments__inspector-stat">
          <small>Viewers then</small>
          <strong>{statsViewers}</strong>
        </div>
        <div className="pulse-moments__inspector-stat">
          <small>{statsChatLabel}</small>
          <strong>{statsChat}</strong>
        </div>
        <div className="pulse-moments__inspector-stat">
          <small>Leading emotes from</small>
          <strong>{statsProvider}</strong>
        </div>
      </div>
    </div>
  )
})

const InspectorEmoteList = memo(
  function InspectorEmoteList({ emotes, mode }: { emotes: HubEmoteWithShare[]; mode: InspectorMode }) {
    if (emotes.length === 0) {
      return (
        <div className="activity-bucket-inspector__empty muted">
          {mode === 'range'
            ? 'Top emotes appear when the public hub has provider rollups for this window.'
            : 'No per-bucket emote breakdown for this interval yet.'}
        </div>
      )
    }
    return (
      <div className="activity-bucket-inspector__table-slot">
        <HubTopEmotesTable emotes={emotes} maxRows={10} layout="leaderboard" />
      </div>
    )
  },
  (prev, next) =>
    prev.mode === next.mode &&
    inspectorEmoteListSignature(prev.emotes) === inspectorEmoteListSignature(next.emotes),
)

export function ActivityBucketInspector({
  rangeEmotes,
  windowLabel,
  windowMinutes,
  updatedAgo,
  bucketMomentEmotes = [],
  selectedPoint,
  hoverPoint,
  className,
}: ActivityBucketInspectorProps) {
  const mode: InspectorMode = selectedPoint
    ? 'selected'
    : hoverPoint
      ? 'preview'
      : 'range'

  const activePoint = selectedPoint ?? hoverPoint
  const bucketHasEmotes = (activePoint?.topEmotes?.length ?? 0) > 0
  const momentFallbackActive =
    (mode === 'selected' || mode === 'preview') && !bucketHasEmotes && bucketMomentEmotes.length > 0

  const tableEmotes = useMemo(
    () => resolveInspectorTableEmotes(mode, activePoint, rangeEmotes, bucketMomentEmotes),
    [mode, activePoint, rangeEmotes, bucketMomentEmotes],
  )

  const headLabel =
    mode === 'selected'
      ? `Selected bucket · ${formatBucketTime(activePoint!.t)}`
      : mode === 'preview'
        ? `Preview · ${formatBucketTime(activePoint!.t)}`
        : `Top emotes — ${windowLabel}`

  const headMeta =
    mode === 'range' && updatedAgo
      ? `as of ${updatedAgo}`
      : activePoint && mode !== 'range' && bucketHasEmotes
        ? busiestEmoteSummary(activePoint)
        : activePoint && mode !== 'range' && momentFallbackActive
          ? 'Top emotes aggregated from detected spikes in this bucket'
          : activePoint && mode !== 'range'
            ? 'No emote rollups stored for this bucket yet'
            : null

  const topProvider = activePoint ? dominantProvider(activePoint) : null
  // Points from the chart series are already per-minute rates for coarse windows.
  const displayPoint = activePoint && mode !== 'range' ? activePoint : null

  const statsViewers = displayPoint ? compact(displayPoint.viewers) : '—'
  const statsChat = displayPoint ? compact(displayPoint.chat) : '—'
  const statsProvider = displayPoint && topProvider ? topProvider : '—'
  const statsChatLabel = bucketMinutes(windowMinutes) > 1 ? 'Chat / min then' : 'Chat then'

  const modeClass =
    mode === 'selected'
      ? ' activity-bucket-inspector--active'
      : mode === 'preview'
        ? ' activity-bucket-inspector--preview'
        : ''

  return (
    <aside
      className={`activity-bucket-inspector${modeClass}${className ? ` ${className}` : ''}`}
      aria-label="Activity bucket inspector"
    >
      <InspectorChrome
        headLabel={headLabel}
        headMeta={headMeta}
        statsViewers={statsViewers}
        statsChat={statsChat}
        statsChatLabel={statsChatLabel}
        statsProvider={statsProvider}
      />
      <InspectorEmoteList emotes={tableEmotes} mode={mode} />
    </aside>
  )
}
