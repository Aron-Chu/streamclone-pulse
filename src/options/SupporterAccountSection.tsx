import { useCallback, useState } from 'react'
import { supporterPerksAllowed, type SupporterCosmetics, type SupporterEntitlement, type SupporterFinish } from '../shared/supporterAccount.ts'
import { supporterTenureForMonths } from '../shared/supporterPaint.ts'
import { SAMPLE_KIT } from '../supporter/kit.ts'
import { usePulseBanner } from '../ui/PulseBanner.tsx'
import { SupporterCosmeticControls } from './SupporterCosmeticControls.tsx'
import { useSupporterPaintStyle } from './SupporterPaintStyleFields.tsx'
import { SupporterJourney } from './SupporterJourney.tsx'
import { SupporterWhoSees } from './SupporterWhoSees.tsx'

/** The sample look's emote rain, for everyone who has not unlocked their own. */
const SAMPLE_RAIN = { mode: 'rain', intensity: 35, title: '' } as const

/**
 * Account & Supporter, direction B "Your card" of the 2026-10-07 redesign:
 * your card (who you are, your membership, the crest ladder, and the one
 * action that matters now), who sees what, your look, then the account.
 *
 * A Supporter's card wears what they have equipped; everyone else's wears the
 * sample. "Who sees what" previews the paint being tried in "Your look".
 * Nothing here grants anything: membership comes from the worker's
 * server-checked projection.
 */
export function SupporterAccountSection() {
  const [entitlement, setEntitlement] = useState<SupporterEntitlement | null>(null)
  const [draft, setDraft] = useState<SupporterFinish | null | undefined>(undefined)
  const paint = useSupporterPaintStyle()
  const banner = usePulseBanner()
  const savedCosmetics = useCallback((cosmetics: SupporterCosmetics) => {
    setEntitlement(current => current?.state === 'ready' ? { ...current, cosmetics } : current)
  }, [])
  const perks = supporterPerksAllowed(entitlement)
  const equipped = perks && entitlement?.state === 'ready' && entitlement.cosmetics?.enabled ? entitlement.cosmetics.finish : null
  // The card wears a Supporter's equipped paint, or the sample; the previews wear what is being tried.
  const worn = perks ? equipped : SAMPLE_KIT.finish
  const tried = draft === undefined ? worn : draft
  const tenure = perks && entitlement?.state === 'ready' ? supporterTenureForMonths(entitlement.supportPeriods) : SAMPLE_KIT.tenure

  return (
    <div className="pulse-supporter-settings">
      <div className="pulse-settings-workspace-heading">
        <h2>Account &amp; Supporter</h2>
        <p>Your Supporter card, who sees what, and billing.</p>
      </div>
      <SupporterJourney onEntitlement={setEntitlement} look={{ finish: worn, paint: paint.style }}>
        <SupporterWhoSees finish={tried} paint={paint.style} tenure={tenure} rain={perks ? banner.value : SAMPLE_RAIN} shown={tried !== worn ? 'trying' : perks ? 'own' : 'sample'} />
        <SupporterCosmeticControls entitlement={entitlement} onSaved={savedCosmetics} onDraft={setDraft} />
      </SupporterJourney>
    </div>
  )
}
