import type { CSSProperties } from 'react'
import { useMemo } from 'react'
import { useTwitchVodPlayback } from '../hooks/useTwitchVodPlayback.ts'
import type { ExtensionVodPulseResponse } from '../types/vodPulseTypes.ts'
import { resolveVodPulseState } from '../vod/normalizeVodPulseFetch.ts'
import {
  buildAnalyticsUrl,
  openAnalyticsHref,
  resolveWebAnalyticsHref,
} from '../shared/analyticsLinks.ts'
import {
  classifyCurrentMoment,
  findNearestMomentWithin,
  findNearestTimelineBucket,
} from '../vod/vodCurrentMoment.ts'
import { PulseSectionCard } from './PulseSectionCard.tsx'
import { PulseStatusPill, type PulseStatusKind } from './PulseStatusPill.tsx'
import { RecapSkeleton } from './RecapSkeleton.tsx'
import { RecapTopEmotesRow } from './RecapTopEmotesRow.tsx'
import { theme } from './theme.ts'
import { VodBestClipCard } from './VodBestClipCard.tsx'
import { VodCurrentMomentCard } from './VodCurrentMomentCard.tsx'
import { VodPulseTimeline } from './VodPulseTimeline.tsx'
import { VodTopMomentsList } from './VodTopMomentsList.tsx'

function vodStatusKind(data: ExtensionVodPulseResponse | null, syncStatus: string): PulseStatusKind {
  if (syncStatus === 'unavailable') return 'playback-sync-unavailable'
  switch (data?.coverageStatus) {
    case 'ready':
      return 'replay-synced'
    case 'partial':
      return 'partial'
    case 'syncing':
      return 'syncing'
    case 'error':
      return 'backend-error'
    default:
      return 'missing'
  }
}

function resolveFullAnalyticsHref(
  webAnalyticsBaseUrl: string,
  data: ExtensionVodPulseResponse | null | undefined,
): string | null {
  if (!data) return null
  const fromApi = resolveWebAnalyticsHref(webAnalyticsBaseUrl, data.fullAnalyticsUrl)
  if (fromApi) return fromApi
  return buildAnalyticsUrl({
    webAnalyticsBaseUrl,
    channelLogin: data.channelLogin,
    streamId: data.streamId,
  })
}

function VodStatePanel({
  title,
  subtitle,
  body,
  status,
  primaryAction,
  secondaryAction,
}: {
  title: string
  subtitle: string
  body: string
  status: PulseStatusKind
  primaryAction?: { label: string; onClick: () => void }
  secondaryAction?: { label: string; onClick: () => void }
}) {
  return (
    <PulseSectionCard title={title}>
      <div style={styles.stateWrap}>
        <PulseStatusPill status={status} />
        <div style={styles.stateTitle}>{subtitle}</div>
        <p style={styles.stateText}>{body}</p>
        <div style={styles.actionRow}>
          {primaryAction ? (
            <button type="button" style={styles.cta} onClick={primaryAction.onClick}>
              {primaryAction.label}
            </button>
          ) : null}
          {secondaryAction ? (
            <button type="button" style={styles.ctaSecondary} onClick={secondaryAction.onClick}>
              {secondaryAction.label}
            </button>
          ) : null}
        </div>
      </div>
    </PulseSectionCard>
  )
}

export function VodReplayPulse({
  vodPulse,
  loading,
  error,
  vodIdHint,
  backendUrl,
  webAnalyticsBaseUrl,
  onRetry,
}: {
  vodPulse: ExtensionVodPulseResponse | null
  loading?: boolean
  error?: string | null
  vodIdHint?: string
  backendUrl: string
  webAnalyticsBaseUrl: string
  onRetry?: () => void
}) {
  const state = resolveVodPulseState(vodPulse, error, loading, vodIdHint)
  const playbackEnabled = state.status === 'ready' || state.status === 'partial'
  const playback = useTwitchVodPlayback(playbackEnabled)
  const data =
    state.status === 'ready' || state.status === 'partial'
      ? state.data
      : state.status === 'syncing'
        ? (state.data ?? vodPulse)
        : vodPulse

  const fullAnalyticsHref = useMemo(
    () => resolveFullAnalyticsHref(webAnalyticsBaseUrl, data ?? vodPulse),
    [webAnalyticsBaseUrl, data, vodPulse],
  )

  const channelAnalyticsHref = useMemo(() => {
    const loginFromMissing = state.status === 'missing' ? state.channelLogin : undefined
    const login = data?.channelLogin ?? vodPulse?.channelLogin ?? loginFromMissing
    if (!login) return null
    return buildAnalyticsUrl({ webAnalyticsBaseUrl, channelLogin: login })
  }, [webAnalyticsBaseUrl, data, vodPulse, state])

  const timelinePoints = data?.timeline?.points ?? []
  const topMoments = data?.topMoments ?? []
  const durationSeconds = playback.durationSeconds ?? data?.durationSeconds ?? 0

  const insight = useMemo(() => {
    const bucket = findNearestTimelineBucket(timelinePoints, playback.currentTimeSeconds)
    const nearest = findNearestMomentWithin(topMoments, playback.currentTimeSeconds, 90)
    return {
      insight: classifyCurrentMoment(bucket, nearest, playback.currentTimeSeconds),
      bucket,
      nearest,
    }
  }, [timelinePoints, topMoments, playback.currentTimeSeconds])

  const metaParts: string[] = []
  if (data?.channelLogin) metaParts.push(data.channelLogin)
  if (durationSeconds > 0) {
    metaParts.push(
      `${Math.floor(durationSeconds / 3600)}h ${Math.floor((durationSeconds % 3600) / 60)}m`.replace(/^0h /, ''),
    )
  }

  if (state.status === 'loading') {
    return (
      <PulseSectionCard title="Replay Pulse">
        <RecapSkeleton />
      </PulseSectionCard>
    )
  }

  if (state.status === 'error') {
    return (
      <VodStatePanel
        title="Replay Pulse"
        subtitle="Replay unavailable"
        body="StreamPulse could not load replay analytics right now."
        status="backend-error"
        primaryAction={onRetry ? { label: 'Retry', onClick: onRetry } : undefined}
      />
    )
  }

  if (state.status === 'missing') {
    return (
      <VodStatePanel
        title="Replay Pulse"
        subtitle="No replay data yet"
        body="This VOD has not been indexed by StreamPulse."
        status="missing"
        primaryAction={onRetry ? { label: 'Retry', onClick: onRetry } : undefined}
        secondaryAction={
          channelAnalyticsHref
            ? { label: 'Open channel analytics', onClick: () => openAnalyticsHref(channelAnalyticsHref) }
            : undefined
        }
      />
    )
  }

  if (state.status === 'syncing') {
    return (
      <VodStatePanel
        title="Replay Pulse"
        subtitle="Syncing replay"
        body={state.reason ?? 'StreamPulse is still processing this VOD.'}
        status="syncing"
        primaryAction={onRetry ? { label: 'Retry', onClick: onRetry } : undefined}
        secondaryAction={
          channelAnalyticsHref
            ? { label: 'Open channel analytics', onClick: () => openAnalyticsHref(channelAnalyticsHref) }
            : undefined
        }
      />
    )
  }

  if (state.status === 'live_dvr') {
    return (
      <VodStatePanel
        title="Replay Pulse"
        subtitle="Live analytics active"
        body="The stream is still live. Replay chat may remain unavailable until Twitch publishes the archive."
        status="tracking"
      />
    )
  }

  const statusKind = vodStatusKind(data ?? null, playback.syncStatus)
  const showTimeline = timelinePoints.length > 0
  const showTopMoments = topMoments.length > 0
  const showTopEmotes = (data?.topEmotes?.length ?? 0) > 0
  const showClip = Boolean(data?.bestClipCandidate)

  return (
    <PulseSectionCard title="Replay Pulse" meta={metaParts.join(' · ') || undefined}>
      <div style={styles.statusRow}>
        <PulseStatusPill status={statusKind} />
        {state.status === 'partial' && state.reason ? (
          <span style={styles.partialNote}>{state.reason}</span>
        ) : null}
        {fullAnalyticsHref ? (
          <button
            type="button"
            style={styles.ctaInline}
            onClick={() => openAnalyticsHref(fullAnalyticsHref)}
          >
            Full analytics
          </button>
        ) : null}
      </div>

      {data?.title ? <div style={styles.vodTitle}>{data.title}</div> : null}

      {showTimeline || showTopMoments ? (
        <VodCurrentMomentCard
          currentTimeSeconds={playback.currentTimeSeconds}
          insight={insight.insight}
          chatPerMin={insight.bucket?.chatPerMin}
          emotePerMin={insight.bucket?.emotesPerMin}
          score={insight.bucket?.score ?? insight.nearest?.score}
          topEmotes={insight.bucket?.topEmotes ?? insight.nearest?.topEmotes}
          backendUrl={backendUrl}
        />
      ) : null}

      {showTimeline ? (
        <VodPulseTimeline
          points={timelinePoints}
          currentTimeSeconds={playback.currentTimeSeconds}
          durationSeconds={durationSeconds}
          topMomentOffsets={topMoments.map(moment => moment.offsetSeconds)}
          onSeek={offset => playback.seekTo(offset)}
          playbackSynced={playback.syncStatus === 'synced'}
        />
      ) : null}

      {showTopEmotes ? (
        <RecapTopEmotesRow backendUrl={backendUrl} emotes={data!.topEmotes!} />
      ) : null}

      {showTopMoments ? (
        <VodTopMomentsList
          moments={topMoments}
          backendUrl={backendUrl}
          onSeek={offset => playback.seekTo(offset)}
        />
      ) : null}

      {showClip ? (
        <VodBestClipCard
          candidate={data!.bestClipCandidate!}
          backendUrl={backendUrl}
          onSeek={offset => playback.seekTo(offset)}
        />
      ) : null}
    </PulseSectionCard>
  )
}

const styles: Record<string, CSSProperties> = {
  statusRow: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8 },
  partialNote: { color: theme.textMuted, flex: 1, fontSize: 10, fontWeight: 600, minWidth: 120 },
  vodTitle: { color: theme.textPrimary, fontSize: 12, fontWeight: 700, lineHeight: 1.35 },
  stateWrap: { display: 'grid', gap: 8 },
  stateTitle: { color: theme.textPrimary, fontSize: 13, fontWeight: 800 },
  stateText: { color: theme.textSecondary, fontSize: 12, lineHeight: 1.45, margin: 0 },
  actionRow: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  cta: {
    background: theme.accent,
    border: 0,
    borderRadius: 10,
    color: theme.onAccent,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 800,
    padding: '8px 12px',
    width: 'fit-content',
  },
  ctaSecondary: {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 10,
    color: theme.textPrimary,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 700,
    padding: '8px 12px',
    width: 'fit-content',
  },
  ctaInline: {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 999,
    color: theme.textPrimary,
    cursor: 'pointer',
    fontSize: 10,
    fontWeight: 800,
    marginLeft: 'auto',
    padding: '4px 10px',
  },
}
