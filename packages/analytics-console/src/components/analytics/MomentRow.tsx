import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { momentRankAccent, momentReasonChipTone } from '../../utils/momentListDisplay.tsx'
import { boxArtAtSize } from '../../utils/boxArtSize.ts'
import { count, getEmoteImageUrl } from '../../utils/consoleFormat.ts'
import {
  momentRowHms,
  momentRowInt,
  momentRowTwitchTime,
  type MomentRowSeries,
  type MomentRowSparkBar,
} from '../../utils/momentRowDisplay.ts'
import { alignedVodOffset, buildTwitchVodUrl } from '../../utils/twitchVodUrl.ts'
import { ConsoleEmoteImg } from './ConsoleEmoteImg.tsx'
import { PREVIEW_PLAYER_LOADS_COPY, previewMissLine } from './MomentPreviewTile.tsx'
import { MomentRowSpark, momentRowSparkNote } from './MomentRowSpark.tsx'

export interface MomentRowEmote {
  name: string
  count: number
  provider?: string
  id?: string
  imageUrl?: string
  /** Canonical `provider:id` key when the source row carries one. */
  key?: string
}

export interface MomentRowModel {
  key: string
  /** 1-based rank within the visible list. */
  rank: number
  primaryTime: string
  secondaryTime?: string | null
  score: number
  /** Score as a fraction of the top-ranked moment in this list. */
  scoreRatio: number
  reasonLabel: string
  reasonCode: string
  statsLine: string
  /** True when the row describes the detection window, not a measured minute. */
  snapshotOnly?: boolean
  /** Extra provenance appended to the row tooltip, e.g. an estimated score. */
  scoreNote?: string
  emotes: MomentRowEmote[]
}

/**
 * Reaction intensity relative to this stream's own top moment.
 *
 * The raw Pulse score is out of 100 but is not a grade — a stream whose loudest
 * minute scores 49 still has a loudest minute. Rendering `49/100` made the top
 * row read as a failure, so the bar is scaled to the list maximum and the raw
 * number stays available but de-emphasised.
 */
function MomentIntensityBar({ ratio, score }: { ratio: number; score: number }) {
  const clamped = Math.max(0, Math.min(1, ratio))
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <span
        aria-hidden="true"
        className="relative block h-1.5 w-10 overflow-hidden rounded-full bg-white/[0.08]"
      >
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-amber-400/70"
          style={{ width: `${Math.max(6, clamped * 100)}%` }}
        />
      </span>
      <span className="w-5 text-right text-xs font-black tabular-nums text-zinc-500">
        {score}
      </span>
    </span>
  )
}

/**
 * The one moment row design. Both the recap-backed rail list and the
 * rollup-backed fallback list render through this so a moment never looks like
 * two different things depending on which data path produced it.
 */
export function MomentRow({
  model,
  selected,
  previewed = false,
  expanded = false,
  onSelect,
  onPreview,
}: {
  model: MomentRowModel
  selected: boolean
  previewed?: boolean
  expanded?: boolean
  onSelect: () => void
  onPreview?: (hovering: boolean) => void
}) {
  const reasonTone = momentReasonChipTone(model.reasonCode)
  const tone = selected
    ? 'border-amber-500/25 bg-amber-500/10 ring-1 ring-amber-400/15'
    : previewed
      ? 'border-amber-300/20 bg-amber-500/[0.05]'
      : 'border-white/[0.07] bg-white/[0.028] hover:bg-white/[0.04]'

  return (
    <button
      type="button"
      data-moment-row
      data-moment-rank={model.rank}
      aria-expanded={expanded}
      aria-current={selected ? 'true' : undefined}
      onClick={onSelect}
      onMouseEnter={() => onPreview?.(true)}
      onMouseLeave={() => onPreview?.(false)}
      onFocus={() => onPreview?.(true)}
      onBlur={() => onPreview?.(false)}
      title={`${model.reasonLabel} · Pulse reaction score ${model.score} of 100 — ranks reactions, not clip quality${
        model.scoreNote ? ` · ${model.scoreNote}` : ''
      }`}
      className={`flex w-full flex-col gap-1 rounded border px-2 py-1.5 text-left text-xs transition-colors ${tone}${
        selected ? ' sc-moment-row-selected' : ''
      }`}
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            className={`inline-flex h-4 min-w-[1.25rem] shrink-0 items-center justify-center rounded px-1 text-xs font-black tabular-nums ${momentRankAccent(model.rank - 1).badge}`}
          >
            #{model.rank}
          </span>
          <span className="font-mono text-xs font-bold tabular-nums text-zinc-300">
            {model.primaryTime}
          </span>
          {model.secondaryTime ? (
            <span className="truncate text-xs font-semibold text-zinc-600">
              {model.secondaryTime}
            </span>
          ) : null}
        </span>
        <MomentIntensityBar ratio={model.scoreRatio} score={model.score} />
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-1">
        <span
          className={`inline-flex max-w-full shrink-0 truncate rounded border px-1.5 py-0.5 text-xs font-black uppercase ${reasonTone.chip}`}
        >
          {model.reasonLabel}
        </span>
        {model.snapshotOnly ? (
          <span
            title="No measured minute lines up with this detection, so the numbers come from the detection window itself."
            className="inline-flex shrink-0 rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-xs font-black uppercase text-zinc-500"
          >
            Snapshot
          </span>
        ) : null}
      </div>

      <div className="min-w-0 truncate text-xs font-semibold tabular-nums text-zinc-500">
        {model.statsLine}
      </div>

      {model.emotes.length > 0 ? (
        <div className="flex min-w-0 items-center gap-1">
          {model.emotes.map((emote, emoteIndex) => (
            <span
              key={`${model.key}-${emote.key ?? emote.name}-${emoteIndex}`}
              title={`${emote.name}: ${count(emote.count)} uses`}
              aria-label={`${emote.name}: ${count(emote.count)} uses`}
              className="inline-flex shrink-0 items-center gap-1 rounded border border-white/10 bg-black/25 py-0.5 pl-0.5 pr-1.5"
            >
              <ConsoleEmoteImg
                src={getEmoteImageUrl(emote)}
                name={emote.name}
                width={14}
                height={14}
                className="h-3.5 w-3.5 shrink-0 object-contain"
                fallbackClassName="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded bg-white/[0.06] text-xs font-black text-zinc-500"
              />
              <span className="text-xs font-bold tabular-nums text-zinc-500">
                {count(emote.count)}
              </span>
            </span>
          ))}
        </div>
      ) : null}
    </button>
  )
}

/** Shared legend so the intensity bar is never an unexplained decoration. */
export function MomentListLegend() {
  return (
    <p className="text-xs font-semibold text-zinc-600">
      Select a moment to review its minute and watch the source. The bar shows reaction
      intensity relative to this stream&rsquo;s loudest moment — Pulse ranks reactions, not
      clip quality.
    </p>
  )
}

// ---------------------------------------------------------------------------
// Session moment rows: the d3-v2 session-original rows (moment-rows.js and
// session-original.css "moment rows", 2026-10-15), styled by
// streampulse-web/src/ui/charts/sp-session-rows.css (`ssr-` classes) and
// analytics-chart-motion.css (the lock glow). The figures are the backend's:
// rank, reason and reaction score from the recap, rate and spark from the
// measured minutes. No client "× usual" (F8).
//
// The row's backdrop is the moment's VOD frame in the mockup. The rows load
// no frames (F6), so they draw no backdrop: the game's small cover by its name
// is the only picture (candidate, 10-30, PIC-2). The blurred, zoomed box art
// that stood in until 10-30 read as a broken preview (Aron 10-21: "why is
// everything blurred"). Never a live frame, never a stand-in. Frames on the
// rows (PIC-6) are not wired: they would slot in where `.ssr-fr` was.
// ---------------------------------------------------------------------------

/** The row player starts this many seconds before the moment. */
export const MOMENT_ROW_VOD_LEAD_SECONDS = 10

export interface SessionMomentRowModel {
  key: string
  /** 1-based rank in the strip (pin N is row N). */
  rank: number
  /** The moment's analytical offset: the row's identity. */
  offsetSeconds: number
  /** "0:50:54" */
  offsetLabel: string
  /** "6:37 AM", weekday first on another day. */
  clockLabel: string | null
  reasonLabel: string
  reasonTone: 'emotes' | 'chat' | 'other'
  series: MomentRowSeries
  /** Backend reaction score, rounded (reactionScore, else score). */
  score: number | null
  /** The measured minute's rate on `series`; null without an exact minute. */
  rate: number | null
  spark: MomentRowSparkBar[]
  game: { name: string; artUrls: string[] } | null
  emotes: MomentRowEmote[]
  /** Title of "names not in this update", when the minute names under 25 % of its uses. */
  namesNotCaptured: string | null
  /** No measured minute lines up: the emotes come from the detection snapshot. */
  snapshotOnly: boolean
}

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

export function MomentPlayIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M8 5.6v12.8a.8.8 0 0 0 1.2.7l10.2-6.4a.8.8 0 0 0 0-1.4L9.2 4.9A.8.8 0 0 0 8 5.6z" fill="currentColor" />
    </svg>
  )
}

/** One emote token (image, name, uses): the rows and the reel. */
export function SessionMomentToken({ emote }: { emote: MomentRowEmote }) {
  const src = getEmoteImageUrl(emote)
  return (
    <span className="ssr-tok" title={`${emote.name}: ${momentRowInt(emote.count)} uses`}>
      {src ? (
        <ConsoleEmoteImg
          src={src}
          name={emote.name}
          width={20}
          height={20}
          className="ssr-tok-img"
          fallbackClassName="ssr-tok-img ssr-tok-ini"
        />
      ) : null}
      {' '}<span className="ssr-tok-c">{emote.name}</span>{' '}
      <span className="ssr-tok-n">{momentRowInt(emote.count)}</span>
    </span>
  )
}

/**
 * One session moment row (moment-rows.js rowHtml). `lockMode="strip"`: a
 * toggle button (`aria-pressed`) that locks the moment on the chart.
 * `lockMode="row"`: a disclosure (`aria-expanded`) whose detail opens in place.
 */
export function SessionMomentRow({
  model,
  artUrl,
  lockMode,
  locked,
  expanded = false,
  detailId,
  ghost = false,
  showPlay,
  pop = 0,
  onActivate,
  onHover,
  onArtError,
}: {
  model: SessionMomentRowModel
  /** The game's box art, the small cover by its name; null draws none. */
  artUrl: string | null
  lockMode: 'strip' | 'row'
  /** The moment the chart's selection holds: ring + filled rank. */
  locked: boolean
  expanded?: boolean
  detailId?: string
  /** A chart pin for this moment is under the pointer. */
  ghost?: boolean
  showPlay: boolean
  /** Changes each time this row becomes the locked one: plays the 0.34 s glow once. */
  pop?: number
  onActivate: (play: boolean) => void
  onHover?: (hovering: boolean) => void
  onArtError?: (url: string) => void
}) {
  // no blurred backdrop, no hover dwell to light it (candidate, 10-30, PIC-2)
  const [popDone, setPopDone] = useState(0)

  const showPop = pop > 0 && pop !== popDone && locked && !prefersReducedMotion()
  const className = [
    'ssr-row',
    locked ? 'lk sc-moment-row-selected' : '',
    ghost ? 'ghost' : '',
  ].filter(Boolean).join(' ')

  return (
    <button
      type="button"
      className={className}
      data-moment-row
      data-moment-rank={model.rank}
      data-moment-offset={model.offsetSeconds}
      aria-pressed={lockMode === 'strip' ? locked : undefined}
      aria-expanded={lockMode === 'row' ? expanded : undefined}
      aria-controls={lockMode === 'row' && expanded && detailId ? detailId : undefined}
      aria-current={lockMode === 'row' && locked ? 'true' : undefined}
      onClick={(event) => {
        const target = event.target as Element | null
        onActivate(Boolean(target?.closest?.('[data-moment-row-play]')))
      }}
      onPointerEnter={() => onHover?.(true)}
      onPointerLeave={() => onHover?.(false)}
      onFocus={() => onHover?.(true)}
      onBlur={() => onHover?.(false)}
    >
      <span className="ssr-tx">
        <span className="ssr-m1">
          <span className="ssr-vh">Moment</span>{' '}
          <span className="ssr-rk">{model.rank}</span>{' '}
          <span className="ssr-off">{model.offsetLabel}</span>{' '}
          {model.clockLabel ? <><span className="ssr-clk">{model.clockLabel}</span>{' '}</> : null}
          <span className={`ssr-why ${model.reasonTone}`}>
            <i aria-hidden="true" />
            {model.reasonLabel}
          </span>{' '}
          {model.score == null ? null : (
            <span className="ssr-sc" title="Reaction score in this stream">
              <span className="ssr-vh">reaction</span>{' '}score <b>{model.score}</b>{' '}
              <span className="ssr-vh">in this stream</span>
            </span>
          )}
        </span>
        <span className="ssr-m2">
          {model.game ? (
            <span className="ssr-gm">
              {artUrl ? (
                <img
                  src={boxArtAtSize(artUrl, 30, 40)}
                  alt=""
                  width={15}
                  height={20}
                  decoding="async"
                  referrerPolicy="no-referrer"
                  onError={() => onArtError?.(artUrl)}
                />
              ) : null}
              <span className="ssr-gm-n">{model.game.name}</span>
            </span>
          ) : null}{' '}
          {model.namesNotCaptured ? (
            <span className="ssr-nn" title={model.namesNotCaptured}>names not in this update</span>
          ) : model.emotes.length > 0 ? (
            <span
              className="ssr-toks"
              title={model.snapshotOnly
                ? 'No measured minute lines up with this detection, so the emotes come from the detection window itself.'
                : undefined}
            >
              {model.emotes.map((emote, index) => (
                <Fragment key={`${emote.key ?? emote.name}-${index}`}>
                  {index > 0 ? ' ' : null}
                  <SessionMomentToken emote={emote} />
                </Fragment>
              ))}
            </span>
          ) : null}
        </span>
      </span>{' '}
      <span className="ssr-ev" title={momentRowSparkNote(model.series)}>
        {model.rate == null ? null : (
          <span className="ssr-rt">
            <b>{momentRowInt(model.rate)}</b>{' '}
            <span className="u">{model.series === 'chat' ? 'chat' : 'emotes'}/min</span>
          </span>
        )}
        <MomentRowSpark bars={model.spark} series={model.series} />
      </span>
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

function vodClockNote(alignSeconds: number): string {
  const al = alignSeconds
  return `VOD time = stream time ${al < 0 ? `− ${-al}` : `+ ${al}`} s${
    al < 0
      ? ` (the VOD starts ${-al} s after the stream went live)`
      : al > 0
        ? ` (the VOD starts ${al} s before the stream clock's 0:00:00)`
        : ''
  }, then ${MOMENT_ROW_VOD_LEAD_SECONDS} s earlier so the moment plays in`
}

/** The VOD time the row player starts at: aligned offset minus the lead; null when unknown. */
export function momentRowVodStart(args: {
  offsetSeconds: number
  vodId?: string | null
  vodAlignSeconds?: number | null
  vodDurationSeconds?: number | null
}): number | null {
  if (!args.vodId) return null
  const v = alignedVodOffset(args.offsetSeconds, args.vodAlignSeconds, args.vodDurationSeconds ?? undefined)
  return v == null ? null : Math.max(0, v - MOMENT_ROW_VOD_LEAD_SECONDS)
}

/**
 * The row's player box (moment-rows.js playerHTML, without a frame: F6). The
 * Twitch player loads only when Play is pressed. A plain dark box, no blurred
 * box art behind it (candidate, 10-30, PIC-2); `artUrl` only lets the note say
 * the pictures are box art. U14's MomentPreviewTile can take the box over once
 * frames load.
 */
export function SessionMomentPlayer({
  model,
  artUrl,
  vodId,
  vodAlignSeconds,
  vodDurationSeconds,
  vodRecording = false,
  autoPlay = false,
}: {
  model: SessionMomentRowModel
  artUrl: string | null
  vodId?: string | null
  vodAlignSeconds?: number | null
  vodDurationSeconds?: number | null
  vodRecording?: boolean
  autoPlay?: boolean
  /** Unused since 10-30 (no picture in the box to fail); kept so callers need no change. */
  onArtError?: (url: string) => void
}) {
  const start = momentRowVodStart({ offsetSeconds: model.offsetSeconds, vodId, vodAlignSeconds, vodDurationSeconds })
  const [playing, setPlaying] = useState(false)
  const boxRef = useRef<HTMLDivElement | null>(null)
  const host = typeof window !== 'undefined' ? window.location.hostname : ''

  function play() {
    if (start == null || !vodId) return
    if (!host) {
      window.open(buildTwitchVodUrl(vodId, start), '_blank', 'noopener')
      return
    }
    setPlaying(true)
  }

  useEffect(() => {
    if (autoPlay) play()
    // Play pressed on the row opens the detail playing; later renders never restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlay])

  useEffect(() => {
    if (playing) boxRef.current?.focus({ preventScroll: true })
  }, [playing])

  return (
    <div className="ssr-pl">
      <div
        ref={boxRef}
        className={`ssr-pl-box nofr${playing ? ' on' : ''}`}
        tabIndex={playing ? -1 : undefined}
        data-moment-player
      >
        {playing && start != null && vodId ? (
          <iframe
            className="ssr-pl-if"
            title={`Twitch VOD from ${momentRowHms(start)}`}
            src={`https://player.twitch.tv/?video=v${encodeURIComponent(vodId)}&time=${momentRowTwitchTime(start)}&parent=${encodeURIComponent(host)}&autoplay=true`}
            allow="autoplay; fullscreen"
            allowFullScreen
          />
        ) : (
          <>
            {start == null ? (
              <p className="ssr-pl-msg">{vodId ? "This minute isn't in the VOD yet." : 'No VOD for this stream yet.'}</p>
            ) : (
              <button type="button" className="ssr-pl-go" data-moment-play onClick={play}>
                <MomentPlayIcon />
                <span>Play VOD from {momentRowHms(start)}</span>
              </button>
            )}
            <p className="ssr-pl-note">
              {/* the reel's and the bar's line (fix, 10-30, PIC-3) */}
              <span>{previewMissLine({ recording: vodRecording, hasArt: Boolean(artUrl) })}</span>
              {start == null ? null : <span className="t3">{PREVIEW_PLAYER_LOADS_COPY}</span>}
            </p>
          </>
        )}
      </div>
      <p className="ssr-pl-cap">
        {start == null ? null : (
          <span title={vodClockNote(typeof vodAlignSeconds === 'number' ? vodAlignSeconds : 0)}>
            On the VOD&rsquo;s clock<span aria-hidden="true"> · </span>
            <span className="ssr-vh">, </span>
            {MOMENT_ROW_VOD_LEAD_SECONDS} s before the moment
          </span>
        )}
        {start != null && vodId ? (
          <span className="act">
            <a className="ssr-qb" href={buildTwitchVodUrl(vodId, start)} target="_blank" rel="noopener noreferrer">
              Open on Twitch ↗
            </a>
          </span>
        ) : null}
      </p>
    </div>
  )
}

/**
 * The in-place detail under an open row (`lockMode="row"`): the player box
 * beside the page's selected-minute card. Height animates 200 ms in and out;
 * reduced motion jumps.
 */
export function SessionMomentDetail({
  id,
  model,
  closing = false,
  children,
}: {
  id: string
  model: SessionMomentRowModel
  closing?: boolean
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || prefersReducedMotion() || typeof el.animate !== 'function') return
    const to = closing ? 0 : el.scrollHeight
    const from = closing ? el.offsetHeight : 0
    const animation = el.animate(
      [{ height: `${from}px` }, { height: `${to}px` }],
      { duration: 200, easing: 'cubic-bezier(.16,1,.3,1)', fill: closing ? 'forwards' : 'none' },
    )
    return () => animation.cancel()
  }, [closing])

  return (
    <div
      ref={ref}
      id={id}
      className={`ssr-det${closing ? ' out' : ''}`}
      role="region"
      aria-label={`Moment ${model.rank} detail`}
      data-moment-row-detail
    >
      <div className="ssr-det-wrap">{children}</div>
    </div>
  )
}
