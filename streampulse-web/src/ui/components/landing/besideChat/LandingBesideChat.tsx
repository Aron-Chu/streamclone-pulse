import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { RotateCcw } from 'lucide-react'
import tabsChat from '../../../../demo/pictures/beside-tabs-chat.webp'
import tabsPulse from '../../../../demo/pictures/beside-tabs-pulse.webp'
import vodBase from '../../../../demo/pictures/beside-vod-base.webp'
import vodCard from '../../../../demo/pictures/beside-vod-card.webp'
import vodJumped from '../../../../demo/pictures/beside-vod-jumped.webp'
import settingsBar from '../../../../demo/pictures/beside-settings.webp'
import catOpener from '../../../../demo/pictures/cat-opener.webp'
import catSetup from '../../../../demo/pictures/cat-setup.webp'
import { useMatchMedia } from '../../../hooks/useMatchMedia'
import { DEMO_PLAY_EVENT, takeDemoPlayRequest } from '../demoPlayEvent'
// Types only: three.js and the scene load on their own, near the demo and only with motion and WebGL.
import type { CatStreamScene } from './catStreamScene'
import { clock, MOMENT_S, STILL_VT, STREAM_SECONDS } from './catStreamTimes'
import {
  AT,
  BEATS,
  CALM,
  CAPS,
  camFor,
  FLOOD,
  FROM_S,
  MAX_LINES,
  MAX_LOOPS,
  PLAYER_W,
  SCROLL,
  SCRUB_STEP_MS,
  SCRUB_STEPS,
  sceneRatio,
  STAGE_MAX_W,
  stageLayout,
  stillChat,
  TIMES,
  TO_S,
  WORLD_H,
  type Beat,
  type Cam,
  type DemoChatLine,
  type StageLayout,
} from './besideChatModel'
import './besideChat.css'

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'
/** The other top moment in the panel picture, about 0:38:00. */
const OTHER_MOMENT_S = 2280
/** The smooth scroll from the cue takes about this long; the run starts when it is over. */
const CUE_SCROLL_MS = 650
/** A cue press older than this, never answered, was on another visit to the page. */
const STALE_CUE_MS = 10_000
/** The stream draws at most this often: smooth enough for a selfie video, and half the GPU work of 60 fps. */
const FRAME_MS = 1000 / 30
/** Canvases whose WebGL context the browser took back; the scene is never made on them again. */
const lostCanvases = new WeakSet<HTMLCanvasElement>()

type Vars = CSSProperties & Record<`--${string}`, string | number>

interface Video {
  /** Held on one stream second... */
  still?: number
  /** ...or playing from `from` since `since` (performance.now()). */
  from?: number
  since?: number
}

interface Runtime {
  scene: CatStreamScene | null
  visible: boolean
  started: boolean
  /** The step the visitor picked, or null while it plays: a re-made run (motion setting changed) picks up from here. */
  held: Beat | null
  video: Video
  scrubbing: boolean
  raf: number
  shownClock: string
}

interface Elements {
  stage: HTMLDivElement
  world: HTMLDivElement
  panel: HTMLDivElement
  lines: HTMLDivElement
  cursor: HTMLSpanElement
  time: HTMLSpanElement
  capN: HTMLElement
  capH: HTMLElement
  capP: HTMLElement
  stepsCapB: HTMLElement
  stepsCapText: HTMLElement
  steps: HTMLButtonElement[]
}

interface Run {
  still(beat: Beat): void
  restart(): void
  applyLayout(): void
  /** Draws the current frame now and keeps drawing while the video plays and the stage shows. */
  refresh(): void
  destroy(): void
}

/** Whether this browser can draw WebGL 2, which three.js needs; asked before the scene's code is fetched. */
function hasWebGL(): boolean {
  try {
    const probe = document.createElement('canvas')
    const gl = probe.getContext('webgl2')
    if (!gl) return false
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return true
  } catch {
    return false
  }
}

/** Runs `fn` when the browser is idle (within about a second), or on the next task without requestIdleCallback. */
function whenIdle(fn: () => void): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(fn, { timeout: 1200 })
    return () => window.cancelIdleCallback(id)
  }
  const id = window.setTimeout(fn, 0)
  return () => clearTimeout(id)
}

function chatLine(line: DemoChatLine): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'es-cl'
  const who = document.createElement('b')
  who.style.color = line.color
  who.textContent = line.name
  el.append(who, document.createTextNode(`: ${line.text}`))
  return el
}

/**
 * The run, ported from the board's e1.js: timers move the pointer, the panel picture and the camera, and set the
 * stage's data-beat and data-cam for the CSS. Nothing here re-renders React. The stream second (`rt.video`) drives
 * the three.js frame and the player's clock.
 */
function createRun(els: Elements, rt: Runtime, layout: () => StageLayout, reduced: boolean): Run {
  const { stage, world, panel, lines, cursor, time, capN, capH, capP, stepsCapB, stepsCapText, steps } = els
  let timers: number[] = []
  let chatTimer = 0
  let scrubTimer = 0
  let cueTimer = 0
  let chatIndex = 0
  let loops = 0
  let cam: Cam = 'out'

  const at = (ms: number, fn: () => void) => { timers.push(window.setTimeout(fn, ms)) }
  const halt = () => {
    timers.forEach(clearTimeout)
    timers = []
    clearInterval(chatTimer)
    clearInterval(scrubTimer)
    rt.scrubbing = false
  }

  const playing = () => rt.video.since !== undefined
  const vtNow = () => (rt.video.since !== undefined ? (rt.video.from ?? FROM_S) + (performance.now() - rt.video.since) / 1000 : rt.video.still ?? STILL_VT[3])
  const setClock = (text: string) => {
    if (text === rt.shownClock) return
    rt.shownClock = text
    time.textContent = text
  }
  const draw = () => {
    const vt = vtNow()
    rt.scene?.render(vt)
    if (!rt.scrubbing) setClock(clock(vt))
  }
  let lastDraw = Number.NEGATIVE_INFINITY
  const loop = (now: number) => {
    rt.raf = 0
    // At most 30 frames a second; a frame not yet due waits for the next one, even when the video is held.
    const due = now - lastDraw >= FRAME_MS - 4
    if (due) {
      lastDraw = now
      draw()
    }
    if ((playing() || !due) && rt.visible) rt.raf = requestAnimationFrame(loop)
  }
  const kick = () => {
    if (!rt.raf && rt.visible) rt.raf = requestAnimationFrame(loop)
  }
  const hold = (vt: number) => {
    rt.video = { still: vt }
    setClock(clock(vt))
    kick()
  }
  const runFrom = (vt: number) => {
    rt.video = { from: vt, since: performance.now() }
    kick()
  }

  const setCam = (next: Cam) => {
    cam = next
    const [x, y, s] = layout().cam[next]
    stage.dataset.cam = next
    world.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${s.toFixed(4)})`
  }
  const setBeat = (beat: Beat) => {
    stage.dataset.beat = String(beat)
    panel.style.transform = `translateY(${-SCROLL[beat]}px)`
    steps.forEach((step, i) => {
      if (i === beat) step.setAttribute('aria-current', 'step')
      else step.removeAttribute('aria-current')
    })
    capN.textContent = `${beat + 1} of ${BEATS.length}`
    capH.textContent = BEATS[beat]
    capP.textContent = CAPS[beat]
    stepsCapB.textContent = `${BEATS[beat]}. `
    stepsCapText.textContent = CAPS[beat]
  }
  /** Changes without the transitions, then lets them run again two frames on. */
  const snap = (change: () => void) => {
    stage.classList.add('es-snap')
    change()
    void stage.offsetWidth
    requestAnimationFrame(() => requestAnimationFrame(() => stage.classList.remove('es-snap')))
  }
  const snapTo = (beat: Beat) => snap(() => { setBeat(beat); setCam(camFor(beat, layout().phone)) })

  const chat = (every: number) => {
    clearInterval(chatTimer)
    chatTimer = window.setInterval(() => {
      lines.append(chatLine(FLOOD[chatIndex % FLOOD.length]!))
      chatIndex += 1
      while (lines.childElementCount > MAX_LINES) lines.firstElementChild?.remove()
    }, every)
  }
  const pointTo = ([x, y]: readonly [number, number]) => { cursor.style.transform = `translate(${x}px, ${y}px)` }
  const click = () => {
    cursor.classList.remove('click')
    void cursor.getBoundingClientRect()
    cursor.classList.add('click')
  }

  const still = (beat: Beat) => {
    halt()
    lines.replaceChildren(...(beat === 0 ? stillChat() : []).map(chatLine))
    cursor.style.opacity = '0'
    hold(STILL_VT[beat])
    snapTo(beat)
  }

  const play = () => {
    halt()
    if (reduced) { still(3); return }
    chatIndex = 0
    lines.replaceChildren(...CALM.map(chatLine))
    cursor.style.opacity = '0'
    pointTo(AT.chat)
    runFrom(FROM_S)
    snapTo(0)
    chat(420)
    at(TIMES.chatFast, () => chat(170))
    at(TIMES.chatFlood, () => chat(75))
    at(TIMES.camIn, () => setCam('in'))
    at(TIMES.pointerShows, () => { cursor.style.opacity = '1'; pointTo(AT.tab) })
    at(TIMES.tabClick, click)
    at(TIMES.pulseOpens, () => {
      clearInterval(chatTimer)
      // The panel is hidden until now: put it at its first place without a slide, then let it fade in.
      stage.classList.add('es-snap')
      panel.style.transform = `translateY(${-SCROLL[1]}px)`
      void stage.offsetWidth
      stage.classList.remove('es-snap')
      setBeat(1)
    })
    at(TIMES.toSpike, () => pointTo(AT.spike))
    at(TIMES.topMoments, () => { setBeat(2); pointTo(AT.row) })
    at(TIMES.rowClick, click)
    at(TIMES.card, () => { setBeat(3); pointTo(AT.jump) })
    at(TIMES.jumpClick, click)
    at(TIMES.jumped, () => setBeat(4))
    at(TIMES.landed, () => {
      cursor.style.opacity = '0'
      setCam(camFor(4, layout().phone))
      // The video lands at 1:36:55 and plays on to the moment; the clock runs there in a few quick steps.
      const from = vtNow()
      runFrom(TO_S)
      rt.scrubbing = true
      let step = 0
      scrubTimer = window.setInterval(() => {
        step += 1
        setClock(clock(from + (TO_S - from) * Math.min(1, step / SCRUB_STEPS)))
        if (step >= SCRUB_STEPS) {
          clearInterval(scrubTimer)
          rt.scrubbing = false
        }
      }, SCRUB_STEP_MS)
    })
    at(TIMES.loop, () => {
      loops += 1
      if (loops < MAX_LOOPS) play()
      else hold(vtNow())
    })
  }

  const restart = () => {
    loops = 0
    play()
  }

  // Starts once, when most of the stage is on screen; draws only while any of it is.
  const autoplay = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return
    autoplay?.disconnect()
    if (rt.started) return
    rt.started = true
    play()
  }, { threshold: 0.45 })
  const seen = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver((entries) => {
    const entry = entries[entries.length - 1]
    rt.visible = Boolean(entry?.isIntersecting)
    if (rt.visible) kick()
  })
  if (!seen) rt.visible = true
  autoplay?.observe(stage)
  seen?.observe(stage)

  /** The visitor took over (a step, Play again or the hero's cue): the autoplay never starts on top of them. */
  const takeOver = () => {
    rt.started = true
    autoplay?.disconnect()
    clearTimeout(cueTimer)
  }
  /** The run starts when the cue's smooth scroll is over: at once if this demo loaded after it. */
  const cue = (askedAt: number) => {
    takeOver()
    rt.held = null
    clearTimeout(cueTimer)
    cueTimer = window.setTimeout(restart, reduced ? 0 : Math.max(0, CUE_SCROLL_MS - (performance.now() - askedAt)))
  }
  const onCue = () => cue(takeDemoPlayRequest() ?? performance.now())
  window.addEventListener(DEMO_PLAY_EVENT, onCue)

  // A run made again over one that had started keeps the visitor's step, or plays on from the top.
  if (rt.held !== null) still(rt.held)
  else if (rt.started) restart()
  else still(3)
  // The cue was pressed while this demo's code was still loading (a request left from another visit is too old).
  const pending = takeDemoPlayRequest()
  if (pending !== null && performance.now() - pending < STALE_CUE_MS) cue(pending)

  return {
    still(beat) {
      takeOver()
      rt.held = beat
      still(beat)
    },
    restart() {
      takeOver()
      rt.held = null
      restart()
    },
    applyLayout() {
      // Across the phone width, a pose the new shape never uses becomes its pose for the step on screen.
      const phone = layout().phone
      const beat = Number(stage.dataset.beat ?? 3) as Beat
      const next: Cam = phone ? (cam === 'out' ? camFor(beat, true) : cam) : (cam === 'low' ? 'out' : cam)
      snap(() => setCam(next))
      rt.scene?.setSize(PLAYER_W, WORLD_H, sceneRatio(layout(), window.devicePixelRatio))
      kick()
    },
    refresh() {
      draw()
      kick()
    },
    destroy() {
      halt()
      clearTimeout(cueTimer)
      cancelAnimationFrame(rt.raf)
      rt.raf = 0
      autoplay?.disconnect()
      seen?.disconnect()
      window.removeEventListener(DEMO_PLAY_EVENT, onCue)
    },
  }
}

/**
 * The extension beside Twitch chat (board extension-brainchat 11-22, ★ E1 push-in): a made-up stream of a cat on a
 * store shelf filming itself, its chat floods, and the Pulse tab marks the spike, lists the top moments and jumps the
 * video to just before the one picked. The camera moves in on the column for steps 2-4. Under reduced motion the
 * stage holds one step and the stream is a still picture; the three.js stream loads only with motion and WebGL.
 */
export function LandingBesideChat() {
  const reduced = useMatchMedia(REDUCED_MOTION)
  const [layout, setLayout] = useState<StageLayout>(() => stageLayout(STAGE_MAX_W))
  const latest = useRef(layout)
  latest.current = layout

  const host = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const world = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const lines = useRef<HTMLDivElement>(null)
  const cursor = useRef<HTMLSpanElement>(null)
  const time = useRef<HTMLSpanElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const capN = useRef<HTMLElement>(null)
  const capH = useRef<HTMLElement>(null)
  const capP = useRef<HTMLParagraphElement>(null)
  const stepsCapB = useRef<HTMLElement>(null)
  const stepsCapText = useRef<HTMLSpanElement>(null)
  const steps = useRef<HTMLDivElement>(null)
  const rt = useRef<Runtime>({ scene: null, visible: false, started: false, held: null, video: { still: STILL_VT[3] }, scrubbing: false, raf: 0, shownClock: '' })
  const run = useRef<Run | null>(null)

  // The stage's size follows the content column.
  useLayoutEffect(() => {
    const el = host.current
    if (!el) return undefined
    const measure = () => {
      const width = el.clientWidth
      if (!width) return
      setLayout((prev) => {
        const next = stageLayout(width)
        return next.width === prev.width && next.height === prev.height ? prev : next
      })
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useLayoutEffect(() => {
    const els = {
      stage: stage.current, world: world.current, panel: panel.current, lines: lines.current, cursor: cursor.current, time: time.current,
      capN: capN.current, capH: capH.current, capP: capP.current, stepsCapB: stepsCapB.current, stepsCapText: stepsCapText.current,
    }
    if (Object.values(els).some((el) => !el)) return undefined
    const stepButtons = Array.from(steps.current?.querySelectorAll<HTMLButtonElement>('.es-step') ?? [])
    const current = createRun({ ...(els as Omit<Elements, 'steps'>), steps: stepButtons }, rt.current, () => latest.current, reduced)
    run.current = current
    return () => {
      current.destroy()
      if (run.current === current) run.current = null
    }
  }, [reduced])

  useLayoutEffect(() => {
    run.current?.applyLayout()
  }, [layout])

  // The stream: fetched about 600 px before the stage shows, never under reduced motion or without WebGL, and not on
  // phones, where the camera stays on the column and the player is never on screen.
  const phone = layout.phone
  useEffect(() => {
    const stageEl = stage.current
    const canvasEl = canvas.current
    if (reduced || phone || !stageEl || !canvasEl || lostCanvases.has(canvasEl) || typeof IntersectionObserver === 'undefined') return undefined
    const state = rt.current
    let cancelled = false
    let cancelIdle = () => {}
    let scene: CatStreamScene | null = null
    const drop = () => {
      delete stageEl.dataset.scene
      if (state.scene === scene) state.scene = null
      scene?.dispose()
      scene = null
    }
    // The browser can take the GPU back (a driver reset, too many tabs): the pictures come back and stay.
    const onLost = () => {
      lostCanvases.add(canvasEl)
      drop()
    }
    canvasEl.addEventListener('webglcontextlost', onLost)
    const near = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      near.disconnect()
      if (!hasWebGL()) return
      import('./catStreamScene')
        .then(({ createCatStreamScene }) => {
          if (cancelled) return
          // Building the scene is a long task: it waits for an idle moment, and the pictures stay until its shaders
          // are ready, so scrolling never stalls on it.
          cancelIdle = whenIdle(() => {
            if (cancelled || lostCanvases.has(canvasEl)) return
            const made = createCatStreamScene(canvasEl)
            if (!made) return
            scene = made
            made.setSize(PLAYER_W, WORLD_H, sceneRatio(latest.current, window.devicePixelRatio))
            made.warm()
              .catch(() => { /* the first frame compiles what is left */ })
              .then(() => {
                if (cancelled || scene !== made) return
                state.scene = made
                run.current?.refresh()
                stageEl.dataset.scene = ''
              })
          })
        })
        .catch(() => { /* the pictures stay */ })
    }, { rootMargin: '600px 0px' })
    near.observe(stageEl)
    return () => {
      cancelled = true
      cancelIdle()
      near.disconnect()
      canvasEl.removeEventListener('webglcontextlost', onLost)
      drop()
    }
  }, [reduced, phone])

  const timeline: Vars = {
    '--es-from': (FROM_S / STREAM_SECONDS).toFixed(4),
    '--es-to': (TO_S / STREAM_SECONDS).toFixed(4),
  }
  const tick = (seconds: number): CSSProperties => ({ left: `${((seconds / STREAM_SECONDS) * 100).toFixed(1)}%` })

  return (
    <div
      className="es-demo"
      ref={host}
      data-phone={layout.phone ? '' : undefined}
      data-cap={layout.capLeft === null ? 'below' : 'beside'}
    >
      <div className="es" ref={stage} style={{ width: layout.width, height: layout.height }} aria-hidden="true">
        <div className="es-world" ref={world}>
          <div className="es-player">
            <img className="es-poster" src={catOpener} alt="" width={1410} height={1200} decoding="async" />
            <img className="es-poster es-poster--jump" src={catSetup} alt="" width={1410} height={1200} decoding="async" />
            <canvas className="es-canvas" ref={canvas} />
            <div className="es-ptop">
              <span className="es-ch">streampulse_demo</span>
              <span className="es-rp">Replay</span>
            </div>
            <div className="es-toast">{`▶ Jumped to ${clock(TO_S)}`}</div>
            <div className="es-pbot">
              <div className="es-tl" style={timeline}>
                <i className="es-fill" />
                <i className="es-tick" style={tick(OTHER_MOMENT_S)} />
                <i className="es-tick es-tick--hot" style={tick(MOMENT_S)} />
              </div>
              <div className="es-time">
                <span ref={time} />
                <span>{clock(STREAM_SECONDS)}</span>
              </div>
            </div>
          </div>
          <div className="es-col">
            <div className="es-tabs">
              <img className="es-tab-chat" src={tabsChat} alt="" width={340} height={59} decoding="async" />
              <img className="es-tab-pulse" src={tabsPulse} alt="" width={340} height={59} decoding="async" />
            </div>
            <div className="es-vp">
              <div className="es-chat">
                <div className="es-chathead">Chat replay</div>
                <div className="es-lines" ref={lines} />
              </div>
              <div className="es-panel" ref={panel}>
                <img className="es-p-base" src={vodBase} alt="" width={340} height={1340} decoding="async" />
                <img className="es-p-card" src={vodCard} alt="" width={340} height={900} decoding="async" />
                <img className="es-p-jump" src={vodJumped} alt="" width={340} height={24} decoding="async" />
                <span className="es-ring" />
              </div>
            </div>
            <img className="es-settings" src={settingsBar} alt="" width={340} height={60} decoding="async" />
          </div>
          <span className="es-cursor" ref={cursor}>
            <svg viewBox="0 0 24 24">
              <path d="M4 2l15 11-6.5 1 3.6 7.2-2.7 1.3-3.6-7.2L5 20z" fill="#fff" stroke="#111" strokeWidth="1.2" strokeLinejoin="round" />
            </svg>
          </span>
        </div>
        <div className="es-cap" style={{ left: layout.capLeft ?? 0, width: layout.capWidth }}>
          <b ref={capN} />
          <strong ref={capH} />
          <p ref={capP} />
        </div>
      </div>
      <div className="es-controls">
        <div className="es-steps" role="group" aria-label="Demo steps" ref={steps}>
          {BEATS.map((label, i) => (
            <button key={label} type="button" className="es-step" aria-label={`${i + 1}. ${label}`} onClick={() => run.current?.still(i as Beat)}>
              <b>{i + 1}</b>
              <span>{label}</span>
            </button>
          ))}
        </div>
        <button type="button" className="es-replay" onClick={() => run.current?.restart()}>
          <RotateCcw aria-hidden="true" />
          Play again
        </button>
      </div>
      <p className="es-steps-cap">
        <b ref={stepsCapB} />
        <span ref={stepsCapText} />
      </p>
    </div>
  )
}
