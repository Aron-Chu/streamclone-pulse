import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { DEFAULT_PULSE_BANNER, PULSE_BANNER_KEY, getPulseBanner, normalizePulseBanner, setPulseBanner, type PulseBannerPreference } from '../shared/storage.ts'
import { StreamPulseTitleBlock, streamPulseHeaderChromeSidebar } from './StreamPulseTitleBlock.tsx'
import { theme } from './theme.ts'

// The same 7TV culture set used by the portal, with static images so motion is
// entirely controlled by CSS and respects the user's reduced-motion setting.
const EMOTES = ['01HM524VE80004SKSHMCZWXH1T', '01FKSDK14G0008TM5NY9QEG0QV', '01GAM8EFQ00004MXFXAJYKA859', '01GB2S7H7000018VJGJ4A9BMFS', '01GAFTZ9K80003DHH026MC7JW0', '01GB2ZJFBG000DTBJYANG8XYFP']

const bannerThemeVariables = {
  '--pulse-banner-canvas': theme.bgCanvas,
  '--pulse-banner-panel': theme.panel,
  '--pulse-banner-panel-elevated': theme.panelElevated,
  '--pulse-banner-border': theme.border,
  '--pulse-banner-border-accent': theme.borderAccent,
  '--pulse-banner-text': theme.textPrimary,
  '--pulse-banner-text-secondary': theme.textSecondary,
  '--pulse-banner-accent': theme.accent,
  '--pulse-banner-accent-ink': theme.accentInk,
  '--pulse-banner-accent-soft': theme.accentSoft,
  '--pulse-banner-radius': `${theme.radiusButton}px`,
} as CSSProperties

export function usePulseBanner() {
  const [value, setValue] = useState(DEFAULT_PULSE_BANNER)
  const [status, setStatus] = useState('')
  const [ready, setReady] = useState(false)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    let alive = true
    void getPulseBanner().then(next => { if (alive) { setValue(next); setReady(true) } })
      .catch(() => { if (alive) setStatus('Could not load banner') })
    const changes = globalThis.chrome?.storage?.onChanged
    const listener = (items: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'sync' && items[PULSE_BANNER_KEY]) setValue(normalizePulseBanner(items[PULSE_BANNER_KEY].newValue))
    }
    changes?.addListener(listener)
    return () => { alive = false; changes?.removeListener(listener) }
  }, [])
  async function save(next: PulseBannerPreference) {
    setSaving(true)
    try { await setPulseBanner(next); setValue(normalizePulseBanner(next)); setStatus('Saved') }
    catch { setStatus('Could not save background') }
    finally { setSaving(false) }
  }
  return { value, ready, saving, status, save }
}

/**
 * The 7TV backdrop, Still or Rain, is a Supporter perk. Without verified perks
 * it draws nothing, whatever an older preference saved, and leaves that choice
 * stored so it returns if the person supports again.
 */
export function PulseBannerBackdrop({ value, perks, paused = false }: { value: PulseBannerPreference; perks: boolean; paused?: boolean }) {
  const mode = perks ? value.mode : 'off'
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const element = ref.current
    if (!element || typeof IntersectionObserver === 'undefined') return
    const update = () => { if (document.hidden) setVisible(false) }
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting && !document.hidden))
    observer.observe(element)
    const visibility = () => { update(); if (!document.hidden) { observer.unobserve(element); observer.observe(element) } }
    document.addEventListener('visibilitychange', visibility)
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', visibility) }
  }, [])
  return <>
    <div ref={ref} className="pulse-banner-art" data-mode={mode} data-running={visible && !paused} aria-hidden="true" style={{ opacity: value.intensity / 100 }}>
      {mode !== 'off' && EMOTES.map((id, index) => <img key={id} alt="" draggable={false} decoding="async" referrerPolicy="no-referrer"
        src={`https://cdn.7tv.app/emote/${id}/2x_static.webp`}
        onError={event => { event.currentTarget.style.visibility = 'hidden' }}
        style={{ '--i': index, left: `${5 + index * 16}%`, top: `${8 + (index * 17) % 78}%`, animationDelay: `${-index * 5.7}s`, animationDuration: `${24 + index % 3 * 6}s` } as CSSProperties} />)}
    </div>
  </>
}

/**
 * Panel title and the 7TV backdrop. The title is free; Still and Rain are a
 * Supporter perk, so without one they stay locked and the saved choice is kept,
 * untouched (Reset included), for when the person supports again. `perks` is
 * undefined until the membership check answers: the perk controls wait, neutral,
 * rather than flashing the lock at a Supporter.
 */
export function PulseBannerControls({ expanded = false, perks }: { expanded?: boolean; perks: boolean | undefined }) {
  const banner = usePulseBanner()
  const [draft, setDraft] = useState(banner.value)
  const id = useId()
  useEffect(() => setDraft(banner.value), [banner.value])
  // "Edit background in all settings" opens #pulse-background: expand this and bring it into view.
  const ref = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const details = ref.current
    if (!details || window.location.hash !== '#pulse-background') return
    details.open = true
    details.scrollIntoView?.({ block: 'start' })
    details.querySelector<HTMLElement>('summary')?.focus({ preventScroll: true })
  }, [])
  // Without perks, Reset clears only what this person may change: the title.
  const reset = perks ? DEFAULT_PULSE_BANNER : { ...DEFAULT_PULSE_BANNER, mode: banner.value.mode, intensity: banner.value.intensity }
  return <details ref={ref} className="pulse-banner-customize" open={expanded || undefined} style={bannerThemeVariables} data-supporter-perks={perks ? 'on' : perks === false ? 'locked' : 'pending'}>
    <summary>Background &amp; motion</summary>
    <form onSubmit={event => { event.preventDefault(); void banner.save(draft) }}>
      <div className="pulse-personal-panel pulse-background-preview" data-appearance-preview="true" aria-label="Appearance preview" style={{ ...streamPulseHeaderChromeSidebar, minHeight: 112 }}>
        <PulseBannerBackdrop value={draft} perks={perks === true} />
        <div className="pulse-banner-copy"><StreamPulseTitleBlock title={draft.title || undefined} statusLabel="Preview" /></div>
      </div>
      <fieldset disabled={!banner.ready || banner.saving}>
        <label htmlFor={`${id}-title`}>Panel title</label>
        <input id={`${id}-title`} maxLength={40} placeholder="Stream Pulse" value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} />
        <span id={`${id}-mode`}>7TV backdrop</span>
        <div className="pulse-banner-modes" role="group" aria-labelledby={`${id}-mode`} aria-busy={perks === undefined || undefined}>
          {(['off', 'still', 'rain'] as const).map(mode => <button key={mode} type="button" aria-pressed={draft.mode === mode} disabled={!perks && mode !== 'off'} title={!perks && mode !== 'off' ? 'Supporter perk' : undefined} onClick={() => setDraft({ ...draft, mode })}>{mode === 'off' ? 'Off' : mode === 'still' ? 'Still' : 'Rain'}</button>)}
        </div>
        {perks !== false ? null : <p className="pulse-supporter-detail" data-supporter-perk="emote-rain">
          Emote rain, still or falling, is a Supporter perk. Only you see it. It moved from free to Supporter in 0.2.2, and a backdrop you chose is kept for when you support.{' '}
          <a href="#supporter" onClick={() => window.scrollTo?.(0, 0)}>View Supporter benefits →</a>
        </p>}
        <label htmlFor={`${id}-intensity`}>Intensity <output>{draft.intensity}%</output></label>
        <input id={`${id}-intensity`} type="range" min={10} max={70} step={5} disabled={!perks || draft.mode === 'off'} value={draft.intensity} onChange={event => setDraft({ ...draft, intensity: Number(event.target.value) })} />
        <div className="pulse-banner-save"><button type="submit">{banner.saving ? 'Saving...' : 'Save background'}</button><button type="button" onClick={() => setDraft(reset)}>Reset</button></div>
      </fieldset>
      <span role="status">{banner.status}</span>
    </form>
  </details>
}

/** The overlay shows what it draws without turning quick settings into an editor. */
export function PulseBannerQuickPreview({ perks }: { perks: boolean }) {
  const banner = usePulseBanner()
  const shown = perks ? banner.value.mode : 'off'
  const mode = shown === 'off' ? 'Backdrop off' : shown === 'still' ? 'Still 7TV' : '7TV rain'
  return <div className="pulse-personal-panel pulse-banner-quick-preview" data-appearance-preview="true" data-preview-mode={shown} role="img" aria-label={`Appearance preview: ${banner.value.title || 'Stream Pulse'}, ${mode}`} style={bannerThemeVariables}>
    <PulseBannerBackdrop value={banner.value} perks={perks} />
    <strong>{banner.value.title || 'Stream Pulse'}</strong>
    <small>{mode}</small>
  </div>
}
