import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Pause, Play, RotateCcw } from 'lucide-react'
import { useMatchMedia } from '../../ui/hooks/useMatchMedia'
import { useInView } from '../../ui/components/landing/useInView'
import { Emote } from './brainchatEmotes'
import {
  answerQuestion,
  BIN_SECONDS,
  DEMO,
  formatClock,
  formatLength,
  formatPace,
  parseTalk,
  QUESTIONS,
  REPLAY_SPEED,
  STREAM_SECONDS,
  STREAM_TITLE,
  WINDOW_SECONDS,
  type DemoMoment,
} from './brainchatDemoData'

type Vars = CSSProperties & Record<`--${string}`, string | number>

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'
const VISIBLE_LINES = 12
const CHART_W = 1000
const CHART_H = 160
/** Bins drawn per point: the max of each 3, so every peak keeps its height. */
const CHART_GROUP = 3
/** Two chips closer than this (in % of the line) take two rows. */
const CHIP_MIN_GAP = 6
const HOUR_TICKS = Array.from({ length: Math.floor(STREAM_SECONDS / 3600) + 1 }, (_, h) => h)
const WINDOW_MINUTES = WINDOW_SECONDS / 60

const momentByNumber = (n: number): DemoMoment => DEMO.moments[n - 1]!
/** Every moment's bars share one scale, so a quiet moment looks quiet. */
const BUSIEST_BIN = Math.max(...DEMO.moments.map(m => m.busiest))
const isBusiest = (n: number) => DEMO.busiestThree.includes(n)

/** Where each moment sits on the stream line, in % of its box. */
function useChartGeometry() {
  return useMemo(() => {
    const { series } = DEMO
    const yMax = Math.max(...series) * 1.18
    const toY = (value: number) => CHART_H - (value / yMax) * CHART_H
    const points: string[] = []
    for (let i = 0; i < series.length; i += CHART_GROUP) {
      const group = series.slice(i, i + CHART_GROUP)
      const x = ((i + group.length / 2) * BIN_SECONDS / STREAM_SECONDS) * CHART_W
      points.push(`${x.toFixed(1)},${toY(Math.max(...group)).toFixed(1)}`)
    }
    const line = `M${points.join('L')}`
    const area = `${line}L${CHART_W},${CHART_H}L0,${CHART_H}Z`
    const lastX: number[] = []
    const marks = DEMO.moments.map((moment) => {
      const anchorBin = Math.floor(moment.at / BIN_SECONDS)
      const x = ((anchorBin + 0.5) * BIN_SECONDS / STREAM_SECONDS) * 100
      const y = (toY(series[anchorBin]!) / CHART_H) * 100
      const fits = (row: number) => lastX[row] === undefined || x - lastX[row]! >= CHIP_MIN_GAP
      const lane = fits(0) || !fits(1) ? 0 : 1
      lastX[lane] = x
      return { n: moment.n, x, y, lane }
    })
    return { line, area, marks }
  }, [])
}

export function BrainChatDemo() {
  const reduceMotion = useMatchMedia(REDUCED_MOTION, false)
  const { ref, inView } = useInView()
  const geometry = useChartGeometry()

  // 'done' is the drawn page the prerender ships; the intro hides the line only once this script runs.
  const [intro, setIntro] = useState<'done' | 'pending' | 'drawing'>('done')
  const [selected, setSelected] = useState(DEMO.busiestThree[0]!)
  const [questionId, setQuestionId] = useState<string | null>(null)
  const [playhead, setPlayhead] = useState(WINDOW_SECONDS)
  const [playing, setPlaying] = useState(false)
  const playheadRef = useRef(WINDOW_SECONDS)
  const introStarted = useRef(false)

  const seek = useCallback((seconds: number) => {
    playheadRef.current = seconds
    setPlayhead(seconds)
  }, [])

  // First look: the line draws left to right and the busiest moment's chat plays once. Nothing loops.
  // The media query is read here too: on the hydrating render the hook still holds the server answer.
  useEffect(() => {
    const prefersReduced = typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION).matches
    if (reduceMotion || prefersReduced || introStarted.current) return
    if (!inView) {
      setIntro('pending')
      return
    }
    introStarted.current = true
    setIntro('pending')
    const frame = requestAnimationFrame(() => {
      setIntro('drawing')
      seek(0)
      setPlaying(true)
    })
    return () => cancelAnimationFrame(frame)
  }, [inView, reduceMotion, seek])

  useEffect(() => {
    if (reduceMotion) setIntro('done')
  }, [reduceMotion])

  useEffect(() => {
    if (!playing) return
    let frame = 0
    let last: number | null = null
    const tick = (now: number) => {
      const elapsed = last === null ? 0 : Math.min(0.1, (now - last) / 1000)
      last = now
      const next = Math.min(WINDOW_SECONDS, playheadRef.current + elapsed * REPLAY_SPEED)
      seek(next)
      if (next >= WINDOW_SECONDS) {
        setPlaying(false)
        return
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, seek])

  const choose = useCallback((n: number) => {
    setSelected(n)
    if (reduceMotion) {
      seek(WINDOW_SECONDS)
      setPlaying(false)
    } else {
      seek(0)
      setPlaying(true)
    }
  }, [reduceMotion, seek])

  const togglePlay = useCallback(() => {
    if (playing) {
      setPlaying(false)
      return
    }
    if (playheadRef.current >= WINDOW_SECONDS) seek(0)
    setPlaying(true)
  }, [playing, seek])

  const moment = momentByNumber(selected)
  const question = QUESTIONS.find(q => q.id === questionId) ?? null
  const answer = question ? answerQuestion(question) : null
  const matched = new Set(answer?.matches.map(m => m.n) ?? [])

  return (
    <section ref={ref} className="bc-demo" data-testid="brainchat-demo" data-intro={intro} aria-labelledby="bc-demo-title"
      onTransitionEnd={(event) => {
        // Once the line has drawn, marks stop waiting their turn: later changes answer at once.
        if (intro === 'drawing' && event.propertyName === 'clip-path') setIntro('done')
      }}>
      <header className="bc-demo__bar">
        <span className="bc-demo__brand"><Emote name="calmBlob" size={22} />BrainChat</span>
        <div className="bc-demo__stream">
          <h2 id="bc-demo-title" className="bc-demo__title">{STREAM_TITLE}</h2>
          <span>Made-up stream · {formatLength(STREAM_SECONDS)} · {DEMO.moments.length} moments</span>
        </div>
      </header>

      <div className="bc-chart-block">
        <p className="bc-demo__label">People chatting per {BIN_SECONDS} s · usual pace {DEMO.usual}</p>
        <div className="bc-chart">
          <svg className="bc-chart__svg" viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
            <path className="bc-chart__area" d={geometry.area} />
            <path className="bc-chart__line" d={geometry.line} vectorEffect="non-scaling-stroke" />
          </svg>
          {geometry.marks.map((mark) => {
            const m = momentByNumber(mark.n)
            const face = isBusiest(mark.n) ? m.face : null
            const state = [
              'bc-peak',
              face ? 'bc-peak--face' : m.doing === null ? 'bc-peak--unsure' : '',
              mark.n === selected ? 'is-selected' : '',
              answer ? (matched.has(mark.n) ? 'is-match' : 'is-dim') : '',
            ].filter(Boolean).join(' ')
            return (
              <span key={mark.n} className={state} style={{ '--x': mark.x.toFixed(2), '--y': mark.y.toFixed(2) } as Vars} aria-hidden="true">
                {face ? <Emote name={face.name} size={22} /> : null}
              </span>
            )
          })}
          {geometry.marks.filter(mark => mark.n === selected).map(mark => (
            <span key={`guide-${mark.n}`} className="bc-guide" style={{ '--x': mark.x.toFixed(2), '--y': mark.y.toFixed(2) } as Vars} aria-hidden="true" />
          ))}
        </div>
        <div className="bc-chips" role="group" aria-label="Moments on this stream">
          {geometry.marks.map((mark) => {
            const m = momentByNumber(mark.n)
            const label = m.doing === null ? `Moment ${m.n}, ${formatClock(m.at)}, not sure` : `Moment ${m.n}, ${formatClock(m.at)}, ${m.about.toLowerCase()}`
            const state = [
              'bc-chip',
              mark.lane ? 'bc-chip--low' : '',
              m.doing === null ? 'bc-chip--unsure' : '',
              answer ? (matched.has(mark.n) ? 'is-match' : 'is-dim') : '',
            ].filter(Boolean).join(' ')
            return (
              <button key={mark.n} type="button" className={state} style={{ '--x': mark.x.toFixed(2) } as Vars}
                aria-pressed={mark.n === selected} aria-label={label} onClick={() => choose(mark.n)}>
                {m.n}
              </button>
            )
          })}
        </div>
        <div className="bc-axis" aria-hidden="true">
          {HOUR_TICKS.map(h => (
            <span key={h} style={{ '--x': ((h * 3600) / STREAM_SECONDS * 100).toFixed(2) } as Vars}>{formatClock(h * 3600)}</span>
          ))}
        </div>
      </div>

      <div className="bc-cards-block">
        <p className="bc-demo__label">Busiest {DEMO.busiestThree.length} of {DEMO.moments.length} · top emotes typed</p>
        <div className="bc-cards">
          {DEMO.busiestThree.map((n) => {
            const m = momentByNumber(n)
            return (
              <button key={n} type="button" className="bc-card" aria-pressed={n === selected} onClick={() => choose(n)}
                data-testid="brainchat-busiest-card">
                <span className="bc-card__face">{m.face ? <Emote name={m.face.name} size={36} /> : null}</span>
                <span className="bc-card__when"><span className="bc-card__n">{m.n}</span>{formatClock(m.at)}</span>
                <span className="bc-card__about">{m.about}</span>
                <span className="bc-card__pace">{m.busiest} people in {BIN_SECONDS} s · {formatPace(m.pace)} usual pace</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="bc-moment">
        <Replay moment={moment} playhead={playhead} playing={playing} onToggle={togglePlay} />
        <Read key={moment.n} moment={moment} />
      </div>

      <div className="bc-ask">
        <p className="bc-demo__label" id="bc-ask-title">Ask about this stream</p>
        <div className="bc-ask__questions" role="group" aria-labelledby="bc-ask-title">
          {QUESTIONS.map(q => (
            <button key={q.id} type="button" className="bc-ask__question" aria-pressed={q.id === questionId}
              onClick={() => setQuestionId(current => (current === q.id ? null : q.id))}>
              {q.label}
            </button>
          ))}
        </div>
        <div className="bc-ask__answer-slot" aria-live="polite">
          {answer && question ? (
            <div key={question.id} className="bc-answer" data-testid="brainchat-answer">
              <p className="bc-answer__steps">{answer.steps}</p>
              <p className="bc-answer__lead">{answer.lead}</p>
              <ul className="bc-answer__list">
                {answer.matches.map(m => (
                  <li key={m.n}>
                    <button type="button" className="bc-answer__row" aria-pressed={m.n === selected} onClick={() => choose(m.n)}>
                      <span className="bc-answer__time">{formatClock(m.at)}</span>
                      <span className="bc-answer__about">{m.about}</span>
                      <span className="bc-answer__aim">at {m.aimedAt} · {m.felt}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {answer.leftOut.length ? (
                <p className="bc-answer__left-out">
                  Left out {answer.leftOut.length === 1 ? 'one moment' : `${answer.leftOut.length} moments`} BrainChat wasn&rsquo;t sure about (<span className="bc-time">{answer.leftOut.map(m => formatClock(m.at)).join(', ')}</span>).
                </p>
              ) : null}
            </div>
          ) : (
            <p className="bc-ask__hint">Pick a question. The answer marks its moments on the line.</p>
          )}
        </div>
      </div>
    </section>
  )
}

function Replay({ moment, playhead, playing, onToggle }: { moment: DemoMoment; playhead: number; playing: boolean; onToggle: () => void }) {
  let shown = 0
  while (shown < moment.lines.length && moment.lines[shown]!.t <= playhead) shown += 1
  const first = Math.max(0, shown - VISIBLE_LINES)
  const visible = moment.lines.slice(first, shown)
  const anchor = moment.at - moment.windowStart
  const ended = playhead >= WINDOW_SECONDS
  const controlLabel = playing ? 'Pause' : ended ? 'Replay' : 'Play'

  return (
    <div className="bc-replay">
      <div className="bc-replay__head">
        <p className="bc-replay__title">Chat around <span className="bc-time">{formatClock(moment.at)}</span></p>
        <span className="bc-replay__clock">{formatClock(moment.windowStart + playhead)} · {REPLAY_SPEED}× speed</span>
        <button type="button" className="bc-replay__toggle" onClick={onToggle} aria-label={`${controlLabel} the chat replay`}>
          {playing ? <Pause aria-hidden="true" /> : ended ? <RotateCcw aria-hidden="true" /> : <Play aria-hidden="true" />}
          <span>{controlLabel}</span>
        </button>
      </div>
      <p className="bc-sr">
        Made-up chat replay: {moment.lines.length} lines from {moment.people} people in the {WINDOW_MINUTES} minutes around {formatClock(moment.at)}.
      </p>
      <ol className="bc-replay__lines" aria-hidden="true" data-testid="brainchat-replay">
        {visible.map((line, i) => (
          <li key={`${moment.n}-${first + i}`} className={`bc-line bc-line--w${line.who % 6}`}>
            <span className="bc-line__dot" />
            <span className="bc-line__text">
              {parseTalk(line.text).map((part, k) => (part.kind === 'emote'
                ? <Emote key={k} name={part.name} size={20} />
                : <span key={k}>{part.text}</span>))}
            </span>
          </li>
        ))}
      </ol>
      <div className="bc-pace" aria-hidden="true">
        <div className="bc-pace__bars">
          {moment.bins.map((people, j) => (
            <span key={j} className={j * BIN_SECONDS < playhead ? 'bc-pace__bar is-past' : 'bc-pace__bar'}
              style={{ '--h': ((people / BUSIEST_BIN) * 100).toFixed(1) } as Vars} />
          ))}
          <span className="bc-pace__anchor" style={{ '--x': ((anchor / WINDOW_SECONDS) * 100).toFixed(2) } as Vars} />
          <span className="bc-pace__head" style={{ '--x': ((playhead / WINDOW_SECONDS) * 100).toFixed(2) } as Vars} />
        </div>
        <div className="bc-pace__scale">
          <span>{formatClock(moment.windowStart)}</span>
          <span>people per {BIN_SECONDS} s</span>
          <span>{formatClock(moment.windowStart + WINDOW_SECONDS)}</span>
        </div>
      </div>
    </div>
  )
}

function Read({ moment }: { moment: DemoMoment }) {
  if (moment.doing === null) {
    return (
      <div className="bc-read bc-read--unsure" data-testid="brainchat-read">
        <p className="bc-read__kicker">Moment {moment.n} · {formatClock(moment.at)}</p>
        <h3 className="bc-read__title">Not sure what chat was doing.</h3>
        <p className="bc-read__reason">{moment.notSure}</p>
        <SaidMost moment={moment} />
        <p className="bc-read__evidence">
          It read {moment.lines.length} lines from {moment.people} people in these {WINDOW_MINUTES} minutes, and says so instead of guessing.
        </p>
      </div>
    )
  }
  const rows: Array<[string, string]> = [
    ['What chat was doing', moment.doing],
    ['Aimed at', moment.aimedAt],
    ['How chat felt', moment.felt],
    ['How it spread', moment.spread],
  ]
  return (
    <div className="bc-read" data-testid="brainchat-read">
      <p className="bc-read__kicker">Moment {moment.n} · {formatClock(moment.at)}</p>
      <h3 className="bc-read__title">{moment.about}.</h3>
      <dl className="bc-read__rows">
        {rows.map(([term, value], i) => (
          <div key={term} className="bc-read__row" style={{ '--i': i } as Vars}>
            <dt>{term}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <SaidMost moment={moment} />
      <p className="bc-read__evidence">
        {moment.face ? (
          <>
            <Emote name={moment.face.name} size={20} />
            <span>{moment.face.name} in {moment.face.lines} of {moment.lines.length} lines · sent by {moment.face.people} people</span>
          </>
        ) : (
          <span>{moment.lines.length} lines from {moment.people} people · no one emote stood out</span>
        )}
      </p>
      <p className="bc-read__pace">{moment.busiest} people in the busiest {BIN_SECONDS} s · {formatPace(moment.pace)} usual pace</p>
    </div>
  )
}

function SaidMost({ moment }: { moment: DemoMoment }) {
  return (
    <div className="bc-said" data-testid="brainchat-said-most">
      <p className="bc-said__label">Said most in these {WINDOW_MINUTES} minutes</p>
      <ol className="bc-said__list">
        {moment.saidMost.map((said, i) => (
          <li key={said.text} className="bc-said__row" style={{ '--i': i } as Vars}>
            <span className="bc-said__text">
              {parseTalk(said.text).map((part, k) => (part.kind === 'emote'
                ? <Emote key={k} name={part.name} size={18} />
                : <span key={k}>{part.text}</span>))}
            </span>
            <span className="bc-said__n">{said.lines} lines</span>
          </li>
        ))}
      </ol>
    </div>
  )
}
