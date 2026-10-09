import type { CSSProperties } from 'react'
import type { SupporterPaintStyle, SupporterTenure } from '../shared/supporterPaint.ts'
import type { PulseBannerPreference } from '../shared/storage.ts'
import { finishVars } from '../supporter/kit.ts'
import { PulseBannerBackdrop } from '../ui/PulseBanner.tsx'
import { names as PERK_NAMES } from '../shared/supporter-perks.json'
import { PulseSectionCard } from '../ui/PulseSectionCard.tsx'
import { StreamPulseTitleBlock } from '../ui/StreamPulseTitleBlock.tsx'
import type { SupporterFinishId } from '../ui/supporterFinish.ts'

const EYE = <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><path fill="none" stroke="currentColor" strokeWidth="1.6" d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8Z" /><circle cx="8" cy="8" r="2" fill="currentColor" /></svg>

/**
 * "Who sees what": every Supporter perk (the one list in
 * src/shared/supporter-perks.json) shows only in your own extension, and
 * everyone else on Twitch sees normal chat. Shown in the look being tried or
 * worn. Nothing unbuilt is shown here: the purchase page offers only what ships.
 */
export function SupporterWhoSees({ finish, paint, tenure, rain, shown }: {
  finish: SupporterFinishId | null
  paint: SupporterPaintStyle
  tenure: SupporterTenure
  /** The emote rain behind your panel: the sample's, or what a Supporter has chosen. */
  rain: PulseBannerPreference
  /** Whose look the previews wear: a Supporter's own, the sample, or one being tried. */
  shown: 'own' | 'sample' | 'trying'
}) {
  return (
    <PulseSectionCard title="Who sees what" headingLevel={3} meta={shown === 'sample' ? 'Shown with the sample look' : shown === 'trying' ? 'Shown with the look you’re trying' : undefined}>
      <ul className="pulse-supporter-who" style={finishVars(finish) as CSSProperties}>
        <li>
          <div className="pulse-supporter-who-label">
            <strong>You</strong>
            <span className="pulse-supporter-vis">{EYE}Only you</span>
            <small>Your Pulse panel, quick settings and settings</small>
            <small data-supporter-perk-names="true">{PERK_NAMES.join(' · ')}</small>
          </div>
          <div className="pulse-supporter-who-preview" role="img" aria-label={`Your Pulse panel title${finish ? ' in your paint, with your crest' : ''}, and your line on the Supporter card`}>
            <div className="pulse-supporter-mini-head pulse-personal-panel" aria-hidden="true">
              <PulseBannerBackdrop value={{ ...rain, intensity: Math.min(rain.intensity, 30) }} perks />
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
        </li>
        <li>
          <div className="pulse-supporter-who-label">
            <strong>Everyone else on Twitch</strong>
            <small>Normal chat. Nothing added.</small>
          </div>
          <div className="pulse-supporter-who-preview" role="img" aria-label="Your name in normal Twitch chat, with nothing added">
            <p className="pulse-supporter-chat-line" aria-hidden="true"><b style={{ color: '#bf94ff' }}>YourName</b>: That deserves a clip.</p>
          </div>
        </li>
      </ul>
    </PulseSectionCard>
  )
}
