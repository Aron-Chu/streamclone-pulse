import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'

/**
 * The player box beside the demo panel.
 *
 * There is no footage. It is a `<video>` with no source, under a drawn frame
 * that shows the sample channel and a clock. The panel finds this element the
 * way it finds Twitch's player (getPrimaryVideo) and seeks it with the
 * extension's own code: on a video with no media the browser keeps the time it
 * is given, so a jump "lands" and this box shows where.
 */

export interface DemoPlayerGame {
  gameName: string
  offsetSeconds: number
  durationSeconds: number
}

export interface DemoPlayerProps {
  channelName: string
  title: string
  durationSeconds: number
  games: readonly DemoPlayerGame[]
  /** Where the clock starts. */
  startSeconds: number
  /** Advance the clock only while the demo is on screen. */
  active: boolean
}

export interface DemoPlayerHandle {
  video: HTMLVideoElement | null
}

const TICK_MS = 250
/** A change bigger than this between ticks is a seek, not playback. */
const SEEK_GAP_SECONDS = 2

export function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function gameAt(games: readonly DemoPlayerGame[], seconds: number): string {
  const game = games.find(g => seconds >= g.offsetSeconds && seconds < g.offsetSeconds + g.durationSeconds)
  return game?.gameName ?? games[games.length - 1]?.gameName ?? ''
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

export const DemoPlayer = forwardRef<DemoPlayerHandle, DemoPlayerProps>(function DemoPlayer(
  { channelName, title, durationSeconds, games, startSeconds, active },
  ref,
) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [time, setTime] = useState(startSeconds)
  // Reduced motion: the clock waits for Play rather than running on its own.
  const [playing, setPlaying] = useState(() => !prefersReducedMotion())
  const [jumpedTo, setJumpedTo] = useState<number | null>(null)
  const lastRead = useRef(startSeconds)

  useImperativeHandle(ref, () => ({ video: videoRef.current }), [])

  useEffect(() => {
    const video = videoRef.current
    if (video) video.currentTime = startSeconds
    lastRead.current = startSeconds
  }, [startSeconds])

  useEffect(() => {
    if (!active) return
    let last = performance.now()
    const timer = window.setInterval(() => {
      const video = videoRef.current
      if (!video) return
      const now = performance.now()
      const elapsed = (now - last) / 1000
      last = now
      let current = Number.isFinite(video.currentTime) ? video.currentTime : lastRead.current
      if (Math.abs(current - lastRead.current) > SEEK_GAP_SECONDS) {
        // Something else moved the player: the panel's Jump.
        setJumpedTo(current)
      } else if (playing && current < durationSeconds) {
        current = Math.min(durationSeconds, current + elapsed)
        video.currentTime = current
      }
      lastRead.current = current
      setTime(current)
    }, TICK_MS)
    return () => window.clearInterval(timer)
  }, [active, playing, durationSeconds])

  useEffect(() => {
    if (jumpedTo === null) return
    const timer = window.setTimeout(() => setJumpedTo(null), 2600)
    return () => window.clearTimeout(timer)
  }, [jumpedTo])

  const seekTo = (seconds: number) => {
    const video = videoRef.current
    if (!video) return
    const next = Math.max(0, Math.min(durationSeconds, seconds))
    video.currentTime = next
    lastRead.current = next
    setTime(next)
  }

  const progress = durationSeconds > 0 ? Math.min(1, time / durationSeconds) : 0
  const game = gameAt(games, time)

  return (
    <div className="xd-player" data-testid="demo-player">
      <div className="xd-player__screen">
        {/* No source on purpose: see the comment at the top of this file. */}
        <video ref={videoRef} className="xd-player__video" muted playsInline preload="none" aria-hidden="true" tabIndex={-1} />
        <div className="xd-player__frame" aria-hidden="true">
          <span className="xd-player__badge">Sample stream</span>
          <span className="xd-player__game">{game}</span>
          <span className="xd-player__clock" data-testid="demo-player-clock">{formatClock(time)}</span>
          <span className="xd-player__nofootage">No footage in the demo. The player keeps time, so the panel&apos;s jumps land here.</span>
        </div>
        {jumpedTo !== null ? (
          <div className="xd-player__jump" role="status" data-testid="demo-player-jump">
            Jumped to {formatClock(jumpedTo)}
          </div>
        ) : null}
      </div>
      <div className="xd-player__bar">
        <button
          type="button"
          className="xd-player__play"
          onClick={() => setPlaying(p => !p)}
          aria-label={playing ? 'Pause the sample clock' : 'Play the sample clock'}
          aria-pressed={playing}
        >
          {playing ? (
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><rect x="3" y="2" width="3.5" height="12" rx="1" fill="currentColor" /><rect x="9.5" y="2" width="3.5" height="12" rx="1" fill="currentColor" /></svg>
          ) : (
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4 2.5v11a.7.7 0 0 0 1.05.6l9-5.5a.7.7 0 0 0 0-1.2l-9-5.5A.7.7 0 0 0 4 2.5z" fill="currentColor" /></svg>
          )}
        </button>
        <input
          className="xd-player__seek"
          type="range"
          min={0}
          max={durationSeconds}
          step={1}
          value={Math.floor(time)}
          onChange={event => seekTo(Number(event.currentTarget.value))}
          aria-label="Sample stream position"
          aria-valuetext={formatClock(time)}
          style={{ ['--xd-progress' as string]: `${progress * 100}%` }}
        />
        <span className="xd-player__time">
          {formatClock(time)} <span aria-hidden="true">/</span><span className="sr-only"> of </span> {formatClock(durationSeconds)}
        </span>
      </div>
      <div className="xd-player__info">
        <span className="xd-player__avatar" aria-hidden="true">PD</span>
        <div className="xd-player__meta">
          <strong>{channelName}</strong>
          <span>{title}</span>
          <span className="xd-player__cat">{game} · Past broadcast</span>
        </div>
      </div>
    </div>
  )
})
