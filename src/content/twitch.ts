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
  | { ok: false; reason: 'no_video' | 'not_seekable' | 'outside_buffer' | 'seek_rejected' }

/**
 * Twitch can mount several video elements at once (the real player plus
 * previews/ad surfaces). Prefer the ready, visible player instead of relying
 * on DOM order, which changes as Twitch transitions between routes.
 */
export function resolvePrimaryVideo(videos: readonly HTMLVideoElement[]): HTMLVideoElement | null {
  if (videos.length === 0) return null

  const score = (video: HTMLVideoElement, index: number): number => {
    let value = 0
    const label = video.getAttribute?.('aria-label')?.toLowerCase() ?? ''
    if (label.includes('twitch video player')) value += 100

    const closest = video.closest?.('[data-a-target="video-player"], [data-test-selector="video-player__video-layout"]')
    if (closest) value += 60

    let rect: DOMRect | null = null
    try {
      rect = video.getBoundingClientRect()
    } catch {
      rect = null
    }
    if (rect && rect.width > 0 && rect.height > 0) value += 30
    if (video.readyState >= 2) value += 25
    if (video.seekable?.length) value += 15
    if (video.buffered?.length) value += 10
    if (Number.isFinite(video.currentTime) && video.currentTime > 0) value += 5

    // Keep DOM order only as a deterministic final tie-breaker.
    return value - index / 1000
  }

  return videos
    .map((video, index) => ({ video, score: score(video, index) }))
    .sort((a, b) => b.score - a.score)[0]?.video ?? null
}

export function getPrimaryVideo(): HTMLVideoElement | null {
  if (typeof document === 'undefined') return null
  return resolvePrimaryVideo(Array.from(document.querySelectorAll('video')))
}

export function seekVodOffset(video: HTMLVideoElement | null, offsetSeconds: number): LiveSeekResult {
  if (!video) return { ok: false, reason: 'no_video' }
  if (!Number.isFinite(offsetSeconds)) return { ok: false, reason: 'outside_buffer' }
  const target = Math.max(0, offsetSeconds)
  if (!Number.isFinite(video.duration) || video.duration <= 0) {
    video.currentTime = target
    return { ok: true, targetSeconds: target }
  }
  if (target > video.duration + 1) {
    return { ok: false, reason: 'outside_buffer' }
  }
  video.currentTime = target
  return { ok: true, targetSeconds: target }
}

export function seekPlaybackOffset(
  video: HTMLVideoElement | null,
  offsetSeconds: number,
  options?: { isLive?: boolean; liveCurrentOffset?: number },
): LiveSeekResult {
  if (options?.isLive && Number.isFinite(options.liveCurrentOffset)) {
    return seekLiveOffset(video, offsetSeconds, options.liveCurrentOffset as number)
  }
  return seekVodOffset(video, offsetSeconds)
}

/**
 * Confirm that the browser kept the requested playback position. Twitch may
 * accept a currentTime assignment and then restore the live edge after the
 * media pipeline rejects the target, so a synchronous success is not enough.
 */
export async function seekPlaybackOffsetVerified(
  video: HTMLVideoElement | null,
  offsetSeconds: number,
  options?: { isLive?: boolean; liveCurrentOffset?: number; timeoutMs?: number; toleranceSeconds?: number },
): Promise<LiveSeekResult> {
  const result = seekPlaybackOffset(video, offsetSeconds, options)
  if (!result.ok || !video) return result

  const timeoutMs = Math.max(300, options?.timeoutMs ?? 1_800)
  const toleranceSeconds = Math.max(1, options?.toleranceSeconds ?? 5)
  const startedAt = Date.now()
  const settleUntil = startedAt + Math.min(300, timeoutMs / 2)

  while (Date.now() - startedAt < timeoutMs) {
    const currentTime = video.currentTime
    if (
      Date.now() >= settleUntil
      && Number.isFinite(currentTime)
      && Math.abs(currentTime - result.targetSeconds) <= toleranceSeconds
    ) {
      return result
    }
    await new Promise<void>(resolve => setTimeout(resolve, 100))
  }

  return { ok: false, reason: 'seek_rejected' }
}

export function seekableLiveEdge(ranges: TimeRanges): number | null {
  if (!ranges || ranges.length === 0) return null
  const end = ranges.end(ranges.length - 1)
  return Number.isFinite(end) ? end : null
}

function finiteRangeEnd(ranges: TimeRanges | undefined): number | null {
  if (!ranges || ranges.length === 0) return null
  try {
    const end = ranges.end(ranges.length - 1)
    return Number.isFinite(end) && end >= 0 ? end : null
  } catch {
    return null
  }
}

/**
 * Resolve a real media-time live edge. Twitch has been observed exposing
 * `[0, 1073741824]` as a seekable range while the actual player is around
 * 1,300 seconds into the broadcast. Treat an endpoint far beyond the current
 * stream duration as a sentinel and use the buffered edge instead.
 */
export function resolveLiveMediaEdge(
  video: Pick<HTMLVideoElement, 'currentTime' | 'buffered' | 'seekable'>,
  currentOffsetSeconds: number,
): number | null {
  const currentTime = Number.isFinite(video.currentTime) && video.currentTime >= 0
    ? video.currentTime
    : null
  const bufferedEnd = finiteRangeEnd(video.buffered)
  const seekableEnd = finiteRangeEnd(video.seekable)
  const reference = Math.max(currentTime ?? 0, bufferedEnd ?? 0)
  const maxReasonableAhead = Math.max(15 * 60, currentOffsetSeconds + 5 * 60)

  if (seekableEnd != null && seekableEnd - reference <= maxReasonableAhead) {
    return seekableEnd
  }
  return bufferedEnd ?? currentTime
}

/**
 * Seek within Twitch live DVR using a validated media-time live edge.
 * Never trust Twitch's synthetic seekable endpoint.
 * `currentOffsetSeconds` must be stream wall offset (startedAt-derived), not player time.
 */
export function seekLiveOffset(
  video: HTMLVideoElement | null,
  offsetSeconds: number,
  currentOffsetSeconds: number,
): LiveSeekResult {
  if (!video) return { ok: false, reason: 'no_video' }
  if (!Number.isFinite(offsetSeconds) || !Number.isFinite(currentOffsetSeconds)) {
    return { ok: false, reason: 'outside_buffer' }
  }
  const liveEdge = resolveLiveMediaEdge(video, currentOffsetSeconds)
  if (liveEdge == null) {
    return { ok: false, reason: video.seekable.length > 0 ? 'outside_buffer' : 'not_seekable' }
  }
  const behindLiveSeconds = Math.max(0, currentOffsetSeconds - offsetSeconds)
  const target = liveEdge - behindLiveSeconds
  if (target < 0) return { ok: false, reason: 'outside_buffer' }
  if (!isSeekable(video.seekable, target)) {
    return { ok: false, reason: 'outside_buffer' }
  }
  video.currentTime = target
  return { ok: true, targetSeconds: target }
}

export function isSeekable(ranges: TimeRanges, targetSeconds: number): boolean {
  if (!Number.isFinite(targetSeconds)) return false
  for (let i = 0; i < ranges.length; i += 1) {
    if (targetSeconds >= ranges.start(i) && targetSeconds <= ranges.end(i)) {
      return true
    }
  }
  return false
}

/**
 * Prefer wall-clock offset from validated `startedAt`. Fall back to the payload
 * offset when startedAt is missing/invalid, or when the payload is within ±120s
 * (bounded reconciliation for clock skew).
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
      if (payload != null && Math.abs(derived - payload) <= 120) {
        return payload
      }
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

  const video = document.querySelector('video')
  // Live HLS often reports duration as Infinity. Number.isFinite(Infinity) is false,
  // so do not gate this branch on isFinite.
  if (video && video.duration === Infinity) {
    return true
  }

  const streamCard = document.querySelector('[data-a-target="stream-info-card-component"]')
  if (streamCard && /\bLIVE\b/i.test(streamCard.textContent ?? '')) {
    return true
  }

  return false
}
