/**
 * The session page's highlight reel (recap-r1 concept C1; Aron 2026-10-16: "i like the highlight wheel quite a
 * bit"): the top three moments as pictures, #1 large and #2, #3 side by side, on the strip's own ranking (pin N
 * is card N). The rest stay rows (SessionRecapMomentsStrip).
 *
 * Each picture is the moment's VOD preview frame (a Twitch storyboard tile, AC/utils/vodFrames.ts) from the tile
 * that holds the moment's minute, so it is near the moment, never the exact second. Moving the pointer across a
 * picture steps through the tiles either side (when the answer says how far apart they are). Without a frame:
 * the game's blurred box art, never a stand-in or a live frame.
 *
 * Evidence follows F8: the backend reason label and reaction score, no client "× usual".
 * A card is the row's toggle (`aria-pressed`, `data-moment-row`): a click locks the moment on the chart, the
 * same card again releases it, and the round play button locks it and asks the page to play.
 * Styles: WEB/src/ui/charts/sp-session-rows.css (`.ssr-reel`, `.ssr-rc*`).
 */
import { Fragment, useEffect, useRef, useState } from 'react'
import { momentRowHms } from '../../utils/momentRowDisplay.ts'
import {
  frameBackgroundStyle,
  frameTimingPhrase,
  loadVodFrame,
  peekVodFrame,
  useVodFrame,
  type VodFrame,
} from '../../utils/vodFrames.ts'
import { MomentPlayIcon, SessionMomentToken, type SessionMomentRowModel } from './MomentRow.tsx'

/** How many tiles a scrub reaches either side of the moment's own. */
export const REEL_SCRUB_TILES = 3
/** The reel holds the top three moments (Aron 2026-10-15: "show at most the top 3 moments"). */
export const REEL_SIZE = 3

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

const clamp = (value: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, value))

/** "4 min 9 s", "1 min", "30 s". */
export function reelIntervalLabel(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const m = Math.floor(total / 60)
  const s = total % 60
  if (!m) return `${s} s`
  return s ? `${m} min ${s} s` : `${m} min`
}

/** The VOD tile offsets a scrub can reach, nearest first (the moment's own tile excluded). */
export function reelScrubOffsets(baseVodOffset: number, intervalSec: number): number[] {
  const out: number[] = []
  for (let k = 1; k <= REEL_SCRUB_TILES; k += 1) {
    out.push(baseVodOffset + k * intervalSec)
    if (baseVodOffset - k * intervalSec >= 0) out.push(baseVodOffset - k * intervalSec)
  }
  return out
}

/** The tile step under a pointer position (0 = left edge, 1 = right edge): −3 … +3. */
export function reelScrubStep(position: number): number {
  return Math.round((clamp(position, 0, 1) - 0.5) * 2 * REEL_SCRUB_TILES)
}

export interface MomentReelCardProps {
  model: SessionMomentRowModel
  size: 'hero' | 'small'
  /** The game's box art: the backdrop under (or instead of) the frame. */
  artUrl: string | null
  locked: boolean
  /** A chart pin for this moment is under the pointer. */
  ghost?: boolean
  showPlay: boolean
  /** Changes each time this card becomes the locked one: plays the lock glow once. */
  pop?: number
  vodId: string | null
  /** The VOD second whose tile is the picture (the middle of the moment's minute); null = no frame to ask for. */
  frameVodOffset: number | null
  /** The moment's own start on the VOD's clock (the frame note's "from about N s before the moment"). */
  momentVodStart: number | null
  /** VOD time = stream time + this; the hover chip shows the tile's start on the stream's clock. */
  alignSeconds: number | null
  onActivate: (play: boolean) => void
  onHover?: (hovering: boolean) => void
  onArtError?: (url: string) => void
}

export function MomentReelCard({
  model,
  size,
  artUrl,
  locked,
  ghost = false,
  showPlay,
  pop = 0,
  vodId,
  frameVodOffset,
  momentVodStart,
  alignSeconds,
  onActivate,
  onHover,
  onArtError,
}: MomentReelCardProps) {
  const hero = size === 'hero'
  const ref = useRef<HTMLButtonElement | null>(null)
  const base = useVodFrame(vodId, frameVodOffset)
  const frame = base.result?.frame ?? null
  const step = frame?.intervalSec ?? null
  const canScrub = Boolean(vodId && frame && step && frameVodOffset != null)
  const [scrub, setScrub] = useState<{ position: number; frame: VodFrame } | null>(null)
  const want = useRef<number | null>(null)
  const [popDone, setPopDone] = useState(0)

  // A new moment (or VOD) under this card drops a scrub in progress.
  useEffect(() => {
    want.current = null
    setScrub(null)
  }, [vodId, frameVodOffset])

  const shown = scrub?.frame ?? frame
  const chip = shown && shown.fromSec != null && alignSeconds != null
    ? `≈ ${momentRowHms(Math.max(0, shown.fromSec - alignSeconds))}`
    : null
  const frameNote = frame ? frameTimingPhrase(frame, momentVodStart, 'moment') : null
  const showPop = pop > 0 && pop !== popDone && locked && !prefersReducedMotion()

  function scrubAt(clientX: number) {
    const box = ref.current?.getBoundingClientRect()
    if (!canScrub || !vodId || frameVodOffset == null || !step || !frame || !box?.width) return
    const position = clamp((clientX - box.left) / box.width, 0, 1)
    const target = Math.max(0, frameVodOffset + reelScrubStep(position) * step)
    want.current = target
    const hit = peekVodFrame(vodId, target)?.frame
    if (hit) {
      setScrub({ position, frame: hit })
      return
    }
    // Keep the last picture until the tile is in; a tile past the VOD's end keeps it.
    setScrub((current) => ({ position, frame: current?.frame ?? frame }))
    void loadVodFrame(vodId, target).then((result) => {
      const next = result.frame
      if (want.current !== target || !next) return
      setScrub((current) => (current ? { position: current.position, frame: next } : current))
    })
  }

  const className = [
    'ssr-rc',
    hero ? 'ssr-rc--hero' : 'ssr-rc--sm',
    shown ? 'has-fr' : artUrl ? 'has-art' : '',
    locked ? 'lk sc-moment-row-selected' : '',
    ghost ? 'ghost' : '',
    scrub ? 'scrubbing' : '',
  ].filter(Boolean).join(' ')
  const score = model.score == null ? null : (
    <span className="ssr-sc" title="Reaction score in this stream">
      <span className="ssr-vh">reaction</span>{' '}score <b>{model.score}</b>{' '}
      <span className="ssr-vh">in this stream</span>
    </span>
  )

  return (
    <button
      ref={ref}
      type="button"
      className={className}
      data-moment-row
      data-moment-card={size}
      data-moment-rank={model.rank}
      data-moment-offset={model.offsetSeconds}
      data-moment-frame={shown ? 'frame' : base.loading ? 'loading' : 'fallback'}
      aria-pressed={locked}
      onClick={(event) => {
        const target = event.target as Element | null
        onActivate(Boolean(target?.closest?.('[data-moment-row-play]')))
      }}
      onPointerEnter={(event) => {
        onHover?.(true)
        if (event.pointerType === 'touch' || !canScrub || !vodId || frameVodOffset == null || !step) return
        for (const offset of reelScrubOffsets(frameVodOffset, step)) void loadVodFrame(vodId, offset)
      }}
      onPointerMove={(event) => {
        if (event.pointerType !== 'touch') scrubAt(event.clientX)
      }}
      onPointerLeave={() => {
        want.current = null
        setScrub(null)
        onHover?.(false)
      }}
      onFocus={() => onHover?.(true)}
      onBlur={() => onHover?.(false)}
    >
      <span className="ssr-rc-pic" aria-hidden="true">
        {artUrl ? (
          <img
            className="ssr-rc-art"
            src={artUrl}
            alt=""
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => onArtError?.(artUrl)}
          />
        ) : null}
        {shown ? <span className="ssr-rc-fr" style={frameBackgroundStyle(shown)} data-moment-card-frame /> : null}
      </span>
      {canScrub ? (
        <span className="ssr-rc-bar" aria-hidden="true">
          <i style={{ left: `${((scrub?.position ?? 0.5) * 100).toFixed(1)}%` }} />
        </span>
      ) : null}
      {chip ? <span className="ssr-rc-at" aria-hidden="true">{chip}</span> : null}
      <span className="ssr-rc-top">
        <span className="ssr-vh">Moment</span>{' '}
        <span className="ssr-rk">{model.rank}</span>
      </span>{' '}
      <span className="ssr-rc-cap">
        <span className="ssr-rc-l1">
          <span className="ssr-off">{model.offsetLabel}</span>{' '}
          {hero && model.clockLabel ? <><span className="ssr-clk">{model.clockLabel}</span>{' '}</> : null}
          {hero && model.game ? <><span className="ssr-rc-gm">{model.game.name}</span>{' '}</> : null}
          {hero ? null : score}
        </span>{' '}
        <span className="ssr-rc-l2">
          <span className={`ssr-why ${model.reasonTone}`}>
            <i aria-hidden="true" />
            {model.reasonLabel}
          </span>{' '}
          {hero ? score : null}
        </span>
        {hero ? (
          <>
            {' '}
            <span className="ssr-rc-l3">
              {model.namesNotCaptured ? (
                <span className="ssr-nn" title={model.namesNotCaptured}>emote names not captured</span>
              ) : model.emotes.length > 0 ? (
                <span
                  className="ssr-toks"
                  title={model.snapshotOnly
                    ? 'No measured minute lines up with this detection, so the emotes come from the detection window itself.'
                    : undefined}
                >
                  {model.emotes.slice(0, 3).map((emote, index) => (
                    <Fragment key={`${emote.key ?? emote.name}-${index}`}>
                      {index > 0 ? ' ' : null}
                      <SessionMomentToken emote={emote} />
                    </Fragment>
                  ))}
                </span>
              ) : null}
            </span>
          </>
        ) : null}
      </span>
      {frameNote ? <span className="ssr-vh">{` Preview frame ${frameNote}.`}</span> : null}
      {showPlay ? (
        <span className="ssr-go" aria-hidden="true" data-moment-row-play>
          <MomentPlayIcon />
        </span>
      ) : null}
      {showPop ? (
        <span
          key={pop}
          className="ssr-mpop"
          aria-hidden="true"
          data-moment-row-pop
          onAnimationEnd={() => setPopDone(pop)}
        />
      ) : null}
    </button>
  )
}

/** The line under the reel: what the pictures are (null while the answer is out, or with no pictures at all). */
export function reelNote(args: {
  frame: VodFrame | null
  reason: string | null
  loading: boolean
  hasArt: boolean
}): string | null {
  const { frame, reason, loading, hasArt } = args
  if (loading) return null
  if (frame) {
    return frame.intervalSec
      ? `Pictures are Twitch's VOD preview frames, one every ${reelIntervalLabel(frame.intervalSec)}. Move across one to step through them.`
      : "Pictures are Twitch's VOD preview frames from near each moment, not the exact second."
  }
  if (reason === 'recording') return 'Twitch publishes preview frames when the VOD finishes.'
  return hasArt ? "Pictures are the game's box art: no VOD preview frames for this stream." : null
}
