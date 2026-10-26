import type { CSSProperties } from 'react'
import type { SupporterPaintStyle, SupporterTenure } from '../shared/supporterPaint.ts'
import type { PulseBannerPreference } from '../shared/storage.ts'
import { finishVars } from '../supporter/kit.ts'
import { PulseBannerBackdrop } from '../ui/PulseBanner.tsx'
import { names as PERK_NAMES } from '../shared/supporter-perks.json'
import { StreamPulseTitleBlock } from '../ui/StreamPulseTitleBlock.tsx'
import type { SupporterFinishId } from '../ui/supporterFinish.ts'

/**
 * The Your look studio's live preview, pinned above its controls so every
 * choice shows at once: your Pulse panel's header in the paint, crest and
 * emote rain being tried, and your line on the Supporter card. It says once
 * that only you see this, and that everyone else on Twitch sees normal chat.
 * Every perk (the one list in src/shared/supporter-perks.json) is named under
 * it. Nothing unbuilt is shown: the preview draws with the overlay's own
 * paint, crest and rain styles.
 */
export function SupporterLookPreview({ finish, paint, tenure, rain, shown, hideStateLabel = false }: {
  finish: SupporterFinishId | null
  paint: SupporterPaintStyle
  tenure: SupporterTenure
  /** The emote rain behind your panel: being tried, the sample's, or a Supporter's own. */
  rain: PulseBannerPreference
  /** Whose look it wears: a Supporter's own, the sample, or one being tried; unset while membership is unknown. */
  shown?: 'own' | 'sample' | 'trying'
  hideStateLabel?: boolean
}) {
  return (
    <div className="pulse-supporter-preview" data-supporter-preview={shown ?? 'pending'} style={finishVars(finish) as CSSProperties}>
      <div role="img" aria-label={`Preview of your Pulse panel title${finish ? ' in your paint, with your crest' : ''}, and your line on the Supporter card`}>
        <div className="pulse-supporter-mini-head pulse-personal-panel" aria-hidden="true">
          <PulseBannerBackdrop value={{ ...rain, intensity: Math.min(rain.intensity, 30) }} perks />
          <span className="pulse-supporter-preview-badge">Preview · only you see this</span>
          <StreamPulseTitleBlock finish={finish} tenure={tenure} paint={paint} statusLabel="Live chart" statusTone="live" />
        </div>
        <p className="pulse-supporter-chat-line" aria-hidden="true">
          {finish ? <i className="pulse-crest" data-tenure={tenure} /> : null}
          {finish
            ? <b className="pulse-paint" data-finish={finish} data-wave={paint.wave} data-sheen={paint.sheen} data-text="you">you</b>
            : <b>you</b>}
          : here again
        </p>
      </div>
      <div className="pulse-supporter-preview-foot">
        <span>Everyone else on Twitch sees normal chat.</span>
        <small data-supporter-perk-names="true">{PERK_NAMES.join(' · ')}</small>
        {shown && !hideStateLabel ? <small>{shown === 'own' ? 'Your look' : shown === 'trying' ? 'Trying' : 'Sample look'}</small> : null}
      </div>
    </div>
  )
}
