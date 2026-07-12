import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiClient } from '../lib/apiClient'
import {
  fetchPortalSessionViewModel,
  type FigmaSessionStripItem,
  type FigmaSessionViewModel,
  sourceLabelFromDetail,
} from '../lib/figmaSessionAnalytics'
import { buildAnalyticsHref } from '../lib/analyticsLinks'
import { fetchPortalStreamRecap, fetchPortalStreamSummary, type PortalStreamRecapResponse, type PortalStreamSummary } from '../lib/streamcloneAnalytics'
import { normalizeTwitchLogin } from '../lib/normalizeTwitchLogin'

interface ChannelStreamItem {
  streamId: string
  login: string
  displayName?: string
  title?: string
  category?: string
  startedAt: string
  endedAt?: string | null
  currentViewers?: number
  peakViewers?: number
  vodId?: string
}

interface AnalyticsStreamsResponse {
  channel: string
  items: ChannelStreamItem[]
  sources?: Array<{ source: string; state: string; label?: string }>
  dataSourceBadges?: Array<{ source: string; state: string; label?: string }>
  updatedAt: number
}

export interface ChannelPageData {
  login: string
  displayName?: string
  loading: boolean
  error?: string
  streams: FigmaSessionStripItem[]
  selectedStreamId?: string
  session: FigmaSessionViewModel
  summary: PortalStreamSummary | null
  recap: PortalStreamRecapResponse | null
  refresh: () => void
}

function sessionStripLabel(stream: ChannelStreamItem, live: boolean): string {
  const started = stream.startedAt
    ? new Date(stream.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : 'Session'
  return live ? `Live · ${started}` : started
}

function mapStripItem(stream: ChannelStreamItem, login: string, defaultSource: string): FigmaSessionStripItem {
  const live = !stream.endedAt
  return {
    streamId: stream.streamId,
    label: sessionStripLabel(stream, live),
    category: stream.category,
    startedAt: stream.startedAt,
    endedAt: stream.endedAt,
    live,
    sourceLabel: defaultSource,
    href: buildAnalyticsHref({ login, streamId: stream.streamId }),
  }
}

export function portalChannelStreamsPath(login: string, limit = 24): string {
  return `/v1/portal/analytics/channels/${encodeURIComponent(login)}/streams?limit=${Math.max(1, limit)}`
}

export function useChannelPageData(loginParam: string, streamIdParam?: string): ChannelPageData {
  const login = normalizeTwitchLogin(loginParam)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>()
  const [streams, setStreams] = useState<FigmaSessionStripItem[]>([])
  const [selectedStreamId, setSelectedStreamId] = useState<string | undefined>(streamIdParam)
  const [session, setSession] = useState<FigmaSessionViewModel>({
    state: 'loading',
    moments: [],
    chartPoints: [],
    bursts: [],
    coverageTruth: [],
  })
  const [summary, setSummary] = useState<PortalStreamSummary | null>(null)
  const [recap, setRecap] = useState<PortalStreamRecapResponse | null>(null)
  const [displayName, setDisplayName] = useState<string | undefined>()

  const load = useCallback(async () => {
    if (!login) {
      setLoading(false)
      setError('invalid_login')
      setSession({ state: 'empty', reason: 'invalid_login', moments: [], chartPoints: [], bursts: [], coverageTruth: [] })
      return
    }
    setLoading(true)
    setError(undefined)
    try {
      const { data } = await apiClient<AnalyticsStreamsResponse>(
        portalChannelStreamsPath(login),
      )
      const defaultSource = sourceLabelFromDetail(data.sources, data.dataSourceBadges)
      const strip = (data.items ?? []).map((item) => mapStripItem(item, login, defaultSource))
      setStreams(strip)
      setDisplayName(data.items[0]?.displayName ?? login)

      const preferred =
        (streamIdParam && strip.find((s) => s.streamId === streamIdParam)?.streamId) ||
        strip.find((s) => s.live)?.streamId ||
        strip[0]?.streamId

      setSelectedStreamId(preferred)
      if (!preferred) {
        setSession({
          state: 'empty',
          reason: 'no_sessions',
          login,
          moments: [],
          chartPoints: [],
          bursts: [],
          coverageTruth: [],
        })
        setSummary(null)
        setRecap(null)
        return
      }

      const [sessionModel, summaryRes, recapRes] = await Promise.all([
        fetchPortalSessionViewModel(preferred, login),
        fetchPortalStreamSummary(preferred),
        fetchPortalStreamRecap(preferred),
      ])
      setSession(sessionModel)
      setSummary(summaryRes)
      setRecap(recapRes)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'load_failed')
      setSession({
        state: 'empty',
        reason: 'load_failed',
        login,
        moments: [],
        chartPoints: [],
        bursts: [],
        coverageTruth: [],
      })
    } finally {
      setLoading(false)
    }
  }, [login, streamIdParam])

  useEffect(() => {
    void load()
  }, [load])

  return useMemo(
    () => ({
      login,
      displayName,
      loading,
      error,
      streams,
      selectedStreamId,
      session,
      summary,
      recap,
      refresh: load,
    }),
    [displayName, error, load, loading, login, recap, selectedStreamId, session, streams, summary],
  )
}
