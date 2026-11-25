import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { buttonClass } from '../../ui/primitives'
import { useMatchMedia } from '../../ui/hooks/useMatchMedia'
import { BIN_SECONDS, DEMO, formatClock, formatPace, STREAM_SECONDS, STREAM_TITLE, type DemoMoment } from './brainchatDemoData'
import './landingBrainChat.css'

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'
const CHART_W = 680
const CHART_H = 132
/** Bins drawn per point: the max of each 3 (30 s), so every peak keeps its height, as on /brainchat. */
const CHART_GROUP = 3
/** Each pin appears this long after the line starts drawing, one after another. */
const PIN_DELAY_MS = 700
const PIN_STEP_MS = 90
/** The read-out fades out this long before it swaps (landingBrainChat.css fades it back in). */
const SWAP_OUT_MS = 90

type Vars = CSSProperties & Record<`--${string}`, string | number>

/** The made-up stream's line, its usual pace and the busiest three moments, from the /brainchat demo's own data. */
const CHART = (() => {
  const { series, usual, busiestThree } = DEMO
  const yMax = Math.max(...series) * 1.08
  const toY = (value: number) => CHART_H - (value / yMax) * CHART_H
  const points: string[] = []
  for (let i = 0; i < series.length; i += CHART_GROUP) {
    const group = series.slice(i, i + CHART_GROUP)
    const x = (((i + group.length / 2) * BIN_SECONDS) / STREAM_SECONDS) * CHART_W
    points.push(`${x.toFixed(1)},${toY(Math.max(...group)).toFixed(1)}`)
  }
  const line = `M${points.join('L')}`
  const pins = busiestThree.map((n) => {
    const moment = DEMO.moments[n - 1]!
    const anchorBin = Math.floor(moment.at / BIN_SECONDS)
    return {
      n,
      x: (((anchorBin + 0.5) * BIN_SECONDS) / STREAM_SECONDS) * 100,
      y: (toY(series[anchorBin]!) / CHART_H) * 100,
    }
  })
  const hours = Array.from({ length: Math.floor(STREAM_SECONDS / 3600) + 1 }, (_, h) => h)
  return { line, area: `${line}L${CHART_W},${CHART_H}L0,${CHART_H}Z`, base: toY(usual), pins, hours }
})()

const momentByNumber = (n: number): DemoMoment => DEMO.moments[n - 1]!

/** The /brainchat demo's read-out, in its words, short enough for the card. */
function ReadOut({ moment }: { moment: DemoMoment }) {
  const when = <span className="sl-bc__when">{`Moment ${moment.n} · ${formatClock(moment.at)}`}</span>
  const pace = (
    <p className="sl-bc__pace">
      <b>{`${moment.busiest} people`}</b>{` in the busiest ${BIN_SECONDS} s · ${formatPace(moment.pace)} usual pace`}
    </p>
  )
  if (moment.doing === null) {
    return (
      <>
        {when}
        <h3>Not sure what chat was doing.</h3>
        <p className="sl-bc__reason">{moment.notSure}</p>
        {pace}
      </>
    )
  }
  const rows: Array<[string, string]> = [
    ['What chat was doing', moment.doing],
    ['Aimed at', moment.aimedAt],
    ['How chat felt', moment.felt],
  ]
  return (
    <>
      {when}
      <h3>{`${moment.about}.`}</h3>
      <dl className="sl-bc__rows">
        {rows.map(([term, value]) => (
          <div key={term}>
            <dt>{term}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {pace}
    </>
  )
}

/**
 * BrainChat, coming later (board extension-brainchat 11-22, ★ B1): under the demo, a card that says what BrainChat
 * will do and shows it on the /brainchat demo's made-up stream. The line draws in once; the busiest three moments are
 * pins, the busiest pressed, and pressing another swaps the read-out. No date, no sign-up, nothing collected.
 */
export function LandingBrainChat() {
  const reduced = useMatchMedia(REDUCED_MOTION)
  const first = CHART.pins[0]!.n
  const [pressed, setPressed] = useState(first)
  const [shown, setShown] = useState(first)
  const [swapping, setSwapping] = useState(false)
  /** still: drawn as is (no script, reduced motion, or already on screen); ready: waiting out of view; on: drawing. */
  const [draw, setDraw] = useState<'still' | 'ready' | 'on'>('still')
  const chart = useRef<HTMLDivElement>(null)
  const drawn = useRef(false)
  const swapTimer = useRef(0)

  useEffect(() => {
    if (reduced) {
      setDraw((current) => (current === 'ready' ? 'still' : current))
      return undefined
    }
    const el = chart.current
    if (drawn.current || !el || typeof IntersectionObserver === 'undefined') return undefined
    const box = el.getBoundingClientRect()
    if (box.bottom > 0 && box.top < window.innerHeight) {
      drawn.current = true
      return undefined
    }
    setDraw('ready')
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      io.disconnect()
      drawn.current = true
      setDraw('on')
    }, { threshold: 0.35 })
    io.observe(el)
    return () => io.disconnect()
  }, [reduced])

  useEffect(() => () => clearTimeout(swapTimer.current), [])

  const pick = (n: number) => {
    if (n === pressed) return
    setPressed(n)
    clearTimeout(swapTimer.current)
    if (reduced) {
      setShown(n)
      setSwapping(false)
      return
    }
    setSwapping(true)
    swapTimer.current = window.setTimeout(() => {
      setShown(n)
      setSwapping(false)
    }, SWAP_OUT_MS)
  }

  return (
    <section className="sl-section sl-bc-section" aria-labelledby="brainchat-title">
      <div className="sl-container">
        <div className="sl-bc" data-testid="landing-brainchat">
          <div className="sl-bc__copy">
            <span className="sl-bc__soon">Coming later</span>
            <h2 id="brainchat-title">BrainChat</h2>
            <p>Reads Twitch chat around a moment and says what it was about, who it was aimed at and how chat felt.</p>
            <p className="sl-bc__note">
              <b>It isn&rsquo;t out yet.</b> There&rsquo;s no date and nothing to sign up for.
            </p>
            <Link to="/brainchat" className={buttonClass('outline', 'default', { className: 'sl-bc__link' })}>
              See the demo
              <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </div>
          <div className="sl-bc__demo">
            <div className="sl-bc__head">
              <span><b>{STREAM_TITLE}</b> · made-up stream</span>
              <span>people chatting per 10 s</span>
            </div>
            <div className="sl-bc__chart" ref={chart} data-draw={draw}>
              <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="none" aria-hidden="true">
                <line className="sl-bc__base" x1="0" x2={CHART_W} y1={CHART.base.toFixed(1)} y2={CHART.base.toFixed(1)} vectorEffect="non-scaling-stroke" />
                <path className="sl-bc__area" d={CHART.area} />
                <path className="sl-bc__line" d={CHART.line} vectorEffect="non-scaling-stroke" />
              </svg>
              {CHART.pins.map((pin, i) => (
                <button
                  key={pin.n}
                  type="button"
                  className="sl-bc__pin"
                  aria-pressed={pin.n === pressed}
                  aria-label={`Moment ${pin.n}, ${formatClock(momentByNumber(pin.n).at)}`}
                  style={{ '--x': pin.x.toFixed(2), '--y': pin.y.toFixed(2), '--d': `${PIN_DELAY_MS + i * PIN_STEP_MS}ms` } as Vars}
                  onClick={() => pick(pin.n)}
                >
                  {pin.n}
                </button>
              ))}
            </div>
            <div className="sl-bc__axis" aria-hidden="true">
              {CHART.hours.map((h) => (
                <span key={h} style={{ '--x': (((h * 3600) / STREAM_SECONDS) * 100).toFixed(2) } as Vars}>{formatClock(h * 3600)}</span>
              ))}
            </div>
            <div className="sl-bc__read" data-swapping={swapping ? '' : undefined} aria-live="polite">
              <ReadOut moment={momentByNumber(shown)} />
            </div>
            <p className="sl-bc__fine">The stream, the chat and the counts are made up.</p>
          </div>
        </div>
      </div>
    </section>
  )
}
