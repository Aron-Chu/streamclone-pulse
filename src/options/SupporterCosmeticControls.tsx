import { SupporterActionButton } from './SupporterActionButton.tsx'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { FINISH_INTENT_TTL_MS, supporterPerksAllowed, type SupporterEntitlement, type SupporterCosmetics } from '../shared/supporterAccount.ts'
import { supporterCheckoutAvailability } from '../shared/supporterCheckoutAvailability.ts'
import { TWITCH_SIGNIN_ENABLED } from '../shared/twitchSignIn.ts'
import { setSupporterLookExtras } from '../shared/storage.ts'
import {
  MAX_SAVED_LOOKS,
  SAMPLE_LOOK,
  STARTER_LOOKS,
  lookExtras,
  lookExtrasOf,
  lookName,
  lookStorage,
  sameExtras,
  sameLook,
  type SupporterLook,
  type SupporterLookExtras,
} from '../shared/supporterLook.ts'
import type { SupporterTenure } from '../shared/supporterPaint.ts'
import { finishVars } from '../supporter/kit.ts'
import { PulseSectionCard } from '../ui/PulseSectionCard.tsx'
import { SUPPORTER_FINISH_OPTIONS } from '../ui/supporterFinish.ts'
import { PulseBannerLoadError, usePulseBanner } from '../ui/PulseBanner.tsx'
import { SupporterCardTag } from './SupporterCardTag.tsx'
import { SupporterLookPreview } from './SupporterLookPreview.tsx'
import { SupporterMotionField, useSavedLooks, useSupporterPaintStyle } from './SupporterPaintStyleFields.tsx'

type Finish = SupporterCosmetics['finish']
const SAMPLE_EXTRAS: SupporterLookExtras = { motion: SAMPLE_LOOK.motion, backdrop: SAMPLE_LOOK.backdrop, intensity: SAMPLE_LOOK.intensity }

/**
 * The "Your look" studio: a live preview pinned above one look draft (paint,
 * motion and backdrop), so every click shows at once and nothing saves until
 * the look is equipped. Looks offers ready-made starters and, for Supporters,
 * up to four saved looks. The crest is earned, shown under every paint and
 * never chosen. The preview draws with the overlay's own paint, crest and
 * backdrop styles, so nothing promises a look the extension does not render.
 *
 * A Supporter's Equip look saves the paint to the server (when it changed),
 * then the motion and backdrop to this browser profile in one write; what is
 * shown as saved is only ever what was stored, and Revert drops the draft.
 * Everyone else starts on the sample look, may try any look, and (while sales
 * are open) choose one to apply when Supporter starts: the worker keeps the
 * whole look with that choice, and the profile's own settings are untouched
 * until it is applied. With checkout closed or unconfirmed nothing is saved.
 */
export function SupporterCosmeticControls({ entitlement, unavailable = false, tenure, onSaved, seenInChat = false }: {
  entitlement: SupporterEntitlement | null
  /** With `entitlement` null: the status could not be read, rather than still loading. */
  unavailable?: boolean
  /** The crest the preview wears: a Supporter's own, or the sample's. */
  tenure: SupporterTenure
  onSaved?: (cosmetics: SupporterCosmetics) => void
  seenInChat?: boolean
}) {
  const banner = usePulseBanner()
  const paint = useSupporterPaintStyle()
  const saved = useSavedLooks()
  // Nothing is presumed while the first answer is pending: a finish shown as
  // chosen then is one the person chose.
  const [finish, setFinish] = useState<Finish | null>(null)
  const [appliedFinish, setAppliedFinish] = useState<Finish | null>(null)
  // Motion, backdrop and intensity being tried; null follows the base look.
  const [extrasDraft, setExtrasDraft] = useState<SupporterLookExtras | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const generation = useRef(0)
  const pending = useRef(false)
  const savedCosmetics = useRef<SupporterCosmetics | null>(null)
  // An explicit choice made before membership is verified. The worker keeps it
  // privately and applies it once the server grants Supporter access.
  const [intent, setIntent] = useState<SupporterCosmetics['finish'] | null>(null)
  const [intentSetAt, setIntentSetAt] = useState<number | null>(null)
  // The motion and backdrop saved with that choice (absent on a choice saved before they were).
  const [intentLook, setIntentLook] = useState<SupporterLookExtras | null>(null)
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
    // Without perks the try-on starts on the sample look, never on Default.
    if (!(firstAnswer && chosenWhileChecking.current)) setFinish(allowed ? activeFinish : SAMPLE_LOOK.finish)
    setExtrasDraft(null)
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
        setIntentSetAt(typeof response.setAt === 'number' ? response.setAt : null)
        setIntentLook(response.finish ? lookExtrasOf(response.look) : null)
        if (response.finish) setFinish(current => current === SAMPLE_LOOK.finish ? response.finish : current)
      })
      .catch(() => { /* No saved choice is shown when the worker is unavailable. */ })
  }, [allowed, unknown])
  // Once access is verified the worker has applied (and cleared) the choice.
  useEffect(() => { if (allowed) { setIntent(null); setIntentLook(null) } }, [allowed])
  async function chooseForLater(value: SupporterCosmetics['finish'] | null) {
    if (intentBusy || unknown || (tryOnly && value !== null)) return
    setIntentBusy(true)
    setNotice('')
    // The look stays as tried while the choice saves, and after it is cleared.
    setExtrasDraft(extras)
    try {
      // Motion and backdrop travel with the choice and wait in the worker, so
      // clearing it leaves nothing behind in this profile's settings.
      const response = await chrome.runtime.sendMessage(value === null ? { type: 'SUPPORTER_FINISH_INTENT', finish: null } : { type: 'SUPPORTER_FINISH_INTENT', finish: value, look: extras })
      if (response?.type !== 'SUPPORTER_FINISH_INTENT') throw new Error('worker unavailable')
      setIntent(response.finish)
      setIntentSetAt(typeof response.setAt === 'number' ? response.setAt : null)
      setIntentLook(response.finish ? lookExtrasOf(response.look) : null)
      const label = SUPPORTER_FINISH_OPTIONS.find(option => option.id === response.finish)?.label
      setNotice(response.finish && label ? `${label} will be applied when your Supporter membership is confirmed.` : value === null ? 'Saved choice cleared.' : 'Could not save this choice. Please try again.')
    } catch {
      setNotice('Could not save this choice. Please try again.')
    } finally {
      setIntentBusy(false)
    }
  }
  const intentLabel = SUPPORTER_FINISH_OPTIONS.find(option => option.id === intent)?.label
  const checkoutAvailability = supporterCheckoutAvailability(entitlement)
  // A store build's browser with no account yet cannot ask whether sales are
  // open, and a membership read that failed, a server without Supporter, or an
  // older server that does not say whether checkout is open cannot confirm
  // them, so each keeps the closed try-on: nothing new saved, no claim either
  // way, and an earlier choice can still be removed.
  const tryOnly = !allowed && (checkoutAvailability === 'closed' || (entitlement?.state === 'ready' && checkoutAvailability === 'unknown') || entitlement?.state === 'unavailable' || entitlement?.state === 'error' || (entitlement?.state === 'not_linked' && !TWITCH_SIGNIN_ENABLED))
  const intentExpiresAt = intentSetAt === null ? null : intentSetAt + FINISH_INTENT_TTL_MS
  const savedEarlier = intentLabel && intentExpiresAt !== null && intentExpiresAt >= Date.now()
    ? { label: intentLabel, date: new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(intentExpiresAt) }
    : null

  // What this profile has saved (or the pending choice holds), and the look being tried.
  const stored = lookExtras(paint.style, banner.value)
  const base = allowed ? stored : intent ? intentLook ?? stored : SAMPLE_EXTRAS
  const extras = extrasDraft ?? base
  const look: SupporterLook = { finish, ...extras }
  const extrasChanged = !sameExtras(extras, base)
  const dirty = finish !== appliedFinish || extrasChanged
  // A draft that now matches what is saved follows it again, so a change made
  // elsewhere (quick settings, another window) shows here.
  const baseKey = `${base.motion}|${base.backdrop}|${base.intensity}`
  useEffect(() => {
    if (allowed || intent) setExtrasDraft(draft => draft && sameExtras(draft, base) ? null : draft)
  }, [baseKey, allowed, intent])

  const studio = useRef<HTMLDivElement>(null)
  const equipButton = useRef<HTMLButtonElement>(null)
  const revertButton = useRef<HTMLButtonElement>(null)
  const focusLookAfterSave = useRef(false)
  // The Equip and Revert buttons leave once the draft is saved or dropped:
  // focus moves to the look now worn instead of the page.
  useEffect(() => {
    if (!busy && !dirty && focusLookAfterSave.current) {
      focusLookAfterSave.current = false
      studio.current?.querySelector<HTMLInputElement>('input:checked')?.focus()
    }
  }, [busy, dirty])

  function selectFinish(value: Finish | null) {
    if (unknown) return
    if (lastAppliedKey.current === null) chosenWhileChecking.current = true
    setFinish(value)
    setNotice('')
  }
  function setExtras(next: SupporterLookExtras) {
    if (unknown) return
    setExtrasDraft(next)
    setNotice('')
  }
  function chooseLook(next: SupporterLook) {
    selectFinish(next.finish)
    setExtras({ motion: next.motion, backdrop: next.backdrop, intensity: next.intensity })
  }
  async function equip() {
    if (!allowed || pending.current || !dirty || !banner.ready) return
    const current = generation.current
    const finishChanged = finish !== appliedFinish
    const cosmetics: SupporterCosmetics = { enabled: finish !== null, finish: finish ?? 'glass' }
    let finishSaved = !finishChanged
    pending.current = true
    setBusy(true)
    setNotice('')
    try {
      if (finishChanged) {
        // Expect our own acknowledgment before asking, so a refresh it causes is recognised.
        savedCosmetics.current = cosmetics
        const response = await chrome.runtime.sendMessage({ type: 'SUPPORTER_COSMETICS', ...cosmetics })
        if (current !== generation.current) return
        if (response?.type !== 'SUPPORTER_COSMETICS' || !response.ok) {
          savedCosmetics.current = null
          setNotice('Could not save. Refresh your Supporter status and try again.')
          return
        }
        finishSaved = true
        setAppliedFinish(finish)
        onSaved?.(cosmetics)
      }
      // Read back what is stored at this moment and written in one go; the
      // studio shows them as saved only once storage reports them.
      if (extrasChanged) await setSupporterLookExtras(extras)
      if (current !== generation.current) return
      focusLookAfterSave.current = document.activeElement === equipButton.current
      setNotice(`Equipped: ${lookName(look)}.`)
    } catch {
      if (current === generation.current) {
        if (!finishSaved) savedCosmetics.current = null
        // A paint the server saved is worn everywhere; the draft keeps motion
        // and backdrop, so Equip look retries just those and Revert shows what
        // is worn now.
        setNotice(finishChanged && finishSaved ? 'Your paint saved, but motion and backdrop did not. Try Equip look again.' : 'Could not save. Please try again.')
      }
    } finally {
      if (current === generation.current) {
        pending.current = false
        setBusy(false)
      }
    }
  }
  function revert() {
    if (busy) return
    focusLookAfterSave.current = document.activeElement === revertButton.current
    setFinish(appliedFinish)
    setExtrasDraft(null)
    setNotice('')
  }

  const isStarter = STARTER_LOOKS.some(option => sameLook(option.look, look))
  const isSaved = saved.looks.some(item => sameLook(item, look))
  const shelfFull = saved.looks.length >= MAX_SAVED_LOOKS
  const canSave = allowed && finish !== null && !isStarter && !isSaved
  async function saveLook() {
    if (!canSave || shelfFull) return
    try {
      await saved.write([...saved.looks, look])
      setNotice(`Saved ${lookName(look)} to your looks.`)
    } catch {
      setNotice("Could not save that look. Try again.")
    }
  }
  async function removeLook(item: SupporterLook) {
    const name = lookName(item)
    try {
      await saved.write(saved.looks.filter(existing => !sameLook(existing, item)))
      setNotice(`Removed ${name} from your looks.`)
      studio.current?.querySelector<HTMLInputElement>('input[name="supporter-look"]')?.focus()
    } catch {
      setNotice("Could not remove that look. Try again.")
    }
  }

  /** A Supporter's paint chips: the one in use, and the one being tried. */
  const chip = (id: Finish | null) => !allowed ? null : <>
    {id === appliedFinish ? <small data-chip="equipped"> · Equipped</small> : null}
    {id === finish && finish !== appliedFinish ? <span className="pulse-supporter-tile-chip" data-chip="previewing">Previewing</span> : null}
  </>
  const perkLine = checkoutAvailability === 'closed' ? 'closed' : checkoutAvailability === 'open' || entitlement?.state === 'not_linked' ? 'locked' : null
  // The preview draws exactly what equipping would store.
  const preview = lookStorage(extras, paint.style, banner.value)
  // The preview wears a Supporter's own look, the sample, or a look being tried; unlabelled while membership is unknown.
  const shown = unknown ? undefined : allowed ? (dirty ? 'trying' : 'own') : sameLook(look, SAMPLE_LOOK) ? 'sample' : 'trying'

  let action: ReactNode = null
  if (unknown) {
    action = <span className="pulse-supporter-detail">{unavailable ? 'Supporter status unavailable' : 'Checking Supporter status…'}</span>
  } else if (allowed) {
    action = dirty || busy ? <>
      <SupporterActionButton ref={equipButton} type="button" disabled={busy || !banner.ready} aria-busy={busy} onClick={() => void equip()}>
        {busy ? 'Saving...' : 'Equip look'}
      </SupporterActionButton>
      <SupporterActionButton ref={revertButton} type="button" disabled={busy} onClick={revert}>Revert</SupporterActionButton>
    </> : null
  } else if (!tryOnly) {
    const chosen = finish !== null && finish === intent && !extrasChanged
    action = finish && !chosen || intent ? <>
      {finish && !chosen ? <SupporterActionButton type="button" disabled={intentBusy} aria-busy={intentBusy} onClick={() => void chooseForLater(finish)}>
        {intentBusy ? 'Saving...' : 'Use this look when Supporter starts'}
      </SupporterActionButton> : null}
      {intent ? <SupporterActionButton aria-busy={intentBusy || undefined} type="button" disabled={intentBusy} onClick={() => void chooseForLater(null)}>Clear choice</SupporterActionButton> : null}
    </> : null
  }

  return <PulseSectionCard
    title="Your look"
    headingLevel={3}
    className="pulse-supporter-studio"
    titleAction={<SupporterCardTag audience="only-you">Only you</SupporterCardTag>}
    meta={unknown ? undefined : tryOnly ? "Try a look. Changes here aren't saved." : allowed ? 'Try looks in the preview. Equip look saves them.' : 'Try any look. Choose one now and it applies when you support.'}
  >
    <SupporterLookPreview
      finish={finish}
      paint={preview.paint}
      tenure={tenure}
      banner={preview.banner}
      name={lookName(look)}
      shown={shown}
      hideStateLabel={tryOnly}
      seenInChat={seenInChat}
    />
    <div ref={studio} className="pulse-supporter-look" data-preview-finish={finish ?? 'default'}>
      <fieldset className="pulse-supporter-look-row" disabled={busy || unknown}>
        <legend>Looks</legend>
        <div>
          <div className="pulse-supporter-tiles">
            {STARTER_LOOKS.map(option => <LookTile key={option.name} name={option.name} look={option.look} current={look} onChoose={chooseLook} />)}
            {saved.looks.map(item => <span key={lookName(item)} className="pulse-supporter-saved-look">
              <LookTile name={lookName(item)} look={item} current={look} onChoose={chooseLook} />
              <button type="button" className="pulse-supporter-look-remove" aria-label={`Remove ${lookName(item)} from your looks`} onClick={() => void removeLook(item)}>×</button>
            </span>)}
            {canSave && !shelfFull ? <SupporterActionButton type="button" className="pulse-supporter-save-look" onClick={() => void saveLook()}>Save look</SupporterActionButton> : null}
          </div>
          {canSave && shelfFull ? <p className="pulse-supporter-detail">You can keep {MAX_SAVED_LOOKS} looks. Remove one to save this one.</p> : null}
        </div>
      </fieldset>
      <fieldset className="pulse-supporter-look-row" disabled={busy || unknown}>
        <legend>Paint</legend>
        <div className="pulse-supporter-tiles">
          <label className="pulse-supporter-tile" title="Your free theme">
            <input type="radio" name="supporter-finish" value="finish-default" checked={finish === null} onChange={() => selectFinish(null)} />
            <i className="pulse-supporter-swatch" data-swatch="default" aria-hidden="true" />
            <small>Default</small>
            {chip(null)}
          </label>
          {SUPPORTER_FINISH_OPTIONS.map(option => <label key={option.id} className="pulse-supporter-tile" title={option.description}>
            <input
              type="radio"
              name="supporter-finish"
              value={`finish-${option.id}`}
              checked={finish === option.id}
              onChange={() => selectFinish(option.id)}
            />
            <i className="pulse-supporter-swatch" style={finishVars(option.id) as CSSProperties} aria-hidden="true" />
            <small>{option.label}</small>
            {chip(option.id)}
          </label>)}
        </div>
      </fieldset>
      <SupporterMotionField motion={extras.motion} finish={finish} disabled={busy || unknown} onChoose={motion => setExtras({ ...extras, motion })} />
      <fieldset className="pulse-supporter-look-row" disabled={busy || unknown} data-supporter-perks={unknown ? 'pending' : allowed ? 'on' : 'locked'}>
        <legend>Backdrop</legend>
        <div>
          <div className="pulse-supporter-backdrop">
            <div className="pulse-supporter-seg">
              {([false, true] as const).map(on => <SupporterActionButton
                key={String(on)}
                type="button"
                aria-pressed={extras.backdrop === on}
                onClick={() => setExtras({ ...extras, backdrop: on })}
              >{on ? 'On' : 'Off'}</SupporterActionButton>)}
            </div>
            {extras.backdrop ? <label className="pulse-supporter-intensity">
              <span>Intensity</span>
              <input type="range" min={10} max={70} step={5} value={extras.intensity} onChange={event => setExtras({ ...extras, intensity: Number(event.target.value) })} />
              <output>{extras.intensity}%</output>
            </label> : null}
          </div>
          {!allowed && !unknown && perkLine
            ? <p className="pulse-supporter-detail" data-supporter-perk="backdrop">The backdrop is a Supporter perk. Only you see it. {perkLine === 'closed' ? "Supporter isn't on sale yet. " : ''}<a href="#supporter" onClick={() => window.scrollTo?.(0, 0)}>See Supporter →</a></p>
            : null}
        </div>
      </fieldset>
    </div>
    {banner.loadError ? <PulseBannerLoadError onRetry={() => void banner.reload()} /> : null}
    {action ? <div className="pulse-account-link-actions">{action}</div> : null}
    {tryOnly && savedEarlier ? <p className="pulse-supporter-detail" data-supporter-finish-intent={intent ?? 'none'}>
      Saved earlier: {savedEarlier.label}, until {savedEarlier.date}.{' '}
      <SupporterActionButton aria-busy={intentBusy || undefined} className="pulse-supporter-remove-intent" type="button" disabled={intentBusy} onClick={() => void chooseForLater(null)}>Remove</SupporterActionButton>
    </p> : null}
    {!allowed && !unknown && !tryOnly ? <p className="pulse-supporter-detail" data-supporter-finish-intent={intent ?? 'none'}>
      {intentLabel
        ? `${intentLabel} is applied automatically when your Supporter membership is confirmed. We keep this choice for 7 days.`
        : 'Preview is free. Choose a look now and it applies when your Supporter membership starts. We keep this choice for 7 days.'}
    </p> : null}
    <p className="pulse-supporter-detail pulse-supporter-save-status" role="status">{notice}</p>
  </PulseSectionCard>
}

/** One look on the shelf, as a pill with its paint's dot; choosing it loads it into the draft. */
function LookTile({ name, look, current, onChoose }: { name: string; look: SupporterLook; current: SupporterLook; onChoose: (look: SupporterLook) => void }) {
  return <label className="pulse-supporter-tile">
    <input type="radio" name="supporter-look" value={`look-${name}`} checked={sameLook(look, current)} onChange={() => onChoose(look)} />
    <i className="pulse-supporter-swatch" data-swatch={look.finish ?? 'default'} style={look.finish ? finishVars(look.finish) as CSSProperties : undefined} aria-hidden="true" />
    <small>{name}</small>
  </label>
}
