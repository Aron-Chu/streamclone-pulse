import type { CSSProperties } from 'react'
import type { SupporterPaintStyle, SupporterTenure } from '../shared/supporterPaint.ts'
import type { PulseBannerPreference } from '../shared/storage.ts'
import { finishVars, TENURES, tenureIndex } from '../supporter/kit.ts'
import { PulseBannerBackdrop } from '../ui/PulseBanner.tsx'
import { names as PERK_NAMES } from '../shared/supporter-perks.json'
import { StreamPulseTitleBlock } from '../ui/StreamPulseTitleBlock.tsx'
import { SUPPORTER_FINISH_OPTIONS, type SupporterFinishId } from '../ui/supporterFinish.ts'

/**
 * The Your look studio's live preview, pinned above its controls so every
 * choice shows at once: your Pulse panel's header in the look being tried
 * (paint, motion and backdrop) with your crest, and your line on the Supporter
 * card. The crest is earned, so it shows under every paint, Default included,
 * and its stage is named under the preview. It says once that only you see
 * this, and that everyone else on Twitch sees normal chat. Every perk (the one
 * list in src/shared/supporter-perks.json) is named under it. Nothing unbuilt
 * is shown: the preview draws with the overlay's own paint, crest and
 * backdrop styles.
 */
export function SupporterLookPreview({ finish, paint, tenure, banner, name, shown, hideStateLabel = false, seenInChat = false }: {
  finish: SupporterFinishId | null
  paint: SupporterPaintStyle
  tenure: SupporterTenure
  /** The backdrop behind your panel: being tried, the sample's, or a Supporter's own. */
  banner: PulseBannerPreference
  /** The look's name, for the preview's description. */
  name: string
  /** Whose look it wears: a Supporter's own, the sample, or one being tried; unset while membership is unknown. */
  shown?: 'own' | 'sample' | 'trying'
  hideStateLabel?: boolean
  seenInChat?: boolean
}) {
  const stage = TENURES[tenureIndex(tenure)]
  const paintLabel = SUPPORTER_FINISH_OPTIONS.find(option => option.id === finish)?.label
  const description = `Preview of the ${name} look: your Pulse panel title in ${paintLabel ? `${paintLabel} paint` : 'the default colour'}, ${banner.mode === 'off' ? 'no backdrop' : 'the backdrop on'}, your ${stage.title} crest, and your line on the Supporter card`
  return (
    <div className="pulse-supporter-preview" data-supporter-preview={shown ?? 'pending'} style={finishVars(finish) as CSSProperties}>
      <div role="img" aria-label={description}>
        <div className="pulse-supporter-mini-head pulse-personal-panel" aria-hidden="true">
          <PulseBannerBackdrop value={banner} finish={finish} perks />
          <span className="pulse-supporter-preview-badge">Preview · only you see this</span>
          <StreamPulseTitleBlock finish={finish} tenure={tenure} paint={paint} statusLabel="Live chart" statusTone="live" />
        </div>
        <p className="pulse-supporter-chat-line" aria-hidden="true">
          <i className="pulse-crest" data-tenure={tenure} />
          {finish
            ? <b className="pulse-paint" data-finish={finish} data-wave={paint.wave} data-sheen={paint.sheen} data-text="you">you</b>
            : <b>you</b>}
          : here again
        </p>
      </div>
      <div className="pulse-supporter-preview-foot">
        <span>{seenInChat ? 'This preview is local. You can separately opt in to show your crest and paint to StreamPulse viewers in chat.' : 'Everyone else on Twitch sees normal chat.'}</span>
        <small data-supporter-crest-stage={tenure}>Crest: {stage.title} · {stage.label}</small>
        <small data-supporter-perk-names="true">{PERK_NAMES.join(' · ')}</small>
        {/* The card above already says "Sample look"; the preview names only a look that is yours or being tried. */}
        {shown && shown !== 'sample' && !hideStateLabel ? <small className="pulse-supporter-preview-state">{shown === 'own' ? 'Your look' : 'Trying'}</small> : null}
      </div>
    </div>
  )
}
