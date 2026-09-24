import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { formatStreamOffset } from '../../../lib/formatStreamOffset'
import { formatMomentDateTime } from '../../../lib/liveWire'
import { discoveryAnalyticsHref, type DiscoveryMoment } from '../../../lib/discoveryMoments'
import { broadcastTimelineHref } from '../../../lib/momentsNavigation'
import { momentComparisonBadge } from '../../../lib/momentComparison'
import type { ArchiveArtwork } from '../../../lib/archiveArtwork'
import { MomentArchiveArtwork } from './MomentArchiveArtwork'
import { SaveMomentButton } from './SaveMomentButton'
import { useMomentRelativeAge } from './useMomentRelativeAge'
import { EmoteImg } from '../analytics/EmoteImg'
import { emoteImageUrlFromIdentity } from '../../../lib/emoteAssetUrl'

const present = (value?: number) =>
  value != null && Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 1 }) : null

export function MomentEmotes({ moment }: { moment: DiscoveryMoment }) {
  return moment.topEmotes?.length ? <div className="moments-row-emotes" aria-label="Measured emote reactions">
    {moment.topEmotes.slice(0, 4).map((emote, index) => {
      // Saved records keep no media URL; rebuild one from a provider ID, else name the emote.
      const src = emote.imageUrl ?? emoteImageUrlFromIdentity(emote.provider, emote.id)
      return <span key={`${emote.provider}:${emote.name}:${index}`} title={`${emote.name}${emote.count != null ? ` · ${present(emote.count)} uses` : ''}`}>
        {src ? <EmoteImg name={emote.name} src={src} width={24} height={24} /> : <span className="moments-row-emote-name">{emote.name}</span>}
      </span>
    })}
  </div> : null
}

/**
 * One detection, on one line.
 *
 * The same row serves the recent feed and a stored broadcast, so a reader never
 * has to learn two layouts: the recent feed adds the creator (it spans many
 * channels) and a grouped broadcast adds a rank, and nothing else differs.
 *
 * Evidence is what the server measured for this minute — the two rates, and a
 * multiplier only where a backend comparison exists. Rows that have no
 * comparison (stored days supply none) simply show their rates; no ratio is
 * derived here to fill the gap.
 */
export function MomentRow({
  moment,
  rank,
  selected,
  artwork,
  clipCandidate,
  creator,
  ranking,
  onSelect,
}: {
  moment: DiscoveryMoment
  /** Position in the server's ranking. Omitted when nothing ranked this row. */
  rank?: number | null
  selected: boolean
  artwork?: ArchiveArtwork
  clipCandidate?: boolean
  /** Creator identity, supplied only where a list spans channels. */
  creator?: ReactNode
  ranking?: { score: number; scoreExplanation: string; detectionId?: string }
  onSelect: (moment: DiscoveryMoment) => void
}) {
  const location = useLocation()
  const name = moment.displayName || moment.login
  const offset = formatStreamOffset(moment.offsetSeconds)
  const occurrenceDateTime = formatMomentDateTime(moment.at)
  const occurrenceLabel = occurrenceDateTime
    ? new Date(occurrenceDateTime).toLocaleString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
      timeZone: 'UTC', timeZoneName: 'short',
    })
    : null
  const occurrenceAge = useMomentRelativeAge(occurrenceDateTime)
  const badge = momentComparisonBadge(moment.comparison, moment.reactionSignal)
  return <article
    className={`moments-result${selected ? ' is-selected' : ''}`}
    data-arrival-key={moment.key}
    data-detection-id={ranking?.detectionId}
    aria-label={`${rank != null ? `Rank ${rank}: ` : ''}${name} ${moment.label} at ${offset} into broadcast`}
    onClick={event => {
      // The primary button provides keyboard access; the surrounding card is
      // the same pointer target. Preserve nested links, Save and text selection.
      if ((event.target as HTMLElement).closest('a, button, input, select, textarea, [role="button"]')) return
      if (window.getSelection()?.toString()) return
      onSelect(moment)
    }}
  >
    {artwork ? <MomentArchiveArtwork artwork={artwork} /> : null}
    {creator}
    <div className="moments-result-body">
      <p className="moments-result-title">
        {rank != null ? <b className="moments-result-rank" aria-hidden="true">#{rank}</b> : null}
        <button
          type="button"
          className="moments-card-primary"
          data-discovery-key={moment.key}
          aria-label={`${moment.label} — Open moment for ${name} at ${offset} into broadcast`}
          aria-current={selected ? 'true' : undefined}
          onClick={() => onSelect(moment)}
        >
          <span>{moment.label}</span>
        </button>
        {clipCandidate ? <span className="moments-result-flag" title="The server also nominated this minute as a clip candidate. It has not been rendered or checked for source permission.">Clip candidate</span> : null}
      </p>
      <p className="moments-result-timing">
        {occurrenceAge ? <span className="moments-result-age">{occurrenceAge}</span> : null}
        {occurrenceDateTime
          ? <time dateTime={occurrenceDateTime} aria-label={`Occurred ${occurrenceLabel}`}>{occurrenceLabel}</time>
          : <span>Occurrence time unavailable</span>}
        <span className="moments-result-offset">{offset} into broadcast</span>
      </p>
      <div className="moments-result-evidence">
        {ranking ? <span title={ranking.scoreExplanation}>{ranking.scoreExplanation}: {ranking.score.toLocaleString(undefined, { maximumSignificantDigits: 6 })}</span> : null}
        {present(moment.chatPerMin) == null && present(moment.emotesPerMin) == null
          // One sentence for the whole gap: older saves never stored their rates.
          ? <span>{moment.provenance === 'saved' ? 'Rates were not kept with this save' : 'Rates unavailable'}</span>
          : <>
            <span>{present(moment.chatPerMin) != null ? `${present(moment.chatPerMin)} chat/min` : 'Chat unavailable'}</span>
            <span>{present(moment.emotesPerMin) != null ? `${present(moment.emotesPerMin)} emotes/min` : 'Emotes unavailable'}</span>
          </>}
        {/* The signal is named here, and the full claim stays on the title, so the
            compact form cannot drift from the headline other surfaces show.
            A value under 1× is a dip, not a spike, and is styled as plainly as one. */}
        {badge ? <span className="moments-result-ratio" data-below={badge.belowBaseline ? 'true' : undefined} title={badge.long}>{badge.label} {badge.short}<small> earlier avg</small></span> : null}
      </div>
    </div>
    <MomentEmotes moment={moment} />
    <div className="moments-actions">
      <Link aria-label={`Stream analytics for ${name} ${moment.label} at ${offset}`} to={discoveryAnalyticsHref(moment)}>Analytics</Link>
      <Link to={broadcastTimelineHref(moment.login, moment.streamId, location.pathname + location.search, moment.offsetSeconds)}>View stream timeline</Link>
      <SaveMomentButton moment={moment} />
    </div>
  </article>
}
