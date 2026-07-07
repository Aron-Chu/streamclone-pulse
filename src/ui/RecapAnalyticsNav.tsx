import { useMemo } from 'react'
import type { CSSProperties } from 'react'
import {
  buildAnalyticsUrl,
  buildHubAnalyticsUrl,
  defaultWebAnalyticsBaseUrlForApi,
  openAnalyticsHref,
} from '../shared/analyticsLinks.ts'
import { theme } from './theme.ts'

export interface RecapAnalyticsNavProps {
  backendUrl: string
  channelLogin: string
  streamId?: string
  offsetSeconds?: number | null
}

export function RecapAnalyticsNav({
  backendUrl,
  channelLogin,
  streamId,
  offsetSeconds = null,
}: RecapAnalyticsNavProps) {
  const webAnalyticsBaseUrl = useMemo(
    () => defaultWebAnalyticsBaseUrlForApi(backendUrl),
    [backendUrl],
  )

  const hubHref = useMemo(
    () => buildHubAnalyticsUrl(webAnalyticsBaseUrl),
    [webAnalyticsBaseUrl],
  )

  const streamHref = useMemo(
    () =>
      buildAnalyticsUrl({
        webAnalyticsBaseUrl,
        channelLogin,
        streamId,
        offsetSeconds: offsetSeconds ?? undefined,
      }),
    [webAnalyticsBaseUrl, channelLogin, streamId, offsetSeconds],
  )

  if (!hubHref && !streamHref) return null

  return (
    <div style={styles.wrap}>
      {hubHref ? (
        <div style={styles.hubRow}>
          <button
            type="button"
            style={styles.hubLink}
            onClick={() => openAnalyticsHref(hubHref)}
          >
            Analytics hub →
          </button>
        </div>
      ) : null}
      {streamHref ? (
        <button
          type="button"
          style={styles.streamCta}
          onClick={() => openAnalyticsHref(streamHref)}
        >
          Open stream analytics
        </button>
      ) : null}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: {
    display: 'grid',
    gap: 8,
  },
  hubRow: {
    display: 'flex',
    justifyContent: 'flex-end',
  },
  hubLink: {
    background: 'transparent',
    border: 0,
    color: '#c4b5fd',
    cursor: 'pointer',
    fontSize: 10,
    fontWeight: 800,
    padding: '2px 0',
    whiteSpace: 'nowrap',
  },
  streamCta: {
    background: theme.accent,
    border: 0,
    borderRadius: 10,
    color: theme.onAccent,
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 800,
    padding: '7px 12px',
    width: '100%',
  },
}
