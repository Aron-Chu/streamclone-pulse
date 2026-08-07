/** Twitch system routes that must never be treated as channel logins. */
export const TWITCH_SYSTEM_ROUTES = new Set([
  'directory',
  'following',
  'search',
  'browse',
  'downloads',
  'turbo',
  'wallet',
  'jobs',
  'store',
  'login',
  'signup',
  'settings',
  'subscriptions',
  'inventory',
  'p',
  'u',
  'popout',
  'team',
  'friends',
  'bits',
  'prime',
  'clips',
  'drops',
  'moderator',
  'dashboard',
  'products',
  'privacy',
  'legal',
  'help',
])

export type TwitchPageKind = 'channel' | 'vod' | 'non-channel'

export interface TwitchPageContext {
  kind: TwitchPageKind
  login: string | null
  vodId: string | null
}

export function parseChannelLogin(pathname: string): string | null {
  return parseTwitchPage(pathname).login
}

export function isTwitchChannelPage(pathname: string): boolean {
  return parseTwitchPage(pathname).kind !== 'non-channel'
}

/** True on `/videos/{id}` or `/{login}/videos/{id}` watch pages. */
export function isTwitchVodPath(pathname: string): boolean {
  return parseTwitchPage(pathname).kind === 'vod'
}

export function parseTwitchPage(pathname: string): TwitchPageContext {
  const parts = pathname.split('/').filter(Boolean)
  if (!parts.length) return { kind: 'non-channel', login: null, vodId: null }

  const head = parts[0].toLowerCase()
  if (head === 'videos') {
    const vodId = normalizeVodPathPart(parts[1])
    return vodId
      ? { kind: 'vod', login: null, vodId }
      : { kind: 'non-channel', login: null, vodId: null }
  }

  if (TWITCH_SYSTEM_ROUTES.has(head)) {
    return { kind: 'non-channel', login: null, vodId: null }
  }

  const login = normalizeLogin(head)
  if (!login) {
    return { kind: 'non-channel', login: null, vodId: null }
  }

  if (parts[1]?.toLowerCase() === 'videos') {
    const vodId = normalizeVodPathPart(parts[2])
    return vodId
      ? { kind: 'vod', login, vodId }
      : { kind: 'channel', login, vodId: null }
  }

  return { kind: 'channel', login, vodId: null }
}

export type LiveSeekResult =
  | { ok: true; targetSeconds: number }
  | { ok: false; reason: 'no_video' | 'not_seekable' | 'outside_buffer' }

export type LiveMediaWindow =
  | {
      ok: true
      liveEdge: number
      ranges: Array<{ start: number; end: number }>
      bufferedEnd: number | null
    }
  | {
      ok: false
      reason: 'no_seekable_ranges' | 'sentinel_range' | 'volatile_ranges'
      ranges: Array<{ start: number; end: number }>
      bufferedEnd: number | null
    }

const MAX_LIVE_EDGE_DRIFT_SECONDS = 5 * 60

function readTimeRanges(value: TimeRanges | null | undefined): Array<{ start: number; end: number }> {
  if (!value) return []
  try {
    const ranges: Array<{ start: number; end: number }> = []
    for (let index = 0; index < value.length; index += 1) {
      const start = value.start(index)
      const end = value.end(index)
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return []
      ranges.push({ start, end })
    }
    return ranges
  } catch {
    // Twitch can replace the MediaSource while a range is being read.
    return []
  }
}

/**
 * Twitch's live MediaSource can expose a huge sentinel seekable range even
 * though only the current live segment is available. Treat range plausibility
 * as a media-clock question, not as a broadcast-duration/horizon question.
 */
export function classifyLiveMediaWindow(video: HTMLVideoElement | null): LiveMediaWindow {
  if (!video) {
    return { ok: false, reason: 'no_seekable_ranges', ranges: [], bufferedEnd: null }
  }
  const ranges = readTimeRanges(video.seekable)
  const bufferedRanges = readTimeRanges(video.buffered)
  const bufferedEnd = bufferedRanges.length ? bufferedRanges[bufferedRanges.length - 1]!.end : null
  if (!ranges.length) {
    return { ok: false, reason: 'no_seekable_ranges', ranges, bufferedEnd }
  }
  const liveEdge = ranges[ranges.length - 1]!.end
  const currentTime = Number.isFinite(video.currentTime) ? Math.max(0, video.currentTime) : null
  const mediaClock = Math.max(currentTime ?? 0, bufferedEnd ?? 0)
  // A real live edge is close to the media clock. The 2^30-style endpoint in
  // the captured Twitch failure is a sentinel and must never receive a seek.
  if (video.duration === Infinity && liveEdge - mediaClock > MAX_LIVE_EDGE_DRIFT_SECONDS) {
    return { ok: false, reason: 'sentinel_range', ranges, bufferedEnd }
  }
  return { ok: true, liveEdge, ranges, bufferedEnd }
}

export function getPrimaryVideo(): HTMLVideoElement | null {
  const videos = Array.from(document.querySelectorAll('video')) as HTMLVideoElement[]
  if (videos.length === 0) return null
  if (videos.length === 1) return videos[0]!

  let best: HTMLVideoElement | null = null
  let bestScore = -1
  for (const video of videos) {
    const rect = video.getBoundingClientRect()
    const area = Math.max(0, rect.width) * Math.max(0, rect.height)
    const playingBoost = video.paused ? 0 : 50_000
    const liveBoost = video.duration === Infinity ? 25_000 : 0
    const score = area + playingBoost + liveBoost
    if (score > bestScore) {
      bestScore = score
      best = video
    }
  }
  return best
}

function commitVideoSeek(video: HTMLVideoElement, targetSeconds: number): boolean {
  try {
    // Prefer the media element's native keyframe-aware seek when the browser
    // exposes it. Twitch's MSE controller can reject a raw currentTime write
    // during manifest/quality transitions even though the range is seekable.
    if (typeof video.fastSeek === 'function') {
      video.fastSeek(targetSeconds)
    } else {
      video.currentTime = targetSeconds
    }
    return true
  } catch {
    return false
  }
}

export function seekVodOffset(
  video: HTMLVideoElement | null,
  offsetSeconds: number,
  options: { commit?: boolean } = {},
): LiveSeekResult {
  if (!video) return { ok: false, reason: 'no_video' }
  if (!Number.isFinite(offsetSeconds)) return { ok: false, reason: 'outside_buffer' }
  const target = Math.max(0, offsetSeconds)
  if (!Number.isFinite(video.duration) || video.duration <= 0) {
    if (options.commit !== false && !commitVideoSeek(video, target)) {
      return { ok: false, reason: 'not_seekable' }
    }
    return { ok: true, targetSeconds: target }
  }
  if (target > video.duration + 1) {
    return { ok: false, reason: 'outside_buffer' }
  }
  if (options.commit !== false && !commitVideoSeek(video, target)) {
    return { ok: false, reason: 'not_seekable' }
  }
  return { ok: true, targetSeconds: target }
}

export function seekPlaybackOffset(
  video: HTMLVideoElement | null,
  offsetSeconds: number,
  options?: { isLive?: boolean; liveCurrentOffset?: number; commit?: boolean },
): LiveSeekResult {
  if (options?.isLive && Number.isFinite(options.liveCurrentOffset)) {
    return seekLiveOffset(video, offsetSeconds, options.liveCurrentOffset as number, options)
  }
  return seekVodOffset(video, offsetSeconds, options)
}

export function seekableLiveEdge(ranges: TimeRanges): number | null {
  if (!ranges || ranges.length === 0) return null
  try {
    const end = ranges.end(ranges.length - 1)
    return Number.isFinite(end) ? end : null
  } catch {
    // Twitch can replace a MediaSource between length and end(). Treat the
    // transient race as unavailable instead of throwing from a click handler.
    return null
  }
}

export function seekLiveOffset(
  video: HTMLVideoElement | null,
  offsetSeconds: number,
  currentOffsetSeconds: number,
  options: { commit?: boolean } = {},
): LiveSeekResult {
  if (!video) return { ok: false, reason: 'no_video' }
  if (!Number.isFinite(offsetSeconds) || !Number.isFinite(currentOffsetSeconds)) {
    return { ok: false, reason: 'outside_buffer' }
  }
  if (offsetSeconds > currentOffsetSeconds) {
    return { ok: false, reason: 'outside_buffer' }
  }
  const mediaWindow = classifyLiveMediaWindow(video)
  if (!mediaWindow.ok) return { ok: false, reason: 'not_seekable' }
  // Do not impose a wall-clock horizon here. Twitch can expose more than two
  // hours of DVR for long broadcasts, and the seekable ranges are the only
  // authoritative boundary. A target is accepted below only when its actual
  // media timestamp is inside one of those ranges.
  const behindLiveSeconds = Math.max(0, currentOffsetSeconds - offsetSeconds)
  // `currentTime` may represent a delayed viewer, while the payload offset is
  // measured from stream start. Anchor the calculation to Twitch's actual DVR
  // live edge so a successful click cannot leave the player at the live point.
  const target = Math.max(0, mediaWindow.liveEdge - behindLiveSeconds)
  if (!isSeekableSnapshot(mediaWindow.ranges, target)) {
    return { ok: false, reason: 'outside_buffer' }
  }
  if (options.commit !== false && !commitVideoSeek(video, target)) {
    return { ok: false, reason: 'not_seekable' }
  }
  return { ok: true, targetSeconds: target }
}

export function isSeekable(ranges: TimeRanges, targetSeconds: number): boolean {
  if (!Number.isFinite(targetSeconds)) return false
  try {
    for (let i = 0; i < ranges.length; i += 1) {
      if (targetSeconds >= ranges.start(i) && targetSeconds <= ranges.end(i)) {
        return true
      }
    }
  } catch {
    return false
  }
  return false
}

function isSeekableSnapshot(ranges: Array<{ start: number; end: number }>, targetSeconds: number): boolean {
  if (!Number.isFinite(targetSeconds)) return false
  return ranges.some(range => targetSeconds >= range.start && targetSeconds <= range.end)
}

/**
 * Prefer the wall-clock offset derived from the validated stream start. The
 * payload offset is retained when it agrees within two minutes, which absorbs
 * normal API/player clock skew without allowing a stale offset to mis-seek.
 */
export function streamOffsetSecondsForLiveSeek(input: {
  startedAt?: string | null
  payloadOffsetSeconds?: number | null
  nowMs?: number
}): number | null {
  const payload =
    Number.isFinite(input.payloadOffsetSeconds) && (input.payloadOffsetSeconds as number) >= 0
      ? (input.payloadOffsetSeconds as number)
      : null
  const startedAt = input.startedAt?.trim()
  if (startedAt) {
    const startMs = Date.parse(startedAt)
    if (Number.isFinite(startMs)) {
      const derived = Math.max(0, ((input.nowMs ?? Date.now()) - startMs) / 1000)
      if (payload != null && Math.abs(derived - payload) <= 120) return payload
      return derived
    }
  }
  return payload
}

function normalizeLogin(value: string): string | null {
  const login = value.trim().toLowerCase()
  return /^[a-z0-9_]{3,25}$/.test(login) ? login : null
}

function normalizeVodPathPart(value: string | undefined): string | null {
  if (!value) return null
  return /^\d{5,20}$/.test(value) ? value : null
}

/** True when the Twitch channel page is showing a live broadcast (not offline/VOD). */
export function detectTwitchChannelLive(context: TwitchPageContext): boolean {
  if (context.kind !== 'channel' || context.vodId) return false
  if (typeof document === 'undefined') return false

  if (document.querySelector('[data-a-target="channel-offline-still-image"]')) return false
  if (document.querySelector('[data-a-target="channel-offline-header"]')) return false

  const video = getPrimaryVideo()
  // Live HLS often reports duration as Infinity. Number.isFinite(Infinity) is false,
  // so do not gate this branch on isFinite. Prefer the ranked primary video so an
  // inserted finite ad-preview <video> cannot flip live → offline.
  if (video && video.duration === Infinity) {
    return true
  }

  const streamCard = document.querySelector('[data-a-target="stream-info-card-component"]')
  if (streamCard && /\bLIVE\b/i.test(streamCard.textContent ?? '')) {
    return true
  }

  return false
}
