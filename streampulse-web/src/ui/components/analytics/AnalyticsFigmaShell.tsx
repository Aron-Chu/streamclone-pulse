import type { ReactNode } from 'react'

import { useRef } from 'react'

import { useAnalyticsTheme } from '../../providers/AnalyticsThemeProvider'

import { AnalyticsThemeProvider } from '../../providers/AnalyticsThemeProvider'

import { sidebarLabelFor } from '../../themes/commandCenterLabels'

import { AnalyticsHubSidebar } from './AnalyticsHubSidebar'

import { AnalyticsTopNav } from './AnalyticsTopNav'

const NAV_ITEMS = [
  { label: 'Home', to: '/', end: true },
  { label: 'Analytics', to: '/analytics', end: true },
]

export interface AnalyticsFigmaShellProps {
  backendStatus?: { label: string; value: string; tone?: 'ready' | 'degraded' | 'offline' | 'checking' }
  sidebarStatusLabel?: string
  sidebarSections?: Array<{ id: string; label: string; hidden?: boolean }>
  /** Hide hub section nav (session console routes use in-page chrome instead). */
  hideSidebar?: boolean
  children: ReactNode
}

function AnalyticsFigmaShellInner({
  backendStatus,
  sidebarStatusLabel,
  sidebarSections,
  hideSidebar = false,
  children,
}: AnalyticsFigmaShellProps) {
  const { labels } = useAnalyticsTheme()
  const centerRef = useRef<HTMLDivElement>(null)

  const sidebarTone =
    backendStatus?.tone === 'offline'
      ? 'offline'
      : backendStatus?.tone === 'degraded'
        ? 'degraded'
        : 'ready'

  const resolvedSections = sidebarSections?.map((section) => ({
    ...section,
    label: sidebarLabelFor(section.id, labels, section.label),
  }))

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
        className={`figma-analytics__frame${hideSidebar ? ' figma-analytics__frame--no-sidebar' : ''}`}
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
      </div>
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
