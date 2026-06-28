import type { AnalyticsApi } from '@streamclone/analytics-console'
import { apiClient } from './apiClient'
import {
  PORTAL_ANALYTICS_PREFIX,
  portalChannelLivePath,
  portalChannelStreamsPath,
  portalStreamDetailPath,
  portalStreamGamesPath,
  portalStreamMinutesPath,
  portalStreamRecapPath,
  portalStreamReplayHeatmapPath,
  portalStreamSyncStatusPath,
} from './portalAnalytics'

const FORBIDDEN_CHART_PREFIX = '/v1/analytics/streams'

function assertPortalChartPath(path: string): void {
  if (path.includes(FORBIDDEN_CHART_PREFIX)) {
    throw new Error(`portal adapter rejected raw chart path: ${path}`)
  }
}

async function portalGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  assertPortalChartPath(path)
  const result = await apiClient<T>(path, { gated: true, signal })
  return result.data
}

async function portalPost<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  assertPortalChartPath(path)
  const result = await apiClient<T>(path, {
    gated: true,
    method: 'POST',
    body: body ?? null,
  })
  return result.data
}

function portalMinuteRollups(
  minutes: Array<Record<string, unknown>> | undefined,
  startedAt?: string,
): Array<Record<string, unknown>> {
  const base = startedAt ? Date.parse(startedAt) : NaN
  return (minutes ?? []).map((point, index) => {
    const offset = typeof point.offsetSeconds === 'number' ? point.offsetSeconds : index * 60
    const minuteTs = Number.isFinite(base)
      ? new Date(base + offset * 1000).toISOString()
      : new Date().toISOString()
    return {
      minuteTs,
      viewerAvg: point.viewerAvg ?? 0,
      viewerMax: point.viewerMax ?? 0,
      viewerLatest: point.viewerLatest ?? 0,
      viewerSamples: point.viewerSamples ?? 0,
      chatCount: point.chatCount ?? 0,
      totalEmoteCount: point.totalEmoteCount ?? point.seventvEmoteCount ?? 0,
      seventvEmoteCount: point.seventvEmoteCount ?? 0,
      emotes: point.emotes ?? {},
      missing: point.missing ?? false,
    }
  })
}

async function loadPortalStreamDetail(streamId: string, channel?: string) {
  const detail = await portalGet<Record<string, unknown>>(portalStreamDetailPath(streamId))
  const minutes = await portalGet<{ minutes?: Array<Record<string, unknown>>; startedAt?: string }>(
    portalStreamMinutesPath(streamId),
  )
  const startedAt =
    typeof minutes.startedAt === 'string'
      ? minutes.startedAt
      : typeof (detail.stream as Record<string, unknown> | undefined)?.startedAt === 'string'
        ? String((detail.stream as Record<string, unknown>).startedAt)
        : undefined
  return {
    ...detail,
    channel: String(detail.channel ?? channel ?? ''),
    rollups: portalMinuteRollups(minutes.minutes, startedAt),
    topEmotes: Array.isArray(detail.topEmotes) ? detail.topEmotes : [],
  }
}

export function createPortalAnalyticsApi(): AnalyticsApi {
  return {
    async ensureChannelEmotes(login, twitchId, providers) {
      return portalPost(`/v1/channels/${encodeURIComponent(login)}/emotes/ensure`, {
        twitch_id: twitchId,
        providers,
      })
    },

    async getAnalyticsStream(streamId, opts) {
      if (!streamId) return null
      try {
        return await loadPortalStreamDetail(streamId, opts?.channel)
      } catch {
        return null
      }
    },

    async getAnalyticsStreams(login, limit = 20) {
      const path = `${portalChannelStreamsPath(login)}?limit=${encodeURIComponent(String(limit))}`
      return portalGet(path)
    },

    async getAnalyticsLive(login) {
      return portalGet(portalChannelLivePath(login))
    },

    async getPulseBookmarks(params = {}) {
      const qs = new URLSearchParams()
      for (const [key, value] of Object.entries(params)) {
        if (value != null && value !== '') qs.set(key, String(value))
      }
      const suffix = qs.toString() ? `?${qs.toString()}` : ''
      return portalGet(`/v1/pulse/bookmarks${suffix}`)
    },

    async getPulseStreamRecap(streamId) {
      try {
        return await portalGet(portalStreamRecapPath(streamId))
      } catch {
        return null
      }
    },

    async getTimeseriesStatus() {
      return { enabled: false, source: 'portal' }
    },

    async createPulseBookmark(input) {
      return portalPost('/v1/pulse/bookmarks', input)
    },

    async deletePulseBookmark(id) {
      await apiClient(`/v1/pulse/bookmarks/${encodeURIComponent(id)}`, {
        gated: true,
        method: 'DELETE',
      })
    },

    async prefetchAnalyticsTracker(_streamId, _channel) {
      return { status: 'skipped' }
    },

    async getChannel(login) {
      return portalGet(`/v1/channels/${encodeURIComponent(login)}`)
    },

    async getChannelStreamHistory(login, period = '30d') {
      return portalGet(
        `/v1/channels/${encodeURIComponent(login)}/streams/history?period=${encodeURIComponent(period)}`,
      )
    },

    async watchAnalyticsChannel(login) {
      return portalPost(`/v1/analytics/channels/${encodeURIComponent(login)}/watch`)
    },

    async getSyncStatus(streamId) {
      try {
        return await portalGet(portalStreamSyncStatusPath(streamId))
      } catch {
        return null
      }
    },

    async startHistoricalSync(streamId, login = '', options = {}) {
      const params = new URLSearchParams()
      if (login) params.set('channel', login)
      if (options.viewersOnly) params.set('viewers_only', 'true')
      if (options.forceChat) params.set('force_chat', 'true')
      if (options.vodId) params.set('vod_id', options.vodId)
      const suffix = params.toString() ? `?${params.toString()}` : ''
      const result = await apiClient(`/v1/analytics/streams/${encodeURIComponent(streamId)}/sync${suffix}`, {
        gated: true,
        method: 'POST',
      })
      return result.data
    },

    async getStreamGameSegments(streamId) {
      return portalGet(portalStreamGamesPath(streamId))
    },

    async getReplayHeatmap(streamId, window = 60, channel) {
      try {
        const params = new URLSearchParams({ window: String(window) })
        if (channel) params.set('channel', channel)
        return await portalGet(`${portalStreamReplayHeatmapPath(streamId)}?${params.toString()}`)
      } catch {
        return null
      }
    },

    async getReplayHeatmapDetail(streamId, window = 60, channel) {
      try {
        const params = new URLSearchParams({ window: String(window), detail: 'true' })
        if (channel) params.set('channel', channel)
        return await portalGet(`${portalStreamReplayHeatmapPath(streamId)}?${params.toString()}`)
      } catch {
        return null
      }
    },

    async getVodStoryboardThumb() {
      return null
    },

    async getSetupWelcome() {
      return {
        profile: 'portal',
        services: {},
        incomplete: false,
        showWelcome: false,
      }
    },
  }
}

/** @internal test helper */
export function __portalAdapterUsesOnlyPortalChartPaths(): string[] {
  return [
    portalStreamDetailPath('x'),
    portalStreamMinutesPath('x'),
    portalChannelLivePath('x'),
    portalChannelStreamsPath('x'),
  ].filter((path) => !path.includes(FORBIDDEN_CHART_PREFIX))
}
