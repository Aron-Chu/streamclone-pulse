import { useEffect, useRef, useState } from 'react'
import { momentClockDisplay, type LiveHeatPoint } from '@streampulse/pulse-core'
import { sendBackgroundMessage } from '../content/bridge.ts'
import { resolveLiveMediaEdge } from '../content/twitch.ts'
import type { ExtensionGameSegment } from '../shared/messages.ts'
import { MOMENT_FRAMES_READY_EVENT, type MomentFramesApi, type MomentPictureAt, type MomentPictureView } from '../shared/momentFramesContract.ts'
import { resolveGameArtCandidates } from './GamesPlayedStrip.tsx'
import { isRenderableGameName } from './extensionChartAdapter.ts'

let asked = false
/** The stream Pulse shows (useMomentCapture), for the backend pictures the frames script draws. */
let pictureAt: MomentPictureAt | undefined

/**
 * The moment-pictures script (content/moment-frames.js) once the worker has
 * injected it. The first caller asks for it; the worker declines while Moment
 * pictures is off, and every picture slot then stays empty.
 */
export function useMomentFrames(): MomentFramesApi | undefined {
  const [frames, setFrames] = useState(() => globalThis.__pulseMomentFrames)
  useEffect(() => {
    if (frames) return
    const ready = (): void => setFrames(globalThis.__pulseMomentFrames)
    addEventListener(MOMENT_FRAMES_READY_EVENT, ready)
    ready()
    if (!asked) {
      asked = true
      // A declined request (the setting is off) is not repeated; a failed one is.
      Promise.resolve()
        .then(() => sendBackgroundMessage({ type: 'MOMENT_FRAMES_SCRIPT' }))
        .catch(() => { asked = false })
    }
    return () => removeEventListener(MOMENT_FRAMES_READY_EVENT, ready)
  }, [frames])
  return frames
}

/**
 * Where a moment's picture comes from: a few seconds before chat reacted, when
 * the moment has second-level timing, or across its minute when it has not.
 */
export function momentPictureView(kind: MomentPictureView['kind'], point: LiveHeatPoint): MomentPictureView {
  const onset = point.reactionOnsetOffsetSeconds
  if (!momentClockDisplay(point).approximate && onset != null) {
    return { kind, from: onset - 20, to: onset + 30, peak: onset - 3 }
  }
  return minutePictureView(kind, point.offsetSeconds)
}

export function minutePictureView(kind: MomentPictureView['kind'], offsetSeconds: number): MomentPictureView {
  return { kind, from: offsetSeconds - 10, to: offsetSeconds + 60, peak: offsetSeconds + 30 }
}

/** Fills the returned element with the picture of `view`, when this tab has frames for it. */
export function useMomentPicture<T extends HTMLElement>(view: MomentPictureView | undefined) {
  const frames = useMomentFrames()
  const ref = useRef<T>(null)
  const at = pictureAt
  const key = view ? `${view.kind} ${view.from} ${view.to} ${view.peak} ${at?.key}` : ''
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
