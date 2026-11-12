import type { ReactNode } from 'react'

import { useRef } from 'react'
import { Link } from 'react-router-dom'

import { useAnalyticsTheme } from '../../providers/AnalyticsThemeProvider'

import { AnalyticsThemeProvider } from '../../providers/AnalyticsThemeProvider'


import { AnalyticsHubSidebar } from './AnalyticsHubSidebar'

import { AnalyticsTopNav } from './AnalyticsTopNav'

import { PageErrorBoundary } from '../../PortalErrorBoundary'
import { discordInviteUrl } from '../../../lib/discord'
import { FEEDBACK_PATH } from '../../../lib/externalLinks'

const NAV_ITEMS = [
  { label: 'Home', to: '/', end: true },
  { label: 'Analytics', to: '/analytics', end: true },
  // "All moments" rather than "Moments": the session page's right rail already
  // has a Moments tab scoped to one stream, and two links named the same thing
  // at different scopes read as the same destination.
  { label: 'All moments', to: '/analytics/moments' },
]

export interface AnalyticsFigmaShellProps {
  /** Hide hub section nav (session console routes use in-page chrome instead). */
  hideSidebar?: boolean
  /** The page's own search and install button in the top bar (the hub's; see AnalyticsTopNav). */
  topNavDock?: ReactNode
  topNavInstall?: ReactNode
  children: ReactNode
}

function AnalyticsFigmaShellInner({
  hideSidebar = false,
  topNavDock,
  topNavInstall,
  children,
}: AnalyticsFigmaShellProps) {
  const { labels } = useAnalyticsTheme()
  const centerRef = useRef<HTMLDivElement>(null)
  const discord = discordInviteUrl()

  return (
    <div className="figma-analytics">
      <AnalyticsTopNav items={NAV_ITEMS} dock={topNavDock} install={topNavInstall} />
      <div className={`figma-analytics__frame${hideSidebar ? ' figma-analytics__frame--no-sidebar' : ''}`}>
        {hideSidebar ? null : (
          <aside className="figma-analytics__sidebar" aria-label="Hub section navigation">
            <AnalyticsHubSidebar statusLabel={labels.apiStatus} statusTone="ready" />
          </aside>
        )}

        <div ref={centerRef} className="figma-analytics__center figma-analytics__center--themed">
          <PageErrorBoundary shell={(panel) => <main id="analytics-main" className="figma-analytics__main" tabIndex={-1}>{panel}</main>}>
            {children}
          </PageErrorBoundary>
        </div>
      </div>
      <footer className="figma-analytics__site-footer" aria-label="Site information">
        <span>StreamPulse Analytics Hub</span>
        <nav aria-label="Site links"><Link to={FEEDBACK_PATH}>Send feedback</Link>{discord ? <a href={discord} target="_blank" rel="noopener noreferrer" aria-label="Discord (opens in a new tab)">Discord</a> : null}<Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link><Link to="/support">Support</Link></nav>
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
