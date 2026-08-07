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

export function seekLiveOffset(
  video: HTMLVideoElement | null,
  offsetSeconds: number,
  currentOffsetSeconds: number,
): LiveSeekResult {
  if (!video) return { ok: false, reason: 'no_video' }
  if (!Number.isFinite(offsetSeconds) || !Number.isFinite(currentOffsetSeconds)) {
    return { ok: false, reason: 'outside_buffer' }
  }
  // Never turn a future/corrupt moment into a successful seek at the live edge.
  // The old max(0, ...) below made a 42-hour peak on an 8-hour stream report
  // success while leaving the player at the live edge.
  if (offsetSeconds > currentOffsetSeconds) {
    return { ok: false, reason: 'outside_buffer' }
  }
  const behindLiveSeconds = Math.max(0, currentOffsetSeconds - offsetSeconds)
  const target = Math.max(0, video.currentTime - behindLiveSeconds)
  if (!isSeekable(video.seekable, target)) {
    return { ok: false, reason: video.seekable.length > 0 ? 'outside_buffer' : 'not_seekable' }
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
