import type { ReactNode } from 'react'
import { AnalyticsHubSidebar } from './AnalyticsHubSidebar'
import { AnalyticsTopNav } from './AnalyticsTopNav'

const NAV_ITEMS = [
  { label: 'Analytics', to: '/analytics', end: true },
]

export interface AnalyticsFigmaShellProps {
  backendStatus?: { label: string; value: string; tone?: 'ready' | 'degraded' | 'offline' | 'checking' }
  sidebarStatusLabel?: string
  sidebarSections?: Array<{ id: string; label: string; hidden?: boolean }>
  children: ReactNode
}

export function AnalyticsFigmaShell({
  backendStatus,
  sidebarStatusLabel,
  sidebarSections,
  children,
}: AnalyticsFigmaShellProps) {
  const sidebarTone =
    backendStatus?.tone === 'offline'
      ? 'offline'
      : backendStatus?.tone === 'degraded'
        ? 'degraded'
        : 'ready'

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
      <div className="figma-analytics__frame">
        <aside className="figma-analytics__sidebar" aria-label="Hub section navigation">
          <AnalyticsHubSidebar
            sections={sidebarSections}
            statusLabel={sidebarStatusLabel ?? backendStatus?.value ?? 'Hosted API'}
            statusTone={sidebarTone}
          />
        </aside>
        <div className="figma-analytics__center">
          {children}
        </div>
      </div>
    </div>
  )
}
