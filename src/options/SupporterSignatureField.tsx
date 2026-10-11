import { SIGNATURE_EMOTES } from '../shared/supporterSignature.ts'
import { kitEmoteSrc } from '../supporter/kit.ts'
import { useReducedMotion } from '../ui/motion/useReducedMotion.ts'
import { useSignatureEmote } from './useSignatureEmote.ts'

/**
 * The signature emote picker, in the Paint & crest card.
 *
 * A Supporter perk on the same rule as emote rain: `allowed` is
 * `supporterPerksAllowed` for this membership. Without it the choices are shown
 * but locked, and whatever was stored stays as it was for when the person
 * supports again. While membership is still being checked the choices wait,
 * neutral, rather than flashing the lock at a Supporter.
 */
export function SupporterSignatureField({ allowed, unknown }: { allowed: boolean; unknown: boolean }) {
  const signature = useSignatureEmote()
  const still = useReducedMotion()
  return <>
    <fieldset
      className="pulse-supporter-badge-choices pulse-supporter-signature-choices"
      disabled={!allowed || !signature.ready}
      aria-busy={unknown || undefined}
      data-supporter-perks={unknown ? 'pending' : allowed ? 'on' : 'locked'}
    >
      <legend>Signature emote</legend>
      {SIGNATURE_EMOTES.map(name => <label key={name} title={allowed ? name : 'Supporter perk'}>
        <input
          type="radio"
          name="supporter-signature"
          value={`signature-${name}`}
          aria-label={name}
          checked={signature.value === name}
          onChange={() => void signature.choose(allowed, name)}
        />
        <img src={kitEmoteSrc(name, still)} alt="" draggable={false} decoding="async" referrerPolicy="no-referrer" onError={event => { event.currentTarget.style.visibility = 'hidden' }} />
        <span className="pulse-supporter-finish-choice"><strong>{name}</strong></span>
      </label>)}
    </fieldset>
    {unknown ? null : <p className="pulse-supporter-detail" data-supporter-perk="signature-emote" aria-live="polite">
      {signature.status || (allowed
        ? 'Your signature emote saves to this browser profile right away. It rides your line on the Supporter card and lands on top of the emote pile. Only you see it.'
        : 'A signature emote is a Supporter perk. Only you see it.')}
    </p>}
  </>
}
