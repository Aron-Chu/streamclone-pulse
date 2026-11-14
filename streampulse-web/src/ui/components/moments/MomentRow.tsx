import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { streamEdgeLabel } from '@streampulse/pulse-core'
import { momentRowClock, momentRowClockText } from '../../../lib/formatStreamOffset'
import { EARLY_STREAM_WORDS, earlyInStream, momentEdge } from '../../../lib/momentsChecked'
import { formatMomentDateTime, formatMomentOccurrence } from '../../../lib/liveWire'
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

/** A list a screen reader names, each emote by name and uses; a picture that fails shows the name, not a letter (MOMENTS-PAGE-8). */
export function MomentEmotes({ moment }: { moment: DiscoveryMoment }) {
  return moment.topEmotes?.length ? <div className="moments-row-emotes" role="list" aria-label="Measured emote reactions">
    {moment.topEmotes.slice(0, 4).map((emote, index) => {
      // Saved records keep no media URL; rebuild one from a provider ID, else name the emote.
      const src = emote.imageUrl ?? emoteImageUrlFromIdentity(emote.provider, emote.id)
      const uses = present(emote.count)
      return <span role="listitem" key={`${emote.provider}:${emote.name}:${index}`} title={`${emote.name}${uses != null ? ` · ${uses} uses` : ''}`}>
        {src
          ? <EmoteImg name={emote.name} src={src} width={24} height={24} alt={`${emote.name}${uses != null ? `, ${uses} uses` : ''}`} fallbackName fallbackClassName="moments-row-emote-name" />
          : <span className="moments-row-emote-name">{emote.name}{uses != null ? <span className="sr-only">{`, ${uses} uses`}</span> : null}</span>}
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
  detailId,
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
  /** The id of this row's open detail, for `aria-controls`. Rows that open in line set it. */
  detailId?: string
  /** Receives the row element, so a caller can keep it in place while content moves. */
  onSelect: (moment: DiscoveryMoment, row: HTMLElement | null) => void
}) {
  const location = useLocation()
  const name = moment.displayName || moment.login
  // h:mm:ss through pulse-core, with 'about' when only the minute is known (K1, 11-13)
  const clock = momentRowClock(moment.offsetSeconds)
  const offset = momentRowClockText(moment.offsetSeconds)
  const occurrenceDateTime = formatMomentDateTime(moment.at)
  const occurrenceLabel = occurrenceDateTime ? formatMomentOccurrence(occurrenceDateTime) : null
  const occurrenceAge = useMomentRelativeAge(occurrenceDateTime)
  // The Hub's rule (X1, 11-13): a stream's first 20 minutes show their rates, no ×; its first 5 are tagged
  // 'Stream start' with pulse-core's edge rule (E1). The backend's edge flag wins where the data carries it,
  // so a flagged closing minute reads 'Stream end' beside its × (round 2).
  const early = earlyInStream(moment.offsetSeconds)
  const edge = momentEdge(moment.offsetSeconds, moment.streamEdge)
  const badge = early ? null : momentComparisonBadge(moment.comparison, moment.reactionSignal)
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
      onSelect(moment, event.currentTarget)
    }}
  >
    {/* Every row keeps the 88 px slot, so titles, times and emotes line up (Z03, 11-13); it hides in a narrow list. */}
    <div className="moments-card-slot" aria-hidden={artwork ? undefined : 'true'}>{artwork ? <MomentArchiveArtwork artwork={artwork} /> : null}</div>
    {creator}
    <div className="moments-result-body">
      <p className="moments-result-title">
        {rank != null ? <b className="moments-result-rank" aria-hidden="true">#{rank}</b> : null}
        <button
          type="button"
          className="moments-card-primary"
          data-discovery-key={moment.key}
          // A row that opens in line closes its open detail when pressed again: name that action.
          aria-label={`${moment.label} — ${detailId && selected ? 'Close' : 'Open'} moment for ${name} at ${offset} into broadcast`}
          aria-current={selected ? 'true' : undefined}
          aria-expanded={detailId ? selected : undefined}
          aria-controls={detailId && selected ? detailId : undefined}
          onClick={event => onSelect(moment, event.currentTarget.closest('article'))}
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
        {/* 'about' is quiet beside the time, as in the session rows and the extension (K1, 11-14) */}
        <span className="moments-result-offset">{clock.approximate ? <><span className="moments-result-about">about</span>{' '}</> : null}{clock.text} into broadcast</span>
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
        {/* The figure in pulse-core's words ("3.7× more emotes", Z06), and the full claim stays on
            the title. A value under 1× is a dip, not a spike, and is styled as plainly as one.
            Early in the stream there is no × to show: the rates stand, with the reason. */}
        {early ? <span className="moments-result-early">{edge ? streamEdgeLabel(edge) : EARLY_STREAM_WORDS}</span>
          : <>{edge ? <span className="moments-result-early">{streamEdgeLabel(edge)}</span> : null}
            {badge ? <span className="moments-result-ratio" data-below={badge.belowBaseline ? 'true' : undefined} title={badge.long}>{badge.words ?? `${badge.label} new`}</span> : null}</>}
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
