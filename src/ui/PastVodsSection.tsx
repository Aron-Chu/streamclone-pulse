import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { buildAnalyticsMomentLink } from '@streamclone/pulse-core'
import type { PastVodRow } from '../shared/messages.ts'
import { sendBackgroundMessage } from '../content/bridge.ts'
import {
  buildTwitchVodUrl,
  formatPastVodDate,
  pastVodAnalyticsStatusClass,
  pastVodAnalyticsStatusLabel,
  vodThumbnailUrl,
} from '../shared/pastVods.ts'
import { MAX_PAST_STREAM_ROWS } from './chatActivityEmotes.ts'
import { PulseSectionCard } from './PulseSectionCard.tsx'
import { theme } from './theme.ts'

export interface PastVodsSectionProps {
  login: string
  backendUrl: string
  liveStreamId?: string
  isLive?: boolean
  channelOffline?: boolean
}

export function PastVodsSection({
  login,
  backendUrl,
  liveStreamId,
  isLive,
  channelOffline = false,
}: PastVodsSectionProps) {
  const [rows, setRows] = useState<PastVodRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const res = await sendBackgroundMessage({
          type: 'LIST_PAST_VODS',
          login,
          liveStreamId,
          isLive,
        })
        if (!mounted) return
        if ('type' in res && res.type === 'PAST_VODS') {
          setRows(res.items)
          setError(res.error ?? null)
        }
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
  }, [login, liveStreamId, isLive])

  const subtitle = channelOffline
    ? 'Recent broadcasts'
    : 'Pulse in Streamclone · Twitch VOD for playback'

  function openAnalytics(streamId: string): void {
    const path = buildAnalyticsMomentLink(login, 0, streamId)
    window.open(`${backendUrl}${path}`, '_blank', 'noopener,noreferrer')
  }

  function openTwitchVod(row: PastVodRow): void {
    if (!row.videoId) return
    window.open(buildTwitchVodUrl(row.videoId), '_blank', 'noopener,noreferrer')
  }

  function openAllAnalytics(): void {
    window.open(`${backendUrl}/analytics/${encodeURIComponent(login)}`, '_blank', 'noopener,noreferrer')
  }

  return (
    <PulseSectionCard
      title="Past streams"
      subtitle={subtitle}
      meta={loading ? '…' : String(rows.length)}
      style={styles.section}
    >
      {loading ? (
        <div className="pulse-shimmer" style={styles.loadingBlock} aria-hidden="true" />
      ) : null}

      {!loading && rows.length === 0 ? (
        <div style={styles.emptyBlock}>
          <strong style={styles.emptyTitle}>No stream history yet</strong>
          <p style={styles.emptyText}>
            {error
              ? 'Could not load stream history from Streamclone.'
              : 'Open full analytics to sync historical sessions when available.'}
          </p>
          <button type="button" className="pulse-past-vod-footer" style={styles.emptyAction} onClick={openAllAnalytics}>
            Open full analytics →
          </button>
        </div>
      ) : null}

      {!loading && rows.length > 0 ? (
        <div className="pulse-past-vod-shell">
          <div role="list" style={styles.list}>
            {rows.slice(0, MAX_PAST_STREAM_ROWS).map(row => (
              <PastVodRowCard
                key={row.streamId}
                row={row}
                onAnalytics={() => openAnalytics(row.streamId)}
                onTwitchVod={() => openTwitchVod(row)}
              />
            ))}
          </div>
          <button type="button" className="pulse-past-vod-footer" onClick={openAllAnalytics}>
            Open all stream history →
          </button>
        </div>
      ) : null}
    </PulseSectionCard>
  )
}

function PastVodRowCard({
  row,
  onAnalytics,
  onTwitchVod,
}: {
  row: PastVodRow
  onAnalytics: () => void
  onTwitchVod: () => void
}) {
  const thumb = vodThumbnailUrl(row.thumbnailUrl, 80, 45)
  const dateLabel = formatPastVodDate(row.startedAt)
  const statusLabel = pastVodAnalyticsStatusLabel(row.analyticsStatus)
  const statusClass = pastVodAnalyticsStatusClass(row.analyticsStatus)

  return (
    <article className="pulse-past-vod-row pulse-past-vod-row-compact" style={styles.row} role="listitem">
      <button type="button" className="pulse-past-vod-main" style={styles.rowMain} onClick={onAnalytics}>
        <div style={styles.thumbWrap}>
          {thumb ? (
            <img src={thumb} alt="" style={styles.thumb} loading="lazy" decoding="async" />
          ) : (
            <span style={styles.thumbFallback}>VOD</span>
          )}
        </div>
        <div style={styles.rowCopy}>
          <strong className="pulse-past-vod-title" style={styles.rowTitle}>
            {row.title}
          </strong>
          <span className="pulse-past-vod-meta-row" style={styles.rowMetaLine}>
            <span className={statusClass} style={styles.statusBadge}>
              {statusLabel}
            </span>
            {[dateLabel, row.category].filter(Boolean).join(' · ')}
          </span>
        </div>
      </button>
      <div style={styles.rowActions}>
        <button type="button" className="pulse-past-vod-action" onClick={onAnalytics}>
          Pulse
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

const styles: Record<string, CSSProperties> = {
  section: { marginTop: 16 },
  loadingBlock: { background: theme.panel, borderRadius: 10, height: 88, marginTop: 4 },
  emptyBlock: {
    background: 'rgba(255, 255, 255, 0.035)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: 10,
    display: 'grid',
    gap: 8,
    padding: 14,
    textAlign: 'center',
  },
  emptyTitle: { color: theme.textPrimary, fontSize: 13, fontWeight: 800 },
  emptyText: { color: theme.textSecondary, fontSize: 12, lineHeight: 1.4, margin: 0 },
  emptyAction: { border: 0, borderRadius: 8, marginTop: 4 },
  list: { display: 'grid' },
  row: {
    alignItems: 'stretch',
    display: 'grid',
    gap: 8,
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    padding: '8px 10px',
  },
  rowMain: {
    alignItems: 'center',
    background: 'transparent',
    border: 0,
    color: theme.textPrimary,
    cursor: 'pointer',
    display: 'flex',
    gap: 10,
    minWidth: 0,
    padding: 0,
    textAlign: 'left',
    width: '100%',
  },
  thumbWrap: {
    alignItems: 'center',
    aspectRatio: '16 / 9',
    background: '#101014',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: 6,
    display: 'flex',
    flexShrink: 0,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 72,
  },
  thumb: { display: 'block', height: '100%', objectFit: 'cover', width: '100%' },
  thumbFallback: { color: theme.textMuted, fontSize: 8, fontWeight: 900, textTransform: 'uppercase' },
  rowCopy: { display: 'grid', gap: 4, minWidth: 0, flex: 1 },
  rowTitle: {
    display: '-webkit-box',
    fontSize: 11,
    fontWeight: 800,
    lineHeight: 1.35,
    overflow: 'hidden',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 2,
  },
  rowMetaLine: {
    alignItems: 'center',
    color: theme.textMuted,
    display: 'flex',
    flexWrap: 'wrap',
    fontSize: 9,
    fontWeight: 600,
    gap: 6,
    lineHeight: 1.3,
  },
  statusBadge: {
    display: 'inline-block',
    flexShrink: 0,
    fontSize: 8,
    maxWidth: '100%',
    overflow: 'hidden',
    padding: '2px 6px',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  rowActions: {
    alignItems: 'center',
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
    gap: 4,
    justifyContent: 'center',
  },
}
