import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { momentClockDisplay, type LiveHeatPoint } from '@streampulse/pulse-core'
import { sendBackgroundMessage } from '../content/bridge.ts'
import { resolveLiveMediaEdge } from '../content/twitch.ts'
import type { ExtensionGameSegment } from '../shared/messages.ts'
import { MOMENT_FRAMES_READY_EVENT, type MomentFramesApi, type MomentPictureAt, type MomentPictureView } from '../shared/momentFramesContract.ts'
import { MOMENT_PICTURES_KEY } from '../shared/storage.ts'
import { resolveGameArtCandidates } from './GamesPlayedStrip.tsx'
import { isRenderableGameName } from './extensionChartAdapter.ts'

let asked = false
let waitingForFrames = 0

function askForFrames(): void {
  if (globalThis.__pulseMomentFrames) return
  asked = true
  Promise.resolve()
    .then(() => sendBackgroundMessage({ type: 'MOMENT_FRAMES_SCRIPT' }))
    .catch(() => { asked = false })
}

function retryFramesOnEnable(changes: Record<string, chrome.storage.StorageChange>, area: string): void {
  const change = changes[MOMENT_PICTURES_KEY]
  if (area === 'sync' && change?.oldValue === false && change.newValue !== false) askForFrames()
}

/** The stream Pulse shows (useMomentCapture), for the backend pictures the frames script draws. */
let pictureAt: MomentPictureAt | undefined
/** Bumped when the stream's key or VOD changes, so mounted pictures look again (a live stream's VOD arrives late). */
let atVersion = 0
const atListeners = new Set<() => void>()
function subscribeAt(listener: () => void): () => void {
  atListeners.add(listener)
  return () => { atListeners.delete(listener) }
}

/**
 * The moment-pictures script (content/moment-frames.js) once the worker has
 * injected it. The first caller asks for it; the worker declines while Moment
 * pictures is off. Waiting slots share one retry when the setting turns on.
 */
export function useMomentFrames(): MomentFramesApi | undefined {
  const [frames, setFrames] = useState(() => globalThis.__pulseMomentFrames)
  useEffect(() => {
    if (frames) return
    const ready = (): void => setFrames(globalThis.__pulseMomentFrames)
    addEventListener(MOMENT_FRAMES_READY_EVENT, ready)
    ready()
    const storage = globalThis.chrome?.storage?.onChanged
    if (waitingForFrames++ === 0) storage?.addListener(retryFramesOnEnable)
    if (!asked) askForFrames()
    return () => {
      removeEventListener(MOMENT_FRAMES_READY_EVENT, ready)
      if (--waitingForFrames === 0) storage?.removeListener(retryFramesOnEnable)
    }
  }, [frames])
  return frames
}

/**
 * Where a moment's picture comes from: a few seconds before chat reacted, when
 * the moment has second-level timing, or across its minute when it has not.
 */
export function momentPictureView(kind: MomentPictureView['kind'], point: LiveHeatPoint, exact?: boolean): MomentPictureView {
  const onset = point.reactionOnsetOffsetSeconds
  const view = !momentClockDisplay(point).approximate && onset != null
    ? { kind, from: onset - 20, to: onset + 30, peak: onset - 3 }
    : minutePictureView(kind, point.offsetSeconds)
  return exact ? { ...view, exact } : view
}

export function minutePictureView(kind: MomentPictureView['kind'], offsetSeconds: number): MomentPictureView {
  return { kind, from: offsetSeconds - 10, to: offsetSeconds + 60, peak: offsetSeconds + 30 }
}

/**
 * The VOD of a stream that has ended, from the channel's stream history, for
 * its pictures and cover: the offline channel page's payload carries no VOD.
 * Only the row whose stream id matches counts, never the channel's latest VOD.
 * Asked only while `ask` holds and Moment pictures is on.
 */
export function useArchiveVodId(login: string | null | undefined, streamId: string | null | undefined, ask: boolean): string | null {
  const frames = useMomentFrames()
  const [found, setFound] = useState<{ streamId: string; vodId: string | null } | null>(null)
  useEffect(() => {
    if (!frames || !ask || !login || !streamId) return
    let live = true
    void sendBackgroundMessage({ type: 'LIST_PAST_VODS', login, liveStreamId: streamId, isLive: false }).then(history => {
      if (!live || !('type' in history) || history.type !== 'PAST_VODS') return
      setFound({ streamId, vodId: history.items.find(item => item.streamId === streamId && item.videoId)?.videoId ?? null })
    }, () => {})
    return () => { live = false }
  }, [frames, ask, login, streamId])
  return ask && found && found.streamId === streamId ? found.vodId : null
}

/**
 * The VOD Twitch is recording for a live stream, for the exact frames of its
 * moments (src/background/vodFrameInject.ts); only an archive that names this
 * stream counts.
 */
export function useLiveVodId(login: string | null | undefined, streamId: string | null | undefined, ask: boolean): string | null {
  const frames = useMomentFrames()
  const [found, setFound] = useState<{ streamId: string; vodId: string | null } | null>(null)
  useEffect(() => {
    if (!frames || !ask || !login || !streamId) return
    let live = true
    void sendBackgroundMessage({ type: 'DISCOVER_LIVE_VOD', login, streamId }).then(response => {
      if (!live || !('type' in response) || response.type !== 'DISCOVER_LIVE_VOD') return
      const { vodId, streamId: archiveStream } = response.result
      setFound({ streamId, vodId: vodId && (!archiveStream || archiveStream === streamId) ? vodId : null })
    }, () => {})
    return () => { live = false }
  }, [frames, ask, login, streamId])
  return ask && found && found.streamId === streamId ? found.vodId : null
}

/** Fills the returned element with the picture of `view`, when this tab has frames for it. */
export function useMomentPicture<T extends HTMLElement>(view: MomentPictureView | undefined) {
  const frames = useMomentFrames()
  const ref = useRef<T>(null)
  useSyncExternalStore(subscribeAt, () => atVersion, () => atVersion)
  const at = pictureAt
  const key = view ? `${view.kind} ${view.from} ${view.to} ${view.peak} ${view.art} ${view.emote} ${view.exact} ${at?.key} ${at?.vodId} ${at?.vodOriginDeltaSeconds}` : ''
  useEffect(() => (frames && view && ref.current ? frames.mount(ref.current, view, at) : undefined), [frames, key])
  return ref
}

export interface MomentGame {
  name: string
  art?: string
}

/** The game on screen at `offsetSeconds`; the latest segment covers a live stream's growing end. */
export function gameAtOffset(games: readonly ExtensionGameSegment[] | undefined, offsetSeconds: number): MomentGame | undefined {
  const segments = (games ?? []).filter(game => isRenderableGameName(game.gameName) && game.offsetSeconds <= offsetSeconds)
  const segment = segments.reduce<ExtensionGameSegment | undefined>(
    (latest, game) => (!latest || game.offsetSeconds > latest.offsetSeconds ? game : latest),
    undefined,
  )
  if (!segment) return undefined
  const last = (games ?? []).every(game => game.offsetSeconds <= segment.offsetSeconds)
  if (!last && offsetSeconds >= segment.offsetSeconds + segment.durationSeconds) return undefined
  return { name: segment.gameName, art: resolveGameArtCandidates(segment.boxArtUrl, segment.categoryId)[0] }
}

export interface MomentCaptureStream {
  /** The stream the frames belong to. */
  key?: string | null
  /** A live channel page: offsets follow the clock from the stream start. */
  live: boolean
  startedAt?: string
  /** A VOD page: offsets follow the player, shifted by the VOD's start in the stream. */
  vod: boolean
  vodOriginDeltaSeconds?: number
  /** For the backend's moment pictures. */
  api?: string
  login?: string | null
  vodId?: string | null
}

/**
 * Keeps frames of what the player shows while Pulse is open on a live channel
 * or a VOD, and holds on to the frames around ranked moments
 * (`momentOffsets`, stream offsets in seconds).
 */
export function useMomentCapture(stream: MomentCaptureStream, momentOffsets: readonly number[], video: () => HTMLVideoElement | null): void {
  const frames = useMomentFrames()
  pictureAt = stream
  useEffect(() => {
    atVersion++
    for (const listener of atListeners) listener()
  }, [stream.key, stream.vodId, stream.vodOriginDeltaSeconds])
  const startedAt = Date.parse(stream.startedAt ?? '')
  const delta = Number.isFinite(stream.vodOriginDeltaSeconds) ? stream.vodOriginDeltaSeconds! : 0
  const mode = stream.vod ? 'vod' : stream.live && startedAt > 0 ? 'live' : null
  useEffect(() => {
    if (!frames || !stream.key || !mode) return
    return frames.start({
      key: stream.key,
      video,
      offset: player => {
        if (mode === 'vod') return player.currentTime + delta
        // Live offsets follow the clock, like chat's, so a frame lines up with
        // the messages people sent while watching it; a viewer scrubbed back
        // in the DVR buffer sees an older offset.
        const now = (Date.now() - startedAt) / 1000
        const behind = (resolveLiveMediaEdge(player, now) ?? player.currentTime) - player.currentTime
        return now - (behind > 15 ? behind : 0)
      },
    })
  }, [frames, stream.key, mode, startedAt, delta, video])
  // A moment's offset is its minute (or its onset); keep the frames its
  // picture can scrub across.
  const kept = [...new Set(momentOffsets.map(Math.round))].sort((a, b) => a - b).join(' ')
  useEffect(() => {
    frames?.keep(kept ? kept.split(' ').map(offset => [Number(offset) - 30, Number(offset) + 90] as const) : [])
  }, [frames, kept])
}
