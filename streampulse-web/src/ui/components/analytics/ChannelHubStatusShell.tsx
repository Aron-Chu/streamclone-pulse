import type { ReactNode } from 'react'
import { AnalyticsFigmaShell } from './AnalyticsFigmaShell'

/**
 * Shell for channel analytics routes. It reads nothing itself: service status
 * is the menu's "Service status" link, not a header pill. Pass heavy chart UI
 * as `children`.
 */
export function ChannelHubStatusShell({
  displayChannel,
  mainClassName,
  hideSidebar = false,
  children,
}: {
  displayChannel: string
  mainClassName?: string
  /** Console nested shell hides hub nav; Figma channel dashboard keeps it. */
  hideSidebar?: boolean
  children: ReactNode
}) {
  return (
    <AnalyticsFigmaShell hideSidebar={hideSidebar}>
      <main
        className={mainClassName ?? 'figma-analytics__main'}
        id="analytics-main"
        tabIndex={-1}
        aria-label={`Analytics for ${displayChannel}`}
      >
        {children}
      </main>
    </AnalyticsFigmaShell>
  )
}
