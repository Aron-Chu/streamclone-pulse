/**
 * A moment's preview picture: which one it may honestly show, and the reads behind it.
 *
 * The order is fixed (pickMomentPreview): the stream's own frame at that second, then a Twitch clip from
 * the same broadcast that sits within NEARBY_CLIP_WINDOW_SECONDS of the moment, then the broadcast's
 * thumbnail, then the game's box art, then a plain placeholder with one honest line. Every picture
 * carries its label, so a clip is never shown as the moment itself.
 *
 * Reads stay off the first load: a caller asks only once its row is on screen or the page is idle
 * (useNearScreen / useAfterIdle). Clips are read once per channel per page view: every range asked for a
 * channel before its read starts is folded into that one read, and a later range is answered from it.
 * At most CLIP_READS_AT_ONCE reads run at a time; a failed read answers "no clips" and the picture falls
 * through to the next kind.
 *
 * Standalone entry (`@streampulse/analytics-console/moment-previews`): it imports no console component,
 * so a public page can use it without the console bundle.
 */
import { useEffect, useState, type RefCallback } from 'react'
import { getConfiguredAnalyticsApi } from './configureApi.ts'
import { useVodFrame, type VodFrame } from './utils/vodFrames.ts'

export { configureVodStoryboardReader, frameBackgroundStyle, type VodFrame, type VodStoryboardReader } from './utils/vodFrames.ts'

/**
 * How far (seconds) a clip's middle may sit from the middle of the moment's minute and still count as
 * "nearby". A moment is one measured minute, so its middle is at most 30 s from any second in it; 15 s
 * more covers the drift of the VOD alignment. Measured on the clip's middle, so a 30 s clip that
 * overlaps the minute at all still counts, and one that only touches the next minute does not.
 */
export const NEARBY_CLIP_WINDOW_SECONDS = 45
/** The middle of a measured minute, from its start. */
export const MOMENT_MIDDLE_SECONDS = 30
/** Clip reads running at once, across every channel on the page. */
export const CLIP_READS_AT_ONCE = 2
/** Clips are made after the moment: a moment asks for clips made from 2 min before it to 6 h after. */
export const CLIP_RANGE_BEFORE_MS = 2 * 60_000
export const CLIP_RANGE_AFTER_MS = 6 * 60 * 60_000
/** Ranges asked within this long of the first one join its read. */
const CLIP_GATHER_MS = 150

export const NEARBY_CLIP_LABEL = 'Nearby clip'
export const STREAM_FRAME_LABEL = 'Stream frame'
export const BROADCAST_THUMBNAIL_LABEL = 'VOD thumbnail'
export const GAME_ART_LABEL = 'Game art'
export const NO_PICTURE_LINE = 'No picture of this moment yet'

const VOD_ID = /^\d{1,30}$/
const LOGIN = /^[a-z0-9_]{1,25}$/

export interface MomentClip {
  id: string
  url: string
  title: string
  thumbnailUrl: string
  /** The broadcast the clip was cut from. */
  videoId: string
  /** Where the clip starts on that broadcast's VOD clock. */
  vodOffsetSeconds: number
  durationSeconds: number
  viewCount: number
}

export interface NearbyClip extends MomentClip {
  /** Seconds between the clip's middle and the moment's middle. */
  distanceSeconds: number
}

function httpsOn(value: unknown, hosts: RegExp): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && hosts.test(url.hostname) ? url.href : null
  } catch {
    return null
  }
}

const TWITCH_PAGE = /^(?:www\.|clips\.|m\.)?twitch\.tv$/i
const TWITCH_IMAGE = /^(?:static-cdn\.jtvnw\.net|clips-media-assets2\.twitch\.tv)$/i

/** The clips route's items that can be matched: a VOD id, a VOD offset, a Twitch link and picture. */
export function parseMomentClips(raw: unknown): MomentClip[] {
  const items = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? (raw as { items?: unknown }).items : null
  if (!Array.isArray(items)) return []
  const out: MomentClip[] = []
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const id = typeof row.id === 'string' && row.id && row.id.length <= 200 ? row.id : null
    const url = httpsOn(row.url, TWITCH_PAGE)
    const thumbnailUrl = httpsOn(row.thumbnailUrl, TWITCH_IMAGE)
    const videoId = typeof row.videoId === 'string' && VOD_ID.test(row.videoId) ? row.videoId : null
    const offset = typeof row.vodOffsetSeconds === 'number' && Number.isFinite(row.vodOffsetSeconds) && row.vodOffsetSeconds >= 0
      ? row.vodOffsetSeconds : null
    if (!id || !url || !thumbnailUrl || !videoId || offset == null) continue
    const duration = typeof row.durationSeconds === 'number' && Number.isFinite(row.durationSeconds) && row.durationSeconds > 0
      ? Math.min(row.durationSeconds, 120) : 0
    out.push({
      id,
      url,
      title: typeof row.title === 'string' ? row.title.slice(0, 200) : '',
      thumbnailUrl,
      videoId,
      vodOffsetSeconds: offset,
      durationSeconds: duration,
      viewCount: typeof row.viewCount === 'number' && Number.isFinite(row.viewCount) && row.viewCount >= 0 ? row.viewCount : 0,
    })
  }
  return out
}

/**
 * The middle of the moment's minute on the VOD's clock, or null. Only a verified alignment may be passed
 * in: without one there is no honest way to place a clip next to the moment.
 */
export function momentMiddleVodSecond(offsetSeconds: number, vodAlignSeconds: number | null | undefined): number | null {
  if (!Number.isFinite(offsetSeconds) || offsetSeconds < 0) return null
  if (vodAlignSeconds == null || !Number.isFinite(vodAlignSeconds)) return null
  const second = vodAlignSeconds + offsetSeconds + MOMENT_MIDDLE_SECONDS
  return second >= 0 ? second : null
}

/**
 * The clip from the same broadcast nearest the moment, when its middle is within
 * NEARBY_CLIP_WINDOW_SECONDS of the moment's middle; else null. A clip from any other VOD never matches.
 */
export function matchNearbyClip(
  clips: readonly MomentClip[],
  target: { vodId?: string | null; vodSecond?: number | null },
): NearbyClip | null {
  const { vodId, vodSecond } = target
  if (!vodId || !VOD_ID.test(vodId) || vodSecond == null || !Number.isFinite(vodSecond)) return null
  let best: NearbyClip | null = null
  for (const clip of clips) {
    if (clip.videoId !== vodId) continue
    const distance = Math.abs(clip.vodOffsetSeconds + clip.durationSeconds / 2 - vodSecond)
    if (distance > NEARBY_CLIP_WINDOW_SECONDS) continue
    if (!best || distance < best.distanceSeconds || (distance === best.distanceSeconds && clip.viewCount > best.viewCount)) {
      best = { ...clip, distanceSeconds: distance }
    }
  }
  return best
}

export type MomentPreview =
  | { kind: 'frame'; label: typeof STREAM_FRAME_LABEL; frame: VodFrame }
  | { kind: 'clip'; label: typeof NEARBY_CLIP_LABEL; imageUrl: string; clip: NearbyClip }
  | { kind: 'broadcast'; label: typeof BROADCAST_THUMBNAIL_LABEL; imageUrl: string }
  | { kind: 'game'; label: typeof GAME_ART_LABEL; imageUrl: string; gameName: string | null }
  | { kind: 'none'; label: typeof NO_PICTURE_LINE }

export interface MomentPreviewInput {
  frame?: VodFrame | null
  clip?: NearbyClip | null
  broadcastUrl?: string | null
  gameArtUrl?: string | null
  gameName?: string | null
  /** Image URLs that failed to load here: each falls through to the next kind. */
  failed?: ReadonlySet<string>
}

/** The first honest picture: stream frame, nearby clip, broadcast thumbnail, game art, then none. */
export function pickMomentPreview(input: MomentPreviewInput): MomentPreview {
  const ok = (url: string | null | undefined): url is string => Boolean(url) && !input.failed?.has(url as string)
  if (input.frame) return { kind: 'frame', label: STREAM_FRAME_LABEL, frame: input.frame }
  if (input.clip && ok(input.clip.thumbnailUrl)) {
    return { kind: 'clip', label: NEARBY_CLIP_LABEL, imageUrl: input.clip.thumbnailUrl, clip: input.clip }
  }
  if (ok(input.broadcastUrl)) return { kind: 'broadcast', label: BROADCAST_THUMBNAIL_LABEL, imageUrl: input.broadcastUrl }
  if (ok(input.gameArtUrl)) return { kind: 'game', label: GAME_ART_LABEL, imageUrl: input.gameArtUrl, gameName: input.gameName ?? null }
  return { kind: 'none', label: NO_PICTURE_LINE }
}

// ---- reads ----------------------------------------------------------------------------------------------

/** Reads the clips route for a channel and a creation-time range; the raw answer, parsed here. */
export type MomentClipsReader = (login: string, startedAt: string, endedAt: string) => Promise<unknown>

let clipsReader: MomentClipsReader | null = null

/** A page that has no configured console API passes its own reader (the portal's public pages). */
export function configureMomentClipsReader(reader: MomentClipsReader | null): void {
  clipsReader = reader
}

function readClips(login: string, startedAt: string, endedAt: string): Promise<unknown> {
  if (clipsReader) return clipsReader(login, startedAt, endedAt)
  return getConfiguredAnalyticsApi().getTwitchDayClips(login, startedAt, endedAt)
}

export interface ClipRange { startMs: number; endMs: number }

interface ChannelClips {
  wanted: ClipRange | null
  /** The range the one read asked for; set when it starts. */
  asked: ClipRange | null
  clips: MomentClip[] | null
  promise: Promise<MomentClip[]> | null
}

const channels = new Map<string, ChannelClips>()
const waiting: Array<() => void> = []
let running = 0

function nextSlot(): Promise<void> {
  if (running < CLIP_READS_AT_ONCE) {
    running += 1
    return Promise.resolve()
  }
  return new Promise((resolve) => waiting.push(() => { running += 1; resolve() }))
}

function freeSlot(): void {
  running = Math.max(0, running - 1)
  waiting.shift()?.()
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * The creation-time range a moment asks for: from just before it to 6 h after, never past now. "Now" is
 * taken to the next whole minute, so the range stays the same between renders.
 */
export function momentClipRange(atMs: number | null | undefined, nowMs = Date.now()): ClipRange | null {
  if (atMs == null || !Number.isFinite(atMs)) return null
  const startMs = atMs - CLIP_RANGE_BEFORE_MS
  const endMs = Math.min(Math.ceil(nowMs / 60_000) * 60_000, atMs + CLIP_RANGE_AFTER_MS)
  return endMs > startMs ? { startMs, endMs } : null
}

/**
 * Add a range to the channel's one read without starting it (a list knows all its moments before any is
 * on screen). Ignored once the read has started.
 */
export function wantMomentClips(login: string, range: ClipRange): void {
  const key = login.toLowerCase()
  if (!LOGIN.test(key) || !Number.isFinite(range.startMs) || !Number.isFinite(range.endMs) || range.endMs <= range.startMs) return
  let entry = channels.get(key)
  if (!entry) {
    entry = { wanted: null, asked: null, clips: null, promise: null }
    channels.set(key, entry)
  }
  if (entry.asked || entry.clips) return
  entry.wanted = entry.wanted
    ? { startMs: Math.min(entry.wanted.startMs, range.startMs), endMs: Math.max(entry.wanted.endMs, range.endMs) }
    : range
}

/**
 * The channel's clips for a range. The first call for a channel starts its one read for this page view,
 * after a short gather so rows that appear together share it; later calls get that read's answer, even
 * when their range is outside it (they then match nothing and fall through). Never rejects.
 */
export function loadMomentClips(login: string, range: ClipRange): Promise<MomentClip[]> {
  const key = login.toLowerCase()
  if (!LOGIN.test(key) || !Number.isFinite(range.startMs) || !Number.isFinite(range.endMs) || range.endMs <= range.startMs) {
    return Promise.resolve([])
  }
  wantMomentClips(key, range)
  const current = channels.get(key)!
  if (current.clips) return Promise.resolve(current.clips)
  if (current.promise) return current.promise
  current.promise = (async () => {
    await sleep(CLIP_GATHER_MS)
    await nextSlot()
    const asked = current.wanted ?? range
    current.asked = asked
    let clips: MomentClip[] = []
    try {
      clips = parseMomentClips(await readClips(key, new Date(asked.startMs).toISOString(), new Date(asked.endMs).toISOString()))
    } catch {
      clips = []
    } finally {
      freeSlot()
    }
    current.clips = clips
    return clips
  })()
  return current.promise
}

/** The channel's clips when its read has answered; null before. */
export function peekMomentClips(login: string): MomentClip[] | null {
  return channels.get(login.toLowerCase())?.clips ?? null
}

/** Tests and a fresh page view. */
export function resetMomentClipCache(): void {
  channels.clear()
  waiting.length = 0
  running = 0
}

// ---- when to ask ----------------------------------------------------------------------------------------

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
  cancelIdleCallback?: (id: number) => void
}

function whenIdle(callback: () => void, timeoutMs: number): () => void {
  if (typeof window === 'undefined') return () => undefined
  const idle = window as IdleWindow
  if (typeof idle.requestIdleCallback === 'function') {
    const id = idle.requestIdleCallback(callback, { timeout: timeoutMs })
    return () => idle.cancelIdleCallback?.(id)
  }
  const id = window.setTimeout(callback, Math.min(timeoutMs, 1200))
  return () => window.clearTimeout(id)
}

/** True once the page has gone idle after load (or after `timeoutMs`, whichever is first). */
export function useAfterIdle(enabled = true, timeoutMs = 2500): boolean {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (!enabled || ready) return
    return whenIdle(() => setReady(true), timeoutMs)
  }, [enabled, ready, timeoutMs])
  return ready
}

/**
 * A ref for an element, and true once it has come within `rootMargin` of the screen (it stays true).
 * Without IntersectionObserver it turns true when the page is idle.
 */
export function useNearScreen<T extends Element>(rootMargin = '200px'): [RefCallback<T>, boolean] {
  const [near, setNear] = useState(false)
  const [node, setNode] = useState<T | null>(null)
  useEffect(() => {
    if (near || !node) return
    if (typeof IntersectionObserver === 'undefined') return whenIdle(() => setNear(true), 2500)
    const io = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setNear(true)
    }, { rootMargin })
    io.observe(node)
    return () => io.disconnect()
  }, [near, node, rootMargin])
  return [setNode, near]
}

// ---- one moment's picture -------------------------------------------------------------------------------

export interface MomentPreviewArgs {
  /** False until the row is on screen or the page is idle: nothing is asked before. */
  enabled: boolean
  login?: string | null
  /** The broadcast's VOD id, only with a verified alignment. */
  vodId?: string | null
  /** The middle of the moment's minute on the VOD clock (momentMiddleVodSecond). */
  vodSecond?: number | null
  /** Creation-time range for the clips read (momentClipRange). */
  clipRange?: ClipRange | null
  /** Ask for the stream's own frame (the storyboard tile) as well. */
  frames?: boolean
  broadcastUrl?: string | null
  gameArtUrl?: string | null
  gameName?: string | null
}

export interface MomentPreviewState {
  preview: MomentPreview
  /** True while a read that could change the picture is out. */
  loading: boolean
  /** Report an image that failed to load: the picture falls to the next kind. */
  onImageError: (url: string) => void
}

/** One moment's picture, from the reads above, after `enabled` turns true. */
export function useMomentPreview(args: MomentPreviewArgs): MomentPreviewState {
  const { enabled, login, vodId, vodSecond, clipRange, frames = true } = args
  const validVod = vodId && VOD_ID.test(vodId) ? vodId : null
  const second = vodSecond != null && Number.isFinite(vodSecond) ? vodSecond : null
  const frameState = useVodFrame(enabled && frames && validVod && second != null ? validVod : null, second)
  const askClips = Boolean(enabled && login && validVod && second != null && clipRange)
  const loginKey = login ? login.toLowerCase() : ''
  const [clips, setClips] = useState<{ login: string; clips: MomentClip[] } | null>(() => {
    const peeked = loginKey ? peekMomentClips(loginKey) : null
    return peeked ? { login: loginKey, clips: peeked } : null
  })
  const startMs = clipRange?.startMs
  const endMs = clipRange?.endMs
  // Known before it is on screen: its range joins the channel's one read.
  useEffect(() => {
    if (loginKey && validVod && startMs != null && endMs != null) wantMomentClips(loginKey, { startMs, endMs })
  }, [loginKey, validVod, startMs, endMs])
  useEffect(() => {
    if (!askClips || startMs == null || endMs == null) return
    let alive = true
    void loadMomentClips(loginKey, { startMs, endMs }).then((found) => {
      if (alive) setClips((current) => (current?.login === loginKey && current.clips === found ? current : { login: loginKey, clips: found }))
    })
    return () => {
      alive = false
    }
  }, [askClips, loginKey, startMs, endMs])
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set())
  const shownClips = clips?.login === loginKey ? clips.clips : null
  const clip = shownClips ? matchNearbyClip(shownClips, { vodId: validVod, vodSecond: second }) : null
  const preview = pickMomentPreview({
    frame: frameState.result?.frame ?? null,
    clip,
    broadcastUrl: args.broadcastUrl,
    gameArtUrl: args.gameArtUrl,
    gameName: args.gameName,
    failed,
  })
  const loading = enabled && ((frames && frameState.loading) || (askClips && !shownClips))
  return {
    preview,
    loading,
    onImageError: (url) => setFailed((current) => (current.has(url) ? current : new Set([...current, url]))),
  }
}
