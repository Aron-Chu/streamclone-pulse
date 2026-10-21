/**
 * SpChart contract (frozen at the wave-1 gate; change only through a filed core request).
 *
 * Units: sample indices for ranges and scaled layers, epoch ms for times, plot
 * pixels for everything a layer draws or positions. The plot's x = 0 is the
 * left edge of the plot; the value-axis column sits to its right.
 */
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react'

export interface SpRange { startIndex: number; endIndex: number }
export interface SpViewportSource {
  getTarget(): SpRange; getVisual(): SpRange
  setTarget(next: SpRange, opts?: { animate?: boolean }): void
  subscribeTarget(cb: () => void): () => void
  subscribeFrame(cb: (visual: SpRange) => void): () => void
  subscribeSettle(cb: (settled: SpRange) => void): () => void
}

/**
 * The viewport store. Ranges are inclusive sample indices; targets are whole
 * samples, the visual range is fractional while it eases. getTarget returns a
 * new object per change; getVisual returns one live object mutated per frame.
 */
export interface SpViewportStore extends SpViewportSource {
  getCount(): number
  /** Live growth: a view that showed everything keeps showing everything. */
  setCount(count: number): void
  /** True from the first moving frame until settle. */
  isMoving(): boolean
  subscribeGesture(cb: (active: boolean) => void): () => void
  destroy(): void
}

export interface SpViewportStoreOptions {
  count: number
  initial?: SpRange | null
  /** Narrowest target, as endIndex - startIndex (default 1). */
  minSpan?: number
  /** Follower time constant (default 36 ms) and jump tween length (default 200 ms). */
  tauMs?: number
  tweenMs?: number
  /** Injectable for tests. Defaults: matchMedia, requestAnimationFrame, performance.now. */
  reducedMotion?: () => boolean
  raf?: (cb: (now: number) => void) => number
  cancelRaf?: (id: number) => void
  now?: () => number
}

/** Hover or keyboard cursor. The chart writes it; readouts subscribe. */
export interface SpHoverStore {
  get(): SpHit | null
  set(next: SpHit | null): void
  subscribe(cb: () => void): () => void
}

/** Per-sample coverage: 0 measured, 1 partly measured, 2 not measured (gap). */
export type SpCoverage = 0 | 1 | 2

/**
 * Dense samples from startMs every stepMs. Use NaN for a missing value;
 * a sample with coverage 2 is never drawn as data.
 */
export interface SpChartData {
  startMs: number
  stepMs: number
  chat: ArrayLike<number>
  emotes: ArrayLike<number>
  viewers: ArrayLike<number>
  coverage: ArrayLike<number>
  /** One emote's rate (the teal overlay line). */
  overlay?: ArrayLike<number> | null
}

export interface SpSeriesVisibility { chat?: boolean; emotes?: boolean; viewers?: boolean; overlay?: boolean }

/**
 * pickBarLevel options (barPyramid.ts BarLevelOptions), plus the bar width rule
 * and the rect cap. rule 'prod' is the hosted portal's bar width
 * (PulseMultiSignalChart activityBarRects): centred in the slot,
 * max(1, min(48, slot - max(1.5, 18 % of the slot), 72 % of the slot)) px.
 * maxRects: most bars drawn per bar series (default SP_RECT_CAP); the level
 * coarsens until the visible bars fit.
 */
export interface SpBarOptions {
  minSlotPx?: number
  maxBars?: number
  tolerance?: number
  maxLevelMinutes?: number
  rule?: 'prod'
  maxRects?: number
}

export interface SpSpanMs { startMs: number; endMs: number }

/** Caption values are shown as passed; the chart computes none. */
export interface SpCaption { peak: number | null; avg?: number | null; unit?: string }
export interface SpCaptions { rates?: SpCaption | null; viewers?: SpCaption | null }

/** One line in a lane (a plotted emote): per-sample values, NaN where none. */
export interface SpLaneLine { key: string; color: string; values: ArrayLike<number> }

/**
 * Lanes mode (opt-in; d3-v2 session-original): stacked lanes on one time axis
 * in place of the rates and viewers panels. Lanes draw in the order given and
 * share the plot under the band row by weight. A lane's scale is fixed from
 * its full-data maximum (niceTicks(max, 4)); one max tick marks it.
 */
export interface SpLane {
  /** 'chat', 'emotes' or 'viewers' read that series; a lane with `lines` draws those instead. */
  key: string
  /** bars: slot-average bars (+ optional trend); area: line over a gradient; line: plain lines. */
  kind: 'bars' | 'area' | 'line'
  label: string
  color: string
  /** Follows the caption figures when it starts with '/' ("757/min"). */
  unit?: string
  /** Share of the plot height (default 1); the last lane takes the rest. */
  weight?: number
  /** Px above the lane (default SpChartProps.laneGap); the first lane has none. */
  gap?: number
  barOpacity?: number
  /** Bars over spikeAbs draw at spikeOpacity (one threshold for the whole stream). */
  spikeOpacity?: number
  spikeAbs?: number
  /** Shortest drawn bar in px (default 0). */
  minBarPx?: number
  /** A 3-slot moving average over the bars, as a smooth line. */
  trend?: { opacity?: number; width?: readonly [number, number]; color?: string } | null
  /** Monotone curve instead of straight segments. */
  smooth?: boolean
  lineOpacity?: number
  /** Area fill opacity at the top and at the baseline. */
  gradient?: readonly [number, number]
  /** Stroke width [whole stream in view, zoomed all the way in]. */
  width?: readonly [number, number]
  /** Join breaks narrower than minHatchPx (default true); false keeps every break. */
  bridge?: boolean
  /** Lane background fills, painted in order. */
  bg?: string | readonly string[]
  /** A 1 px rule along the lane top. */
  topLine?: string
  /** Baseline colour (default #272728); false draws none. */
  baseline?: string | false
  /** Head chip, values as passed; left out: the peak is the lane's plotted maximum; false: no chip. */
  caption?: SpCaption | false
  lines?: readonly SpLaneLine[]
}

/** A lane's box: a value panel plus its key. */
export interface SpLaneBox extends SpValuePanel { key: string; raw: number }

/** The sliding selection band (prod's useSmoothedScalar on x and width). */
export interface SpSelSlide {
  /** Default CHART_MOTION.selectionSettleMs (190). */
  settleMs?: number
  /** Default: the prefers-reduced-motion media query. Reduced motion jumps. */
  reducedMotion?: () => boolean
}

export interface SpLiveEdge {
  /** Newest closed sample time; the rule and dot sit here. */
  atMs: number
  /** One ring per new value. */
  pollSeq: number
  /** Hollow dot. */
  stale?: boolean
  /** Text for screen readers and the data-chart-live-edge hook. */
  label?: string
  tone?: string
}

/** 'bar' outlines the column and dims other bars; 'minute' draws a rule. */
export interface SpSelection extends SpSpanMs { kind?: 'bar' | 'minute' }

export interface SpAxisOptions {
  /** Tick label; default local clock (hub) or h:mm since viewportOriginMs (session). */
  format?: (ms: number) => string
  /** Least px between labels while a gesture zooms out (default 80 session, 96 hub). */
  minGapPx?: number
}

export type SpDensity = 'hub' | 'session'

/** A bar at the current level. Indices are [fromIndex, toIndex). */
export interface SpBar {
  startMs: number
  endMs: number
  fromIndex: number
  toIndex: number
  chat: number
  emotes: number | null
  viewers: number | null
  overlay: number | null
  chatPeak: number
  chatPeakIndex: number
  emotesPeak: number | null
  emotesPeakIndex: number
  observed: number
  expected: number
  partial: boolean
}

export interface SpSample { chat: number; emotes: number; viewers: number; overlay: number; coverage: number }

export interface SpHit {
  index: number
  ms: number
  sample: SpSample
  /** The bar holding the sample, or null over a gap. */
  bar: SpBar | null
  levelMinutes: number
  /** True when the cursor runs per sample (lines finer than bars). */
  fine: boolean
  /** Plot px of the cursor column centre at the time of the hit. */
  x: number
  source: 'pointer' | 'touch' | 'keyboard'
}

/** Plot-local px of a bar from the current frame (no layout read). */
export interface SpBarAnchor { x: number; width: number; top: number; bottom: number; colTop: number; colBottom: number }

export interface SpLevelInfo { step: number; slotMs: number; minutes: number }

export interface SpPanelBox { x: number; y: number; width: number; height: number }
export interface SpValuePanel extends SpPanelBox { dataTop: number; max: number; ticks: number[] }
export interface SpLayout {
  width: number
  plotWidth: number
  height: number
  tickColumn: number
  /** The rail above the plot (its own box; y from 0). */
  top: SpPanelBox | null
  band: SpPanelBox | null
  rates: SpValuePanel | null
  viewers: SpValuePanel | null
  /**
   * Lanes mode: the lane boxes, top to bottom. `rates` then spans every lane
   * (layers on 'rates' cover them, on the first lane's scale) and `viewers` is null.
   */
  lanes?: SpLaneBox[]
}

/** The live frame; mutated in place on every frame. */
export interface SpFrame {
  readonly range: SpRange
  /** px = offset + scale * sampleIndex */
  readonly scale: number
  readonly offset: number
  readonly moving: boolean
  xOfIndex(index: number): number
  xOfMs(ms: number): number
  subscribe(cb: (frame: SpFrame) => void): () => void
}

export type SpLayerPanel = 'top' | 'band' | 'rates' | 'viewers'
/**
 * scaled: drawn once in data units (x = sample index, y = plot px) inside the
 *   transformed group; never re-rendered per frame. svg only; not in 'top'.
 * frame: rendered at settle; follows ctx.frame.subscribe for per-frame writes.
 * settle: rendered at settle and hidden while the view moves.
 */
export type SpLayerMode = 'scaled' | 'frame' | 'settle'

export interface SpLayerContext {
  width: number
  height: number
  layout: SpLayout
  box: SpPanelBox
  level: SpLevelInfo
  range: SpRange
  data: SpChartData
  /** Settled px. */
  xOfMs(ms: number): number
  xOfIndex(index: number): number
  /** Data units for scaled layers. */
  uOfMs(ms: number): number
  yRates(value: number): number
  yViewers(value: number): number
  frame: SpFrame
  store: SpViewportSource
  hover: SpHoverStore
}

export interface SpLayer {
  id: string
  panel: SpLayerPanel
  mode: SpLayerMode
  /** Default 'svg'. An html layer is an absolutely placed div over its panel. */
  surface?: 'svg' | 'html'
  /** Layers ignore the pointer; elements with class "spc-pe" opt in. */
  render(ctx: SpLayerContext): ReactNode
}

export type SpChartEvent = MouseEvent<Element> | KeyboardEvent<Element>

export interface SpChartProps {
  /** null while loading: the skeleton shows and no SVG mounts. */
  data: SpChartData | null
  viewport: SpViewportSource
  hover?: SpHoverStore | null
  series?: SpSeriesVisibility
  /** pickBarLevel options. Without them the plain 5 px rule applies. */
  barOptions?: SpBarOptions | null
  /** Bar level in minutes. Fixed without barOptions; the floor with them. */
  fixedLevelMinutes?: number | null
  plotHeight: number
  density?: SpDensity
  /** Value-axis column (default 56 session, 68 hub); 0 puts labels inside the plot. */
  tickColumnPx?: number
  /** Category band row of 22 px (default on for session). */
  band?: boolean
  /** Rail above the plot for 'top' layers (default 0). */
  topPx?: number
  /** Bar slots align to this time (default 0 = UTC clock for hub, data.startMs for session). */
  alignMs?: number
  /** Lines and cursor run per sample at this many px per sample (default 3 session, off hub). */
  fineLinesPx?: number | null
  /** data-chart-viewport-start/end are seconds from here (default data.startMs). */
  viewportOriginMs?: number
  /** Fixed outer width; measured from the host when left out. */
  width?: number
  axis?: SpAxisOptions
  ariaLabel?: string
  ariaDescribedBy?: string
  captions?: SpCaptions | null
  /** Unmeasured spans to hatch; only samples with coverage 2 are ever hatched. Default: every coverage-2 sample. */
  gaps?: readonly SpSpanMs[] | null
  liveEdge?: SpLiveEdge | null
  /** Dims everything outside the span. */
  highlightRange?: SpSpanMs | null
  selected?: SpSelection | null
  /**
   * Lanes mode (see SpLane). captions, series and the value panels are then
   * unused; the caller passes only the lanes to draw.
   */
  lanes?: readonly SpLane[] | null
  /** Px between lanes (default 12). */
  laneGap?: number
  /**
   * Each lane's value scale follows the view frame by frame as it zooms and
   * pans: the tallest value in view plus 10 % (laneFitMax), eased on a spring
   * (about 100 ms), instead of the whole data's max. Each lane clips to its
   * box, and bar widths follow the zoom too (prod rule). Reduced motion snaps.
   * Asked for on the session page, 2026-10-21.
   */
  laneFit?: boolean
  /** Hatches and lane breaks narrower than this many px are not drawn (lines join across). */
  minHatchPx?: number
  /**
   * The selection as a band snapped to the bar level, sliding to a new
   * selection (in place on the first one and on a level change).
   */
  selSlide?: SpSelSlide | null
  layers?: readonly SpLayer[]
  /** Below the axis (the host renders ChartNavigator). */
  navigator?: ReactNode
  /** Inside div[data-skeleton] while there is no data. */
  skeleton?: ReactNode
  className?: string
  onBarClick?(hit: SpHit, event: SpChartEvent): void
  onLevel?(levelMinutes: number): void
  onSettle?(range: SpRange): void
  onEscape?(): void
}

export interface SpChartHandle {
  hitTest(clientX: number): SpHit | null
  barAnchor(sampleIndex: number): SpBarAnchor | null
  plotElement(): SVGSVGElement | null
  /** Current-frame plot px. */
  xOfMs(ms: number): number
  level(): SpLevelInfo | null
  frame(): SpFrame
  layout(): SpLayout | null
}
