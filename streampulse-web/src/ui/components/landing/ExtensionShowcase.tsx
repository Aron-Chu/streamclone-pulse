import { useEffect, useRef, useState } from 'react'

import { buildExtModel, type ExtModel } from './landingData'

import { ExtensionDemoCard } from './ExtensionDemoCard'

import { startScrollScene } from './scrollScene'



const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)



function prefersReducedMotion(): boolean {

  return (

    typeof window !== 'undefined' &&

    typeof window.matchMedia === 'function' &&

    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  )

}



function canAnimateTour(): boolean {

  if (prefersReducedMotion()) return false

  if (typeof window === 'undefined') return false

  if (typeof IntersectionObserver === 'undefined' || typeof requestAnimationFrame === 'undefined') return false

  if (typeof window.matchMedia === 'function' && !window.matchMedia('(min-width: 961px)').matches) return false

  return true

}



/**

 * Tour accent ramp — one tone per Pulse panel feature card, aligned to StreamPulse

 * chart tokens (violet 7TV, cyan chat, green synced, Twitch purple, rose live).

 */

const TOUR_TONES = [

  { accent: '#a78bfa', strong: '#8b5cf6', soft: '#c4b5fd', rgb: '139, 92, 246', on: '#ffffff' },

  { accent: '#22d3ee', strong: '#06b6d4', soft: '#a5f3fc', rgb: '34, 211, 238', on: '#04181d' },

  { accent: '#22c55e', strong: '#16a34a', soft: '#bbf7d0', rgb: '34, 197, 94', on: '#04180a' },

  { accent: '#9146ff', strong: '#772ce8', soft: '#d9c2ff', rgb: '145, 70, 255', on: '#ffffff' },

  { accent: '#f43f7a', strong: '#e11d5c', soft: '#fbcfe8', rgb: '244, 63, 122', on: '#ffffff' },

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



  // `animate` stays false until a motion-allowed desktop browser mounts, so SSR /

  // reduced-motion / mobile render the static, natively scrollable panel (data-static).

  const [animate, setAnimate] = useState(false)



  useEffect(() => {

    if (!canAnimateTour()) return

    setAnimate(true)

  }, [])



  // Scroll engine — page scroll drives panel content via transform (not scrollTop)

  // so we avoid fighting native page scroll / wheel handling.

  useEffect(() => {

    if (!animate) return

    const root = rootRef.current

    const scene = sceneRef.current

    const port = portRef.current

    if (!root || !scene || !port) return



    const scroll = port.querySelector<HTMLElement>('.sl-ext__scroll')

    if (!scroll) return



    const cards = Array.from(scroll.querySelectorAll<HTMLElement>('[data-tour-step]'))

    if (cards.length === 0) return



    const panel = root.querySelector<HTMLElement>('.sl-ext')

    scroll.classList.add('is-playing')

    port.classList.add('is-playing')



    let active = -1

    const paint = (index: number) => {

      const idx = index < 0 ? 0 : index >= cards.length ? cards.length - 1 : index

      if (idx === active) return

      active = idx

      cards.forEach((card, i) => card.classList.toggle('is-live', i === idx))

      const step = String(Math.min(idx + 1, STEPS.length))

      if (root.dataset.step !== step) root.dataset.step = step

      const tone = TOUR_TONES[idx % TOUR_TONES.length]!

      if (panel) {

        panel.style.setProperty('--xp-accent', tone.accent)

        panel.style.setProperty('--xp-strong', tone.strong)

        panel.style.setProperty('--xp-soft', tone.soft)

        panel.style.setProperty('--xp-rgb', tone.rgb)

        panel.style.setProperty('--xp-on', tone.on)

      }

    }



    const nudgeScrollScene = () => {

      window.dispatchEvent(new Event('resize'))

    }



    let resizeObserver: ResizeObserver | undefined

    if (typeof ResizeObserver !== 'undefined') {

      resizeObserver = new ResizeObserver(nudgeScrollScene)

      resizeObserver.observe(scroll)

    }



    // Shared scroll-scene engine (same as the live analytics replay): exact

    // GPU-transform pinning plus smoothed progress, so both landing sections

    // ease through wheel-step scrolling with the same fluid feel.

    const stop = startScrollScene({

      scene,

      sticky: stickyRef.current,

      onProgress: (p) => {

        const portH = port.clientHeight

        const maxScroll = Math.max(0, scroll.scrollHeight - portH)

        const drive = clamp01((p - 0.04) / 0.88)

        const virtualScroll = drive * maxScroll

        scroll.style.transform = `translate3d(0, ${-virtualScroll}px, 0)`



        const idx = Math.min(cards.length - 1, Math.floor(drive * cards.length))

        paint(idx)

      },

    })



    return () => {

      resizeObserver?.disconnect()

      stop()

      scroll.classList.remove('is-playing')

      port.classList.remove('is-playing')

      scroll.style.transform = ''

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

              <ExtensionDemoCard model={ext} theme="aurora" scrollportRef={portRef} showTourHint={animate} />

            </div>

          </div>

        </div>

      </div>

    </div>
  )
}