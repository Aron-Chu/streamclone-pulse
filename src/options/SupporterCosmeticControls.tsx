import { useEffect, useRef, useState } from 'react'
import type { SupporterEntitlement, SupporterCosmetics } from '../shared/supporterAccount.ts'
import { PulseSectionCard } from '../ui/PulseSectionCard.tsx'
import { supporterFinish, SUPPORTER_FINISH_OPTIONS } from '../ui/supporterFinish.ts'
import { StreamPulseTitleBlock, streamPulseHeaderChromeSidebar } from '../ui/StreamPulseTitleBlock.tsx'
import { theme } from '../ui/theme.ts'
import { PulseBannerBackdrop, usePulseBanner } from '../ui/PulseBanner.tsx'

/**
 * The finish colours the small Peak signature beside the title.
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
  const [finish, setFinish] = useState<SupporterCosmetics['finish'] | null>('glass')
  const [appliedFinish, setAppliedFinish] = useState<SupporterCosmetics['finish'] | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const generation = useRef(0)
  const pending = useRef(false)
  const savedCosmetics = useRef<SupporterCosmetics | null>(null)
  const allowed = entitlement?.state === 'ready'
    && (entitlement.status === 'active' || entitlement.status === 'grace')
    && entitlement.features.includes('supporter.banner.v1')
    && entitlement.features.includes('supporter.finish.v1')
  const entitlementState = entitlement?.state
  const entitlementStatus = entitlement?.state === 'ready' ? entitlement.status : undefined
  const entitlementPeriods = entitlement?.state === 'ready' ? entitlement.supportPeriods : undefined
  const entitlementAccessUntil = entitlement?.state === 'ready' ? entitlement.accessUntil : undefined
  const cosmetics = entitlement?.state === 'ready' ? entitlement.cosmetics : undefined
  useEffect(() => {
    savedCosmetics.current = null
  }, [entitlementState, entitlementStatus, entitlementPeriods, entitlementAccessUntil, allowed])
  useEffect(() => {
    generation.current++
    pending.current = false
    setBusy(false)
    const activeFinish = allowed && cosmetics?.enabled ? cosmetics.finish : null
    setAppliedFinish(activeFinish)
    const acknowledgment = savedCosmetics.current
    savedCosmetics.current = null
    // An acknowledgment of our save keeps its confirmation. A remote change
    // replaces both the draft and the applied preview.
    if (!acknowledgment || acknowledgment.enabled !== cosmetics?.enabled || acknowledgment.finish !== cosmetics?.finish) {
      setFinish(cosmetics ? activeFinish : 'glass')
      setNotice('')
    }
    return () => { generation.current++ }
  }, [entitlementState, entitlementStatus, entitlementPeriods, entitlementAccessUntil, allowed, cosmetics?.enabled, cosmetics?.finish])
  const selectedLabel = SUPPORTER_FINISH_OPTIONS.find(option => option.id === finish)?.label ?? 'Default'
  const appliedLabel = SUPPORTER_FINISH_OPTIONS.find(option => option.id === appliedFinish)?.label ?? 'Default'
  const unchanged = finish === appliedFinish

  function selectFinish(value: typeof finish) {
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
    try {
      const response = await chrome.runtime.sendMessage({ type: 'SUPPORTER_COSMETICS', ...cosmetics })
      if (current !== generation.current) return
      if (response?.type !== 'SUPPORTER_COSMETICS' || !response.ok) {
        setNotice('Could not save. Refresh your Supporter status and try again.')
        return
      }
      setAppliedFinish(finish)
      setNotice(finish ? `${selectedLabel} accent equipped.` : 'Default accent restored.')
      savedCosmetics.current = cosmetics
      onSaved?.(cosmetics)
    } catch {
      if (current === generation.current) setNotice('Could not save. Please try again.')
    } finally {
      if (current === generation.current) {
        pending.current = false
        setBusy(false)
      }
    }
  }
  return <PulseSectionCard title="Pulse signature" headingLevel={3} subtitle="A personal colour for the Pulse mark beside your title.">
    {/* True sidebar width on the real panel colour, rendering the same
        component the overlay renders, so this cannot promise a header the
        extension does not draw. */}
    <div className="pulse-supporter-finish-preview" aria-label={`${selectedLabel} sidebar header preview`} data-preview-finish={finish ?? 'default'} style={{ background: theme.bgCanvas, maxWidth: '100%', width: 'min(340px, 100%)' }}>
      <div className="pulse-personal-panel pulse-background-preview" style={{ ...streamPulseHeaderChromeSidebar, minHeight: 180 }}>
        <PulseBannerBackdrop value={banner.value} paused />
        <div className="pulse-banner-copy"><StreamPulseTitleBlock title={banner.value.title || undefined} finish={finish} statusLabel="Live chart" statusTone="live" /></div>
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
    <div className="pulse-account-link-actions">
      <button type="button" disabled={!allowed || busy || unchanged} aria-busy={busy} onClick={() => void save()}>
        {busy ? 'Saving...' : unchanged ? (finish ? 'Equipped' : 'Default active') : finish ? 'Equip accent' : 'Use default'}
      </button>
    </div>
    {!allowed ? <p className="pulse-supporter-detail">Preview is free. Equipping an accent requires an active linked Supporter membership.</p> : null}
    <p className="pulse-supporter-detail pulse-supporter-save-status" role="status">{notice}</p>
  </PulseSectionCard>
}
