import type { CheckedMomentSource, DiscoveryMoment } from './discoveryMoments'

/** Navigation only. The watch service must independently verify clipping rights.
 * Never derive a VOD from the creator's latest broadcast or persisted metadata.
 */
export function watchMomentHref(
  moment: Pick<DiscoveryMoment, 'login' | 'streamId'>,
  source: CheckedMomentSource | null,
  configuredOrigin: string | undefined = import.meta.env.VITE_STREAMCLONE_WATCH_ORIGIN,
  pageOrigin: string = typeof window === 'undefined' ? '' : window.location.origin,
): string | null {
  if (!configuredOrigin || !source?.vodHref || !Number.isFinite(source.vodOffsetSeconds) || source.vodOffsetSeconds! < 0 ||
    !/^[a-z0-9_]{1,25}$/.test(moment.login) || !/^\d{1,30}$/.test(moment.streamId)) return null
  try {
    const target = new URL(configuredOrigin)
    const page = new URL(pageOrigin)
    const replay = new URL(source.vodHref)
    const loopback = (host: string) => ['localhost', '127.0.0.1', '[::1]'].includes(host)
    if (target.username || target.password || target.pathname !== '/' || target.search || target.hash) return null
    // A public portal must never navigate to a visitor's loopback service,
    // even if an operator accidentally includes a local origin in its build.
    if (loopback(target.hostname) && (!loopback(page.hostname) || target.port !== '8090')) return null
    if (target.protocol !== 'https:' && !(target.protocol === 'http:' && loopback(target.hostname) && loopback(page.hostname))) return null
    const video = /^\/videos\/(\d{5,20})$/.exec(replay.pathname)?.[1]
    const seconds = Math.floor(source.vodOffsetSeconds!)
    if (replay.origin !== 'https://www.twitch.tv' || replay.username || replay.password || replay.hash || !video ||
      replay.searchParams.size !== 1 || replay.searchParams.get('t') !== `${seconds}s` || !Number.isSafeInteger(seconds)) return null
    const query = new URLSearchParams({ vod: video, offset: String(seconds), sid: moment.streamId, from: 'analytics' })
    return `${target.origin}/c/${moment.login}?${query}`
  } catch { return null }
}
