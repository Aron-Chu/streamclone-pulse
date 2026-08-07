/**
 * Evidence returned by a Twitch player seek attempt.
 *
 * Assigning HTMLMediaElement.currentTime is not evidence that Twitch loaded
 * the requested HLS segment. Callers should only show a success notice when
 * this result is ok.
 */
export type JumpSeekConfirmationReason =
  | 'played'
  | 'paused_seeked'
  | 'timeout'
  | 'stalled'
  | 'media_error'
  | 'video_replaced'

export interface JumpSeekConfirmation {
  ok: boolean
  reason: JumpSeekConfirmationReason
  elapsedMs: number
  events: string[]
  progressSeconds: number
}

export interface ConfirmJumpSeekOptions {
  /** Maximum time to wait for seek and playback evidence. */
  timeoutMs?: number
  /** Time that was observed before assigning currentTime. */
  baselineSeconds?: number | null
  /** Whether the user had deliberately paused the player before the seek. */
  wasPaused?: boolean
  /** Returns false when Twitch replaced the original video element. */
  isCurrentVideo?: () => boolean
  /** Minimum movement after reaching the target before declaring playback. */
  minProgressSeconds?: number
  /** How long Twitch may buffer at the requested point before it is a stall. */
  stallGraceMs?: number
  /** Perform the actual currentTime assignment after listeners are attached. */
  beforeSeek?: () => boolean
}

const MEDIA_EVENTS = [
  'seeking',
  'seeked',
  'timeupdate',
  'playing',
  'canplay',
  'loadeddata',
  'waiting',
  'stalled',
  'error',
  'emptied',
] as const

const TARGET_TOLERANCE_SECONDS = 2

function finite(value: number): number | null {
  return Number.isFinite(value) ? value : null
}

function readyForData(video: HTMLVideoElement): boolean {
  // HAVE_CURRENT_DATA (2) is enough to render the requested frame. A Twitch
  // player may report HAVE_FUTURE_DATA (3) only after it has already begun
  // playing, so requiring 2 avoids false negatives without accepting an empty
  // media element.
  return video.readyState >= 2
}

/**
 * Confirm that a seek actually reached usable media and, when playback was
 * active, that the media clock advanced. A `currentTime` assignment alone is
 * intentionally never sufficient.
 */
export function confirmJumpSeek(
  video: HTMLVideoElement | null,
  targetSeconds: number,
  options: ConfirmJumpSeekOptions = {},
): Promise<JumpSeekConfirmation> {
  const timeoutMs = Math.max(250, options.timeoutMs ?? 6_000)
  const minProgressSeconds = Math.max(0.1, options.minProgressSeconds ?? 0.35)
  const stallGraceMs = Math.max(250, options.stallGraceMs ?? Math.min(5_000, timeoutMs - 250))
  const baseline = finite(options.baselineSeconds ?? Number.NaN)
  const wasPaused = options.wasPaused ?? Boolean(video?.paused)

  if (!video || !Number.isFinite(targetSeconds)) {
    return Promise.resolve({
      ok: false,
      reason: 'timeout',
      elapsedMs: 0,
      events: [],
      progressSeconds: 0,
    })
  }

  return new Promise(resolve => {
    const startedAt = performance.now()
    const events: string[] = []
    let finished = false
    let timer: ReturnType<typeof setInterval> | null = null
    let deadline: ReturnType<typeof setTimeout> | null = null
    let targetReached = false
    let targetReachedAt = 0
    let targetReachedTime = 0
    let stalledAt = 0
    let sawFrameEvidence = false
    // Prefer the post-assignment media clock so the seek itself is not
    // mistaken for playback progress. The baseline is only a fallback for
    // unusual media elements that temporarily report a non-finite time.
    let lastTime = finite(video.currentTime) ?? baseline ?? 0
    let progressSeconds = 0

    const isAtTarget = (): boolean => {
      const currentTime = finite(video.currentTime)
      return currentTime != null && Math.abs(currentTime - targetSeconds) <= TARGET_TOLERANCE_SECONDS
    }

    const finish = (ok: boolean, reason: JumpSeekConfirmationReason) => {
      if (finished) return
      finished = true
      if (timer != null) clearInterval(timer)
      if (deadline != null) clearTimeout(deadline)
      for (const name of MEDIA_EVENTS) {
        video.removeEventListener(name, onEvent)
      }
      resolve({
        ok,
        reason,
        elapsedMs: Math.round(performance.now() - startedAt),
        events,
        progressSeconds: Math.round(progressSeconds * 100) / 100,
      })
    }

    const check = () => {
      if (finished) return
      if (options.isCurrentVideo && !options.isCurrentVideo()) {
        finish(false, 'video_replaced')
        return
      }
      if (video.isConnected === false) {
        finish(false, 'video_replaced')
        return
      }

      const currentTime = finite(video.currentTime)
      if (currentTime == null) return
      progressSeconds = Math.max(progressSeconds, Math.abs(currentTime - lastTime))
      lastTime = currentTime

      // Twitch can accept a seek assignment, emit `seeked`, then snap the MSE
      // element back to the live edge (or the prior position). Once the clock
      // leaves the target tolerance, invalidate that attempt so later motion
      // cannot be mistaken for playback at the requested point.
      if (targetReached && Math.abs(currentTime - targetSeconds) > TARGET_TOLERANCE_SECONDS) {
        targetReached = false
        targetReachedAt = 0
        stalledAt = 0
        sawFrameEvidence = false
      }

      if (!targetReached && isAtTarget() && !video.seeking) {
        targetReached = true
        targetReachedAt = performance.now()
        targetReachedTime = currentTime
      }

      if (!targetReached || !readyForData(video) || !sawFrameEvidence) return

      if (stalledAt > 0 && performance.now() - stalledAt >= stallGraceMs) {
        finish(false, 'stalled')
        return
      }

      // If the user intentionally paused the player, a seeked event plus a
      // usable frame is the strongest evidence available. Do not force a
      // paused viewer to start playback just to prove a jump.
      if (wasPaused) {
        finish(true, 'paused_seeked')
        return
      }

      // A seek can land on the requested timestamp while Twitch is still
      // buffering. Require the media clock to move after landing and ensure
      // the element has not become paused.
      const advancedAfterTarget = currentTime - targetReachedTime >= minProgressSeconds
      if (advancedAfterTarget && !video.paused) {
        finish(true, 'played')
      } else if (performance.now() - targetReachedAt >= timeoutMs) {
        finish(false, 'timeout')
      }
    }

    function onEvent(event: Event) {
      events.push(event.type)
      if (event.type === 'seeked' || event.type === 'canplay' || event.type === 'loadeddata') {
        sawFrameEvidence = true
      }
      if (event.type === 'waiting' || event.type === 'stalled') {
        // Keep waiting/stalled in the event trace and allow a short recovery
        // window before surfacing a stalled result.
        if (targetReached && stalledAt === 0) stalledAt = performance.now()
        check()
        return
      }
      if (event.type === 'playing') stalledAt = 0
      if (event.type === 'error' || event.type === 'emptied') {
        finish(false, 'media_error')
        return
      }
      check()
    }

    for (const name of MEDIA_EVENTS) {
      video.addEventListener(name, onEvent)
    }
    if (options.beforeSeek && !options.beforeSeek()) {
      finish(false, 'timeout')
      return
    }
    timer = setInterval(check, 50)
    deadline = setTimeout(() => finish(false, 'timeout'), timeoutMs)
    // The caller normally invokes this immediately after setting currentTime.
    // Run one observation for already-fired events, but never accept merely
    // being at the target without seek/playback evidence.
    check()
  })
}
