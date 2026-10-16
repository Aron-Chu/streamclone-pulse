/**
 * VOD preview frames (Twitch storyboard tiles) for the session page's bar strip
 * and moment rows (PORT-PLAN §2.1, F6).
 *
 * The one adapter between `getVodStoryboardThumb` and the UI:
 * - parses the response defensively (the post-fix shape is not final), so a
 *   malformed or unexpected body is "no frame", never a broken picture;
 * - allows tile sheets from `*.cloudfront.net` only (where Twitch serves
 *   storyboards), with no characters that could break out of a CSS `url()`;
 * - crops the tile with CSS `background-size` / `background-position`, so no
 *   canvas and no CORS;
 * - caches per VOD and offset, and remembers a VOD that has no storyboard (or
 *   is still recording) so the page asks once, not once per bar.
 *
 * The web client asks the backend's `GET /v1/analytics/vods/{id}/storyboard-thumb`.
 * Today the hosted backend answers 404 `no_storyboard` for every VOD (F6: it
 * asks Twitch for a field that doesn't exist), so every caller shows the
 * fallback (blurred game art and the reason). Never a stand-in or a live frame.
 */
import { useEffect, useState, type CSSProperties } from 'react'
import { getConfiguredAnalyticsApi } from '../configureApi.ts'

/** One storyboard tile: a crop rectangle inside a sheet image (pixels). */
export interface VodFrame {
  sheetUrl: string
  sheetWidth: number
  sheetHeight: number
  cropX: number
  cropY: number
  cropW: number
  cropH: number
  /** VOD second the tile starts at, when the response says; else null. */
  fromSec: number | null
  /** Seconds between tiles, when the response says (a scrub steps by it); absent otherwise. */
  intervalSec?: number | null
}

/** Why there is no frame. */
export type VodFrameMissReason =
  /** The VOD is still recording: Twitch publishes storyboards when it ends. */
  | 'recording'
  /** The VOD has no storyboard. */
  | 'no_storyboard'
  /** The offset is outside the storyboard. */
  | 'out_of_range'
  /** No answer, a malformed answer, or a sheet from a host that isn't allowed. */
  | 'unavailable'

export type VodFrameResult =
  | { frame: VodFrame; reason: null }
  | { frame: null; reason: VodFrameMissReason }

const SHEET_URL = /^https:\/\/(?:[a-z0-9-]+\.)+cloudfront\.net\/[^"'()\\\s]+$/i

/** Tile sheets load from `*.cloudfront.net` only, and never with characters that could escape `url("…")`. */
export function isAllowedSheetUrl(url: unknown): url is string {
  return typeof url === 'string' && url.length <= 2048 && SHEET_URL.test(url)
}

const miss = (reason: VodFrameMissReason): VodFrameResult => ({ frame: null, reason })

function num(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '' && /^-?\d+(?:\.\d+)?$/.test(value.trim())) return Number(value)
  return null
}

function pick(record: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) if (record[key] !== undefined) return record[key]
  return undefined
}

/** Map a body's reason or status text to a miss reason (null when it names none). */
function reasonOf(record: Record<string, unknown>): VodFrameMissReason | null {
  const status = typeof record.status === 'string' ? record.status.trim().toUpperCase() : ''
  if (status === 'RECORDING') return 'recording'
  const statusCode = num(pick(record, 'statusCode', 'httpStatus'))
  if (statusCode === 403) return 'recording'
  const raw = typeof record.reason === 'string' ? record.reason.trim().toLowerCase()
    : typeof record.error === 'string' ? record.error.trim().toLowerCase() : ''
  if (!raw) return null
  if (raw.includes('recording') || raw === 'vod_live' || raw === 'live') return 'recording'
  if (raw === 'no_storyboard' || raw.includes('storyboard')) return 'no_storyboard'
  if (raw === 'offset_out_of_range' || raw.includes('range')) return 'out_of_range'
  return 'unavailable'
}

/**
 * Parse a `getVodStoryboardThumb` answer.
 *
 * Accepts the backend's shape `{ sheetUrl, sheetWidth, sheetHeight, cropX, cropY, cropW, cropH }`
 * (internal/analytics/vod_storyboard.go), optionally wrapped in `{ data }` or `{ thumb }`, with an
 * optional tile start (`fromSec` / `frameStartSec`, or `frameIndex` × `intervalMilliseconds`).
 * A `{ reason }` / `{ status: 'RECORDING' }` body, a 403, or anything malformed is a miss.
 */
export function parseStoryboardThumb(raw: unknown): VodFrameResult {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return miss('unavailable')
  let record = raw as Record<string, unknown>
  const inner = pick(record, 'data', 'thumb')
  if (inner && typeof inner === 'object' && !Array.isArray(inner) && record.sheetUrl === undefined) {
    record = inner as Record<string, unknown>
  }
  const reason = reasonOf(record)
  if (reason) return miss(reason)

  const sheetUrl = pick(record, 'sheetUrl', 'sheetURL', 'url')
  if (!isAllowedSheetUrl(sheetUrl)) return miss('unavailable')
  const sheetWidth = num(pick(record, 'sheetWidth', 'sheetW'))
  const sheetHeight = num(pick(record, 'sheetHeight', 'sheetH'))
  const cropX = num(pick(record, 'cropX', 'x'))
  const cropY = num(pick(record, 'cropY', 'y'))
  const cropW = num(pick(record, 'cropW', 'w'))
  const cropH = num(pick(record, 'cropH', 'h'))
  if (sheetWidth == null || sheetHeight == null || cropX == null || cropY == null || cropW == null || cropH == null) {
    return miss('unavailable')
  }
  if (sheetWidth <= 0 || sheetHeight <= 0 || cropW <= 0 || cropH <= 0 || cropX < 0 || cropY < 0) return miss('unavailable')
  if (cropW > sheetWidth || cropH > sheetHeight) return miss('unavailable')
  if (cropX + cropW > sheetWidth + 0.5 || cropY + cropH > sheetHeight + 0.5) return miss('unavailable')
  if (sheetWidth > 20000 || sheetHeight > 20000) return miss('unavailable')

  const intervalMs = num(pick(record, 'intervalMilliseconds', 'intervalMs'))
  const intervalSec = intervalMs != null && intervalMs >= 1000 && intervalMs <= 3_600_000 ? intervalMs / 1000 : null
  let fromSec = num(pick(record, 'fromSec', 'frameStartSec', 'tileStartSec'))
  if (fromSec == null) {
    const index = num(pick(record, 'frameIndex', 'index'))
    if (index != null && intervalMs != null && index >= 0 && intervalMs > 0) fromSec = (index * intervalMs) / 1000
  }
  if (fromSec != null && fromSec < 0) fromSec = null

  return {
    frame: { sheetUrl, sheetWidth, sheetHeight, cropX, cropY, cropW, cropH, fromSec, ...(intervalSec != null ? { intervalSec } : {}) },
    reason: null,
  }
}

/**
 * The CSS that shows one tile in a box of any size with the tile's aspect ratio
 * (the mockup's SP_FRAME_CSS, generalised from a grid to a crop rectangle).
 */
export function frameBackgroundStyle(frame: VodFrame): CSSProperties {
  const sx = (frame.sheetWidth / frame.cropW) * 100
  const sy = (frame.sheetHeight / frame.cropH) * 100
  const px = frame.sheetWidth > frame.cropW ? (frame.cropX / (frame.sheetWidth - frame.cropW)) * 100 : 0
  const py = frame.sheetHeight > frame.cropH ? (frame.cropY / (frame.sheetHeight - frame.cropH)) * 100 : 0
  return {
    backgroundImage: `url("${frame.sheetUrl}")`,
    backgroundSize: `${sx.toFixed(4)}% ${sy.toFixed(4)}%`,
    backgroundPosition: `${px.toFixed(4)}% ${py.toFixed(4)}%`,
    backgroundRepeat: 'no-repeat',
  }
}

/**
 * How far the tile sits from what it previews, in the mockup's words
 * ("from about 54 s before this minute"). `subjectVodStart` is the subject's
 * start on the VOD's clock. Null when the response doesn't say where the tile starts.
 */
export function frameTimingPhrase(
  frame: VodFrame,
  subjectVodStart: number | null | undefined,
  subject: 'minute' | 'bar' | 'moment',
): string | null {
  if (frame.fromSec == null || subjectVodStart == null || !Number.isFinite(subjectVodStart)) return null
  const d = Math.round(frame.fromSec - subjectVodStart)
  const unit = subject === 'moment' ? 'the moment' : subject === 'minute' ? 'this minute' : 'this bar'
  if (Math.abs(d) < 3) return subject === 'moment' ? "from the moment's start" : `from the start of ${unit}`
  return d > 0 ? `from about ${d} s into ${unit}` : `from about ${-d} s before ${unit}`
}

// ---- loading + cache ----

const frameCache = new Map<string, VodFrameResult>()
const inFlight = new Map<string, Promise<VodFrameResult>>()
/** VODs with no storyboard (or still recording): every offset answers the same, so ask once. */
const vodMisses = new Map<string, VodFrameMissReason>()
/**
 * A VOD's first request, until it answers: other offsets of that VOD wait for it, so a VOD with no
 * storyboard costs one request even when several pictures ask at once (the reel's three cards).
 */
const vodFirst = new Map<string, Promise<VodFrameResult>>()
const vodAnswered = new Set<string>()
const VOD_ID = /^\d{6,20}$/

/** Test hook. */
export function resetVodFrameCache(): void {
  frameCache.clear()
  inFlight.clear()
  vodMisses.clear()
  vodFirst.clear()
  vodAnswered.clear()
}

function cacheKey(vodId: string, offsetSec: number): string {
  return `${vodId}:${offsetSec}`
}

/** A cached answer, if the page already has one (lets a remount render without a flash). */
export function peekVodFrame(vodId: string | null | undefined, offsetSec: number | null | undefined): VodFrameResult | null {
  if (!vodId || offsetSec == null || !Number.isFinite(offsetSec)) return null
  const vodMiss = vodMisses.get(vodId)
  if (vodMiss) return miss(vodMiss)
  return frameCache.get(cacheKey(vodId, Math.max(0, Math.floor(offsetSec)))) ?? null
}

/** Load the tile under a VOD offset (seconds on the VOD's clock). Never throws. */
export function loadVodFrame(vodId: string, vodOffsetSec: number): Promise<VodFrameResult> {
  if (!VOD_ID.test(vodId) || !Number.isFinite(vodOffsetSec) || vodOffsetSec < 0) return Promise.resolve(miss('unavailable'))
  const offset = Math.floor(vodOffsetSec)
  const cached = peekVodFrame(vodId, offset)
  if (cached) return Promise.resolve(cached)
  const key = cacheKey(vodId, offset)
  const pending = inFlight.get(key)
  if (pending) return pending
  const first = vodAnswered.has(vodId) ? undefined : vodFirst.get(vodId)
  if (first) return first.then(() => loadVodFrame(vodId, offset))
  const request = (async (): Promise<VodFrameResult> => {
    let raw: unknown = null
    try {
      raw = await getConfiguredAnalyticsApi().getVodStoryboardThumb(vodId, offset)
    } catch (error) {
      const status = typeof error === 'object' && error !== null
        ? num((error as Record<string, unknown>).status ?? (error as Record<string, unknown>).statusCode)
        : null
      raw = status === 403 ? { statusCode: 403 } : null
    }
    const result = parseStoryboardThumb(raw)
    if (result.reason === 'no_storyboard' || result.reason === 'recording') vodMisses.set(vodId, result.reason)
    frameCache.set(key, result)
    vodAnswered.add(vodId)
    return result
  })().finally(() => {
    inFlight.delete(key)
    vodFirst.delete(vodId)
  })
  inFlight.set(key, request)
  if (!vodAnswered.has(vodId)) vodFirst.set(vodId, request)
  return request
}

export interface VodFrameState {
  /** True until the answer for the current VOD + offset is in. */
  loading: boolean
  result: VodFrameResult | null
}

/** The tile under a VOD offset; null offset or VOD = nothing to load. */
export function useVodFrame(vodId: string | null | undefined, vodOffsetSec: number | null | undefined): VodFrameState {
  const offset = vodOffsetSec == null || !Number.isFinite(vodOffsetSec) ? null : Math.max(0, Math.floor(vodOffsetSec))
  const [state, setState] = useState<{ key: string | null; result: VodFrameResult | null }>(() => {
    const key = vodId && offset != null ? cacheKey(vodId, offset) : null
    return { key, result: key ? peekVodFrame(vodId, offset) : null }
  })
  const key = vodId && offset != null ? cacheKey(vodId, offset) : null
  useEffect(() => {
    if (!vodId || offset == null || !key) return
    let alive = true
    void loadVodFrame(vodId, offset).then((result) => {
      if (alive) setState({ key, result })
    })
    return () => {
      alive = false
    }
  }, [vodId, offset, key])
  if (!key) return { loading: false, result: null }
  if (state.key === key && state.result) return { loading: false, result: state.result }
  const cached = peekVodFrame(vodId, offset)
  return cached ? { loading: false, result: cached } : { loading: true, result: null }
}
