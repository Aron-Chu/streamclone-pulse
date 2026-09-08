import type { DiscoveryMoment } from '../../../lib/discoveryMoments'
import { momentComparisonSummary } from '../../../lib/momentComparison'
import { EmoteImg } from '../analytics/EmoteImg'

function displayRate(value: number | undefined): string {
  return value != null && Number.isFinite(value)
    ? value.toLocaleString(undefined, { maximumFractionDigits: 1 })
    : 'Unavailable'
}

function displayProvider(provider?: string): string {
  const normalized = provider?.trim().toLowerCase()
  if (normalized === 'seventv' || normalized === '7tv') return '7TV'
  if (normalized === 'betterttv' || normalized === 'bttv') return 'BTTV'
  if (normalized === 'frankerfacez' || normalized === 'ffz') return 'FFZ'
  if (normalized === 'twitch') return 'Twitch'
  return provider?.trim() || 'Provider unavailable'
}

/**
 * Honest visual fallback for a result whose exact broadcast thumbnail has not
 * been supplied. This renders measured reaction evidence only; it is never a
 * video, category image, source check, or implied playable preview.
 */
export function MomentReactionVisual({ moment }: { moment: DiscoveryMoment }) {
  const emotes = moment.topEmotes?.slice(0, 3) ?? []
  const comparison = momentComparisonSummary(moment.comparison, moment.reactionSignal)
  const hasRates = moment.chatPerMin != null || moment.emotesPerMin != null

  if (!hasRates && emotes.length === 0 && !comparison) return <div className="moments-reaction-visual" aria-label="Preview unavailable">
    <div className="moments-reaction-visual__metric"><span>Preview unavailable</span><p className="moments-reaction-visual__availability">No broadcast image or reaction detail is available for this detection.</p></div>
  </div>

  return <div className="moments-reaction-visual" aria-label={`Measured reaction snapshot for ${moment.displayName || moment.login}; not a video preview`}>
    <div className="moments-reaction-visual__metric">
      <span>One-minute detection</span>
      {!hasRates ? (
        <p className="moments-reaction-visual__availability">Aggregate chat and emote rates were not supplied for this archived detection.</p>
      ) : (
        <dl>
          <div className={moment.reactionSignal === 'chat' ? 'is-primary' : undefined}><dt>Chat / min</dt><dd>{displayRate(moment.chatPerMin)}</dd></div>
          <div className={moment.reactionSignal === 'emotes' ? 'is-primary' : undefined}><dt>Emotes / min</dt><dd>{displayRate(moment.emotesPerMin)}</dd></div>
        </dl>
      )}
      {comparison ? <p>{comparison}</p> : null}
    </div>
    {emotes.length ? <div className="moments-reaction-visual__emotes" aria-label="Top measured emote reactions">
      <span className="moments-reaction-visual__emotes-label">Top reactions</span>
      <div className="moments-reaction-visual__emote-list">
        {emotes.map((emote, index) => <span className="moments-reaction-visual__emote" key={`${emote.provider || ''}:${emote.name}:${index}`} title={`${emote.name}${emote.count != null ? ` · ${displayRate(emote.count)} uses` : ''} · ${displayProvider(emote.provider)}`}>
          <EmoteImg name={emote.name} src={emote.imageUrl} width={36} height={36} displayPx={36} hideFallbackText />
          <span className="moments-reaction-visual__emote-copy">
            <strong>{emote.name}</strong>
            <small>{emote.count != null && Number.isFinite(emote.count) && emote.count >= 0 ? `${displayRate(emote.count)} uses` : 'Count unavailable'} · {displayProvider(emote.provider)}</small>
          </span>
        </span>)}
      </div>
    </div> : <span className="moments-reaction-visual__empty">Emote detail unavailable</span>}
    <span className="moments-reaction-visual__caption">Measured chat evidence · not footage</span>
  </div>
}
