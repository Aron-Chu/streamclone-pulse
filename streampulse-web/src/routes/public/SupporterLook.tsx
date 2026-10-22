import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { DEFAULT_SUPPORTER_PAINT } from '@pulse-ext/shared/supporterPaint.ts'
import { FINISHES, SAMPLE_KIT, TENURES, finishVars, type KitFinish } from '@pulse-ext/supporter/kit.ts'
import { PulseBannerBackdrop } from '@pulse-ext/ui/PulseBanner.tsx'
import { StreamPulseTitleBlock } from '@pulse-ext/ui/StreamPulseTitleBlock.tsx'
import { shadowStyles } from '@pulse-ext/ui/theme.ts'

/**
 * The /supporter page's pictures (Aron's S1 pick, 2026-10-21): the live preview
 * in the hero and one picture per perk card. Each is drawn by the extension's
 * own paint, crest and emote rain code inside a shadow root, as the /extension
 * demo is, so the page shows exactly what the extension draws.
 *
 * Shadow content is not part of the page's text, so the perk list keeps its
 * words byte-identical to the shared perk list (tests/supporterChatBadgesCopy).
 */

const LOOK_CSS = `
:host { display: block; }
.look { position: relative; isolation: isolate; overflow: hidden; height: 100%; box-sizing: border-box; border-radius: 10px; background: #0b0b0f; font-family: Inter, system-ui, sans-serif; }
.look-head { display: flex; align-items: flex-end; min-height: 150px; padding: 14px 16px 16px; border: 1px solid #2a2a36; }
.look-head .pulse-banner-art img { width: 38px; height: 38px; }
.look-badge { position: absolute; top: 9px; right: 10px; z-index: 3; padding: 0 8px; border: 1px solid #2a2a36; border-radius: 999px; background: rgba(11, 11, 15, 0.82); color: #a1a1aa; font-size: 12px; font-weight: 800; line-height: 18px; white-space: nowrap; }
.look-title { position: relative; z-index: 1; min-width: 0; }
.look-title h2 { font-size: 22px !important; }
.look-pic { display: flex; align-items: center; justify-content: center; gap: 10px; height: 96px; border-bottom: 1px solid #23232d; border-radius: 0; }
.look-pic .pulse-paint { font-size: 22px; font-weight: 900; letter-spacing: 0; }
.look-crests { gap: 14px; }
.look-crests figure { display: grid; justify-items: center; gap: 4px; margin: 0; color: #a1a1aa; font-size: 11px; font-weight: 700; }
.look-crests .pulse-crest { width: 28px; height: 28px; }
.look-rain .pulse-banner-art { z-index: 0; }
.look-card { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border: 1px solid #3b2d6b; border-radius: 10px; background: #141020; }
.look-card .pulse-crest { width: 24px; height: 24px; }
.look-card .pulse-paint { font-size: 16px; }
`

let shared: CSSStyleSheet | null = null

function adopt(shadow: ShadowRoot): void {
  if (shadow.querySelector('style[data-look]') || (shared && shadow.adoptedStyleSheets?.includes(shared))) return
  try {
    shared ??= new CSSStyleSheet()
    if (!shared.cssRules.length) shared.replaceSync(shadowStyles + LOOK_CSS)
    shadow.adoptedStyleSheets = [...shadow.adoptedStyleSheets, shared]
  } catch {
    const style = document.createElement('style')
    style.dataset.look = ''
    style.textContent = shadowStyles + LOOK_CSS
    shadow.append(style)
  }
}

/** A box whose content renders in its own shadow root, with the extension's styles. */
function Shadowed({ className, style, children }: { className?: string; style?: CSSProperties; children: ReactNode }) {
  const host = useRef<HTMLDivElement>(null)
  const [root, setRoot] = useState<ShadowRoot | null>(null)
  useLayoutEffect(() => {
    const el = host.current
    if (!el) return
    const shadow = el.shadowRoot ?? el.attachShadow({ mode: 'open' })
    adopt(shadow)
    setRoot(shadow)
  }, [])
  return <div ref={host} className={className} style={style} aria-hidden="true">{root ? createPortal(children, root) : null}</div>
}

const FINISH_IDS: KitFinish[] = ['glass', 'etched', 'halo']
const RAIN_MODES = [
  { id: 'still', label: 'still' },
  { id: 'rain', label: 'falling' },
] as const

/** The hero's preview: your Pulse panel header in a finish, with its crest and emote rain. */
export function SupporterLookPreview() {
  const [finish, setFinish] = useState<KitFinish>('halo')
  const [rain, setRain] = useState<'still' | 'rain'>('rain')
  return (
    <div className="sp-look">
      <Shadowed className="sp-look__stage" style={finishVars(finish) as CSSProperties}>
        <div className="look look-head pulse-personal-panel">
          <PulseBannerBackdrop value={{ mode: rain, intensity: 30, title: '' }} perks />
          <span className="look-badge">Preview · only you see this</span>
          <div className="look-title">
            <StreamPulseTitleBlock finish={finish} tenure={SAMPLE_KIT.tenure} paint={DEFAULT_SUPPORTER_PAINT} statusLabel="Live chart" statusTone="live" />
          </div>
        </div>
      </Shadowed>
      <div className="sp-look__controls" role="group" aria-label="Try the preview">
        <span className="sp-look__label">Finish</span>
        {FINISH_IDS.map(id => (
          <button key={id} type="button" aria-pressed={finish === id} onClick={() => setFinish(id)}>{FINISHES[id].label}</button>
        ))}
        <span className="sp-look__label">Emote rain</span>
        {RAIN_MODES.map(mode => (
          <button key={mode.id} type="button" aria-pressed={rain === mode.id} onClick={() => setRain(mode.id)}>{mode.label}</button>
        ))}
      </div>
    </div>
  )
}

/** One perk card's picture, drawn with the extension's code. */
export function SupporterPerkPicture({ name }: { name: string }) {
  if (name === 'Title paint') {
    return (
      <Shadowed className="sp-perk__pic">
        <div className="look look-pic">
          <b className="pulse-paint" data-finish="glass" data-wave={DEFAULT_SUPPORTER_PAINT.wave} data-sheen={DEFAULT_SUPPORTER_PAINT.sheen} data-text="Stream Pulse">Stream Pulse</b>
        </div>
      </Shadowed>
    )
  }
  if (name === 'Tenure crest') {
    return (
      <Shadowed className="sp-perk__pic">
        <div className="look look-pic look-crests">
          {TENURES.filter(stage => stage.id !== 'new').map(stage => (
            <figure key={stage.id}><i className="pulse-crest" data-tenure={stage.id} />{stage.short}</figure>
          ))}
        </div>
      </Shadowed>
    )
  }
  if (name === 'Emote rain') {
    return (
      <Shadowed className="sp-perk__pic">
        <div className="look look-pic look-rain">
          <PulseBannerBackdrop value={{ mode: 'rain', intensity: 70, title: '' }} perks />
        </div>
      </Shadowed>
    )
  }
  if (name === 'Supporter card') {
    return (
      <Shadowed className="sp-perk__pic">
        <div className="look look-pic">
          <span className="look-card">
            <i className="pulse-crest" data-tenure={SAMPLE_KIT.tenure} />
            <b className="pulse-paint" data-finish="halo" data-wave={DEFAULT_SUPPORTER_PAINT.wave} data-sheen={DEFAULT_SUPPORTER_PAINT.sheen} data-text="Supporter">Supporter</b>
          </span>
        </div>
      </Shadowed>
    )
  }
  return null
}
