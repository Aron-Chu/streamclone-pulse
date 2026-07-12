import type { ReactNode } from 'react'
import { usePublicStatusProbe } from '../../../hooks/usePublicStatusProbe'
import { getBackendUrl } from '../../../lib/apiClient'
import { resolveBackendSource, backendSourceLabel } from '../../../lib/backendSource'
import { AnalyticsFigmaShell } from './AnalyticsFigmaShell'

/**
 * Owns lightweight API shell tone for channel analytics routes.
 * Uses `/v1/public/status` once on mount — never interval-polls full `/v1/public/hub`
 * (P4-L05 Phase 1). Pass heavy chart UI as `children` so status updates do not
 * rebuild chart inputs (P4-L03).
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
  const probe = usePublicStatusProbe({ enabled: true })
  const backendSource = resolveBackendSource(getBackendUrl())

  return (
    <AnalyticsFigmaShell
      hideSidebar={hideSidebar}
      backendStatus={{
        label: 'API',
        value: backendSourceLabel(backendSource),
        tone: probe.tone,
      }}
    >
      <main
        className={mainClassName ?? 'figma-analytics__main'}
        id="analytics-main"
        aria-label={`Analytics for ${displayChannel}`}
      >
        {children}
      </main>
    </AnalyticsFigmaShell>
  )
}
