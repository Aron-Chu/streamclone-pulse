import { measurementTimeMs } from '@streampulse/pulse-core'
import { apiClient, getBackendUrl } from './apiClient'
import { resolveBackendSource } from './backendSource'
import { atMinute, offsetOriginMs } from './momentMinuteWindow'
import { SERIES_AFTER, SERIES_BEFORE, type MinuteSeries } from './momentsChecked'
import { PORTAL_MINUTES_TIMEOUT_MS } from './timelineDownsample'

/**
 * The opened moment's minutes for the checked Moments page's chart and held
 * minute: chat, emotes, viewers and the top three emotes for 32 minutes before
 * to 16 after, from one bounded /minutes read. Only the opened moment reads
 * it; rows draw the feed's sparkline.
 */
interface SeriesMoment { login: string; streamId: string; offsetSeconds: number; minuteStart: number }
interface MinuteRow {
  offsetSeconds?: unknown; chatCount?: unknown; totalEmoteCount?: unknown; viewerAvg?: unknown; missing?: unknown
  topEmotes?: Array<{ name?: unknown; imageUrl?: unknown; count?: unknown }>
}
interface MinutesPayload { streamId?: unknown; channel?: unknown; startedAt?: unknown; minutes?: unknown }

const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null)

/** `afterOffset` for the bounded tail read: whole minutes, one spare minute before the window. */
export function seriesAfterOffset(offsetSeconds: number): number {
  return Math.max(0, Math.floor((offsetSeconds - (SERIES_BEFORE + 1) * 60) / 60) * 60)
}

/**
 * Shape `/streams/{id}/minutes` rows into the series. A minute the API flags
 * missing, or never sends, stays empty rather than zero; a row without a chat
 * count is "no chat recorded" (the API omits a zero, and a viewer-only rollup
 * looks the same), and its emotes count only when chat was recorded.
 * Null when the payload is another broadcast's or holds no chat in the window.
 */
export function minuteSeriesFromMinutes(moment: SeriesMoment, payload: unknown, nowMs = Date.now()): MinuteSeries | null {
  if (!payload || typeof payload !== 'object') return null
  const data = payload as MinutesPayload
  if (data.streamId != null && data.streamId !== moment.streamId) return null
  if (data.channel != null && data.channel !== '' && (typeof data.channel !== 'string' || data.channel.toLowerCase() !== moment.login)) return null
  const startMs = measurementTimeMs(data.startedAt, nowMs)
  if (startMs == null || !Array.isArray(data.minutes)) return null
  const origin = offsetOriginMs(data.startedAt, startMs)
  const momentMinute = atMinute(moment.minuteStart) ?? Math.floor((origin + moment.offsetSeconds * 1000) / 60_000)
  const n = SERIES_BEFORE + SERIES_AFTER + 1
  const c = Array<number | null>(n).fill(null), e = Array<number | null>(n).fill(null), v = Array<number | null>(n).fill(null)
  const t3 = Array<MinuteSeries['t3'][number]>(n).fill(null)
  let measured = 0
  for (const row of data.minutes.slice(0, 240) as MinuteRow[]) {
    if (!row || typeof row !== 'object' || row.missing === true) continue
    const offset = row.offsetSeconds
    if (typeof offset !== 'number' || !Number.isFinite(offset) || offset < 0) continue
    const i = Math.floor((origin + offset * 1000) / 60_000) - momentMinute + SERIES_BEFORE
    if (i < 0 || i >= n) continue
    const chat = count(row.chatCount)
    c[i] = chat
    e[i] = chat == null ? null : count(row.totalEmoteCount) ?? 0
    v[i] = count(row.viewerAvg)
    // /minutes sends a minute's emotes in no order: the top three by count.
    const named = Array.isArray(row.topEmotes) ? row.topEmotes.flatMap(t => (t && typeof t.name === 'string' && count(t.count) != null
      ? [{ name: t.name, imageUrl: typeof t.imageUrl === 'string' ? t.imageUrl : undefined, count: count(t.count)! }] : [])) : []
    t3[i] = named.sort((a, b) => b.count - a.count).slice(0, 3)
    if (chat != null) measured += 1
  }
  return measured ? { c, e, v, t3, fromSpark: false } : null
}

/**
 * One read for the opened moment. The local analytics stack has no portal
 * minutes route, so there the chart draws the feed's sparkline instead.
 */
export async function loadMomentMinuteSeries(moment: SeriesMoment, signal: AbortSignal): Promise<MinuteSeries | null> {
  if (resolveBackendSource(getBackendUrl()) === 'local') return null
  const { data } = await apiClient<unknown>(
    `/v1/portal/analytics/streams/${encodeURIComponent(moment.streamId)}/minutes?afterOffset=${seriesAfterOffset(moment.offsetSeconds)}`,
    { signal, timeoutMs: PORTAL_MINUTES_TIMEOUT_MS, maxResponseBytes: 1024 * 1024 })
  return minuteSeriesFromMinutes(moment, data)
}
