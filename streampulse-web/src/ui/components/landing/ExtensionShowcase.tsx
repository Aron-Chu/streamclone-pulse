import { useEffect, useRef, useState } from 'react'
import { buildExtModel, type ExtModel } from './landingData'
import { ExtensionDemoCard } from './ExtensionDemoCard'

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/**
 * Aurora accent ramp the Pulse panel shimmers through as scroll drives each
 * feature card — cyan → indigo → violet → purple → fuchsia. Centered on the
 * extension's aurora violet, with the borealis cyan/pink edges. One tone per
 * feature card, in scroll order.
 */
const AURORA_TONES = [
  { accent: '#22d3ee', strong: '#0fb6d6', soft: '#a5f0fb', rgb: '34, 211, 238', on: '#04181d' },
  { accent: '#7c83ff', strong: '#6366f1', soft: '#c7d2fe', rgb: '124, 131, 255', on: '#0a0a23' },
  { accent: '#8b5cf6', strong: '#7c3aed', soft: '#c4b5fd', rgb: '139, 92, 246', on: '#ffffff' },
  { accent: '#a855f7', strong: '#9333ea', soft: '#e9d5ff', rgb: '168, 85, 247', on: '#ffffff' },
  { accent: '#e879f9', strong: '#d946ef', soft: '#f5d0fe', rgb: '232, 121, 249', on: '#2a0a2e' },
] as const

/** Narrative steps — one per Pulse panel feature card, in scroll order. */
interface TourStep {
  kicker: string
  title: string
  body: string
}
const STEPS: readonly TourStep[] = [
  {
    kicker: 'Live now',
    title: 'Live viewers, chat & emote rate',
    body: 'Viewers, chat/min and emotes/min refresh every minute with rolling 5-minute deltas — the same KPIs the extension docks into your Twitch sidebar.',
  },
  {
    kicker: 'Chat velocity',
    title: '60-minute chat & 7TV chart',
    body: 'Per-minute chat bars with a min–max band, the dashed 7TV/min line on top, and the live top-emote leaderboard underneath.',
  },
  {
    kicker: 'Coverage',
    title: 'Honest data coverage',
    body: 'StreamPulse shows exactly when the collector attached and how much of the broadcast is covered — never inflated history.',
  },
  {
    kicker: 'Most reacted',
    title: 'The loudest moments, ranked',
    body: 'Backend-detected chat and emote spikes are scored and ranked, so you can jump straight to the biggest moment of the stream.',
  },
  {
    kicker: 'Past streams',
    title: 'Past VODs & full analytics',
    body: 'Every tracked broadcast is one tap away — replay a VOD on Twitch or open the full analytics dashboard off Twitch.',
  },
] as const

/**
 * The Pulse panel as it docks in the Twitch sidebar — no fake browser chrome.
 * A transform-pinned stage holds the real extension panel while page scroll
 * drives its own scrollport through every feature card, lighting the centered
 * card (plus its narrative rail step and aurora accent) as it passes by.
 */
export function ExtensionShowcase({ model }: { model?: ExtModel }) {
  const ext = model ?? buildExtModel(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const sceneRef = useRef<HTMLDivElement | null>(null)
  const stickyRef = useRef<HTMLDivElement | null>(null)
  const portRef = useRef<HTMLDivElement | null>(null)

  // `animate` stays false until a motion-allowed browser mounts, so SSR /
  // reduced-motion render the static, fully-expanded panel (data-static).
  const [animate, setAnimate] = useState(false)

  useEffect(() => {
    if (prefersReducedMotion()) return
    if (typeof IntersectionObserver === 'undefined' || typeof requestAnimationFrame === 'undefined') return
    setAnimate(true)
  }, [])

  // Scroll engine — page scroll drives the panel's own scrollport through each
  // feature card, lighting the centered card (+ its rail step + aurora tone) as
  // it passes. Mirrors LiveSignalScrollGraph's transform-pin pattern.
  useEffect(() => {
    if (!animate) return
    const root = rootRef.current
    const scene = sceneRef.current
    const port = portRef.current
    if (!root || !scene || !port) return

    const cards = Array.from(port.querySelectorAll<HTMLElement>('.sl-ext__card'))
    if (cards.length === 0) return
    const scroll = port.querySelector<HTMLElement>('.sl-ext__scroll')
    const panel = root.querySelector<HTMLElement>('.sl-ext')
    scroll?.classList.add('is-playing')

    let active = -1
    const paint = (index: number) => {
      const idx = index < 0 ? 0 : index >= cards.length ? cards.length - 1 : index
      if (idx === active) return
      active = idx
      cards.forEach((card, i) => card.classList.toggle('is-live', i === idx))
      const step = String(Math.min(idx + 1, STEPS.length))
      if (root.dataset.step !== step) root.dataset.step = step
      const tone = AURORA_TONES[idx % AURORA_TONES.length]!
      if (panel) {
        panel.style.setProperty('--xp-accent', tone.accent)
        panel.style.setProperty('--xp-strong', tone.strong)
        panel.style.setProperty('--xp-soft', tone.soft)
        panel.style.setProperty('--xp-rgb', tone.rgb)
        panel.style.setProperty('--xp-on', tone.on)
      }
    }

    let raf = 0
    const measure = () => {
      raf = 0
      const vh = window.innerHeight || 1
      const rect = scene.getBoundingClientRect()
      const scrollable = scene.offsetHeight - vh
      const p = scrollable > 0 ? clamp01(-rect.top / scrollable) : 0

      // Transform-pin the stage: .sp-landing is a non-scrolling overflow
      // container, so native position:sticky never engages here.
      if (stickyRef.current) {
        const pin = Math.min(Math.max(-rect.top, 0), Math.max(scrollable, 0))
        stickyRef.current.style.transform = `translate3d(0, ${pin}px, 0)`
      }

      // Drive the panel scrollport from progress, with a small lead-in/out so
      // the first and last cards rest fully in view at the scroll extremes.
      const portH = port.clientHeight
      const maxScroll = Math.max(0, port.scrollHeight - portH)
      const drive = clamp01((p - 0.07) / 0.86)
      port.scrollTop = drive * maxScroll

      // Light the card nearest the scrollport's vertical center.
      const center = port.scrollTop + portH / 2
      let idx = 0
      let best = Infinity
      for (let i = 0; i < cards.length; i++) {
        const card = cards[i]!
        const cc = card.offsetTop + card.offsetHeight / 2
        const d = Math.abs(cc - center)
        if (d < best) {
          best = d
          idx = i
        }
      }
      paint(idx)
    }

    const onScroll = () => {
      if (!raf) raf = window.requestAnimationFrame(measure)
    }
    // Inner scrollport is driven by page scroll — forward wheel to the document
    // so hovering the panel does not hijack the scroll tour.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      window.scrollBy(0, e.deltaY)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    port.addEventListener('wheel', onWheel, { passive: false })
    measure()
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      port.removeEventListener('wheel', onWheel)
      if (raf) window.cancelAnimationFrame(raf)
      scroll?.classList.remove('is-playing')
    }
  }, [animate])

  return (
    <div className="sl-xtour" ref={rootRef} data-step="1" {...(animate ? {} : { 'data-static': '' })}>
      <div className="sl-xtour__scene" ref={sceneRef}>
        <div className="sl-xtour__sticky" ref={stickyRef}>
          <div className="sl-xtour__grid">
            <aside className="sl-xtour__rail" aria-hidden="true">
              <span className="sl-xtour__eyebrow">
                <span className="sl-dot" /> StreamPulse · Pulse tab
              </span>
              <ol className="sl-xtour__steps">
                {STEPS.map((step, idx) => (
                  <li className="sl-xtour__step" data-step={idx + 1} key={step.kicker}>
                    <span className="sl-xtour__step-rail" />
                    <span className="sl-xtour__step-kicker">{step.kicker}</span>
                    <span className="sl-xtour__step-title">{step.title}</span>
                    <span className="sl-xtour__step-body">{step.body}</span>
                  </li>
                ))}
              </ol>
            </aside>
            <div className="sl-xtour__stage">
              <ExtensionDemoCard model={ext} theme="aurora" scrollportRef={portRef} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
