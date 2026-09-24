import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import type { FigmaMomentRow } from '../../../lib/figmaSessionAnalytics'
import { discoveryMomentHref, fromHubMoment } from '../../../lib/discoveryMoments'
import { withComputedBurstShare } from '../../../lib/emoteShare'
import type { HubEmote, HubLiveChannel } from '../../../lib/publicHub'
import {
  momentEmoteRollupsEmptyHint,
  momentHasEmoteRollups,
  momentWallClockLabel,
  resolveMomentEmote,
  resolveMomentEmotesPerMin,
  resolveMomentViewers,
} from '../../../lib/pulseMomentsUtils'
import {
  formatChatRate,
  formatMomentViewersLabel,
  formatReactionScore,
  REACTION_SCORE_TOOLTIP,
} from '../../../lib/momentMetricLabels'
import { buildAnalyticsHref } from '../../../lib/analyticsLinks'
import { InspectorTopEmoteCard } from './InspectorTopEmoteCard'
import { TopEmoteBurstsPanel } from './TopEmoteBurstsPanel'
import { compact } from './hubFormat'

export interface HubMomentRailBodyProps {
  moment: FigmaMomentRow
  emoteLookup?: Map<string, HubEmote>
  liveChannels?: Array<Pick<HubLiveChannel, 'login' | 'startedAt'>>
  channelLive?: boolean
  lockedBucketT?: number | null
  lockedBucketLabel?: string | null
  onBackToBucket?: () => void
}

export function HubMomentRailBody({
  moment,
  emoteLookup,
  liveChannels = [],
  channelLive,
  lockedBucketT,
  lockedBucketLabel,
  onBackToBucket,
}: HubMomentRailBodyProps) {
  const timeLabel = momentWallClockLabel(moment, liveChannels)
  const category = moment.category?.trim()
  const displayName = moment.displayName ?? moment.login ?? 'Channel'
  const hasEmotes = momentHasEmoteRollups(moment)
  const emote = hasEmotes ? resolveMomentEmote(moment, emoteLookup ?? new Map()) : null
  const topShare = moment.topEmotes?.[0]?.sharePct
  const emotesPerMin = resolveMomentEmotesPerMin(moment)
  const viewerDisplay = formatMomentViewersLabel(resolveMomentViewers(moment, liveChannels))

  const bursts = useMemo(() => {
    if (!moment.topEmotes?.length) return []
    return withComputedBurstShare(
      moment.topEmotes.map((row) => ({
        code: row.name,
        provider: row.provider,
        imageUrl: row.imageUrl,
        count: row.count ?? 0,
        sharePct: row.sharePct,
      })),
    )
  }, [moment.topEmotes])

  const reviewMoment = fromHubMoment(moment)
  const reviewHref = reviewMoment ? discoveryMomentHref(reviewMoment) : undefined
  const analyticsHref =
    moment.href ??
    (moment.login
      ? buildAnalyticsHref({
          login: moment.login,
          streamId: moment.streamId,
          offsetSeconds: moment.offsetSeconds,
        })
      : undefined)
  const primaryHref = reviewHref ?? analyticsHref
  const primaryLabel = reviewHref ? 'Review moment' : analyticsHref ? 'Open analytics' : null

  return (
    <div className="hub-moment-rail">
      {lockedBucketT != null && lockedBucketLabel ? (
        <div className="hub-moment-rail__bucket-context">
          <span className="hub-moment-rail__bucket-context-label">
            Selected bucket · {lockedBucketLabel}
          </span>
          {onBackToBucket ? (
            <button type="button" className="hub-moment-rail__back-btn" onClick={onBackToBucket}>
              Back to bucket
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="hub-moment-rail__channel-row">
        <strong className="hub-moment-rail__channel-name">{displayName}</strong>
        {category ? <span className="hub-moment-rail__channel-game">{category}</span> : null}
        <span className="hub-moment-rail__channel-time">
          {timeLabel.primary}
          {timeLabel.secondary ? ` · ${timeLabel.secondary}` : ''}
        </span>
      </div>

      {emote ? (
        <InspectorTopEmoteCard
          className="hub-moment-rail__hero"
          emote={emote}
          headline="Top emote this minute"
          countUnit="uses this minute"
          topShare={topShare}
        />
      ) : (
        <p className="muted hub-moment-rail__empty-emote">{momentEmoteRollupsEmptyHint(moment)}</p>
      )}

      <div className="hub-moment-rail__kpi-grid pulse-moments__inspector-grid">
        <div className="pulse-moments__inspector-stat pulse-moments__inspector-stat--mid" title={REACTION_SCORE_TOOLTIP}>
          <small>Reaction score</small>
          <strong>{formatReactionScore(moment.score)}</strong>
        </div>
        <div className="pulse-moments__inspector-stat">
          <small>Chat / min</small>
          <strong>{formatChatRate(moment.chatPerMin)}</strong>
        </div>
        <div className="pulse-moments__inspector-stat pulse-moments__inspector-stat--emote">
          <small>Emotes / min</small>
          <strong>{emotesPerMin != null ? compact(emotesPerMin) : '—'}</strong>
        </div>
        <div className="pulse-moments__inspector-stat pulse-moments__inspector-stat--high">
          <small>Viewers</small>
          <strong>{viewerDisplay}</strong>
        </div>
      </div>

      <TopEmoteBurstsPanel
        bursts={bursts}
        emoteLookup={emoteLookup}
        variant="pulse-live"
        maxRows={5}
        className="hub-moment-rail__bursts"
        emptyHint={momentEmoteRollupsEmptyHint(moment)}
      />

      {primaryHref && primaryLabel ? (
        <div className="hub-moment-rail__cta">
          <Link className="hub-openbtn hub-openbtn--accent" to={primaryHref}>
            {primaryLabel}
          </Link>
        </div>
      ) : (
        <div className="hub-moment-rail__cta">
          <span className="hub-openbtn hub-openbtn--disabled" aria-disabled="true">
            {channelLive === false ? 'No VOD indexed yet' : 'Live tracking only'}
          </span>
        </div>
      )}
    </div>
  )
}
