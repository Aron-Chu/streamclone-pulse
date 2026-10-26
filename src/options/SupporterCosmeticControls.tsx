import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { supporterPerksAllowed, type SupporterEntitlement, type SupporterCosmetics } from '../shared/supporterAccount.ts'
import { finishVars, SAMPLE_KIT } from '../supporter/kit.ts'
import { PulseSectionCard } from '../ui/PulseSectionCard.tsx'
import { SUPPORTER_FINISH_OPTIONS } from '../ui/supporterFinish.ts'
import { usePulseBanner } from '../ui/PulseBanner.tsx'
import type { PulseBannerPreference } from '../shared/storage.ts'
import type { SupporterTenure } from '../shared/supporterPaint.ts'
import { TWITCH_SIGNIN_ENABLED } from '../shared/twitchSignIn.ts'
import { SupporterLookPreview } from './SupporterLookPreview.tsx'
import { SupporterPaintStyleFields, useSupporterPaintStyle } from './SupporterPaintStyleFields.tsx'

/** The sample look's emote rain, which anyone may try in the preview. */
const SAMPLE_RAIN = { mode: 'rain', intensity: 35, title: '' } as const

/**
 * The "Your look" studio: a live preview pinned above the paint, wave, sheen
 * and emote rain choices, so every click shows at once. The paint colours the
 * panel title, wave and sheen choose how that paint moves, the tenure crest
 * sits beside it, and emote rain falls behind the panel. The preview draws
 * with the overlay's own paint and crest styles, so nothing promises a look
 * the extension does not render.
 *
 * A paint is checked by the server and saved with Equip; wave, sheen and emote
 * rain save to this browser profile at once. Everyone else may try any look
 * (emote rain only in the preview) and choose a paint to apply when Supporter
 * starts.
 */
export function SupporterCosmeticControls({ entitlement, tenure, onSaved }: {
  entitlement: SupporterEntitlement | null
  /** The crest the preview wears: a Supporter's own, or the sample's. */
  tenure: SupporterTenure
  onSaved?: (cosmetics: SupporterCosmetics) => void
}) {
  const banner = usePulseBanner()
  // Emote rain tried without the perk: shown in the preview only, never saved.
  const [rainTry, setRainTry] = useState<PulseBannerPreference['mode']>(SAMPLE_RAIN.mode)
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
    if (!(firstAnswer && chosenWhileChecking.current)) setFinish(cosmetics ? activeFinish : SAMPLE_KIT.finish)
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
        if (response.finish) setFinish(current => current === SAMPLE_KIT.finish ? response.finish : current)
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
  const unchanged = finish === appliedFinish
  // Sign-ups closed: a choice is kept for when Supporter opens, not for a membership that cannot start yet.
  const checkoutOpen = entitlement?.state === 'ready' && entitlement.checkoutEnabled === true
  const checkoutAvailability = entitlement?.state === 'ready' && typeof entitlement.checkoutEnabled === 'boolean'
    ? entitlement.checkoutEnabled ? 'open' : 'closed'
    : entitlement?.state === 'not_linked' && !TWITCH_SIGNIN_ENABLED ? 'closed' : 'unknown'
  /** The swatch's state, as a chip on it: the paint you are trying, and the one in use. */
  const chip = (id: SupporterCosmetics['finish'] | null) => <>
    {id === appliedFinish ? <span className="pulse-supporter-tile-chip" data-chip="equipped">Equipped</span> : null}
    {id === finish && !unchanged ? <span className="pulse-supporter-tile-chip" data-chip="previewing">Previewing</span> : null}
  </>

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
      setNotice(finish ? `${selectedLabel} paint equipped.` : 'Default paint restored.')
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
  // The preview wears a Supporter's own look, the sample, or a paint being tried; unlabelled while membership is unknown.
  const shown = unknown ? undefined : finish !== (allowed ? appliedFinish : SAMPLE_KIT.finish) ? 'trying' : allowed ? 'own' : 'sample'
  return <PulseSectionCard
    title="Your look"
    headingLevel={3}
    className="pulse-supporter-studio"
    meta={unknown ? undefined : allowed ? 'Wave, sheen and Emote rain save right away' : 'Try any look. Paint, wave and sheen apply when you support.'}
  >
    <SupporterLookPreview
      finish={finish}
      paint={paint.style}
      tenure={tenure}
      rain={allowed || unknown ? banner.value : { ...SAMPLE_RAIN, mode: rainTry }}
      shown={shown}
    />
    <div className="pulse-supporter-look" data-preview-finish={finish ?? 'default'}>
      <fieldset className="pulse-supporter-look-row" disabled={busy}>
        <legend>Paint</legend>
        <div className="pulse-supporter-tiles">
          <label className="pulse-supporter-tile" title="Your free theme">
            <input type="radio" name="supporter-finish" value="finish-default" aria-label="Default" checked={finish === null} onChange={() => selectFinish(null)} />
            <i className="pulse-supporter-swatch" aria-hidden="true" />
            <small>Default</small>
            {chip(null)}
          </label>
          {SUPPORTER_FINISH_OPTIONS.map(option => <label key={option.id} className="pulse-supporter-tile" title={option.description}>
            <input
              type="radio"
              name="supporter-finish"
              value={`finish-${option.id}`}
              aria-label={option.label}
              checked={finish === option.id}
              onChange={() => selectFinish(option.id)}
            />
            <i className="pulse-supporter-swatch" style={finishVars(option.id) as CSSProperties} aria-hidden="true" />
            <small>{option.label}</small>
            {chip(option.id)}
          </label>)}
        </div>
      </fieldset>
      <SupporterPaintStyleFields style={paint.style} onChoose={next => void paint.choose(next)} />
      <EmoteRainField banner={banner} perks={unknown ? undefined : allowed} availability={checkoutAvailability} tried={rainTry} onTry={setRainTry} />
    </div>
    <p className="pulse-supporter-detail" aria-live="polite">{paint.status || 'Wave and sheen save to this browser profile right away and show whenever your paint is equipped.'}</p>
    <div className="pulse-account-link-actions">
      {unknown ? (
        <button type="button" disabled>Checking Supporter status…</button>
      ) : allowed ? (
        <button type="button" disabled={busy || unchanged} aria-busy={busy} onClick={() => void save()}>
          {busy ? 'Saving...' : unchanged ? (finish ? 'Equipped' : 'Default active') : finish ? 'Equip paint' : 'Use default'}
        </button>
      ) : finish && finish !== intent ? (
        <button type="button" disabled={intentBusy} aria-busy={intentBusy} onClick={() => void chooseForLater(finish)}>
          {intentBusy ? 'Saving...' : checkoutOpen ? `Use ${selectedLabel} when Supporter starts` : 'Save for when Supporter opens'}
        </button>
      ) : (
        <button type="button" disabled>{!finish ? 'Default active' : checkoutOpen ? `${selectedLabel} chosen` : 'Saved for when Supporter opens'}</button>
      )}
      {!allowed && !unknown && intent ? <button type="button" disabled={intentBusy} onClick={() => void chooseForLater(null)}>Clear choice</button> : null}
    </div>
    {!allowed && !unknown ? <p className="pulse-supporter-detail" data-supporter-finish-intent={intent ?? 'none'}>
      {intentLabel
        ? `${intentLabel} is applied automatically when your Supporter membership is confirmed. Until then, this is only a preview.`
        : 'Preview is free. Choose a paint now and it applies when your Supporter membership starts.'}
    </p> : null}
    <p className="pulse-supporter-detail pulse-supporter-save-status" role="status">{notice}</p>
  </PulseSectionCard>
}

/**
 * Emote rain behind your Pulse panel: off, still or falling. A Supporter's
 * choice saves at once. Without the perk it is tried in the preview only
 * (`tried`) and the saved choice stays as it was; while membership is unknown
 * it waits, neutral.
 *
 * A save never disables the row: the pressed button would lose keyboard focus
 * to the page. Presses while one saves are ignored instead, and one live region,
 * always present, is cleared when a save starts and then states its result.
 */
function EmoteRainField({ banner, perks, availability, tried, onTry }: {
  banner: ReturnType<typeof usePulseBanner>
  perks: boolean | undefined
  availability: 'open' | 'closed' | 'unknown'
  tried: PulseBannerPreference['mode']
  onTry: (mode: PulseBannerPreference['mode']) => void
}) {
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const shown = perks === false ? tried : banner.value.mode
  // The shared hook reports the result once its write settles (status and
  // saving change together), so this row reads only the save it started.
  useEffect(() => {
    if (!saving || banner.saving) return
    setSaving(false)
    setMessage(banner.status === 'Saved' ? 'Emote rain saved.' : 'Could not save emote rain. Please try again.')
  }, [saving, banner.saving, banner.status])
  function choose(mode: PulseBannerPreference['mode']) {
    if (perks === false) return onTry(mode)
    if (!perks || !banner.ready || saving || banner.saving) return
    setMessage('')
    setSaving(true)
    void banner.save({ ...banner.value, mode })
  }
  return <fieldset className="pulse-supporter-look-row" disabled={perks === undefined || (perks && !banner.ready)} aria-busy={perks === undefined || saving || undefined} data-supporter-perks={perks ? 'on' : perks === false ? 'locked' : 'pending'}>
    <legend>Emote rain</legend>
    <div>
      <div className="pulse-supporter-seg">
        {(['off', 'still', 'rain'] as const).map(mode => <button
          key={mode}
          type="button"
          aria-pressed={shown === mode}
          onClick={() => choose(mode)}
        >{mode === 'off' ? 'Off' : mode === 'still' ? 'Still' : 'Rain'}</button>)}
      </div>
      {perks === false
        ? <p className="pulse-supporter-detail" data-supporter-perk="emote-rain">{availability === 'unknown' ? 'Preview only.' : availability === 'open' ? 'Emote rain is a Supporter perk. Preview it here.' : 'Preview only until Supporter sign-ups open.'}</p>
        : null}
      <p className="pulse-supporter-detail" role="status" data-emote-rain-status>{message}</p>
    </div>
  </fieldset>
}
