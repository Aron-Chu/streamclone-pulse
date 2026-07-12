import { useCallback, useEffect, useRef, useState } from 'react'

import { PulseLandingPanel } from './PulseLandingPanel'
import { ScrollPinnedTour, canAnimateScrollTour } from './scroll-tour/ScrollPinnedTour'
import { TourRail } from './scroll-tour/TourRail'
import { useTourPanelScroll } from './scroll-tour/useTourPanelScroll'
import type { TourPanelScrollState, TourStep, TourTone } from './scroll-tour/types'

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)

const TOUR_TONES: readonly TourTone[] = [
  { accent: '#a78bfa', strong: '#8b5cf6', soft: '#c4b5fd', rgb: '139, 92, 246', on: '#ffffff' },
  { accent: '#22c55e', strong: '#16a34a', soft: '#bbf7d0', rgb: '34, 197, 94', on: '#04180a' },
  { accent: '#9146ff', strong: '#772ce8', soft: '#d9c2ff', rgb: '145, 70, 255', on: '#ffffff' },
  { accent: '#f43f7a', strong: '#e11d5c', soft: '#fbcfe8', rgb: '244, 63, 122', on: '#ffffff' },
] as const

const STEPS: readonly TourStep[] = [
  {
    kicker: 'Live now',
    title: 'Live KPIs & 60-minute Stream Activity chart',
    body: 'Viewers, chat/min, and 7TV/min refresh every minute with the same multi-lane chart, emote plot picker, and top-emote leaderboard the extension docks into your Twitch sidebar.',
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

export function ExtensionShowcase() {
  const portRef = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const tourRootRef = useRef<HTMLDivElement | null>(null)
  const lastActiveIndexRef = useRef(-1)
  const tourCardsRef = useRef<HTMLElement[]>([])

  const [animate, setAnimate] = useState(false)
  const [activeStep, setActiveStep] = useState(1)

  useEffect(() => {
    if (canAnimateScrollTour()) setAnimate(true)
  }, [])

  const paintStepChange = useCallback((activeIndex: number, smoothed: number, drive: number) => {
    const panel = panelRef.current
    const tourRoot = tourRootRef.current
    const cards = tourCardsRef.current
    const tone = TOUR_TONES[activeIndex % TOUR_TONES.length]!

    if (tourRoot) {
      tourRoot.dataset.step = String(activeIndex + 1)
    }

    cards.forEach((card, i) => {
      card.classList.toggle('is-live', i === activeIndex)
      card.toggleAttribute('data-tour-step-active', i === activeIndex)
    })

    if (panel) {
      panel.style.setProperty('--xp-accent', tone.accent)
      panel.style.setProperty('--xp-strong', tone.strong)
      panel.style.setProperty('--xp-soft', tone.soft)
      panel.style.setProperty('--xp-rgb', tone.rgb)
      panel.style.setProperty('--xp-on', tone.on)
      panel.style.setProperty('--tour-p', smoothed.toFixed(4))
      panel.style.setProperty('--tour-drive', drive.toFixed(4))

      const stepSpan = 1 / STEPS.length
      const step1End = stepSpan * 1.15
      const chartWipe =
        activeIndex === 0 ? clamp01(drive / step1End) : activeIndex > 0 ? 1 : 0
      panel.style.setProperty('--chart-wipe', chartWipe.toFixed(4))
    }
  }, [])

  const handlePanelScrollState = useCallback(
    (state: TourPanelScrollState) => {
      const panel = panelRef.current
      if (panel) {
        panel.style.setProperty('--tour-p', state.progress.toFixed(4))
        panel.style.setProperty('--tour-drive', state.drive.toFixed(4))
        const stepSpan = 1 / STEPS.length
        const step1End = stepSpan * 1.15
        const chartWipe =
          state.activeStep === 1
            ? clamp01(state.drive / step1End)
            : state.activeStep > 1
              ? 1
              : 0
        panel.style.setProperty('--chart-wipe', chartWipe.toFixed(4))
      }

      if (state.activeIndex !== lastActiveIndexRef.current) {
        lastActiveIndexRef.current = state.activeIndex
        setActiveStep(state.activeStep)
        paintStepChange(state.activeIndex, state.progress, state.drive)
      }
    },
    [paintStepChange],
  )

  const { applyProgress, cardsRef } = useTourPanelScroll({
    enabled: animate,
    scrollportRef: portRef,
    stepCount: STEPS.length,
    onStateChange: handlePanelScrollState,
  })

  useEffect(() => {
    if (!animate) return
    const id = window.requestAnimationFrame(() => {
      tourCardsRef.current = cardsRef.current
      if (tourCardsRef.current.length > 0) {
        lastActiveIndexRef.current = -1
        paintStepChange(0, 0, 0)
      }
    })
    return () => window.cancelAnimationFrame(id)
  }, [animate, cardsRef, paintStepChange])

  const handleProgress = useCallback(
    (smoothed: number, raw: number) => {
      tourCardsRef.current = cardsRef.current
      applyProgress(smoothed, raw)
    },
    [applyProgress, cardsRef],
  )

  return (
    <ScrollPinnedTour
      ref={tourRootRef}
      activeStep={activeStep}
      onProgress={animate ? handleProgress : undefined}
    >
      <div className="sl-xtour__grid">
        <TourRail steps={STEPS} activeStep={activeStep} id="demo-title" />
        <div className="sl-xtour__stage sl-xtour__panel">
          <PulseLandingPanel
            ref={panelRef}
            scrollportRef={portRef}
            activeStep={activeStep}
            tourActive={animate}
            showTourHint={animate}
          />
        </div>
      </div>
    </ScrollPinnedTour>
  )
}
