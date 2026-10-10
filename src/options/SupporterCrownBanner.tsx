import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { sendBackgroundMessage } from '../content/bridge.ts'
import { mountEmotePile } from '../supporter/emotePile.ts'
import { FINISHES, SAMPLE_KIT, TENURES, finishVars, kitEmoteSrc, tenureIndex, type Kit } from '../supporter/kit.ts'
import { PeakMark } from '../ui/PeakMark.tsx'
import { names as PERK_NAMES, seenInChat as SEEN_IN_CHAT } from '../shared/supporter-perks.json'
import { useChatBadgeListReceived } from './useChatBadges.ts'
import { useSupporterAppearanceDetails } from '../ui/useSupporterAppearance.ts'

/** How long the banner waits for the membership answer before showing the sample pile. */
const SAMPLE_AFTER_MS = 1200
/** USD only at launch, matching the public /supporter page. */
const PRICE_SHORT = 'US$4.99/mo'

/**
 * The full-settings Supporter banner, "Crown, staged" (direction B of the
 * 2026-10-07 banner round): the lab's Emote Pile gets the whole right half and
 * runs calmer, with a soft glow at each peak. Every so often your crest drops
 * in on top, bigger and glowing in your paint, with a small "you" tag. The
 * copy names every perk as a chip, in the order of the one perk list
 * (src/shared/supporter-perks.json): title paint, tenure crest, emote rain,
 * Supporter card.
 * A Supporter sees their own paint and crest; everyone else sees the lab's
 * sample, with the price.
 *
 * It owns the settings page's membership check (the same worker reply the
 * overlay header uses) and reports whether perks are on, so the page's other
 * controls never start a second poll. Until a verified answer arrives it
 * reports undefined, so those controls wait instead of guessing.
 */
export function SupporterBanner({ onOpen, onPerks }: { onOpen: () => void; onPerks?: (perks: boolean | undefined) => void }) {
  const [answered, setAnswered] = useState(false)
  const request = useCallback(() => sendBackgroundMessage({ type: 'SUPPORTER_APPEARANCE' }).then(reply => {
    if (reply && 'type' in reply && reply.type === 'SUPPORTER_APPEARANCE' && !reply.unverified) setAnswered(true)
    return reply
  }), [])
  const appearance = useSupporterAppearanceDetails(request)
  const perks = appearance?.perks === true
  // An inherited verified appearance is an answer too.
  const known = answered || appearance !== null
  useEffect(() => { onPerks?.(known ? perks : undefined) }, [known, perks, onPerks])
  // The pile starts once it knows whose kit to draw, so a Supporter never sees
  // the sample swap for their own; a slow answer falls back to the sample.
  const [waited, setWaited] = useState(false)
  useEffect(() => { const timer = window.setTimeout(() => setWaited(true), SAMPLE_AFTER_MS); return () => window.clearTimeout(timer) }, [])
  const kit: Kit | null = known && perks && appearance
    ? { name: 'you', finish: appearance.finish, tenure: appearance.tenure ?? 'new', paint: appearance.paint }
    : known || waited ? { ...SAMPLE_KIT } : null
  const shown = kit ?? SAMPLE_KIT
  const state = kit ? (perks ? 'own' : 'sample') : 'pending'
  const own = state === 'own'
  // Seen in chat is named only once this browser has received a list (the feature is live).
  const [seenInChat] = useChatBadgeListReceived()
  return (
    <div className="pulse-settings-supporter-banner-frame">
      <button
        type="button"
        className="pulse-settings-supporter-banner"
        data-settings-host-banner="supporter"
        data-supporter-kit={state}
        onClick={onOpen}
        style={finishVars(shown.finish) as CSSProperties}
      >
        <EmotePileStage kit={kit} />
        <span className="pulse-settings-supporter-banner-copy">
          <span className="pulse-settings-supporter-banner-eyebrow">
            <PeakMark size={13} strokeWidth={2} stroke="currentColor" />
            <span>{own ? 'Your kit' : 'Pulse Supporter'}</span>
            {state === 'sample' ? <em>· {PRICE_SHORT}</em> : null}
          </span>
          <strong>{own ? 'Yours lands on top' : 'Your crest lands on top'}</strong>
          <span className="pulse-settings-supporter-banner-perks">
            <BannerPerks kit={shown} own={own} seenInChat={seenInChat} />
          </span>
          <small>{seenInChat
            ? own ? 'Only you see your kit, unless you turn on Seen in chat. Core tools stay free.' : 'Only you see them, unless you turn on Seen in chat. Core tools stay free.'
            : own ? 'Only you see your kit. Core tools stay free.' : 'Only you see them. Core tools stay free.'}</small>
        </span>
        <span className="pulse-settings-supporter-banner-arrow">View benefits <span aria-hidden="true">→</span></span>
      </button>
    </div>
  )
}

/**
 * Every perk as a chip, named and ordered by the one perk list. The sample
 * names them; a Supporter's paint and crest chips name their own kit.
 */
function BannerPerks({ kit, own, seenInChat = false }: { kit: Kit; own: boolean; seenInChat?: boolean }) {
  const finish = own ? kit.finish : SAMPLE_KIT.finish
  const [paint, crest, rain, card] = PERK_NAMES
  return <>
    <span className="pulse-settings-supporter-perk" data-perk="paint">
      <i className="pulse-settings-supporter-swatch" style={{ background: finish ? FINISHES[finish].paint : 'var(--pulse-accent-soft, #c4b5fd)' }} aria-hidden="true" />
      {own ? (finish ? `${FINISHES[finish].label} paint` : 'Default paint') : paint}
    </span>
    <span className="pulse-settings-supporter-perk" data-perk="crest">
      <i className="pulse-crest" data-tenure={kit.tenure} aria-hidden="true" />
      {own ? TENURES[tenureIndex(kit.tenure)].title : crest}
    </span>
    <span className="pulse-settings-supporter-perk" data-perk="rain">
      <img src={kitEmoteSrc('PepePls', true)} alt="" draggable={false} decoding="async" referrerPolicy="no-referrer" onError={event => { event.currentTarget.style.visibility = 'hidden' }} />
      {rain}
    </span>
    <span className="pulse-settings-supporter-perk" data-perk="card">
      <PeakMark size={13} strokeWidth={2} stroke="currentColor" />
      {card}
    </span>
    {seenInChat ? <span className="pulse-settings-supporter-perk" data-perk="seen-in-chat">
      <i className="pulse-crest" data-tenure={kit.tenure} aria-hidden="true" />
      {SEEN_IN_CHAT.name}
    </span> : null}
  </>
}

/** The Crown pile behind the banner copy; decorative, so hidden from assistive tech. */
function EmotePileStage({ kit }: { kit: Kit | null }) {
  const ref = useRef<HTMLSpanElement>(null)
  const key = kit ? JSON.stringify(kit) : ''
  useEffect(() => {
    const stage = ref.current
    return stage && key ? mountEmotePile(stage, JSON.parse(key) as Kit) : undefined
  }, [key])
  return <span ref={ref} className="pulse-supporter-pile" aria-hidden="true" />
}
