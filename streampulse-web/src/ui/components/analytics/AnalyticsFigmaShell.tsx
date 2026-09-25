import type { ReactNode } from 'react'

import { useRef } from 'react'
import { Link } from 'react-router-dom'

import { useAnalyticsTheme } from '../../providers/AnalyticsThemeProvider'

import { AnalyticsThemeProvider } from '../../providers/AnalyticsThemeProvider'


import { AnalyticsHubSidebar } from './AnalyticsHubSidebar'

import { AnalyticsTopNav } from './AnalyticsTopNav'

const NAV_ITEMS = [
  { label: 'Home', to: '/', end: true },
  { label: 'Analytics', to: '/analytics', end: true },
  // "All moments" rather than "Moments": the session page's right rail already
  // has a Moments tab scoped to one stream, and two links named the same thing
  // at different scopes read as the same destination.
  { label: 'All moments', to: '/analytics/moments' },
  { label: 'Pulse Explorer', to: '/analytics/explore' },
]

export interface AnalyticsFigmaShellProps {
  backendStatus?: { label: string; value: string; tone?: 'ready' | 'degraded' | 'offline' | 'checking' }
  sidebarStatusLabel?: string
  sidebarSections?: Array<{ id: string; label: string; hidden?: boolean }>
  /** Hide hub section nav (session console routes use in-page chrome instead). */
  hideSidebar?: boolean
  /** Optional Live Wire catch-moment rail, mounted as a single right aside. */
  rightRail?: ReactNode
  children: ReactNode
}

function AnalyticsFigmaShellInner({
  backendStatus,
  sidebarStatusLabel,
  sidebarSections,
  hideSidebar = false,
  rightRail,
  children,
}: AnalyticsFigmaShellProps) {
  const { labels } = useAnalyticsTheme()
  const centerRef = useRef<HTMLDivElement>(null)

  const sidebarTone =
    backendStatus?.tone === 'checking'
      ? 'checking'
      : backendStatus?.tone === 'offline'
      ? 'offline'
      : backendStatus?.tone === 'degraded'
        ? 'degraded'
        : 'ready'

  // The route owns its four-question navigation; do not relabel it as extra products.
  const resolvedSections = sidebarSections

  return (
    <div className="figma-analytics">
      <AnalyticsTopNav
        items={NAV_ITEMS}
        status={
          backendStatus
            ? {
                label: backendStatus.label,
                value: backendStatus.value,
                tone: backendStatus.tone ?? 'muted',
              }
            : undefined
        }
      />
      <div
        className={`figma-analytics__frame${hideSidebar ? ' figma-analytics__frame--no-sidebar' : ''}${
          rightRail ? ' figma-analytics__frame--with-right-rail' : ''
        }`}
      >
        {hideSidebar ? null : (
          <aside className="figma-analytics__sidebar" aria-label="Hub section navigation">
            <AnalyticsHubSidebar
              sections={resolvedSections}
              statusLabel={sidebarStatusLabel ?? labels.apiStatus}
              statusTone={sidebarTone}
            />
          </aside>
        )}

        <div ref={centerRef} className="figma-analytics__center figma-analytics__center--themed">
          {children}
        </div>

        {rightRail ? (
          <aside className="figma-analytics__right-rail" aria-label="Live Wire discovery">
            {rightRail}
          </aside>
        ) : null}
      </div>
      <footer className="figma-analytics__site-footer" aria-label="Site information">
        <span>StreamPulse Analytics Hub</span>
        <nav aria-label="Site links"><Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link><Link to="/support">Support</Link></nav>
      </footer>
    </div>
  )
}

export function AnalyticsFigmaShell(props: AnalyticsFigmaShellProps) {
  return (
    <AnalyticsThemeProvider>
      <AnalyticsFigmaShellInner {...props} />
    </AnalyticsThemeProvider>
  )
}
