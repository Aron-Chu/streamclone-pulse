import { useEffect, useRef, useState } from 'react'
import { supporterPerksAllowed, type SupporterEntitlement, type SupporterCosmetics } from '../shared/supporterAccount.ts'
import { SAMPLE_KIT } from '../supporter/kit.ts'
import { PulseSectionCard } from '../ui/PulseSectionCard.tsx'
import { SUPPORTER_FINISH_OPTIONS } from '../ui/supporterFinish.ts'
import { usePulseBanner } from '../ui/PulseBanner.tsx'
import type { PulseBannerPreference } from '../shared/storage.ts'
import { SupporterPaintStyleFields, useSupporterPaintStyle } from './SupporterPaintStyleFields.tsx'

/**
 * "Your look", direction B of the 2026-10-07 Account & Supporter redesign:
 * paint, wave, sheen and emote rain as rows of tiles. The finish paints the
 * panel title, wave and sheen choose how that paint moves, the tenure crest
 * sits beside it, and emote rain falls behind the panel. The card and "Who sees
 * what" above preview the chosen paint (`onDraft`), drawn with the overlay's own
 * paint and crest styles, so nothing promises a look the extension does not
 * render.
 *
 * A finish is checked by the server and saved with Equip; wave, sheen and emote
 * rain save to this browser profile at once. Everyone else may try any paint
 * and choose one to apply when Supporter starts.
 */
export function SupporterCosmeticControls({ entitlement, onSaved, onDraft }: {
  entitlement: SupporterEntitlement | null
  onSaved?: (cosmetics: SupporterCosmetics) => void
  /** The paint being tried or worn, for the previews; undefined while membership is unknown. */
  onDraft?: (finish: SupporterCosmetics['finish'] | null | undefined) => void
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
  useEffect(() => { onDraft?.(unknown ? undefined : finish) }, [unknown, finish, onDraft])
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
  return <PulseSectionCard
    title="Your look"
    headingLevel={3}
    meta={unknown ? undefined : allowed ? 'Wave, sheen and rain save right away' : 'Try anything. It applies when you support.'}
  >
    <div className="pulse-supporter-look" data-preview-finish={finish ?? 'default'}>
      <fieldset className="pulse-supporter-look-row" disabled={busy}>
        <legend>Paint</legend>
        <div className="pulse-supporter-tiles">
          <label className="pulse-supporter-tile" title="Your free theme">
            <input type="radio" name="supporter-finish" value="finish-default" aria-label="Default" checked={finish === null} onChange={() => selectFinish(null)} />
            <span className="pulse-supporter-paint-sample" style={{ color: 'var(--pulse-accent-soft, #c4b5fd)' }} aria-hidden="true">Aa</span>
            <small>Default</small>
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
            <span className="pulse-paint pulse-supporter-paint-sample" data-finish={option.id} data-wave="smooth" data-sheen="none" data-text="Aa" aria-hidden="true">Aa</span>
            <small>{option.label}</small>
          </label>)}
        </div>
      </fieldset>
      <SupporterPaintStyleFields finish={finish} style={paint.style} onChoose={next => void paint.choose(next)} />
      <EmoteRainField banner={banner} perks={unknown ? undefined : allowed} />
    </div>
    <p className="pulse-supporter-detail" data-supporter-accent-state={unchanged ? 'equipped' : 'preview'}>
      {unchanged ? `${appliedLabel} active` : `Preview: ${selectedLabel} / Active: ${appliedLabel}`}
    </p>
    <p className="pulse-supporter-detail" aria-live="polite">{paint.status || 'Wave and sheen save to this browser profile right away and show whenever your finish is equipped.'}</p>
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

/**
 * Emote rain behind your Pulse panel: off, still or falling. A Supporter perk
 * on the same rule as the backdrop editor: without one it is locked and the
 * saved choice stays as it was; while membership is unknown it waits, neutral.
 * A Supporter's choice saves at once.
 *
 * A save never disables the row: the pressed button would lose keyboard focus
 * to the page. Presses while one saves are ignored instead, and one live region,
 * always present, is cleared when a save starts and then states its result.
 */
function EmoteRainField({ banner, perks }: { banner: ReturnType<typeof usePulseBanner>; perks: boolean | undefined }) {
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  // Locked, the row shows the sample look's rain.
  const shown = perks === false ? 'rain' : banner.value.mode
  // The shared hook reports the result once its write settles (status and
  // saving change together), so this row reads only the save it started.
  useEffect(() => {
    if (!saving || banner.saving) return
    setSaving(false)
    setMessage(banner.status === 'Saved' ? 'Emote rain saved.' : 'Could not save emote rain. Please try again.')
  }, [saving, banner.saving, banner.status])
  function choose(mode: PulseBannerPreference['mode']) {
    if (!perks || !banner.ready || saving || banner.saving) return
    setMessage('')
    setSaving(true)
    void banner.save({ ...banner.value, mode })
  }
  return <fieldset className="pulse-supporter-look-row" disabled={!perks || !banner.ready} aria-busy={perks === undefined || saving || undefined} data-supporter-perks={perks ? 'on' : perks === false ? 'locked' : 'pending'}>
    <legend>Emote rain</legend>
    <div>
      <div className="pulse-supporter-seg">
        {(['off', 'still', 'rain'] as const).map(mode => <button
          key={mode}
          type="button"
          aria-pressed={shown === mode}
          title={perks === false ? 'Supporter perk' : undefined}
          onClick={() => choose(mode)}
        >{mode === 'off' ? 'Off' : mode === 'still' ? 'Still' : 'Rain'}</button>)}
      </div>
      {perks === false
        ? <p className="pulse-supporter-detail" data-supporter-perk="emote-rain">Emote rain, still or falling, is a Supporter perk. Only you see it. It moved from free to Supporter in 0.2.2, and a backdrop you chose is kept for when you support.</p>
        : null}
      <p className="pulse-supporter-detail" role="status" data-emote-rain-status>{message}</p>
    </div>
  </fieldset>
}
