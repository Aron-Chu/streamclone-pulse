import { clamp, rand } from './kit.ts'

/** One animated lab stage: the lab's `ChatStack` / `PileFamily` instance shape. */
export interface StageModel {
  tick(dt: number): void
  peak(): void
  onHot(): void
  resize(): void
  /** Under reduced motion, after the settle ticks: leave a finished still frame. */
  settle?(): void
}

export interface StageContext {
  readonly still: boolean
  /** The lab's `paceOf(inst)`: stream pace, plus a lift while hovered, plus a peak's surge. */
  pace(): number
  hot(): boolean
  /** `setTimeout` that is cancelled when the stage stops. */
  later(run: () => void, ms: number): void
}

/** The lab's chat pace slider at its default, 40 (about 75 messages a minute). */
const STREAM_PACE = 0.4
/** The lab fires its first peak 10 s in, then every 17 to 23 s. */
const FIRST_PEAK_S = 10
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

/**
 * Runs one stage the way the lab's frame loop does, with the guardrails the
 * lab lists: it ticks only while on screen (80 px margin, like the lab's
 * observer) in a shown tab, and under reduced motion it settles one still frame
 * and never schedules an animation frame. Hover and focus on the stage's
 * button are the lab's `hot`; a peak arrives on the lab's timer.
 *
 * `stage.dataset.running` says whether frames are being scheduled, and
 * `stage.dataset.peaks` how many peaks have fired.
 */
export function runStage(stage: HTMLElement, still: boolean, build: (context: StageContext) => StageModel): () => void {
  let hot = false
  let surge = 0
  let clock = 0
  let autoPeakAt = FIRST_PEAK_S
  let frame = 0
  let last = 0
  let inView = true
  let stopped = false
  const timers = new Set<number>()
  const context: StageContext = {
    still,
    pace: () => clamp(STREAM_PACE + (hot ? 0.32 : 0) + surge * 0.6, 0, 1),
    hot: () => hot,
    later(run, ms) {
      const id = window.setTimeout(() => { timers.delete(id); if (!stopped) run() }, ms)
      timers.add(id)
    },
  }
  const model = build(context)
  const host = stage.closest('button')

  let peaks = 0
  const firePeak = () => { surge = 1; model.peak(); stage.dataset.peaks = String(++peaks) }
  const tick = (now: number) => {
    frame = 0
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0)
    last = now
    clock += dt
    surge = Math.max(0, surge - dt / 2.6)
    if (clock >= autoPeakAt) { firePeak(); autoPeakAt = clock + rand(17, 23) }
    model.tick(dt)
    schedule()
  }
  const schedule = () => {
    if (still || stopped || frame || !inView || document.hidden) return
    frame = requestAnimationFrame(tick)
    stage.dataset.running = 'true'
  }
  const pause = () => {
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    last = 0
    stage.dataset.running = 'false'
  }
  const visibility = () => { if (document.hidden) pause(); else schedule() }
  const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting
    if (inView) schedule(); else pause()
  }, { rootMargin: '80px' })
  observer?.observe(stage)

  const enter = () => {
    if (hot) return
    hot = true
    // A still frame shows the hover labels but adds nothing that would move.
    if (still) model.tick(0)
    else model.onHot()
  }
  const leave = () => {
    hot = false
    if (still) model.tick(0)
  }
  host?.addEventListener('pointerenter', enter)
  host?.addEventListener('pointerleave', leave)
  host?.addEventListener('focus', enter)
  host?.addEventListener('blur', leave)
  let resizeTimer: number | undefined
  const resize = () => { window.clearTimeout(resizeTimer); resizeTimer = window.setTimeout(() => model.resize(), 150) }
  window.addEventListener('resize', resize)
  document.addEventListener('visibilitychange', visibility)

  stage.dataset.running = 'false'
  if (still) {
    // The lab's settleAll: four seconds of stream, drawn once.
    for (let k = 0; k < 120; k++) model.tick(1 / 30)
    model.settle?.()
  } else {
    schedule()
  }
  return () => {
    stopped = true
    pause()
    for (const id of timers) window.clearTimeout(id)
    timers.clear()
    window.clearTimeout(resizeTimer)
    observer?.disconnect()
    host?.removeEventListener('pointerenter', enter)
    host?.removeEventListener('pointerleave', leave)
    host?.removeEventListener('focus', enter)
    host?.removeEventListener('blur', leave)
    window.removeEventListener('resize', resize)
    document.removeEventListener('visibilitychange', visibility)
  }
}

/**
 * Starts a stage and restarts it, still or moving, when the reduced-motion
 * setting changes. The stage's own `<style>` goes first so it applies wherever
 * the stage lives: the settings page or the Twitch panel's shadow root.
 */
export function mountStage(stage: HTMLElement, css: string, start: (still: boolean) => () => void): () => void {
  const query = typeof matchMedia === 'function' ? matchMedia(REDUCED_MOTION) : null
  let stop = () => {}
  const run = () => {
    stop()
    const style = document.createElement('style')
    style.textContent = css
    stage.replaceChildren(style)
    stage.dataset.still = query?.matches ? 'true' : 'false'
    stop = start(query?.matches ?? false)
  }
  run()
  query?.addEventListener?.('change', run)
  return () => {
    query?.removeEventListener?.('change', run)
    stop()
    stage.replaceChildren()
    delete stage.dataset.running
    delete stage.dataset.still
    delete stage.dataset.peaks
  }
}
