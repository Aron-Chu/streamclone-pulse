import type { ReactNode } from 'react'

import { useRef } from 'react'

import { useAnalyticsTheme } from '../../providers/AnalyticsThemeProvider'

import { AnalyticsThemeProvider } from '../../providers/AnalyticsThemeProvider'


import { AnalyticsHubSidebar } from './AnalyticsHubSidebar'

import { SiteHeader } from '../SiteHeader'

import { PageErrorBoundary } from '../../PortalErrorBoundary'
import { SiteFooter } from '../SiteFooter'

export interface AnalyticsFigmaShellProps {
  /** Hide hub section nav (session console routes use in-page chrome instead). */
  hideSidebar?: boolean
  /** The page's own search and install button in the top bar (the hub's; see SiteHeader). */
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

  return (
    <div className="figma-analytics">
      <SiteHeader mainId="analytics-main" variant="analytics" dock={topNavDock} install={topNavInstall} />
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
      <SiteFooter />
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
