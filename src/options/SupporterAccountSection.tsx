import { useCallback, useEffect, useState } from 'react'
import { AccountConnection } from './AccountConnection.tsx'
import { SupporterOffer } from './SupporterOffer.tsx'
import { PulseSectionCard } from '../ui/PulseSectionCard.tsx'
import {
  SUPPORTER_BADGE_TENURES,
  SupporterBadge,
  supporterBadgeTenureForMonths,
  type SupporterBadgeTenure,
} from '../ui/SupporterBadge.tsx'
import type { SupporterCosmetics, SupporterEntitlement } from '../shared/supporterAccount.ts'
import { SupporterCosmeticControls } from './SupporterCosmeticControls.tsx'

const STAGE_DETAILS: Record<SupporterBadgeTenure, { title: string; detail: string }> = {
  new: { title: 'First signal', detail: 'A clean mint outline starts the ladder.' },
  '3m': { title: 'Signal set', detail: 'The frame opens into a blue six-sided mark.' },
  '6m': { title: 'Steady signal', detail: 'An amethyst shield adds a second rank mark.' },
  '12m': { title: 'Year-one crest', detail: 'A gold peak and three marks make the first year distinct.' },
  '24m': { title: 'Two-year pinnacle', detail: 'The final crest gains a crown, a second metal, and its own silhouette.' },
}

/** Temporary drafts only. Account linking and equip must use the BFF when released. */
export function SupporterAccountSection() {
  const [tenure, setTenure] = useState<SupporterBadgeTenure>('new')
  const [tenureWasSelected, setTenureWasSelected] = useState(false)
  const [showBadge, setShowBadge] = useState(true)
  const [entitlement, setEntitlement] = useState<SupporterEntitlement | null>(null)
  const savedCosmetics = useCallback((cosmetics: SupporterCosmetics) => {
    setEntitlement(current => current?.state === 'ready' ? { ...current, cosmetics } : current)
  }, [])
  const activeSupporter = entitlement?.state === 'ready'
    && (entitlement.status === 'active' || entitlement.status === 'grace')
  const finishEnabled = activeSupporter && entitlement?.state === 'ready'
    && entitlement.features.includes('supporter.finish.v1')
  const finish = finishEnabled && entitlement?.state === 'ready' && entitlement.cosmetics?.enabled
    ? entitlement.cosmetics.finish
    : null
  const currentTenure = entitlement?.state === 'ready'
    && (entitlement.status === 'active' || entitlement.status === 'grace')
    && entitlement.supportPeriods > 0
    ? supporterBadgeTenureForMonths(entitlement.supportPeriods)
    : null
  const supportPeriods = entitlement?.state === 'ready' ? entitlement.supportPeriods : undefined
  const selectedTenure = SUPPORTER_BADGE_TENURES.find(option => option.id === tenure) ?? SUPPORTER_BADGE_TENURES[0]
  const currentStageIndex = currentTenure === null
    ? -1
    : SUPPORTER_BADGE_TENURES.findIndex(option => option.id === currentTenure)

  useEffect(() => {
    if (entitlement?.state !== 'ready') {
      if (!tenureWasSelected) setTenure('new')
      return
    }
    if (!tenureWasSelected && supportPeriods !== undefined) setTenure(supporterBadgeTenureForMonths(supportPeriods))
  }, [entitlement?.state, supportPeriods, tenureWasSelected])

  return (
    <div className="pulse-supporter-settings">
      <div className="pulse-settings-workspace-heading">
        <h2>Account &amp; Supporter</h2>
        <p>Your account, membership, and private Pulse appearance.</p>
      </div>
      <AccountConnection />
      <SupporterOffer onEntitlement={setEntitlement} />
      <SupporterCosmeticControls entitlement={entitlement} onSaved={savedCosmetics} />
      <PulseSectionCard
        title="Badge preview"
        headingLevel={3}
        subtitle="Explore five visual milestones locally. This does not alter Twitch chat or publish a badge."
      >
        <div className="pulse-supporter-preview-intro" data-supporter-preview-mode="local">
          <div>
            <span className="pulse-supporter-preview-kicker">Local preview</span>
            <p>{currentTenure ? `Service reports ${SUPPORTER_BADGE_TENURES.find(option => option.id === currentTenure)?.label} of support. Explore the full artwork ladder below.` : 'Select a stage to compare its artwork at preview and chat size.'}</p>
          </div>
          <span className="pulse-supporter-preview-note">Not a Twitch badge</span>
        </div>
        <fieldset className="pulse-supporter-badge-choices pulse-supporter-tenure-choices">
          <legend>Tenure preview</legend>
          {SUPPORTER_BADGE_TENURES.map((option, index) => {
            const stageState = currentStageIndex < 0
              ? 'preview'
              : index < currentStageIndex
                ? 'reported-earlier'
                : index === currentStageIndex
                  ? 'reported-current'
                  : 'future'
            return (
              <label
                key={option.id}
                data-selected={tenure === option.id ? 'true' : 'false'}
                data-stage-state={stageState}
                data-pinnacle={option.id === '24m' ? 'true' : undefined}
                title={`${option.label} artwork preview`}
              >
                <input type="radio" name="supporter-badge-preview" value={option.id} aria-label={option.label} checked={tenure === option.id} onChange={() => { setTenureWasSelected(true); setTenure(option.id) }} />
                <span className="pulse-supporter-tenure-ordinal">{String(index + 1).padStart(2, '0')} / 05</span>
                <SupporterBadge tenure={option.id} finish={finish} size={option.id === '24m' ? 40 : 32} />
                <strong>{option.label}</strong>
                <small>{stageState === 'reported-current' ? 'Reported now' : stageState === 'reported-earlier' ? 'Reported earlier' : stageState === 'future' ? 'Future preview' : 'Artwork preview'}</small>
              </label>
            )
          })}
        </fieldset>
        <div className="pulse-supporter-stage-detail" aria-live="polite">
          <span className="pulse-supporter-stage-detail__mark" aria-hidden="true"><SupporterBadge tenure={tenure} finish={finish} size={44} /></span>
          <div>
            <span className="pulse-supporter-stage-detail__eyebrow">{selectedTenure.label} · enlarged artwork</span>
            <strong>{STAGE_DETAILS[tenure].title}</strong>
            <p>{STAGE_DETAILS[tenure].detail}</p>
          </div>
        </div>
        <p className="pulse-supporter-chat-label">Actual chat size · 18 px</p>
        <div className="pulse-supporter-chat-preview" aria-label="Sample compatible StreamPulse chat message">
          <div className="pulse-supporter-chat-preview__message">
            <span className="pulse-supporter-chat-preview__badge" aria-hidden="true">{showBadge ? <SupporterBadge key={tenure} tenure={tenure} finish={finish} size={18} /> : null}</span>
            <strong>YourName</strong><span className="pulse-supporter-chat-preview__separator">:</span><span>That deserves a clip.</span>
          </div>
          <span className="pulse-supporter-chat-preview__meta" aria-live="polite">{showBadge ? `${selectedTenure.label} recognition preview` : 'Badge hidden in preview'}</span>
        </div>
        <label className="pulse-supporter-preview-toggle">
          <input type="checkbox" checked={showBadge} onChange={event => setShowBadge(event.target.checked)} />
          Show badge in this preview
        </label>
        <p className="pulse-supporter-detail">Reported stages use the service’s support-period count; exact tenure still needs ledger reconciliation. All badge artwork here is preview-only; nothing is equipped, published, or injected into Twitch chat.</p>
      </PulseSectionCard>
      <PulseSectionCard title="Shared chat badge" headingLevel={3}>
        <p className="pulse-supporter-detail">Not included yet. A shared badge will require a linked Twitch account and your permission. Only compatible StreamPulse viewers will see it; it is not an official Twitch badge.</p>
      </PulseSectionCard>
    </div>
  )
}
