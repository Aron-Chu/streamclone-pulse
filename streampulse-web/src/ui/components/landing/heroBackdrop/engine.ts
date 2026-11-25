import type { HubActivityPoint, HubLiveChannel, HubLivePulseMoment } from '../../../../lib/publicHub'
import { sceneBusy } from '../backdropPace'
import { chatSources, heroMoments, ridgeRows, type HeroMoment } from '../heroBackdropModel'
import { mountChatColumns } from './chatColumns'
import { mountEmoteRain } from './emoteRain'
import { mountRidge } from './ridge'
import type { Part, Pointer, SearchEvent } from './shared'

/**
 * The front page's background (mix 03): the side chat columns, the emote rain and the chat ridge, on one
 * animation loop. Loaded as its own chunk after the page is idle. The loop stops while the tab is hidden,
 * and the hero's layers stop while the hero is scrolled away.
 *
 * Its motion is slow (drops rise 15-32 px a second, the light crosses a line in about 4.3 s, every 6 s), so it draws 30 frames a
 * second, 20 while the extension demo's 3D scene draws, and 60 (or the display's rate, when lower) only while
 * something quick is on: the pointer over the background, a live moment's burst, the lines rising (11-23: an idle hero
 * kept a laptop-class main thread 95 % busy). Between drawn frames it waits on a timer, not on the display: every
 * display frame asked for costs the page a full update (style, prepaint, commit), drawn or not, and a 240 Hz display
 * would ask 240 times a second.
 */

export interface StageHosts {
  stage: HTMLElement
  chat: HTMLElement | null
  ridge: HTMLCanvasElement
}

export interface BackdropInput {
  live: readonly HubLiveChannel[]
  points: readonly HubActivityPoint[]
  moments: readonly HubLivePulseMoment[]
  generatedAt?: string | null
  bucketMinutes?: number | null
}

export interface HeroBackdropController {
  setRain(host: HTMLElement | null): void
  setStage(hosts: StageHosts | null, input: BackdropInput, reduced: boolean): void
  dispose(): void
}

/** A live moment comes up about every 15 s while the hero is on screen. */
const BEAT_MIN_MS = 14_000
const BEAT_SPREAD_MS = 2_000
const FIRST_BEAT_MS = 3_500
const RIDGE_ABOVE_BUTTONS_PX = 60
const FRAME_MS = 1000 / 30
const SCENE_FRAME_MS = 1000 / 20
/** Something quick on screen draws 60 frames a second, not a fast display's 120-240. */
const QUICK_FRAME_MS = 1000 / 60
/** The display's beat, until the frames measure it. */
const VSYNC_GUESS_MS = 1000 / 60
/** A pace keeps its count of display frames until the measured ratio moves this far from it (a 165 Hz display sits at 5.5). */
const CADENCE_HOLD = 0.65
/** Back-to-back display frames measured before the timer aims straight at the due frame. */
const BEATS_KNOWN = 8
/** A drawn frame this far off a whole number of display frames since the last means the display changed: measure again. */
const BEAT_SLIP = 0.35
/** A paced frame may be up to 50 ms late before the motion slows to match. */
const MAX_DT_S = 0.1
/** How long the quick pace holds after the pointer moves over the background... */
const QUICK_POINTER_MS = 1500
/** ...after a live moment (its burst flies for up to 4.4 s)... */
const QUICK_MOMENT_MS = 4800
/** ...and after a rebuild, while the lines rise. */
const QUICK_BUILD_MS = 2200
const UI_SELECTOR = 'a, button, input, select, textarea, [role="button"], [role="option"], [role="listbox"], .site-header, .sl-search, .sl-tickwrap, .sl-hero__actions'

export function createHeroBackdrop({ isSearchInput }: { isSearchInput: (target: EventTarget | null) => boolean }): HeroBackdropController {
  let rainHost: HTMLElement | null = null
  let rain: Part | null = null
  let stageHosts: StageHosts | null = null
  let stageInput: BackdropInput | null = null
  let reduced = false
  let stageParts: Part[] = []
  let moments: HeroMoment[] = []
  let momentTurn = 0
  let stageVisible = true
  let pointer: Pointer | null = null
  let pointerDirty = false
  let frame = 0
  let slow = 0
  let last = 0
  let beat = 0
  let ridgeBorn = 0
  let resizeTimer = 0
  let quickUntil = 0
  /** The display's frame interval, measured from the frames themselves, and how many display frames each pace waits. */
  let vsync = VSYNC_GUESS_MS
  let lastRaf = 0
  let beats = 0
  const cadence = new Map<number, number>()
  let io: IntersectionObserver | null = null
  let size = { w: window.innerWidth, h: window.innerHeight }

  const parts = () => (rain ? [rain, ...stageParts] : stageParts)
  const quick = (ms: number) => {
    quickUntil = Math.max(quickUntil, performance.now() + ms)
  }

  function buildRain() {
    rain?.dispose()
    rain = rainHost ? mountEmoteRain(rainHost) : null
  }

  function buildStage() {
    for (const p of stageParts) p.dispose()
    stageParts = []
    io?.disconnect()
    io = null
    window.clearTimeout(beat)
    if (!stageHosts || !stageInput) return
    const { stage, chat, ridge } = stageHosts
    const now = Date.now()
    if (chat) stageParts.push(mountChatColumns(chat, stage, chatSources(stageInput.live), reduced))
    const rd = ridgeRows(stageInput.points, stageInput.generatedAt, stageInput.bucketMinutes)
    // The lines rise once, when they first have something to draw; a rebuild (fresh data, a resize) keeps them up,
    // so only the rise runs at the quick pace.
    if (!ridgeBorn && rd.rows.length && rd.times.length >= 2) {
      ridgeBorn = performance.now()
      if (!reduced) quick(QUICK_BUILD_MS)
    }
    // As on the board, the far line sits a little above the hero's buttons, wherever the copy above them ends.
    const actions = document.querySelector('.sl-hero__actions')
    const farAt = actions ? actions.getBoundingClientRect().top - stage.getBoundingClientRect().top - RIDGE_ABOVE_BUTTONS_PX : undefined
    stageParts.push(mountRidge(ridge, stage, rd, reduced, ridgeBorn || undefined, farAt))
    moments = heroMoments(stageInput.moments, now)
    momentTurn = 0
    if (typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver((entries) => {
        const was = stageVisible
        stageVisible = entries.some((e) => e.isIntersecting)
        // Back on screen: time passed without frames, so each layer draws afresh once.
        if (stageVisible && !was) {
          for (const p of stageParts) p.resume?.()
          start()
        }
      })
      io.observe(stage)
    }
    if (!moments.length) return
    // Still under reduced motion: the newest moment shows once and stays.
    if (reduced) playMoment()
    else beat = window.setTimeout(nextBeat, FIRST_BEAT_MS)
  }

  function playMoment() {
    const m = moments[momentTurn++ % moments.length]
    const nowMs = Date.now()
    if (!reduced) quick(QUICK_MOMENT_MS)
    for (const p of parts()) p.moment(m, nowMs)
    plan()
  }

  function nextBeat() {
    if (stageVisible && !document.hidden) playMoment()
    beat = window.setTimeout(nextBeat, BEAT_MIN_MS + Math.random() * BEAT_SPREAD_MS)
  }

  function paceAt(now: number) {
    const scene = sceneBusy(now)
    return now < quickUntil ? (scene ? FRAME_MS : QUICK_FRAME_MS) : scene ? SCENE_FRAME_MS : FRAME_MS
  }

  /** How many display frames a frame at this pace waits: a whole number, so the beat stays even. */
  function framesFor(pace: number) {
    const ratio = pace / vsync
    const held = cadence.get(pace)
    const frames = held != null && Math.abs(ratio - held) <= CADENCE_HOLD ? held : Math.max(1, Math.round(ratio))
    cadence.set(pace, frames)
    return frames
  }

  /** From when the next frame is due: half a display frame before the display frame it is drawn on (0: at once). */
  function dueAt(now: number) {
    return last ? last + framesFor(paceAt(now)) * vsync - vsync / 2 : 0
  }

  function loop(now: number) {
    frame = 0
    // A skipped display frame (a long task, a hidden tab, a timer's wait) is not the display's beat.
    const gap = lastRaf ? now - lastRaf : 0
    if (gap > 0 && gap < vsync * 1.5) {
      vsync += (gap - vsync) * (beats < BEATS_KNOWN ? 0.5 : 0.1)
      beats += 1
    }
    lastRaf = now
    if (now < dueAt(now)) {
      plan()
      return
    }
    if (last) {
      // Drawn frames sit a whole number of display frames apart; when they do not, the display changed.
      const k = (now - last) / vsync
      if (Math.abs(k - Math.round(k)) > BEAT_SLIP) beats = 0
    }
    const dt = Math.min(MAX_DT_S, last ? (now - last) / 1000 : 0.016)
    last = now
    if (pointerDirty) {
      pointerDirty = false
      // Chat first, then the ridge, then the rain: one label at a time, from the layer nearest the reader.
      let claimed = false
      for (const p of [...stageParts, ...(rain ? [rain] : [])]) claimed = p.pointer(pointer, claimed) || claimed
    }
    rain?.tick(now, dt)
    if (stageVisible) for (const p of stageParts) p.tick(now, dt)
    if (reduced && !rain) {
      // Nothing moves under reduced motion, so no frame loop: a frame a second keeps the labels current, and
      // the pointer or a scroll asks for one at once.
      last = 0
      slow = window.setTimeout(start, 1000)
    } else if (needsFrames(now)) plan()
    // Otherwise nothing on screen needs script: the loop sleeps until the pointer, the search, a moment, a resize or
    // the hero coming back on screen wakes it.
    else last = 0
  }

  /** A layer on screen still moving from script, or one that cannot say. */
  function needsFrames(now: number) {
    if (rain && !(rain.idle?.(now) ?? false)) return true
    return stageVisible && stageParts.some((p) => !(p.idle?.(now) ?? false))
  }

  let disposed = false

  const running = () => !disposed && !document.hidden && !!(rain || stageParts.length)

  /** A display frame now, whatever the pace: the pointer moved, the tab came back, the loop starts. */
  function start() {
    if (!running() || frame) return
    window.clearTimeout(slow)
    slow = 0
    frame = requestAnimationFrame(loop)
  }

  /**
   * The next frame at the pace. The display frames before it pass on a timer that wakes the loop when the frame is
   * due, so the display frame after it is the one drawn on. Until the display's beat is measured the timer wakes a
   * display frame earlier, and that frame asks for the next, so the two measure the beat.
   */
  function plan() {
    if (!running() || frame) return
    window.clearTimeout(slow)
    slow = 0
    const now = performance.now()
    const wait = dueAt(now) - (beats >= BEATS_KNOWN ? 0 : vsync) - now
    if (wait > vsync / 2) {
      slow = window.setTimeout(() => {
        slow = 0
        if (running() && !frame) frame = requestAnimationFrame(loop)
      }, wait)
    } else frame = requestAnimationFrame(loop)
  }

  function stop() {
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    window.clearTimeout(slow)
    slow = 0
    last = 0
    lastRaf = 0
  }

  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return
    // Over the page's own controls the background stays out of the way: no labels behind a button.
    const over = e.target instanceof Element ? e.target.closest(UI_SELECTOR) : null
    pointer = over ? null : { x: e.clientX, y: e.clientY }
    // Labels follow the pointer over the background; over a control nothing does, so the pace stays down. While
    // the extension demo's scene draws, the pointer is on the demo, so the background keeps its slower pace.
    if (pointer && !sceneBusy(performance.now())) quick(QUICK_POINTER_MS)
    pointerDirty = true
    // The next frame at the quick pace, not one on every move.
    plan()
  }
  const onPointerOut = (e: PointerEvent) => {
    if (e.relatedTarget) return
    pointer = null
    pointerDirty = true
    plan()
  }
  const onScroll = () => {
    if (!pointer) return
    if (!sceneBusy(performance.now())) quick(QUICK_POINTER_MS)
    pointerDirty = true
    plan()
  }
  const onVisibility = () => {
    if (document.hidden) return stop()
    for (const p of parts()) p.resume?.()
    start()
  }
  const onSearch = (e: Event) => {
    if (!isSearchInput(e.target)) return
    const ev: SearchEvent = e.type === 'focusin' ? 'focus' : e.type === 'focusout' ? 'blur' : 'input'
    const value = (e.target as HTMLInputElement).value ?? ''
    for (const p of parts()) p.search(ev, value)
    plan()
  }
  const onResize = () => {
    window.clearTimeout(resizeTimer)
    resizeTimer = window.setTimeout(() => {
      // A phone's address bar changes the height as it scrolls; only a real resize rebuilds.
      const next = { w: window.innerWidth, h: window.innerHeight }
      if (next.w === size.w && Math.abs(next.h - size.h) < 120) return
      size = next
      buildRain()
      buildStage()
      start()
    }, 250)
  }

  window.addEventListener('pointermove', onPointerMove, { passive: true })
  document.documentElement.addEventListener('pointerout', onPointerOut, { passive: true })
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', onResize)
  document.addEventListener('visibilitychange', onVisibility)
  document.addEventListener('focusin', onSearch)
  document.addEventListener('focusout', onSearch)
  document.addEventListener('input', onSearch)

  return {
    setRain(host) {
      if (disposed || host === rainHost) return
      rainHost = host
      buildRain()
      start()
    },
    setStage(hosts, input, nextReduced) {
      if (disposed) return
      stageHosts = hosts
      stageInput = input
      reduced = nextReduced
      buildStage()
      start()
    },
    dispose() {
      disposed = true
      stop()
      rainHost = null
      stageHosts = null
      window.clearTimeout(beat)
      window.clearTimeout(resizeTimer)
      io?.disconnect()
      rain?.dispose()
      rain = null
      for (const p of stageParts) p.dispose()
      stageParts = []
      window.removeEventListener('pointermove', onPointerMove)
      document.documentElement.removeEventListener('pointerout', onPointerOut)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('visibilitychange', onVisibility)
      document.removeEventListener('focusin', onSearch)
      document.removeEventListener('focusout', onSearch)
      document.removeEventListener('input', onSearch)
    },
  }
}
