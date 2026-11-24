import type { HubActivityPoint, HubLiveChannel, HubLivePulseMoment } from '../../../../lib/publicHub'
import { chatSources, heroMoments, ridgeRows, type HeroMoment } from '../heroBackdropModel'
import { mountChatColumns } from './chatColumns'
import { mountEmoteRain } from './emoteRain'
import { mountRidge } from './ridge'
import type { Part, Pointer, SearchEvent } from './shared'

/**
 * The front page's background (mix 03): counted chat columns, the emote rain and the chat ridge, on one
 * animation loop. Loaded as its own chunk after the page is idle. The loop stops while the tab is hidden,
 * and the hero's layers stop while the hero is scrolled away.
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
const UI_SELECTOR = 'a, button, input, select, textarea, [role="button"], [role="option"], [role="listbox"], .sl-header, .sl-search, .sl-tickwrap, .sl-hero__actions'

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
  let io: IntersectionObserver | null = null
  let size = { w: window.innerWidth, h: window.innerHeight }

  const parts = () => (rain ? [rain, ...stageParts] : stageParts)

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
    // The lines rise once, when they first have something to draw; a rebuild (fresh data, a resize) keeps them up.
    if (!ridgeBorn && rd.rows.length && rd.times.length >= 2) ridgeBorn = performance.now()
    // As on the board, the far line sits a little above the hero's buttons, wherever the copy above them ends.
    const actions = document.querySelector('.sl-hero__actions')
    const farAt = actions ? actions.getBoundingClientRect().top - stage.getBoundingClientRect().top - RIDGE_ABOVE_BUTTONS_PX : undefined
    stageParts.push(mountRidge(ridge, stage, rd, reduced, ridgeBorn || undefined, farAt))
    moments = heroMoments(stageInput.moments, now)
    momentTurn = 0
    if (typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver((entries) => {
        stageVisible = entries.some((e) => e.isIntersecting)
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
    for (const p of parts()) p.moment(m, nowMs)
  }

  function nextBeat() {
    if (stageVisible && !document.hidden) playMoment()
    beat = window.setTimeout(nextBeat, BEAT_MIN_MS + Math.random() * BEAT_SPREAD_MS)
  }

  function loop(now: number) {
    frame = 0
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016)
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
    } else start()
  }

  let disposed = false

  function start() {
    if (disposed || frame || document.hidden || !(rain || stageParts.length)) return
    window.clearTimeout(slow)
    slow = 0
    frame = requestAnimationFrame(loop)
  }

  function stop() {
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    window.clearTimeout(slow)
    slow = 0
    last = 0
  }

  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return
    // Over the page's own controls the background stays out of the way: no labels behind a button.
    const over = e.target instanceof Element ? e.target.closest(UI_SELECTOR) : null
    pointer = over ? null : { x: e.clientX, y: e.clientY }
    pointerDirty = true
    start()
  }
  const onPointerOut = (e: PointerEvent) => {
    if (e.relatedTarget) return
    pointer = null
    pointerDirty = true
    start()
  }
  const onScroll = () => {
    if (!pointer) return
    pointerDirty = true
    start()
  }
  const onVisibility = () => (document.hidden ? stop() : start())
  const onSearch = (e: Event) => {
    if (!isSearchInput(e.target)) return
    const ev: SearchEvent = e.type === 'focusin' ? 'focus' : e.type === 'focusout' ? 'blur' : 'input'
    const value = (e.target as HTMLInputElement).value ?? ''
    for (const p of parts()) p.search(ev, value)
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
