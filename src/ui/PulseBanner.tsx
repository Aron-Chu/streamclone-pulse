import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { DEFAULT_PULSE_BANNER, PULSE_BANNER_KEY, getPulseBanner, normalizePulseBanner, setPulseBanner, type PulseBannerPreference } from '../shared/storage.ts'
import { StreamPulseTitleBlock, streamPulseHeaderChromeSidebar } from './StreamPulseTitleBlock.tsx'
import { theme } from './theme.ts'

// Original StreamPulse marks (the pulse line, a spark and a diamond), drawn in
// the paint's colours. Nothing is fetched, so the backdrop draws even when
// other sites' images are blocked, and CSS alone moves it.
const ART = ['M1 10h4l2-6 3 10 2-6h5', 'M9 2l2 5 5 2-5 2-2 5-2-5-5-2 5-2z', 'M9 4l5 5-5 5-5-5z']

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
  const [loadError, setLoadError] = useState(false)
  const alive = useRef(false)
  const loadRequest = useRef(0)
  const pendingSave = useRef(false)
  const reload = useCallback(async () => {
    const request = ++loadRequest.current
    setReady(false)
    setLoadError(false)
    try {
      const next = await getPulseBanner()
      if (alive.current && request === loadRequest.current) { setValue(next); setReady(true) }
    } catch {
      if (alive.current && request === loadRequest.current) setLoadError(true)
    }
  }, [])
  useEffect(() => {
    alive.current = true
    void reload()
    const changes = globalThis.chrome?.storage?.onChanged
    const listener = (items: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'sync' || !items[PULSE_BANNER_KEY]) return
      // A newer synced setting wins over an initial read or retry still in flight.
      loadRequest.current++
      setValue(normalizePulseBanner(items[PULSE_BANNER_KEY].newValue))
      setReady(true)
      setLoadError(false)
    }
    changes?.addListener(listener)
    return () => { alive.current = false; loadRequest.current++; changes?.removeListener(listener) }
  }, [reload])
  async function save(next: PulseBannerPreference) {
    if (!ready || pendingSave.current) return
    pendingSave.current = true
    setSaving(true)
    setStatus('')
    try {
      await setPulseBanner(next)
      if (alive.current) { setValue(normalizePulseBanner(next)); setStatus('Saved') }
    } catch {
      if (alive.current) setStatus("Couldn't save that. Try again.")
    } finally {
      pendingSave.current = false
      if (alive.current) setSaving(false)
    }
  }
  return { value, ready, saving, status, save, loadError, reload }
}

/** Keep retry reachable when the setting's controls are paused after a failed read. */
export function PulseBannerLoadError({ onRetry }: { onRetry: () => void }) {
  return <p className="pulse-supporter-detail" role="status" data-emote-rain-load-error>
    Couldn't load your backdrop setting. <button className="pulse-link-btn" type="button" onClick={onRetry}>Try again</button>
  </p>
}

/**
 * The backdrop, Still or drifting (stored as `rain`), is a Supporter perk.
 * Without verified perks it draws nothing, whatever an older preference saved,
 * and leaves that choice stored so it returns if the person supports again.
 * `finish` colours the marks; without one they take the accent.
 */
export function PulseBannerBackdrop({ value, perks, finish, paused = false }: { value: PulseBannerPreference; perks: boolean; finish?: string | null; paused?: boolean }) {
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
  return <div ref={ref} className="pulse-banner-art" data-mode={mode} data-finish={finish ?? undefined} data-running={visible && !paused} aria-hidden="true" style={{ opacity: value.intensity / 100 }}>
    {mode !== 'off' && [...ART, ...ART].map((d, index) => <svg key={index} viewBox="0 0 18 18"
      style={{ '--i': index, left: `${5 + index * 16}%`, top: `${8 + (index * 17) % 78}%`, animationDelay: `${-index * 5.7}s`, animationDuration: `${24 + index % 3 * 6}s` } as CSSProperties}><path d={d} /></svg>)}
  </div>
}

/**
 * The panel title, over a preview of the panel header. The backdrop behind the
 * header is part of Your look in Account & Supporter, so a look is changed in
 * one place. `perks` is undefined until the membership check answers.
 */
export function PulseBannerControls({ expanded = false, perks }: { expanded?: boolean; perks: boolean | undefined }) {
  const banner = usePulseBanner()
  const [title, setTitle] = useState(banner.value.title)
  const id = useId()
  useEffect(() => setTitle(banner.value.title), [banner.value.title])
  // "#pulse-background" opens this section: expand this and bring it into view.
  const ref = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const details = ref.current
    if (!details || window.location.hash !== '#pulse-background') return
    details.open = true
    details.scrollIntoView?.({ block: 'start' })
    details.querySelector<HTMLElement>('summary')?.focus({ preventScroll: true })
  }, [])
  return <details ref={ref} className="pulse-banner-customize" open={expanded || undefined} style={bannerThemeVariables} data-supporter-perks={perks ? 'on' : perks === false ? 'locked' : 'pending'}>
    <summary>Panel title</summary>
    <form onSubmit={event => { event.preventDefault(); void banner.save({ ...banner.value, title }) }}>
      <div className="pulse-personal-panel pulse-background-preview" data-appearance-preview="true" aria-label="Appearance preview" style={{ ...streamPulseHeaderChromeSidebar, minHeight: 112 }}>
        <PulseBannerBackdrop value={banner.value} perks={perks === true} />
        <div className="pulse-banner-copy"><StreamPulseTitleBlock title={title || undefined} statusLabel="Preview" /></div>
      </div>
      <fieldset disabled={!banner.ready || banner.saving}>
        <label htmlFor={`${id}-title`}>Panel title</label>
        <input id={`${id}-title`} maxLength={40} placeholder="Stream Pulse" value={title} onChange={event => setTitle(event.target.value)} />
        <p className="pulse-supporter-detail" data-supporter-perk="backdrop">
          The backdrop behind the header is part of <a href="#supporter" onClick={() => window.scrollTo?.(0, 0)}>Your look</a>.
        </p>
        <div className="pulse-banner-save"><button type="submit">{banner.saving ? 'Saving...' : 'Save title'}</button><button type="button" onClick={() => setTitle('')}>Reset</button></div>
      </fieldset>
      {banner.loadError ? <PulseBannerLoadError onRetry={() => void banner.reload()} /> : null}
      <span role="status">{banner.status}</span>
    </form>
  </details>
}
