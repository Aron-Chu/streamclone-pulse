import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { PublicHub } from '../../../lib/publicHub'
import { type LiveSignalModel } from './landingData'
import { seventvImageUrl } from './landingEmotes'
import { startScrollScene } from './scrollScene'
import './LiveSignalScrollGraph.css'
/* ============================================================================
 * LiveSignalScrollGraph
 *
 * A scroll-driven "live analytics replay" for the landing page. As the visitor
 * scrolls, the StreamPulse extension graph expands into a full-width signal map
 * of a Twitch stream: chat/min bars plus line, the 7TV/min aggregate, viewers
 * baseline, emote bursts, peak markers, and finally a multi-channel ledger.
 *
 * Scroll engine (no GSAP dependency — the project already ships a custom
 * rAF/IntersectionObserver scroll pattern that is SSR/prerender-safe):
 *   - `.lsg__scene` is a tall element that defines the scroll distance.
 *   - `.lsg__sticky` pins the stage while the scene scrolls past.
 *   - A passive, rAF-batched scroll listener turns the scene's viewport offset
 *     into a single progress value `p` (0 → 1), then into a small set of CSS
 *     custom properties that the stylesheet consumes (transform / opacity /
 *     stroke-dashoffset only — no layout thrash).
 *
 * Animation timeline (progress → beats; see BEATS for the narrative copy):
 *   Beat 1  p 0.00–0.14  Live signal starts — Synced pills + KPI counters spin
 *                        up, the viewer baseline fades in (--sigv, counters).
 *   Beat 2  p 0.14–0.36  Chat velocity — chat/min bars and line wipe in
 *                        left→right as the playhead sweeps (--wipe gates each bar).
 *   Beat 3  p 0.36–0.58  Emote velocity — total emotes/min line, then 7TV/min
 *                        dashed subset (--emo, --sv) with emote chips at spikes.
 *   Beat 4  p 0.58–0.78  Peak markers + emote chips light up
 *                        and the "Most reacted so far" card slides in (--moments).
 *   Beat 5  p 0.78–1.00  Every tracked channel — the panel eases back to reveal a
 *                        deck of tracked channels minute by minute (--channels).
 *
 * Reduced motion / no-JS / SSR: the root renders with `data-static`, which forces
 * every reveal var to 1, unpins the stage, and shows the final expanded state with
 * all information visible and readable. The scroll engine only activates after the
 * component mounts in a motion-allowed browser.
 *
 * All data below is deterministic (sine + fixed spikes, no Math.random) so
 * screenshots and tests stay stable.
 * ========================================================================== */

/** Style object that also accepts CSS custom properties. */
type Vars = CSSProperties & Record<`--${string}`, string | number>

/* ---- Editable narrative copy (kept separate from the animation logic) ---- */
interface Beat {
  kicker: string
  title: string
  body: string
  /** Accent token for the step dot/rail. */
  tone: 'view' | 'chat' | '7tv' | 'spike' | 'multi'
}

const BEATS: readonly Beat[] = [
  {
    kicker: 'Beat 01',
    title: 'The live signal starts',
    body: 'When a tracked channel goes live, StreamPulse starts minute buckets for viewers, chat, and 7TV reactions.',
    tone: 'view',
  },
  {
    kicker: 'Beat 02',
    title: 'Chat becomes readable bars',
    body: 'Each bar is real chat/min volume, so spikes stay visible instead of disappearing into a smoothed line.',
    tone: 'chat',
  },
  {
    kicker: 'Beat 03',
    title: 'Emote velocity layers in',
    body: 'Total emotes/min (all providers) draws first, then the dashed 7TV/min line shows how much of that signal is third-party emotes.',
    tone: '7tv',
  },
  {
    kicker: 'Beat 04',
    title: 'Moments are marked',
    body: 'Backend-detected peaks become markers. The strongest live marker is pinned as Most reacted so far.',
    tone: 'spike',
  },
  {
    kicker: 'Beat 05',
    title: 'Every tracked channel, minute by minute',
    body: 'The same minute-by-minute model runs across tracked channels, with the hub acting as the shortcut into full analytics.',
    tone: 'multi',
  },
] as const

/* ---- Deterministic stream telemetry ------------------------------------- */
const MIN = 48 // minutes of stream shown across the x-axis
const VIEW_W = 1000
const VIEW_H = 300

/** Gaussian spikes that create realistic chat/emote bursts (minute, height, width). */
const SPIKES: ReadonlyArray<{ at: number; boost: number; w: number }> = [
  { at: 13, boost: 22, w: 1.5 },
  { at: 31, boost: 30, w: 1.7 },
  { at: 42, boost: 42, w: 1.3 },
]

function spikeAt(i: number): number {
  let s = 0
  for (const sp of SPIKES) {
    const d = i - sp.at
    s += sp.boost * Math.exp(-(d * d) / (2 * sp.w * sp.w))
  }
  return s
}

const CHAT: number[] = []
const EMOTES: number[] = []
const SV: number[] = []
const VIEWERS: number[] = []
for (let i = 0; i < MIN; i++) {
  const base = 16 + 9 * Math.sin(i * 0.45) + 5 * Math.sin(i * 0.21 + 1.3)
  const trend = i * 0.42
  const c = Math.max(5, base + trend + spikeAt(i))
  CHAT.push(Math.round(c))
  const sv = Math.max(2, Math.round(c * 0.42 + 2 * Math.sin(i * 0.6)))
  SV.push(sv)
  EMOTES.push(Math.max(sv + 3, Math.round(sv * 1.52 + c * 0.06)))
  VIEWERS.push(Math.round(880 + 360 * (i / (MIN - 1)) + 110 * Math.sin(i * 0.3) + spikeAt(i) * 5))
}

const CHAT_MAX = Math.max(...CHAT)
const LINE_MAX = Math.max(...CHAT, ...EMOTES, ...SV)
const VIEW_MIN = Math.min(...VIEWERS)
const VIEW_MAX = Math.max(...VIEWERS)

const DEMO_MOMENTS: LiveSignalModel['moments'] = [
  { i: 13, time: '00:51:00', kind: '7TV emote spike', emoteImage: seventvImageUrl('01GB2ZJFBG000DTBJYANG8XYFP'), count: 28 },
  { i: 31, time: '01:09:00', kind: 'Chat spike', emoteImage: seventvImageUrl('01G98W833R0000BRQD106P0ZNT'), count: 41 },
  { i: 42, time: '01:20:00', kind: 'Chat spike', emoteImage: seventvImageUrl('01GAZ199Z8000FEWHS6AT5QZV0'), count: 56, top: true },
]

const DEMO_TOP_EMOTES: LiveSignalModel['topEmotes'] = [
  { name: 'LOL', count: 37, imageUrl: seventvImageUrl('01GAZ199Z8000FEWHS6AT5QZV0'), pct: 100 },
  { name: '!join', count: 23, imageUrl: seventvImageUrl('01GB8EQNJ8000497KFBZWNSDFZ'), pct: 62 },
  { name: 'LO', count: 17, imageUrl: seventvImageUrl('01G98W833R0000BRQD106P0ZNT'), pct: 46 },
  { name: 'classic', count: 10, imageUrl: seventvImageUrl('01GB4P2HX0000BJ5HR8F6XV9Q0'), pct: 27 },
  { name: 'Clap', count: 9, imageUrl: seventvImageUrl('01GAM8EFQ00004MXFXAJYKA859'), pct: 24 },
]

const DEMO_CHANNELS: LiveSignalModel['channels'] = [
  { login: 'xqc', initial: 'X', live: true },
  { login: 'ludwig', initial: 'L', live: true },
  { login: 'kaicenat', initial: 'K', live: true },
  { login: 'caseoh_', initial: 'C', live: true },
  { login: 'tarik', initial: 'T', live: false },
  { login: 'jynxzi', initial: 'J', live: true },
  { login: 'pokimane', initial: 'P', live: false },
]

function buildDemoLiveSignalModel(): LiveSignalModel {
  return {
    min: MIN,
    chat: CHAT,
    emotes: EMOTES,
    sv: SV,
    viewers: VIEWERS,
    kpiViewers: 1284,
    kpiChat: 56,
    kpiEmotes: 29,
    kpiSeventv: 19,
    kpiViewerDelta: '+17 · 5m',
    moments: DEMO_MOMENTS,
    topEmotes: DEMO_TOP_EMOTES,
    channels: DEMO_CHANNELS,
    axisStart: '00:38:00',
    axisMid: '01:07:00',
    featuredMoment: {
      time: '01:20:00',
      kind: 'Chat spike',
      chatPerMin: 56,
      emotesPerMin: 19,
    },
    topEmoteCount: 5,
    topEmoteTotal: 19,
    trackedChannelCount: 7,
  }
}

interface LiveSignalGeometry {
  min: number
  chatMax: number
  chatLine: string
  emoteLine: string
  svLine: string
  viewLine: string
  viewArea: string
  xAt: (index: number) => number
  yLine: (value: number) => number
  model: LiveSignalModel
}

function computeGeometry(model: LiveSignalModel): LiveSignalGeometry {
  const min = model.min
  const chatMax = Math.max(...model.chat, 1)
  const lineMax = Math.max(...model.chat, ...model.emotes, ...model.sv, 1)
  const viewMin = Math.min(...model.viewers)
  const viewMax = Math.max(...model.viewers)

  const xAt = (index: number) => ((index + 0.5) / min) * VIEW_W
  const yLine = (value: number) => VIEW_H - (Math.min(value, lineMax) / lineMax) * (VIEW_H * 0.82) - VIEW_H * 0.06
  const yView = (value: number) => {
    const norm = (value - viewMin) / Math.max(1, viewMax - viewMin)
    return VIEW_H - (0.32 + norm * 0.52) * VIEW_H
  }

  const chatPoints = model.chat.map((value, index) => [xAt(index), yLine(value)] as const)
  const emotePoints = model.emotes.map((value, index) => [xAt(index), yLine(value)] as const)
  const svPoints = model.sv.map((value, index) => [xAt(index), yLine(value)] as const)
  const viewPoints = model.viewers.map((value, index) => [xAt(index), yView(value)] as const)
  const viewLine = smooth(viewPoints)

  return {
    min,
    chatMax,
    chatLine: smooth(chatPoints),
    emoteLine: smooth(emotePoints),
    svLine: smooth(svPoints),
    viewLine,
    viewArea: `${viewLine} L${VIEW_W},${VIEW_H} L0,${VIEW_H} Z`,
    xAt,
    yLine,
    model,
  }
}

/** Catmull-Rom → cubic Bézier for smooth, deterministic signal paths. */
function smooth(points: ReadonlyArray<readonly [number, number]>): string {
  if (points.length < 2) return ''
  const d = [`M${points[0][0].toFixed(1)},${points[0][1].toFixed(1)}`]
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2] ?? p2
    const c1x = p1[0] + (p2[0] - p0[0]) / 6
    const c1y = p1[1] + (p2[1] - p0[1]) / 6
    const c2x = p2[0] - (p3[0] - p1[0]) / 6
    const c2y = p2[1] - (p3[1] - p1[1]) / 6
    d.push(
      `C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`,
    )
  }
  return d.join(' ')
}

/** Horizontal grid rows + vertical minute gridlines (every 8 min). */
const GRID_ROWS = [0.18, 0.4, 0.62, 0.84].map((f) => f * VIEW_H)
const GRID_COLS = Array.from({ length: 6 }, (_, k) => ((k + 1) / 7) * VIEW_W)

const fmtInt = (n: number) => n.toLocaleString('en-US')

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)

export function LiveSignalScrollGraph(_props: { hub?: PublicHub | null } = {}) {
  // Landing replay is always the deterministic illustrative demo — never mix live
  // hub aggregates into a surface labeled "not live backend data."
  const model = useMemo(() => buildDemoLiveSignalModel(), [])
  const geo = useMemo(() => computeGeometry(model), [model])
  const { kpiViewers, kpiChat, kpiEmotes, kpiSeventv, kpiViewerDelta } = model

  const rootRef = useRef<HTMLDivElement | null>(null)
  const sceneRef = useRef<HTMLDivElement | null>(null)
  const stickyRef = useRef<HTMLDivElement | null>(null)
  const viewersRef = useRef<HTMLElement | null>(null)
  const chatRef = useRef<HTMLElement | null>(null)
  const emotesRef = useRef<HTMLElement | null>(null)
  const capRef = useRef<HTMLSpanElement | null>(null)

  // `animate` is false until a motion-allowed browser mounts the component, so
  // SSR / no-JS / reduced-motion render the static final state (data-static).
  const [animate, setAnimate] = useState(false)

  useEffect(() => {
    if (prefersReducedMotion()) return
    if (typeof IntersectionObserver === 'undefined' || typeof requestAnimationFrame === 'undefined') return
    setAnimate(true)
  }, [])

  // Scroll engine — only attached in animated mode. The shared scroll-scene
  // engine (same one the extension tour uses) pins the stage with an exact GPU
  // transform and hands us a *smoothed* progress `p`, which we turn into the
  // reveal vars the stylesheet consumes. Smoothing is what makes wheel-step
  // scrolling read as one fluid sweep instead of discrete jumps.
  useEffect(() => {
    if (!animate) return
    const root = rootRef.current
    const scene = sceneRef.current
    if (!root || !scene) return

    // Cache last-written text so counters only touch the DOM (and trigger
    // layout) when a rounded value actually changes.
    let lastViewers = ''
    let lastChat = ''
    let lastEmotes = ''
    let lastCap = ''

    return startScrollScene({
      scene,
      sticky: stickyRef.current,
      onProgress: (p, _raw) => {
        const wipe = clamp01(p / 0.72) // left→right playhead reveal
        const sigv = clamp01(p / 0.12) // viewers baseline + counters
        const sigc = clamp01((p - 0.14) / 0.1) // chat bars layer
        const emo = clamp01((p - 0.36) / 0.1) // total emotes/min line
        const sv = clamp01((p - 0.48) / 0.1) // 7TV dashed line
        const emotes = clamp01((p - 0.54) / 0.1) // emote chips at peaks
        const moments = clamp01((p - 0.6) / 0.12) // peak markers + card
        const channels = clamp01((p - 0.78) / 0.16) // multi-channel deck
        const beat = p < 0.14 ? 1 : p < 0.36 ? 2 : p < 0.58 ? 3 : p < 0.78 ? 4 : 5

        const s = root.style
        s.setProperty('--p', p.toFixed(4))
        s.setProperty('--wipe', wipe.toFixed(4))
        s.setProperty('--sigv', sigv.toFixed(4))
        s.setProperty('--sigc', sigc.toFixed(4))
        s.setProperty('--emo', emo.toFixed(4))
        s.setProperty('--sv', sv.toFixed(4))
        s.setProperty('--emotes', emotes.toFixed(4))
        s.setProperty('--moments', moments.toFixed(4))
        s.setProperty('--channels', channels.toFixed(4))
        if (root.dataset.beat !== String(beat)) root.dataset.beat = String(beat)

        const ease = sigv * sigv * (3 - 2 * sigv) // smoothstep for the counters
        const viewersText = fmtInt(Math.round(kpiViewers * ease))
        if (viewersRef.current && viewersText !== lastViewers) {
          viewersRef.current.textContent = viewersText
          lastViewers = viewersText
        }
        const chatText = String(Math.round(kpiChat * ease))
        if (chatRef.current && chatText !== lastChat) {
          chatRef.current.textContent = chatText
          lastChat = chatText
        }
        const emotesText = String(Math.round(kpiEmotes * ease))
        if (emotesRef.current && emotesText !== lastEmotes) {
          emotesRef.current.textContent = emotesText
          lastEmotes = emotesText
        }
        const capText = `${beat} · ${BEATS[beat - 1].title}`
        if (capRef.current && capText !== lastCap) {
          capRef.current.textContent = capText
          lastCap = capText
        }
      },
    })
  }, [animate, kpiViewers, kpiChat, kpiEmotes])
  return (
    <div
      className="lsg"
      ref={rootRef}
      data-beat="5"
      {...(animate ? {} : { 'data-static': '' })}
    >
      <div className="lsg__scene" ref={sceneRef}>
        <div className="lsg__sticky" ref={stickyRef}>
          <div className="lsg__grid">
            {/* Left: sticky narrative steps (copy lives in BEATS) */}
            <aside className="lsg__narrative" aria-hidden="true">
              <span className="lsg__eyebrow">Illustrative analytics replay</span>
              <ol className="lsg__steps">
                {BEATS.map((beat, idx) => (
                  <li className="lsg__step" data-step={idx + 1} data-tone={beat.tone} key={beat.kicker}>
                    <span className="lsg__step-rail" />
                    <span className="lsg__step-kicker">{beat.kicker}</span>
                    <span className="lsg__step-title">{beat.title}</span>
                    <span className="lsg__step-body">{beat.body}</span>
                  </li>
                ))}
              </ol>
            </aside>

            {/* Right: the pinned StreamPulse signal map */}
            <div className="lsg__stage">
              <div className="lsg__deck" aria-hidden="true">
                <span className="lsg__ghost lsg__ghost--b" />
                <span className="lsg__ghost lsg__ghost--a" />
              </div>

              <figure
                className="lsg__panel"
                role="img"
                aria-label="Illustrative StreamPulse signal map — sample chat-per-minute bars, emote rates, viewer baseline, peak markers, and tracked channels. Not live backend data."
              >
                <figcaption className="lsg__nowcap">
                  <span className="sl-dot" /> <span ref={capRef}>1 · The live signal starts</span>
                </figcaption>

                <header className="lsg__head">
                  <span className="lsg__title">
                    Stream <b>Pulse</b>
                  </span>
                  <span className="lsg__head-right">
                    <span className="lsg__pill lsg__pill--live">
                      <span className="sl-dot" /> Live
                    </span>
                    <span className="lsg__pill lsg__pill--sync">Synced</span>
                  </span>
                </header>

                {/* Live-now KPI cards */}
                <div className="lsg__kpis">
                  <div className="lsg__kpi" data-sig="view">
                    <small>Viewers</small>
                    <b>
                      <i ref={viewersRef}>{fmtInt(kpiViewers)}</i>
                    </b>
                    <span className={`lsg__kpi-delta${kpiViewerDelta.startsWith('-') ? ' dn' : kpiViewerDelta === 'flat · 5m' ? '' : ' up'}`}>
                      {kpiViewerDelta}
                    </span>
                  </div>
                  <div className="lsg__kpi" data-sig="chat">
                    <small>Chat / min</small>
                    <b>
                      <i ref={chatRef}>{kpiChat}</i>
                    </b>
                    <span className="lsg__kpi-delta">rolling 5m</span>
                  </div>
                  <div className="lsg__kpi" data-sig="emotes">
                    <small>Emotes / min</small>
                    <b>
                      <i ref={emotesRef}>{kpiEmotes}</i>
                    </b>
                    <span className="lsg__kpi-delta">7TV {kpiSeventv} · Other {Math.max(0, kpiEmotes - kpiSeventv)}</span>                  </div>
                </div>

                {/* Plot: SVG signals + HTML bars + overlays */}
                <div className="lsg__plot">
                  <svg className="lsg__svg" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="none" aria-hidden="true">
                    <g className="lsg__gridlines">
                      {GRID_ROWS.map((y) => (
                        <line key={`r${y}`} x1={0} y1={y} x2={VIEW_W} y2={y} />
                      ))}
                      {GRID_COLS.map((x) => (
                        <line key={`c${x}`} className="lsg__gridcol" x1={x} y1={0} x2={x} y2={VIEW_H} />
                      ))}
                    </g>

                    {/* Viewers baseline */}
                    <path className="lsg__view-area" d={geo.viewArea} />
                    <path className="lsg__view-line" d={geo.viewLine} pathLength={1} vectorEffect="non-scaling-stroke" />

                    {/* Total emotes/min (amber) — all providers */}
                    <path className="lsg__emo-line" d={geo.emoteLine} pathLength={1} vectorEffect="non-scaling-stroke" />

                    {/* 7TV/min subset (green dashed) */}
                    <path className="lsg__sv-line" d={geo.svLine} pathLength={1} vectorEffect="non-scaling-stroke" />

                    {/* Chat/min trend line over the bars */}
                    <path className="lsg__chat-line" d={geo.chatLine} pathLength={1} vectorEffect="non-scaling-stroke" />
                  </svg>

                  {/* Chat/min bars (cyan) */}
                  <div className="lsg__bars" style={{ '--n': geo.min } as Vars}>
                    {model.chat.map((value, index) => (
                      <span
                        className="lsg__bar"
                        key={index}
                        style={{ '--i': index, height: `${((value / geo.chatMax) * 82).toFixed(1)}%` } as Vars}
                      />
                    ))}
                  </div>

                  {/* Peak callouts — emote chip only (no client-invented Pulse scores) */}
                  <div className="lsg__peaks">
                    {model.moments.map((moment, idx) => (
                      <span
                        className={`lsg__peak${moment.top ? ' is-top' : ''}`}
                        data-side={idx % 2 === 0 ? 'left' : 'right'}
                        key={`peak-${moment.i}`}
                        style={{
                          left: `${(geo.xAt(moment.i) / VIEW_W) * 100}%`,
                          top: `${(geo.yLine(model.chat[moment.i] ?? 0) / VIEW_H) * 100}%`,
                        } as Vars}
                      >
                        <span className="lsg__peak-callout">
                          <span className="lsg__peak-chip">
                            <img src={moment.emoteImage} alt="" loading="lazy" decoding="async" />
                            <span>+{moment.count}</span>
                          </span>
                        </span>
                        <span className="lsg__peak-dot" />
                      </span>
                    ))}
                  </div>
                  {/* Sweeping playhead / scanline */}
                  <span className="lsg__playhead" aria-hidden="true">
                    <span className="lsg__playhead-now">Now</span>
                  </span>

                  {/* x-axis minute labels */}
                  <div className="lsg__axis" aria-hidden="true">
                    <span>{model.axisStart}</span>
                    <span>{model.axisMid}</span>
                    <span>Now</span>
                  </div>                </div>

                {/* Legend */}
                <div className="lsg__legend" aria-hidden="true">
                  <span data-sig="chat">
                    <i /> chat/min bars + line
                  </span>
                  <span data-sig="emotes">
                    <i /> emotes/min
                  </span>
                  <span data-sig="7tv">
                    <i /> 7TV/min
                  </span>
                  <span data-sig="view">
                    <i /> viewers
                  </span>
                  <span data-sig="spike">
                    <i /> moment
                  </span>
                </div>

                {/* Lower row: top emotes + most-reacted card */}
                <div className="lsg__lower">
                  <div className="lsg__te">
                    <div className="lsg__te-head">
                      <span>Top emotes</span>
                      <span className="lsg__te-count">{model.topEmoteCount} / {model.topEmoteTotal}</span>
                    </div>
                    {model.topEmotes.map((emote, idx) => (
                      <div className={`lsg__te-row${idx === 0 ? ' is-hot' : ''}`} key={emote.name}>
                        <span className="lsg__te-rank">{idx + 1}</span>
                        <img src={emote.imageUrl} alt="" loading="lazy" decoding="async" />
                        <span className="lsg__te-name">{emote.name}</span>
                        <span className="lsg__te-bar">
                          <i style={{ width: `${emote.pct}%` }} />
                        </span>
                        <span className="lsg__te-n">{emote.count}</span>
                      </div>
                    ))}                    <div className="lsg__te-stale">
                      <span className="sl-dot" /> 7TV set cached for stable labels
                    </div>
                  </div>

                  <div className="lsg__moment">
                    <div className="lsg__moment-top">
                      <span className="lsg__moment-badge">Most reacted so far</span>
                      <span className="lsg__moment-time">{model.featuredMoment.time}</span>
                    </div>
                    <div className="lsg__moment-reason">{model.featuredMoment.kind}</div>
                    <div className="lsg__moment-metrics">
                      <span>
                        <b>{model.featuredMoment.chatPerMin}</b> chat / min
                      </span>
                      <span>
                        <b>{model.featuredMoment.emotesPerMin}</b> emotes / min
                      </span>
                    </div>                    <div className="lsg__moment-btns">
                      <span className="lsg__moment-btn">Jump to moment</span>
                      <span className="lsg__moment-btn ghost">Analytics</span>
                    </div>
                  </div>
                </div>

                {/* Beat 5: every tracked channel */}
                <div className="lsg__channels">
                  <span className="lsg__channels-cap">
                    Tracking {model.trackedChannelCount}+ channels live · minute by minute
                  </span>
                  <div className="lsg__channels-row">
                    {model.channels.map((channel, idx) => (
                      <span className="lsg__chan" key={channel.login} style={{ '--ci': idx } as Vars}>
                        <span className="lsg__chan-av">{channel.initial}</span>
                        <span className="lsg__chan-name">{channel.login}</span>
                        {channel.live ? <span className="lsg__chan-dot" /> : <span className="lsg__chan-dot is-off" />}
                      </span>
                    ))}
                  </div>
                </div>              </figure>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
