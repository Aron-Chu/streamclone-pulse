// Extension UI is bundled via Vite alias; runtime types come from the sibling streamclone-pulse checkout.
// @ts-nocheck
import { forwardRef, useEffect, useLayoutEffect, useRef, useState, type Ref } from 'react'
import type { CSSProperties } from 'react'
import { LIVE_HEAT_SUBTITLE } from '@streampulse/pulse-core'
import { LiveStatsBand } from '@pulse-ext/ui/LiveStatsBand.tsx'
import { MostReactedSection } from '@pulse-ext/ui/MostReactedSection.tsx'
import { PastVodsSection } from '@pulse-ext/ui/PastVodsSection.tsx'
import { PulseSidebarTabs } from '@pulse-ext/ui/PulseSidebarTabs.tsx'
import { applyAccentTheme } from '@pulse-ext/ui/overlayTheme.ts'
import { shadowStyles, theme } from '@pulse-ext/ui/theme.ts'
import '../../../shims/install-chrome-global.ts'
import {
  LANDING_PAST_VODS,
  loadLandingPulseFixture,
} from './landingPulseFixture.ts'
import { LandingCoveragePanel } from './LandingCoveragePanel.tsx'
import './PulseLandingPanel.css'
import './LandingTourChartReveal.css'

const BACKEND_URL = 'https://api.streampulse.stream'

const LANDING_TOUR_STYLE_GUARD = `
  .pulse-landing-panel[data-tour-active] .pulse-landing-scrollport,
  .pulse-landing-panel[data-tour-active] .pulse-landing-scroll,
  .pulse-landing-panel[data-tour-active] .sl-ext__scrollport,
  .pulse-landing-panel[data-tour-active] .sl-ext__scroll,
  .pulse-landing-panel[data-tour-active] .pulse-panel-body {
    overflow: hidden !important;
    overscroll-behavior: none !important;
    scrollbar-width: none !important;
  }
  .pulse-landing-panel[data-tour-active] .pulse-landing-scrollport::-webkit-scrollbar,
  .pulse-landing-panel[data-tour-active] .pulse-landing-scroll::-webkit-scrollbar,
  .pulse-landing-panel[data-tour-active] .sl-ext__scrollport::-webkit-scrollbar,
  .pulse-landing-panel[data-tour-active] .sl-ext__scroll::-webkit-scrollbar {
    display: none !important;
    width: 0 !important;
    height: 0 !important;
  }
`

export interface PulseLandingPanelProps {
  scrollportRef?: Ref<HTMLDivElement>
  activeStep?: number
  tourActive?: boolean
  showTourHint?: boolean
}

export const PulseLandingPanel = forwardRef<HTMLDivElement, PulseLandingPanelProps>(
  function PulseLandingPanel(
    { scrollportRef, activeStep = 1, tourActive = false, showTourHint = false },
    ref,
  ) {
    const styleRef = useRef<HTMLStyleElement | null>(null)
    const localScrollportRef = useRef<HTMLDivElement | null>(null)
    const [stylesReady, setStylesReady] = useState(false)
    const payload = loadLandingPulseFixture()

    const setScrollportRef = (node: HTMLDivElement | null) => {
      localScrollportRef.current = node
      if (typeof scrollportRef === 'function') {
        scrollportRef(node)
      } else if (scrollportRef) {
        scrollportRef.current = node
      }
    }

    useEffect(() => {
      applyAccentTheme('aurora')
      const el = styleRef.current
      if (el) {
        el.textContent = shadowStyles + LANDING_TOUR_STYLE_GUARD
        setStylesReady(true)
      }
    }, [])

    useLayoutEffect(() => {
      const port = localScrollportRef.current
      if (!port || !tourActive) return

      port.classList.add('is-playing')
      const scroll = port.querySelector<HTMLElement>('.sl-ext__scroll')
      scroll?.classList.add('is-playing')

      return () => {
        port.classList.remove('is-playing')
        scroll?.classList.remove('is-playing')
      }
    }, [tourActive, stylesReady])

    useEffect(() => {
      const port = localScrollportRef.current
      if (!port || !tourActive) return

      const redirectWheelToPage = (event: WheelEvent) => {
        event.preventDefault()
        window.scrollBy({ top: event.deltaY, left: event.deltaX, behavior: 'auto' })
      }

      port.addEventListener('wheel', redirectWheelToPage, { passive: false })
      return () => port.removeEventListener('wheel', redirectWheelToPage)
    }, [tourActive, stylesReady])

    return (
      <div
        ref={ref}
        className="sl-ext pulse-landing-panel"
        data-theme="aurora"
        data-tour-active={tourActive ? '' : undefined}
        data-active-step={String(activeStep)}
        role="region"
        aria-label="StreamPulse Pulse sidebar preview"
        aria-busy={stylesReady ? undefined : true}
      >
        <style ref={styleRef} />
        <div className="pulse-shell pulse-sidebar-shell pulse-landing-shell">
          <div className="sl-ext__tabs pulse-sidebar-tabs-wrap">
            <PulseSidebarTabs active="pulse" demoMode />
          </div>

          <div className="sl-ext__fixed pulse-landing-header">
            <header style={headerStyles.wrap}>
              <div style={headerStyles.titleRow}>
                <h2 style={headerStyles.title}>Stream Pulse</h2>
                <span style={headerStyles.liveBadge}>
                  <span className="pulse-live-dot" style={headerStyles.liveDot} aria-hidden />
                  Live
                </span>
              </div>
              <p style={headerStyles.lead}>{LIVE_HEAT_SUBTITLE}</p>
              <span style={headerStyles.trackPill}>Tracking {payload.login}</span>
              <div style={headerStyles.autoRow}>
                <span>Auto-updating</span>
                <span className="pulse-toggle pulse-toggle-on" aria-hidden style={headerStyles.toggle} />
              </div>
            </header>
          </div>

          <div
            className="sl-ext__scrollport pulse-landing-scrollport pulse-no-scrollbar"
            ref={setScrollportRef}
          >
            <div className="sl-ext__scroll pulse-landing-scroll pulse-no-scrollbar">
              <div
                className="sl-ext__card pulse-landing-tour-step pulse-landing-chart-reveal"
                data-tour-step="1"
                data-tour-step-active={activeStep === 1 ? '' : undefined}
              >
                <LiveStatsBand
                  payload={payload}
                  backendUrl={BACKEND_URL}
                  sidebarFill
                  isLive
                  currentOffsetSeconds={payload.currentOffsetSeconds}
                  coverageStartOffsetSeconds={payload.coverageStartOffsetSeconds}
                  demoMode
                />
              </div>

              <div
                className="sl-ext__card pulse-landing-tour-step"
                data-tour-step="2"
                data-tour-step-active={activeStep === 2 ? '' : undefined}
              >
                <LandingCoveragePanel payload={payload} />
              </div>

              <div
                className="sl-ext__card pulse-landing-tour-step"
                data-tour-step="3"
                data-tour-step-active={activeStep === 3 ? '' : undefined}
              >
                <MostReactedSection
                  payload={payload}
                  backendUrl={BACKEND_URL}
                  sidebarFill
                  onJump={() => undefined}
                  onSave={() => undefined}
                  onAnalytics={() => undefined}
                  demoMode
                />
              </div>

              <div
                className="sl-ext__card pulse-landing-tour-step"
                data-tour-step="4"
                data-tour-step-active={activeStep === 4 ? '' : undefined}
              >
                <PastVodsSection
                  login={payload.login}
                  backendUrl={BACKEND_URL}
                  liveStreamId={payload.streamId}
                  isLive={payload.isLive}
                  demoRows={LANDING_PAST_VODS}
                  demoMode
                />
              </div>
            </div>
          </div>

          {showTourHint ? (
            <p className="sl-ext__scrollhint pulse-landing-scrollhint" aria-hidden="true">
              Scroll the page — the tour walks through each Pulse panel section.
            </p>
          ) : null}
        </div>
      </div>
    )
  },
)

const headerStyles: Record<string, CSSProperties> = {
  wrap: { padding: '0 2px 8px' },
  titleRow: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8 },
  title: {
    color: theme.textPrimary,
    fontSize: 15,
    fontWeight: 800,
    letterSpacing: '0.04em',
    margin: 0,
    textTransform: 'uppercase',
  },
  liveBadge: {
    alignItems: 'center',
    background: 'rgba(244, 63, 122, 0.18)',
    border: '1px solid rgba(244, 63, 122, 0.35)',
    borderRadius: 6,
    color: '#fda4af',
    display: 'inline-flex',
    fontSize: 10,
    fontWeight: 800,
    gap: 5,
    marginLeft: 'auto',
    padding: '2px 7px',
  },
  liveDot: { background: theme.live, borderRadius: '50%', height: 6, width: 6 },
  lead: { color: theme.textSecondary, fontSize: 11, lineHeight: 1.4, margin: '6px 0 8px' },
  trackPill: {
    background: 'rgba(139, 92, 246, 0.12)',
    border: '1px solid rgba(139, 92, 246, 0.35)',
    borderRadius: 9,
    color: theme.accentSoft,
    display: 'block',
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: '0.06em',
    marginBottom: 8,
    padding: '8px 10px',
    textAlign: 'center',
  },
  autoRow: {
    alignItems: 'center',
    color: theme.textMuted,
    display: 'flex',
    fontSize: 11,
    fontWeight: 700,
    justifyContent: 'space-between',
  },
  toggle: {
    background: theme.accent,
    borderRadius: 999,
    display: 'inline-block',
    height: 18,
    position: 'relative',
    width: 34,
  },
}
