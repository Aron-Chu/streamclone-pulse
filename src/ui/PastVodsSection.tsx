import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { PastVodRow } from '../shared/messages.ts'
import { openHubAnalytics, openStreamAnalytics } from '../shared/analyticsLinks.ts'
import { sendBackgroundMessage } from '../content/bridge.ts'
import {
  buildTwitchVodUrl,
  formatPastVodDate,
  pastVodAnalyticsStatusClass,
  pastVodAnalyticsStatusLabel,
  vodThumbnailUrl,
} from '../shared/pastVods.ts'
import { safeImageUrl } from '../shared/safeUrl.ts'
import { MAX_PAST_STREAM_ROWS } from './chatActivityEmotes.ts'
import { PulseSectionCard } from './PulseSectionCard.tsx'

export interface PastVodsSectionProps {
  login: string
  /** The page's VOD id on a growing live VOD, so the worker accepts the /videos/{id} tab. */
  vodId?: string | null
  backendUrl: string
  liveStreamId?: string
  isLive?: boolean
  channelOffline?: boolean
  onOpenFromStart?: () => void
  /** When set, skip background fetch and render these rows (landing demo). */
  demoRows?: PastVodRow[]
  demoMode?: boolean
}

export function PastVodsSection({
  login,
  vodId,
  backendUrl,
  liveStreamId,
  isLive,
  channelOffline = false,
  onOpenFromStart,
  demoRows,
  demoMode = false,
}: PastVodsSectionProps) {
  const [rows, setRows] = useState<PastVodRow[]>(demoRows ?? [])
  const [loading, setLoading] = useState(!demoRows)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [requestNonce, setRequestNonce] = useState(0)

  useEffect(() => {
    if (demoRows) {
      setRows(demoRows)
      setLoading(false)
      setError(null)
      return
    }
    let mounted = true
    setLoading(true)
    setError(null)
    setExpanded(false)
    void (async () => {
      try {
        const res = await sendBackgroundMessage({
          type: 'LIST_PAST_VODS',
          login,
          liveStreamId,
          isLive,
          contextVodId: vodId ?? undefined,
        })
        if (!mounted) return
        // A refused or dead request is a failed load, never "no stream history".
        if (!('type' in res) || res.type !== 'PAST_VODS') throw new Error('past_vods_failed')
        setRows(res.items)
        setError(res.error ?? null)
      } catch (err) {
        if (!mounted) return
        setRows([])
        setError(err instanceof Error ? err.message : 'past_vods_failed')
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [login, vodId, liveStreamId, isLive, demoRows, requestNonce])

  const subtitle = channelOffline
    ? 'Recent broadcasts'
    : 'Stream history · Twitch VOD for playback'

  const visibleRows = expanded ? rows : rows.slice(0, MAX_PAST_STREAM_ROWS)
  const hiddenCount = Math.max(0, rows.length - MAX_PAST_STREAM_ROWS)

  function openAnalytics(streamId: string): void {
    openStreamAnalytics({
      apiBaseUrl: backendUrl,
      channelLogin: login,
      streamId,
    })
  }

  function openTwitchVod(row: PastVodRow): void {
    if (!row.videoId) return
    window.open(buildTwitchVodUrl(row.videoId), '_blank', 'noopener,noreferrer')
  }

  function openAllAnalytics(): void {
    openHubAnalytics(backendUrl)
  }

  return (
    <PulseSectionCard
      title="Past streams"
      subtitle={subtitle}
      meta={loading ? '…' : String(rows.length)}
      style={sectionStyle}
    >
      {loading ? (
        <div className="pulse-shimmer pulse-pv-loading" aria-hidden="true" />
      ) : null}

      {!loading && rows.length === 0 ? (
        <div className="pulse-pv-empty" data-past-vods-state={error ? 'error' : 'empty'}>
          <strong className="pulse-pv-empty-title">
            {error ? "Couldn't load stream history" : 'No stream history yet'}
          </strong>
          <p className="pulse-pv-empty-text">
            {error
              ? 'Could not load stream history from StreamPulse.'
              : 'No past streams recorded for this channel.'}
          </p>
          {error ? (
            <button type="button" className="pulse-past-vod-footer pulse-pv-empty-action" onClick={() => setRequestNonce(value => value + 1)}>
              Retry stream history
            </button>
          ) : null}
          <button type="button" className="pulse-past-vod-footer pulse-pv-empty-action" onClick={openAllAnalytics}>
            Open full analytics →
          </button>
        </div>
      ) : null}

      {!loading && rows.length > 0 ? (
        <div className="pulse-past-vod-shell" data-past-vods-state="ready">
          <div role="list" className="pulse-pv-list">
            {visibleRows.map(row => (
                <PastVodRowCard
                  key={row.streamId}
                  row={row}
                  backendUrl={backendUrl}
                onAnalytics={demoMode ? () => undefined : () => openAnalytics(row.streamId)}
                onTwitchVod={demoMode ? () => undefined : () => openTwitchVod(row)}
                onFromStart={row.analyticsStatus === 'current-live' ? onOpenFromStart : undefined}
              />
            ))}
          </div>
          {hiddenCount > 0 && !expanded ? (
            <button type="button" className="pulse-past-vod-footer" disabled={demoMode} onClick={demoMode ? undefined : () => setExpanded(true)}>
              View all ({rows.length}) →
            </button>
          ) : (
            <button type="button" className="pulse-past-vod-footer" disabled={demoMode} onClick={demoMode ? undefined : openAllAnalytics}>
              Open all stream history →
            </button>
          )}
        </div>
      ) : null}
    </PulseSectionCard>
  )
}

function PastVodRowCard({
  row,
  backendUrl,
  onAnalytics,
  onTwitchVod,
  onFromStart,
}: {
  row: PastVodRow
  backendUrl: string
  onAnalytics: () => void
  onTwitchVod: () => void
  onFromStart?: () => void
}) {
  const thumb = safeImageUrl(vodThumbnailUrl(row.thumbnailUrl, 80, 45), backendUrl)
  const dateLabel = formatPastVodDate(row.startedAt)
  const statusLabel = pastVodAnalyticsStatusLabel(row.analyticsStatus)
  const statusClass = pastVodAnalyticsStatusClass(row.analyticsStatus)

  return (
    <article
      className="pulse-past-vod-row pulse-past-vod-row-compact pulse-pv-row"
      // Inline so the landing's one-column override stays masked, as before.
      style={rowStyle}
      role="listitem"
    >
      <button type="button" className="pulse-past-vod-main pulse-pv-main" onClick={onAnalytics}>
        <div className="pulse-pv-thumb-wrap">
          {thumb ? (
            <img src={thumb} alt="" className="pulse-pv-thumb" loading="lazy" decoding="async" />
          ) : (
            <span className="pulse-pv-thumb-fallback">VOD</span>
          )}
        </div>
        <div className="pulse-pv-copy">
          <strong className="pulse-past-vod-title pulse-pv-title">
            {row.title}
          </strong>
          <span className="pulse-past-vod-meta-row pulse-pv-meta">
            <span className={`${statusClass} pulse-pv-status`}>
              {statusLabel}
            </span>
            {[dateLabel, row.category].filter(Boolean).join(' · ')}
          </span>
        </div>
      </button>
      <div className="pulse-past-vod-actions">
        {onFromStart ? (
          <button type="button" className="pulse-past-vod-action pulse-past-vod-action-start" onClick={onFromStart}>
            From start
          </button>
        ) : null}
        <button type="button" className="pulse-past-vod-action" onClick={onAnalytics}>
          Analytics
        </button>
        {row.videoId ? (
          <button type="button" className="pulse-past-vod-action pulse-past-vod-action-vod" onClick={onTwitchVod}>
            VOD
          </button>
        ) : null}
      </div>
    </article>
  )
}

const sectionStyle: CSSProperties = { marginTop: 16 }
const rowStyle: CSSProperties = { gridTemplateColumns: 'minmax(0, 1fr) auto' }
