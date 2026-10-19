import type { MomentReference } from '../ui/library/model.ts'

export interface PlaybackSample { time: number; clock: number; source: unknown; active: boolean }
export function watchedProgress(start: number, end: number, source: unknown) {
  let previous: PlaybackSample | undefined
  let seconds = 0
  return (sample: PlaybackSample): 'stop' | 'watched' | 'pending' => {
    if (sample.source !== source || !Number.isFinite(sample.time) || sample.time < start || sample.time > end) return 'stop'
    if (previous && sample.active && previous.active) {
      const wall = (sample.clock - previous.clock) / 1000
      const media = sample.time - previous.time
      if (wall > 0 && wall <= 2 && media > 0 && media <= wall * 2.1) seconds += Math.min(wall, media)
    }
    previous = sample
    return seconds >= 10 ? 'watched' : 'pending'
  }
}
let cancel: (() => void) | undefined
/** What the video plays: its URL, or the object Twitch attaches through srcObject (currentSrc is then empty). */
const sourceOf = (video: HTMLVideoElement): unknown => video.currentSrc || video.srcObject
/**
 * Called only by an explicit, verified Pulse seek, or on arrival from a Pulse
 * Watch link. No page events can start capture.
 */
export async function observeMomentPlayback(video: HTMLVideoElement | null, reference: MomentReference, start: number, end: number,
  onRecorded?: () => void): Promise<void> {
  cancel?.()
  let cancelled = false
  cancel = () => { cancelled = true }
  if (!video || !Number.isFinite(start) || !Number.isFinite(end) || end - start < 10 || end - start > 120 || !sourceOf(video)) return
  const status = await chrome.runtime.sendMessage({ type: 'MOMENT_CAPTURE', action: 'status' }).catch(() => null)
  if (cancelled || !status?.enabled) return
  const source = sourceOf(video)
  const url = location.href
  const sample = watchedProgress(start, end, source)
  let entered = false
  const deadline = performance.now() + 180000
  const timer = setInterval(() => {
    if (!entered && video.currentTime >= start) entered = true
    if (!entered && video.currentTime >= start - 10 && sourceOf(video) === source && location.href === url && performance.now() < deadline && video.isConnected && !cancelled) return
    const result = sample({ time: video.currentTime, clock: performance.now(), source: sourceOf(video),
      active: !document.hidden && !video.paused && !video.seeking && video.readyState >= 3 })
    if (cancelled || !video.isConnected || location.href !== url || performance.now() >= deadline || result === 'stop' || result === 'watched') {
      clearInterval(timer)
      if (!cancelled && video.isConnected && location.href === url && result === 'watched') {
        void chrome.runtime.sendMessage({ type: 'MOMENT_CAPTURE', action: 'record', epoch: status.epoch, reference, watchedSeconds: 10 })
          .then(result => { if (result?.ok === true) onRecorded?.() }).catch(() => undefined)
      }
    }
  }, 500)
  cancel = () => { cancelled = true; clearInterval(timer) }
}
