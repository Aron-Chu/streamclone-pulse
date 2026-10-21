/**
 * The selected bar's strip under the session chart (F22, d3-v2
 * session-original `.bkc--below`, bucket-card.js + card-model.js sessionBar).
 *
 * In the page's flow under the chart at every width, so nothing covers the
 * plot: the bar's picture (a VOD storyboard frame, or the game's art and the
 * reason) with Play over its time and game on the left; its figures, top
 * emotes, moments (the locked one marked) and the VOD link on the right.
 * Under 600 px the picture is a 128 px thumbnail beside the time and the rest
 * stacks. Twitch's player loads only when the viewer presses Play.
 *
 * Still the single owner of the selected-moment detail
 * (check-analytics-overlap.mjs), still `[data-selected-moment-card]`.
 * Styles: WEB/src/ui/charts/sp-session-strip.css.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { recapMomentAnalyticalOffset } from '@streampulse/pulse-core'
import { useConsoleMotion } from '../../hooks/useConsoleMotion.ts'
import type { AnalyticsMinuteRollup, AnalyticsTopEmote, PulseRecapMoment } from '../../apiTypes.ts'
import type { ReplayHeatmapDetailPoint, ReplayHeatmapPoint } from '../../types/heatmap.ts'
import {
  buildSessionBarStrip,
  resolveBarSpan,
  STRIP_MAX_EMOTES,
  STRIP_MAX_MOMENTS,
  stripInt,
  stripRate,
  type SessionBarMoment,
  type SessionBarStripModel,
  type StripGame,
} from '../../utils/sessionBarStrip.ts'
import type { VodLinkState } from '../../utils/twitchVodUrl.ts'
import { useVodFrame } from '../../utils/vodFrames.ts'
import { ConsoleEmoteImg } from './ConsoleEmoteImg.tsx'
import { MomentVodPanel } from './MomentVodPanel.tsx'

export interface SelectedMomentCompactCardProps {
  /** The selected minute (the bar's first measured minute, or the pinned one). */
  rollup: AnalyticsMinuteRollup
  /** Every measured minute of the stream. */
  rollups: AnalyticsMinuteRollup[]
  startedAt?: string
  vodLinkState: VodLinkState
  topEmotesCatalog?: AnalyticsTopEmote[]
  /** Kept for the current wiring; the strip doesn't read them. */
  heatmapPoint?: ReplayHeatmapPoint | null
  heatmapDetail?: ReplayHeatmapDetailPoint | null
  onOpenAnalytics?: () => void
  onClear?: () => void
  /** Today's wiring: the recap moment nearest the selection (90 s). Used when `barMoments` is absent. */
  recapMoment?: PulseRecapMoment | null
  gameName?: string | null
  vodAlignSeconds?: number | null
  vodDurationSeconds?: number | null
  // ---- PORT-PLAN T0 (U14) ----
  /** The chart's bar (epoch ms) from `onSelectBar`; absent = the selected minute. */
  barSpan?: { startMs: number; endMs: number; levelMinutes?: number | null } | null
  /** The Moments list's entries inside the bar, with their rank (`momentsInBar`). */
  barMoments?: SessionBarMoment[] | null
  /** The analytical offset of the moment the bar locked (`bestMomentInSpan` or a row click). */
  lockedMomentOffsetSeconds?: number | null
  /** A moment row in the strip was clicked: lock that moment (the bar stays). */
  onLockMoment?: (offsetSeconds: number) => void
  vodId?: string | null
  // ---- optional extras (requested from Page) ----
  /** Game segments: box art and a category switch inside the bar. */
  games?: StripGame[] | null
  /** The VOD is still recording (Twitch has no preview frames yet). */
  vodRecording?: boolean
  /** "N more": open the Moments list past the strip's three. */
  onShowMoreMoments?: () => void
  /** "Zoom to bucket". */
  onZoomToBar?: () => void
}

const ICON = {
  x: <svg className="ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6 6 18" /></svg>,
  ext: <svg className="ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 16 16 8M10 8h6v6" /></svg>,
  zoom: <svg className="ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="6" /><path d="m20 20-4.6-4.6M11 8.5v5M8.5 11h5" /></svg>,
}
// "not in the data": the chart's 45° hatch for unmeasured spans
const HATCH = (
  <svg className="bkc-hatch" viewBox="0 0 16 12" aria-hidden="true" focusable="false">
    <path d="M-3 9 6-0M1 13 14 0M7 15 19 3M13 15l6-6" stroke="#8e8e96" strokeOpacity=".7" strokeWidth="1.25" fill="none" />
  </svg>
)

function BoxArt({ src }: { src: string | null }) {
  const [failed, setFailed] = useState<string | null>(null)
  if (!src || failed === src) return null
  return (
    <img className="bkc-art" src={src} alt="" width={36} height={48} decoding="async" referrerPolicy="no-referrer"
      onError={() => setFailed(src)} />
  )
}

function Figures({ model }: { model: SessionBarStripModel }) {
  return (
    <div className="bkc-fg">
      <div className="bkc-figs">
        {model.figures.map((fig) => (
          <div key={fig.key} className="bkc-fig" title={fig.tip ?? undefined} data-strip-figure={fig.key}>
            <span className={`bkc-n${fig.value == null ? ' na' : ''}`}>{stripInt(fig.value)}</span>
            <span className="bkc-fl"><i className={`sw ${fig.key}`} aria-hidden="true" />{fig.label}</span>
            <span className="bkc-u"><span className="bkc-ut">{fig.third ?? ' '}</span></span>
          </div>
        ))}
      </div>
    </div>
  )
}

function TopEmotes({ model }: { model: SessionBarStripModel }) {
  const unit = model.span.levelMinutes === 1 ? 'minute' : 'bar'
  const list = model.topEmotes.slice(0, STRIP_MAX_EMOTES)
  if (!list.length) {
    return (
      <div className="bkc-emo">
        <p className="bkc-sl"><span>Top emotes</span><span className="r">none named in this {unit}</span></p>
      </div>
    )
  }
  const exact = model.topEmotesExact
  const mk = exact ? '' : '≥'
  return (
    <div className="bkc-emo">
      <p className="bkc-sl"><span>Top emotes</span><span className="r">per min{exact ? '' : ' · ≥ = at least'}</span></p>
      <ul className="bkc-el" aria-label="Top emotes in this bar">
        {list.map((emote) => (
          <li key={emote.key}
            title={`${emote.code}: ${exact ? '' : 'at least '}${stripInt(emote.count)} uses in this ${unit}, ${mk}${stripRate(emote.perMin)}/min`}>
            <ConsoleEmoteImg src={emote.imageUrl ?? undefined} name={emote.code} width={28} height={28} fallbackClassName="bkc-noimg" />
            <span className="bkc-en">{emote.code}</span>
            <span className="bkc-ec">{mk}{stripRate(emote.perMin ?? emote.count)}</span>
          </li>
        ))}
      </ul>
      {model.namedNote ? <p className="bkc-cap">{model.namedNote}</p> : null}
    </div>
  )
}

function Moments({
  model,
  onLockMoment,
  onShowMoreMoments,
}: {
  model: SessionBarStripModel
  onLockMoment?: (offsetSeconds: number) => void
  onShowMoreMoments?: () => void
}) {
  const items = model.moments
  if (!items.length) {
    return (
      <div className="bkc-mom">
        <p className="bkc-sl"><span>Moments</span><span className="r">none</span></p>
      </div>
    )
  }
  const shown = items.slice(0, STRIP_MAX_MOMENTS)
  const rest = Math.max(0, items.length - shown.length)
  return (
    <div className="bkc-mom">
      <p className="bkc-sl"><span>Moments</span><span className="r">{items.length}</span></p>
      <ul className="bkc-ml">
        {shown.map((item) => {
          const content = (
            <>
              <span className="rk">{item.rank ?? ''}</span>
              <span className="tm">{item.offsetLabel}</span>
              <span className="lb">{item.label}</span>
              {item.topEmote ? (
                <span className="em" title={`${item.topEmote.code} ×${stripInt(item.topEmote.count)} in that minute`}>
                  {item.topEmote.imageUrl ? (
                    <ConsoleEmoteImg src={item.topEmote.imageUrl} name={item.topEmote.code} width={20} height={20} fallbackClassName="bkc-noimg sm" />
                  ) : null}
                  <span className="sr-only">{item.topEmote.code} </span>×{stripInt(item.topEmote.count)}
                </span>
              ) : null}
            </>
          )
          const label = `Moment${item.rank != null ? ` ${item.rank}` : ''} at ${item.offsetLabel}, ${item.label}`
          return (
            <li key={item.key}>
              {onLockMoment ? (
                <button type="button" className={`bkc-mr${item.locked ? ' lk' : ''}`} aria-label={label}
                  aria-current={item.locked ? 'true' : undefined} data-strip-moment={item.offsetSec}
                  onClick={() => onLockMoment(item.offsetSec)}>
                  {content}
                </button>
              ) : (
                <div className={`bkc-mr${item.locked ? ' lk' : ''}`}
                  aria-current={item.locked ? 'true' : undefined} data-strip-moment={item.offsetSec}>
                  {content}
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {rest > 0 ? (
        onShowMoreMoments ? (
          <button type="button" className="bkc-more" onClick={onShowMoreMoments}>{rest} more</button>
        ) : (
          <span className="bkc-more">{rest} more</span>
        )
      ) : null}
    </div>
  )
}

function Providers({ model }: { model: SessionBarStripModel }) {
  const p = model.providers
  if (!p) return null
  return (
    <div className="bkc-pv" title="The minutes data splits out 7TV only, so Twitch, BTTV and FFZ are one number.">
      <p className="bkc-sl">
        <span>By provider, per min</span>
        <span className="r">
          <span>7TV <b>{stripInt(p.sevenTv)}</b></span>
          <span aria-hidden="true">·</span>
          <span>Twitch, BTTV, FFZ <b>{stripInt(p.other)}</b></span>
        </span>
      </p>
    </div>
  )
}

/** What a screen reader hears when the strip opens or swaps (bucket-card.js `summary`). */
export function stripSummary(model: SessionBarStripModel): string {
  const t = model.title.replace('–', ' to ')
  if (model.gap) return `Bucket selected, ${t}. Not measured.`
  const parts = [`Bucket selected, ${t}`]
  for (const fig of model.figures) {
    if (fig.value == null) continue
    parts.push(fig.key === 'viewers' ? `Viewers ${stripInt(fig.value)}` : `${fig.key === 'chat' ? 'Chat' : 'Emotes'} ${stripInt(fig.value)} per minute`)
  }
  if (model.moments.length) parts.push(`${model.moments.length} moment${model.moments.length === 1 ? '' : 's'}`)
  return `${parts.join('. ')}.`
}

// The strip scrolls into view only when it opens from the plot (a click, a tap or Enter on a bar). A pick in the
// Moments list or a #t= link selects the same minute and keeps the page still (prod: analytics-chart-touch).
const PLOT_SELECTOR = '.spc-svg, [data-chart-plot]'
let lastPlotGesture = Number.NEGATIVE_INFINITY
const nowMs = () => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now())
if (typeof document !== 'undefined') {
  const note = (event: Event) => {
    const target = event.target as Element | null
    if (target && typeof target.closest === 'function' && target.closest(PLOT_SELECTOR)) lastPlotGesture = nowMs()
  }
  document.addEventListener('pointerdown', note, true)
  document.addEventListener('keydown', note, true)
}
/** True when the plot took a pointer or key press in the last second. */
export function openedFromPlot(): boolean {
  return nowMs() - lastPlotGesture < 1000
}

/** Walk up from the strip to the chart that owns it and read its plot's top. */
function plotTopOf(el: HTMLElement): number {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const plot = node.querySelector(PLOT_SELECTOR)
    if (plot && !el.contains(plot)) return plot.getBoundingClientRect().top
  }
  return Number.POSITIVE_INFINITY
}

/**
 * The bottom of whatever sticks to the top of the window (the site's header), so
 * the scroll never parks the plot under it. 0 when nothing does, or without layout.
 */
function stickyTopInset(self: HTMLElement): number {
  if (typeof document.elementsFromPoint !== 'function') return 0
  let inset = 0
  try {
    for (const el of document.elementsFromPoint(Math.round(window.innerWidth / 2), 1)) {
      if (self.contains(el) || el === document.documentElement || el === document.body) continue
      const pos = getComputedStyle(el).position
      if (pos !== 'fixed' && pos !== 'sticky') continue
      const r = el.getBoundingClientRect()
      if (r.top <= 1 && r.bottom > inset && r.bottom < window.innerHeight * 0.4) inset = r.bottom
    }
  } catch {
    return 0
  }
  return inset
}

/** Selected bar's strip, attached beneath the session chart. */
export function SelectedMomentCompactCard({
  rollup,
  rollups,
  startedAt,
  vodLinkState,
  topEmotesCatalog,
  onClear,
  recapMoment,
  gameName,
  vodAlignSeconds,
  vodDurationSeconds,
  barSpan,
  barMoments,
  lockedMomentOffsetSeconds,
  onLockMoment,
  vodId,
  games,
  vodRecording,
  onShowMoreMoments,
  onZoomToBar,
}: SelectedMomentCompactCardProps) {
  const titleId = useId()
  const hostRef = useRef<HTMLDivElement>(null)
  const { motionEnabled } = useConsoleMotion()
  const [entering, setEntering] = useState(motionEnabled)

  const clockStart = startedAt ?? rollup.minuteTs
  const model = useMemo(() => {
    const span = resolveBarSpan({ barSpan, rollup, startedAt: clockStart })
    // Today's wiring has no bar moments: the moment matched to the selection stands in, when it is in the bar.
    let moments = barMoments ?? null
    let locked = lockedMomentOffsetSeconds ?? null
    if (!moments && recapMoment) {
      const off = recapMomentAnalyticalOffset(recapMoment)
      if (off < span.endSec && off + 60 > span.startSec) {
        moments = [{ rank: null, moment: recapMoment }]
        if (locked == null) locked = off
      }
    }
    return buildSessionBarStrip({
      span,
      rollups,
      startedAt: clockStart,
      topEmotesCatalog,
      games,
      gameName,
      moments: moments ?? [],
      lockedMomentOffsetSeconds: locked,
      vodLinkState,
      vodId,
      vodAlignSeconds,
      vodDurationSeconds,
    })
  }, [barMoments, barSpan, clockStart, gameName, games, lockedMomentOffsetSeconds, recapMoment, rollup, rollups,
    topEmotesCatalog, vodAlignSeconds, vodDurationSeconds, vodId, vodLinkState])

  const { vod } = model
  const frameState = useVodFrame(vod.vodId, vod.frameVodOffset)
  const frame = frameState.result?.frame ?? null
  const recording = vodRecording
    ?? (frameState.result?.reason === 'recording' || /live archive/i.test(vodLinkState.label))

  // 120 ms enter on the first open only (a swap keeps the strip in place); none under reduced motion
  useLayoutEffect(() => {
    if (!entering) return
    const id = requestAnimationFrame(() => setEntering(false))
    return () => cancelAnimationFrame(id)
    // first open only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A first open from the plot scrolls toward the strip, but the chart wins: it stops before the plot's top leaves
  // the window (or slides under the site's sticky header), so the locked bar and the strip's head and figures show
  // together. Swapping bars, a Moments-list pick and a #t= link don't scroll.
  useEffect(() => {
    const el = hostRef.current?.querySelector<HTMLElement>('.bkc--below')
    if (!el || typeof window.scrollBy !== 'function' || !openedFromPlot()) return
    const r = el.getBoundingClientRect()
    const top = stickyTopInset(el) + 8
    const want = Math.min(r.height, Math.round(window.innerHeight * 0.6))
    const by = Math.round(Math.min(r.top + want - (window.innerHeight - 8), r.top - top, plotTopOf(el) - top))
    if (by > 1) window.scrollBy({ top: by, behavior: motionEnabled ? 'smooth' : 'auto' })
    // first open only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const unitEyebrow = model.gap ? 'Bucket selected' : `Bucket selected · ${model.span.levelMinutes} min`
  const when = [model.clockLabel, model.zone].filter(Boolean).join(' ')
  const sw = model.category ? model.categorySwitch : null
  const unit = model.span.levelMinutes === 1 ? 'minute' : 'bar'

  return (
    <div ref={hostRef} className="bkc-below-host" data-selected-moment-card
      data-selected-bar={`${model.span.startSec}-${model.span.endSec}`}>
      <section className={`bkc bkc--below${entering ? ' bkc-enter' : ''}`} role="region" aria-labelledby={titleId} data-scope="session">
        <div className="bkc-in">
          <header className="bkc-h">
            <div className="bkc-top">
              <p className="bkc-s">{unitEyebrow}</p>
              {onClear ? (
                <button type="button" className="bkc-ib bkc-x" onClick={onClear} aria-label="Clear selected moment" title="Close (Esc)">
                  {ICON.x}
                </button>
              ) : null}
            </div>
            <div className="bkc-id">
              {model.category ? <BoxArt src={model.category.artUrl} /> : null}
              <div className="bkc-hl">
                <h2 className="bkc-t" id={titleId}>
                  <span className="sr-only">Bucket selected:</span>{' '}
                  <span data-selected-moment-time>{model.title}</span>
                </h2>
                {when ? <p className="bkc-m"><span className="bkc-d bkc-dc">{when}</span></p> : null}
                {model.category ? (
                  <p className={`bkc-cat${sw ? ' bkc-sw2' : ''}`} title={sw ? `Most of this ${unit}: ${model.category.name}` : undefined}>
                    <span>{sw ?? model.category.name}</span>
                  </p>
                ) : null}
                {!model.gap && model.coverage.partial ? (
                  <p className="bkc-m bkc-prog">{HATCH}<span>{model.coverage.label}</span></p>
                ) : null}
              </div>
            </div>
          </header>
          {model.gap ? null : (
            <div className="bkc-pvw">
              <MomentVodPanel
                vodId={vod.vodId}
                playAt={vod.playAt}
                playVerb={vod.playVerb}
                leadCaption={vod.leadCaption}
                message={vod.message}
                frame={frame}
                loading={frameState.loading}
                subject={vod.subject}
                subjectVodStart={vod.subjectVodStart}
                recording={recording}
              />
            </div>
          )}
          <div className="bkc-body">
            {model.gap ? (
              <div className="bkc-gap">
                <span className="bkc-gapm" aria-hidden="true">{HATCH}</span>
                <div><p className="bkc-gt">Not measured</p></div>
              </div>
            ) : (
              <>
                <Figures model={model} />
                <TopEmotes model={model} />
                <Moments model={model} onLockMoment={onLockMoment} onShowMoreMoments={onShowMoreMoments} />
                <Providers model={model} />
              </>
            )}
          </div>
          {!model.gap && (vod.open || onZoomToBar) ? (
            <div className="bkc-act">
              {vod.open ? (
                <a className="bkc-btn bkc-vod" href={vod.open.href} target="_blank" rel="noopener noreferrer" data-strip-vod-link>
                  {vod.open.label}{ICON.ext}
                </a>
              ) : null}
              {onZoomToBar ? (
                <button type="button" className="bkc-qb bkc-zoom" onClick={onZoomToBar}>{ICON.zoom}Zoom to bucket</button>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>
      <p className="sr-only" aria-live="polite" aria-atomic="true">{stripSummary(model)}</p>
    </div>
  )
}
