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

export function PulseBannerBackdrop({ value, paused = false }: { value: PulseBannerPreference; paused?: boolean }) {
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
    <style>{BANNER_CSS}</style>
    <div ref={ref} className="pulse-banner-art" data-mode={value.mode} data-running={visible && !paused} aria-hidden="true" style={{ opacity: value.intensity / 100 }}>
      {value.mode !== 'off' && EMOTES.map((id, index) => <img key={id} alt="" draggable={false} decoding="async" referrerPolicy="no-referrer"
        src={`https://cdn.7tv.app/emote/${id}/2x_static.webp`}
        onError={event => { event.currentTarget.style.visibility = 'hidden' }}
        style={{ '--i': index, left: `${5 + index * 16}%`, top: `${8 + (index * 17) % 78}%`, animationDelay: `${-index * 5.7}s`, animationDuration: `${24 + index % 3 * 6}s` } as CSSProperties} />)}
    </div>
  </>
}

export function PulseBannerControls({ expanded = false }: { expanded?: boolean }) {
  const banner = usePulseBanner()
  const [draft, setDraft] = useState(banner.value)
  const id = useId()
  useEffect(() => setDraft(banner.value), [banner.value])
  return <details className="pulse-banner-customize" open={expanded || undefined} style={bannerThemeVariables}>
    <summary>Background &amp; motion</summary>
    <form onSubmit={event => { event.preventDefault(); void banner.save(draft) }}>
      <div className="pulse-personal-panel pulse-background-preview" data-appearance-preview="true" aria-label="Appearance preview" style={{ ...streamPulseHeaderChromeSidebar, minHeight: 112 }}>
        <PulseBannerBackdrop value={draft} />
        <div className="pulse-banner-copy"><StreamPulseTitleBlock title={draft.title || undefined} statusLabel="Preview" /></div>
      </div>
      <fieldset disabled={!banner.ready || banner.saving}>
        <label htmlFor={`${id}-title`}>Panel title</label>
        <input id={`${id}-title`} maxLength={40} placeholder="Stream Pulse" value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} />
        <span id={`${id}-mode`}>7TV backdrop</span>
        <div className="pulse-banner-modes" role="group" aria-labelledby={`${id}-mode`}>
          {(['off', 'still', 'rain'] as const).map(mode => <button key={mode} type="button" aria-pressed={draft.mode === mode} onClick={() => setDraft({ ...draft, mode })}>{mode === 'off' ? 'Off' : mode === 'still' ? 'Still' : 'Rain'}</button>)}
        </div>
        <label htmlFor={`${id}-intensity`}>Intensity <output>{draft.intensity}%</output></label>
        <input id={`${id}-intensity`} type="range" min={10} max={70} step={5} disabled={draft.mode === 'off'} value={draft.intensity} onChange={event => setDraft({ ...draft, intensity: Number(event.target.value) })} />
        <div className="pulse-banner-save"><button type="submit">{banner.saving ? 'Saving...' : 'Save background'}</button><button type="button" onClick={() => setDraft(DEFAULT_PULSE_BANNER)}>Reset</button></div>
      </fieldset>
      <span role="status">{banner.status}</span>
    </form>
  </details>
}

/** The overlay shows the saved appearance without turning quick settings into an editor. */
export function PulseBannerQuickPreview() {
  const banner = usePulseBanner()
  const mode = banner.value.mode === 'off' ? 'Off' : banner.value.mode === 'still' ? 'Still 7TV' : '7TV rain'
  return <div className="pulse-personal-panel pulse-banner-quick-preview" data-appearance-preview="true" data-preview-mode={banner.value.mode} role="img" aria-label={`Appearance preview: ${banner.value.title || 'Stream Pulse'}, ${mode}`} style={bannerThemeVariables}>
    <PulseBannerBackdrop value={banner.value} />
    <strong>{banner.value.title || 'Stream Pulse'}</strong>
    <small>{mode}</small>
  </div>
}

const BANNER_CSS = `
.pulse-personal-panel { isolation: isolate; }
/* Previews need a containing block for the art layer. The overlay shell already has one:
   relative in the sidebar, fixed in right/bottom placement, which must stay fixed. */
.pulse-personal-panel:not(.placement-right):not(.placement-bottom) { position: relative; }
.pulse-background-preview { background: var(--pulse-banner-canvas); border: 1px solid var(--pulse-banner-border); border-radius: var(--pulse-banner-radius); overflow: hidden; }
.pulse-banner-quick-preview { align-items: center; background: var(--pulse-banner-canvas); border: 1px solid var(--pulse-banner-border); border-radius: var(--pulse-banner-radius); color: var(--pulse-banner-text); display: flex; gap: 8px; min-height: 48px; min-width: 0; overflow: hidden; padding: 8px 10px; }
.pulse-banner-quick-preview strong { flex: 1 1 auto; font-size: 12px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pulse-banner-quick-preview small { color: var(--pulse-banner-text-secondary); flex: none; font-size: 10px; }
.pulse-personal-banner { background: transparent; }
.pulse-banner-art { position: absolute; inset: 0; z-index: -1; pointer-events: none; overflow: hidden; container-type: size; }
.pulse-background-preview .pulse-banner-art, .pulse-banner-quick-preview .pulse-banner-art { z-index: 0; }
.pulse-background-preview .pulse-banner-copy, .pulse-banner-quick-preview strong, .pulse-banner-quick-preview small { position: relative; z-index: 1; }
.pulse-banner-art img { position: absolute; width: 34px; height: 34px; object-fit: contain; transform: rotate(calc(var(--i) * 9deg - 20deg)); opacity: .8; }
.pulse-banner-art[data-mode="rain"] img { top: 0 !important; animation: pulse-banner-rain linear infinite; animation-play-state: paused; }
.pulse-banner-art[data-mode="rain"][data-running="true"] img { animation-play-state: running; }
.pulse-banner-copy { min-width: 0; overflow-wrap: anywhere; }
.pulse-banner-customize { width: 100%; min-width: 0; font-size: 12px; color: inherit; }
.pulse-banner-customize summary { cursor: pointer; padding: 10px 0; font-weight: 600; color: var(--pulse-banner-text); }
.pulse-banner-customize output { color: var(--pulse-banner-text-secondary); font-variant-numeric: tabular-nums; }
.pulse-banner-customize input[type="range"] { min-height: 24px; }
.pulse-banner-save button[type="submit"] { flex: 1; font-weight: 600; }
.pulse-banner-customize form, .pulse-banner-customize fieldset { display: grid; gap: 10px; min-width: 0; }
.pulse-banner-customize fieldset { border: 0; padding: 0; margin: 0; }
.pulse-banner-customize label { display: flex; justify-content: space-between; }
.pulse-banner-customize input { min-width: 0; width: 100%; box-sizing: border-box; accent-color: var(--pulse-banner-accent); }
.pulse-banner-customize input:not([type="range"]) { background: var(--pulse-banner-canvas); color: var(--pulse-banner-text); border: 1px solid var(--pulse-banner-border); border-radius: var(--pulse-banner-radius); padding: 8px; font: inherit; }
.pulse-banner-modes, .pulse-banner-save { display: flex; gap: 6px; }
.pulse-banner-modes { gap: 2px; padding: 3px; background: var(--pulse-banner-canvas); border: 1px solid var(--pulse-banner-border); border-radius: var(--pulse-banner-radius); }
.pulse-banner-modes button { flex: 1; }
.pulse-banner-customize button { min-height: 32px; padding: 6px 12px; border: 1px solid var(--pulse-banner-border); border-radius: var(--pulse-banner-radius); background: var(--pulse-banner-panel); color: var(--pulse-banner-text); font: inherit; cursor: pointer; transition: background 140ms ease, border-color 140ms ease; }
.pulse-banner-customize button[aria-pressed="true"], .pulse-banner-customize button[type="submit"] { background: rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.16); border-color: var(--pulse-banner-border-accent); color: var(--pulse-banner-accent-ink); }
.pulse-banner-customize button:hover { background: var(--pulse-banner-panel-elevated); }
.pulse-banner-customize :focus-visible { outline: 2px solid var(--pulse-banner-accent-soft); outline-offset: 2px; }
.pulse-banner-customize button:disabled { opacity: .5; cursor: default; }
@keyframes pulse-banner-rain { from { translate: 0 -50px; rotate: -12deg; } to { translate: -12px calc(100cqh + 50px); rotate: 18deg; } }
@media (prefers-reduced-motion: reduce) { .pulse-banner-art[data-mode="rain"] img { animation: none; top: calc(8% + var(--i) * 15%) !important; } .pulse-banner-customize button { transition: none; } }
`
