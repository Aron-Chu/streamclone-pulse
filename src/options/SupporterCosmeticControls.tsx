import { useEffect, useRef, useState } from 'react'
import { supporterPerksAllowed, type SupporterEntitlement, type SupporterCosmetics } from '../shared/supporterAccount.ts'
import { PulseSectionCard } from '../ui/PulseSectionCard.tsx'
import { supporterFinish, SUPPORTER_FINISH_OPTIONS } from '../ui/supporterFinish.ts'
import { StreamPulseTitleBlock, streamPulseHeaderChromeSidebar } from '../ui/StreamPulseTitleBlock.tsx'
import { theme } from '../ui/theme.ts'
import { PulseBannerBackdrop, usePulseBanner } from '../ui/PulseBanner.tsx'
import { supporterTenureForMonths } from '../shared/supporterPaint.ts'
import { SupporterPaintStyleFields, useSupporterPaintStyle } from './SupporterPaintStyleFields.tsx'
import { SupporterSignatureField } from './SupporterSignatureField.tsx'

/**
 * The finish paints the panel title, wave and sheen choose how that paint
 * moves, and the tenure crest sits beside it. The signature emote rides the
 * Supporter's line on the quick-settings card and tops the settings banner.
 * The preview reproduces that header rather than a
 * decorative plate: an earlier version previewed a tinted banner that the
 * overlay no longer draws, so the preview promised something the extension did
 * not render.
 */
export function SupporterCosmeticControls({ entitlement, onSaved }: {
  entitlement: SupporterEntitlement | null
  onSaved?: (cosmetics: SupporterCosmetics) => void
}) {
  const banner = usePulseBanner()
  const paint = useSupporterPaintStyle()
  // Nothing is presumed while the first answer is pending: a finish shown as
  // chosen then is one the person chose.
  const [finish, setFinish] = useState<SupporterCosmetics['finish'] | null>(null)
  const [appliedFinish, setAppliedFinish] = useState<SupporterCosmetics['finish'] | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const generation = useRef(0)
  const pending = useRef(false)
  const savedCosmetics = useRef<SupporterCosmetics | null>(null)
  // An explicit choice made before membership is verified. The worker keeps it
  // privately and applies it once the server grants Supporter access.
  const [intent, setIntent] = useState<SupporterCosmetics['finish'] | null>(null)
  const [intentBusy, setIntentBusy] = useState(false)
  const allowed = supporterPerksAllowed(entitlement)
  const entitlementState = entitlement?.state
  const entitlementStatus = entitlement?.state === 'ready' ? entitlement.status : undefined
  const cosmetics = entitlement?.state === 'ready' ? entitlement.cosmetics : undefined
  const tenure = entitlement?.state === 'ready' ? supporterTenureForMonths(entitlement.supportPeriods) : 'new'
  // Loading, or a background read that could not confirm the last status: the
  // controls pause rather than switching to the pre-purchase mode, and the
  // user's selection is kept.
  const unknown = entitlement === null
  // Settings re-read membership by themselves now (after a purchase, a save or
  // a signal), so only a change to access or the applied finish may replace an
  // unsaved selection; a refreshed date, a support count or a brief unknown
  // read must not.
  const appliedKey = unknown ? null : JSON.stringify([entitlementState, entitlementStatus, allowed, cosmetics?.enabled ?? null, cosmetics?.finish ?? null])
  const lastAppliedKey = useRef<string | null>(null)
  // Access as last confirmed. A read that could not confirm it (the unknown
  // gap of a quiet re-check that failed and recovered) is not a change, so a
  // save in flight keeps its acknowledgment through it.
  const accessKey = unknown ? null : JSON.stringify([entitlementState, entitlementStatus, allowed])
  const lastAccessKey = useRef<string | null>(null)
  useEffect(() => {
    if (accessKey === null) return
    if (accessKey !== lastAccessKey.current) savedCosmetics.current = null
    lastAccessKey.current = accessKey
  }, [accessKey])
  // A finish chosen before the first answer arrives.
  const chosenWhileChecking = useRef(false)
  useEffect(() => {
    if (appliedKey === null || appliedKey === lastAppliedKey.current) return
    const firstAnswer = lastAppliedKey.current === null
    lastAppliedKey.current = appliedKey
    const activeFinish = allowed && cosmetics?.enabled ? cosmetics.finish : null
    setAppliedFinish(activeFinish)
    const acknowledgment = savedCosmetics.current
    // Our own save, seen here before or after its response arrives (the
    // worker's change signal can win that race), keeps its confirmation and
    // its in-flight result.
    if (acknowledgment && acknowledgment.enabled === cosmetics?.enabled && acknowledgment.finish === cosmetics?.finish) return
    // A remote change replaces both the draft and the applied preview, and an
    // in-flight save from before it no longer applies.
    savedCosmetics.current = null
    generation.current++
    pending.current = false
    setBusy(false)
    // The first answer keeps what the person chose while it was pending; after
    // that, a change to access or the applied finish replaces the draft.
    if (!(firstAnswer && chosenWhileChecking.current)) setFinish(cosmetics ? activeFinish : 'glass')
    setNotice('')
  }, [appliedKey])
  // A save in flight belongs to this view only.
  useEffect(() => () => { generation.current++ }, [])
  // Read the saved choice only while it could still matter, and only once.
  const intentRead = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    if (allowed || unknown || intentRead.current) return
    intentRead.current = true
    void Promise.resolve(globalThis.chrome?.runtime?.sendMessage?.({ type: 'SUPPORTER_FINISH_INTENT' }))
      .then(response => {
        if (!mounted.current || response?.type !== 'SUPPORTER_FINISH_INTENT') return
        setIntent(response.finish)
        if (response.finish) setFinish(current => current === 'glass' ? response.finish : current)
      })
      .catch(() => { /* No saved choice is shown when the worker is unavailable. */ })
  }, [allowed, unknown])
  // Once access is verified the worker has applied (and cleared) the choice.
  useEffect(() => { if (allowed) setIntent(null) }, [allowed])
  async function chooseForLater(value: SupporterCosmetics['finish'] | null) {
    if (intentBusy) return
    setIntentBusy(true)
    setNotice('')
    try {
      const response = await chrome.runtime.sendMessage({ type: 'SUPPORTER_FINISH_INTENT', finish: value })
      if (response?.type !== 'SUPPORTER_FINISH_INTENT') throw new Error('worker unavailable')
      setIntent(response.finish)
      const label = SUPPORTER_FINISH_OPTIONS.find(option => option.id === response.finish)?.label
      setNotice(response.finish && label ? `${label} will be applied when your Supporter membership is confirmed.` : value === null ? 'Saved choice cleared.' : 'Could not save this choice. Please try again.')
    } catch {
      setNotice('Could not save this choice. Please try again.')
    } finally {
      setIntentBusy(false)
    }
  }
  const selectedLabel = SUPPORTER_FINISH_OPTIONS.find(option => option.id === finish)?.label ?? 'Default'
  const intentLabel = SUPPORTER_FINISH_OPTIONS.find(option => option.id === intent)?.label
  const appliedLabel = SUPPORTER_FINISH_OPTIONS.find(option => option.id === appliedFinish)?.label ?? 'Default'
  const unchanged = finish === appliedFinish

  function selectFinish(value: typeof finish) {
    if (lastAppliedKey.current === null) chosenWhileChecking.current = true
    setFinish(value)
    setNotice('')
  }

  async function save() {
    if (!allowed || pending.current || unchanged) return
    const current = generation.current
    const cosmetics: SupporterCosmetics = { enabled: finish !== null, finish: finish ?? 'glass' }
    pending.current = true
    setBusy(true)
    setNotice('')
    // Expect our own acknowledgment before asking, so a refresh it causes is recognised.
    savedCosmetics.current = cosmetics
    try {
      const response = await chrome.runtime.sendMessage({ type: 'SUPPORTER_COSMETICS', ...cosmetics })
      if (current !== generation.current) return
      if (response?.type !== 'SUPPORTER_COSMETICS' || !response.ok) {
        savedCosmetics.current = null
        setNotice('Could not save. Refresh your Supporter status and try again.')
        return
      }
      setAppliedFinish(finish)
      setNotice(finish ? `${selectedLabel} accent equipped.` : 'Default accent restored.')
      savedCosmetics.current = cosmetics
      onSaved?.(cosmetics)
    } catch {
      if (current === generation.current) {
        savedCosmetics.current = null
        setNotice('Could not save. Please try again.')
      }
    } finally {
      if (current === generation.current) {
        pending.current = false
        setBusy(false)
      }
    }
  }
  return <PulseSectionCard title="Paint & crest" headingLevel={3} subtitle="Your finish paints your panel title. Choose how it moves; your tenure crest sits beside it.">
    {/* True sidebar width on the real panel colour, rendering the same
        component the overlay renders, so this cannot promise a header the
        extension does not draw. */}
    <div className="pulse-supporter-finish-preview" aria-label={`${selectedLabel} sidebar header preview`} data-preview-finish={finish ?? 'default'} style={{ background: theme.bgCanvas, maxWidth: '100%', width: 'min(340px, 100%)' }}>
      <div className="pulse-personal-panel pulse-background-preview" style={{ ...streamPulseHeaderChromeSidebar, minHeight: 180 }}>
        <PulseBannerBackdrop value={banner.value} perks={allowed} paused />
        <div className="pulse-banner-copy"><StreamPulseTitleBlock title={banner.value.title || undefined} finish={finish} tenure={tenure} paint={paint.style} statusLabel="Live chart" statusTone="live" /></div>
      </div>
    </div>
    <p className="pulse-supporter-detail" data-supporter-accent-state={unchanged ? 'equipped' : 'preview'}>
      {unchanged ? `${appliedLabel} active` : `Preview: ${selectedLabel} / Active: ${appliedLabel}`}
    </p>
    <fieldset className="pulse-supporter-badge-choices" disabled={busy}><legend>Accent finish</legend>
      <label>
        <input type="radio" name="supporter-finish" value="finish-default" aria-label="Default" checked={finish === null} onChange={() => selectFinish(null)} />
        <span className="pulse-supporter-finish-swatch" style={{ background: 'var(--pulse-accent-soft, #a78bfa)' }} aria-hidden="true" />
        <span className="pulse-supporter-finish-choice"><strong>Default</strong><small>Your free theme</small></span>
      </label>
      {SUPPORTER_FINISH_OPTIONS.map(option => <label key={option.id} title={option.description}>
        <input
          type="radio"
          name="supporter-finish"
          value={`finish-${option.id}`}
          aria-label={option.label}
          checked={finish === option.id}
          onChange={() => selectFinish(option.id)}
        />
        <span className="pulse-supporter-finish-swatch" style={{ background: supporterFinish[option.id] }} aria-hidden="true" />
        <span className="pulse-supporter-finish-choice"><strong>{option.label}</strong><small>{option.description}</small></span>
      </label>)}
    </fieldset>
    <SupporterPaintStyleFields finish={finish} style={paint.style} onChoose={next => void paint.choose(next)} />
    <p className="pulse-supporter-detail" aria-live="polite">{paint.status || 'Wave and sheen save to this browser profile right away and show whenever your finish is equipped.'}</p>
    <SupporterSignatureField allowed={allowed} unknown={unknown} />
    <div className="pulse-account-link-actions">
      {unknown ? (
        <button type="button" disabled>Checking Supporter status…</button>
      ) : allowed ? (
        <button type="button" disabled={busy || unchanged} aria-busy={busy} onClick={() => void save()}>
          {busy ? 'Saving...' : unchanged ? (finish ? 'Equipped' : 'Default active') : finish ? 'Equip accent' : 'Use default'}
        </button>
      ) : finish && finish !== intent ? (
        <button type="button" disabled={intentBusy} aria-busy={intentBusy} onClick={() => void chooseForLater(finish)}>
          {intentBusy ? 'Saving...' : `Use ${selectedLabel} when Supporter starts`}
        </button>
      ) : (
        <button type="button" disabled>{finish ? `${selectedLabel} chosen` : 'Default active'}</button>
      )}
      {!allowed && !unknown && intent ? <button type="button" disabled={intentBusy} onClick={() => void chooseForLater(null)}>Clear choice</button> : null}
    </div>
    {!allowed && !unknown ? <p className="pulse-supporter-detail" data-supporter-finish-intent={intent ?? 'none'}>
      {intentLabel
        ? `${intentLabel} is applied automatically when your Supporter membership is confirmed. Until then, this is only a preview.`
        : 'Preview is free. Equipping an accent requires an active linked Supporter membership; you can choose one now to apply automatically once it starts.'}
    </p> : null}
    <p className="pulse-supporter-detail pulse-supporter-save-status" role="status">{notice}</p>
  </PulseSectionCard>
}
