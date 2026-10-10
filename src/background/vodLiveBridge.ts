import type { ExtensionVodPulseResponse } from '../types/vodPulseTypes.ts'

/**
 * When to ask the VOD endpoint for the live bridge (`allowLiveBridge=true`).
 *
 * The bridge answers with the channel's live DVR. That is right only for the
 * archive of the stream that is live now. For any other VOD of a live channel
 * it answered with the live stream (wrong game, a 50-hour range) or a 409, so
 * a past VOD is always asked for plainly, and the bridge is used only once the
 * VOD is shown to be the live stream's archive.
 */

export interface LiveStreamIdentity {
  isLive: boolean
  streamId?: string | null
  startedAt?: string | null
  /** The live stream's archive VOD, when the backend already knows it. */
  vodId?: string | null
}

/** A live archive starts with its stream; allow for Twitch creating it a little late. */
export const LIVE_ARCHIVE_START_TOLERANCE_MS = 2 * 60_000
/** A VOD that ended longer ago than this cannot be the stream that is live now. */
export const LIVE_ARCHIVE_END_SLACK_MS = 15 * 60_000
/** Without a duration, only a VOD started in the last two days can still be live. */
export const LIVE_ARCHIVE_MAX_AGE_MS = 48 * 60 * 60_000
/** How long a confirmed live archive is asked for with the bridge first. */
export const LIVE_ARCHIVE_MEMO_MS = 5 * 60_000
/** Longest Retry-After honoured for the live bridge; the memo expires before this anyway. */
export const LIVE_BRIDGE_RETRY_MAX_MS = LIVE_ARCHIVE_MEMO_MS

/**
 * A bridged request that did not get an answer: a 429, a 5xx, a timeout or a
 * network error. It says nothing about whether the stream is still live.
 */
export class VodBridgeTransientError extends Error {
  constructor(readonly status: number, readonly retryAfterMs?: number) {
    super(`vod_bridge_transient_${status}`)
  }
}

/** Retry-After as milliseconds (seconds or an HTTP date), or undefined. */
export function retryAfterMs(value: string | null | undefined, nowMs: number): number | undefined {
  const text = trimmed(value)
  if (!text) return undefined
  const ms = /^\d+$/.test(text) ? Number(text) * 1000 : Date.parse(text) - nowMs
  return Number.isFinite(ms) && ms > 0 ? ms : undefined
}

function trimmed(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** True only when the VOD being watched is the stream that is live right now. */
export function shouldUseLiveBridge(input: {
  vodId: string
  vodStreamId?: string | null
  vodStartedAt?: string | null
  live: LiveStreamIdentity | null | undefined
}): boolean {
  const live = input.live
  if (!live || live.isLive !== true) return false
  const liveStreamId = trimmed(live.streamId)
  const vodStreamId = trimmed(input.vodStreamId)
  if (liveStreamId && vodStreamId) return liveStreamId === vodStreamId
  const liveVodId = trimmed(live.vodId)
  if (liveVodId) return liveVodId === trimmed(input.vodId)
  const liveStart = Date.parse(trimmed(live.startedAt))
  const vodStart = Date.parse(trimmed(input.vodStartedAt))
  return Number.isFinite(liveStart)
    && Number.isFinite(vodStart)
    && vodStart >= liveStart - LIVE_ARCHIVE_START_TOLERANCE_MS
}

/**
 * Cheap pre-check on a plain answer: a VOD that ended well before now is a
 * finished archive, so there is no need to look up whether the channel is live.
 */
export function couldBeLiveArchive(vod: ExtensionVodPulseResponse, nowMs: number): boolean {
  if (vod.mode !== 'vod' || !trimmed(vod.streamId)) return false
  const startMs = Date.parse(trimmed(vod.startedAt))
  if (!Number.isFinite(startMs)) return false
  const duration = vod.durationSeconds
  if (typeof duration === 'number' && Number.isFinite(duration) && duration >= 0) {
    return startMs + duration * 1000 >= nowMs - LIVE_ARCHIVE_END_SLACK_MS
  }
  return startMs >= nowMs - LIVE_ARCHIVE_MAX_AGE_MS
}

/** A plain answer that already names the VOD's own stream. */
export function isResolvedVod(vod: ExtensionVodPulseResponse): boolean {
  return vod.mode === 'vod'
    && Boolean(trimmed(vod.vodId))
    && Boolean(trimmed(vod.streamId))
    && vod.coverageStatus !== 'missing'
    && vod.coverageStatus !== 'error'
}

/** Accept a bridged answer only when it is the live DVR of the expected stream. */
export function isAcceptedLiveBridge(
  vod: ExtensionVodPulseResponse | null | undefined,
  expectedStreamId: string,
): vod is Extract<ExtensionVodPulseResponse, { mode: 'live_dvr' }> {
  return Boolean(vod && vod.mode === 'live_dvr' && expectedStreamId && trimmed(vod.streamId) === expectedStreamId)
}

export interface VodPulseRequestDeps {
  /** One request to the VOD endpoint. `streamId` is only sent with the bridge. */
  request: (bridge: boolean, streamId?: string) => Promise<ExtensionVodPulseResponse>
  /** The channel's live stream, or null when unknown or offline. */
  liveIdentity: (login: string) => Promise<LiveStreamIdentity | null>
  now?: () => number
}

export type VodBridgeOutcome = 'plain' | 'bridge' | 'bridge_rejected' | 'bridge_transient'

interface LiveArchiveMemo {
  streamId: string
  /** When the bridge last confirmed this VOD as the live DVR. */
  atMs: number
  /** That confirmed answer, shown again while the bridge is briefly unreachable. */
  last: Extract<ExtensionVodPulseResponse, { mode: 'live_dvr' }>
  /** Do not ask the bridge again before this (Retry-After). */
  retryAtMs?: number
}

const liveArchiveMemo = new Map<string, LiveArchiveMemo>()

/** Test hook: forget confirmed live archives. */
export function resetLiveArchiveMemo(): void {
  liveArchiveMemo.clear()
}

/**
 * Plain first; the bridge only for the archive of the stream that is live now.
 * A VOD already confirmed as the live archive (recurring growing-VOD polls)
 * asks with the bridge first. If the bridge gives no answer (429, 5xx, timeout,
 * network), the last confirmed live DVR is kept and polling goes on, without
 * further requests and within Retry-After. Only a definite answer that is not
 * this stream's live DVR drops to the plain request.
 */
export async function requestVodPulse(
  vodId: string,
  options: { streamId?: string; login?: string },
  deps: VodPulseRequestDeps,
): Promise<{ payload: ExtensionVodPulseResponse; outcome: VodBridgeOutcome }> {
  const now = deps.now ?? Date.now
  let outcome: VodBridgeOutcome = 'plain'

  const memo = liveArchiveMemo.get(vodId)
  if (memo && now() - memo.atMs <= LIVE_ARCHIVE_MEMO_MS) {
    if (memo.retryAtMs !== undefined && now() < memo.retryAtMs) {
      return { payload: memo.last, outcome: 'bridge_transient' }
    }
    let bridged: ExtensionVodPulseResponse | null = null
    try {
      bridged = await deps.request(true, memo.streamId)
    } catch (err) {
      const wait = err instanceof VodBridgeTransientError ? err.retryAfterMs : undefined
      liveArchiveMemo.set(vodId, {
        ...memo,
        retryAtMs: wait ? now() + Math.min(wait, LIVE_BRIDGE_RETRY_MAX_MS) : undefined,
      })
      return { payload: memo.last, outcome: 'bridge_transient' }
    }
    if (isAcceptedLiveBridge(bridged, memo.streamId)) {
      liveArchiveMemo.set(vodId, { streamId: memo.streamId, atMs: now(), last: bridged })
      return { payload: bridged, outcome: 'bridge' }
    }
    outcome = 'bridge_rejected'
  }
  liveArchiveMemo.delete(vodId)

  const plain = await deps.request(false)
  // Asked without the bridge, a live answer is the backend's own decision.
  if (plain.mode === 'live_dvr') return { payload: plain, outcome }
  const resolved = isResolvedVod(plain)
  if (resolved && !couldBeLiveArchive(plain, now())) return { payload: plain, outcome }

  const login = trimmed(plain.channelLogin ?? plain.login) || trimmed(options.login)
  if (!login || login.startsWith('__vod__:')) return { payload: plain, outcome }
  const live = await deps.liveIdentity(login.toLowerCase()).catch(() => null)
  const vodStreamId = resolved ? trimmed(plain.streamId) : trimmed(options.streamId)
  const isLiveArchive = shouldUseLiveBridge({
    vodId,
    vodStreamId,
    vodStartedAt: resolved ? plain.startedAt : undefined,
    live,
  })
  const expected = vodStreamId || trimmed(live?.streamId)
  if (!isLiveArchive || !expected) return { payload: plain, outcome }

  const bridged = await deps.request(true, expected).catch(() => null)
  if (isAcceptedLiveBridge(bridged, expected)) {
    liveArchiveMemo.set(vodId, { streamId: expected, atMs: now(), last: bridged })
    return { payload: bridged, outcome: 'bridge' }
  }
  return { payload: plain, outcome: 'bridge_rejected' }
}
