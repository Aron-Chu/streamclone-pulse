import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { sendBackgroundMessage } from '../content/bridge.ts'
import { mountEmotePile } from '../supporter/emotePile.ts'
import { SAMPLE_KIT, finishVars, type Kit } from '../supporter/kit.ts'
import { PeakMark } from '../ui/PeakMark.tsx'
import { useSupporterAppearanceDetails } from '../ui/useSupporterAppearance.ts'
import { useSignatureEmote } from './useSignatureEmote.ts'

/** The lab's Crown copy (`wide`), saying who sees it. */
export const CROWN_COPY = 'Your signature emote lands on top, crest and all. Only you see it. Core Pulse tools stay free.'
/** How long the banner waits for the membership answer before showing the sample pile. */
const SAMPLE_AFTER_MS = 1200

/**
 * The full-settings Supporter banner: the design lab's "Emote Pile · Crown".
 * Chat emotes drop, bounce and stack behind the copy; every so often a
 * signature emote drops in bigger, glowing in its paint with a crest riding on
 * it. A Supporter sees their own signature emote, paint and crest; everyone
 * else sees the lab's sample.
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
  const signature = useSignatureEmote()
  // The pile starts once it knows whose kit to draw, so a Supporter never sees
  // the sample swap for their own; a slow answer falls back to the sample.
  const [waited, setWaited] = useState(false)
  useEffect(() => { const timer = window.setTimeout(() => setWaited(true), SAMPLE_AFTER_MS); return () => window.clearTimeout(timer) }, [])
  const kit: Kit | null = known && perks && appearance
    ? (signature.ready ? { name: 'you', finish: appearance.finish, tenure: appearance.tenure ?? 'new', emote: signature.value, paint: appearance.paint } : null)
    : known || waited ? { ...SAMPLE_KIT } : null
  const shown = kit ?? SAMPLE_KIT
  return (
    <button
      type="button"
      className="pulse-settings-supporter-banner"
      data-settings-host-banner="supporter"
      data-supporter-kit={kit ? (perks ? 'own' : 'sample') : 'pending'}
      onClick={onOpen}
      style={finishVars(shown.finish) as CSSProperties}
    >
      <EmotePileStage kit={kit} />
      <span className="pulse-settings-supporter-banner-plate">
        <span className="pulse-settings-supporter-banner-mark" aria-hidden="true"><PeakMark size={20} strokeWidth={1.8} /></span>
        <span className="pulse-settings-supporter-banner-copy">
          <strong>Pulse Supporter</strong>
          <small>{CROWN_COPY}</small>
        </span>
      </span>
      <span className="pulse-settings-supporter-banner-arrow">View benefits <span aria-hidden="true">→</span></span>
    </button>
  )
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
