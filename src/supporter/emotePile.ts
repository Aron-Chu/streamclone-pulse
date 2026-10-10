import { AMBIENT, clamp, emoteAspect, emoteImg, finishVars, kitCrest, kitName, pick, rand, type Kit, type KitEmoteName } from './kit.ts'
import { mountStage, runStage, type StageContext, type StageModel, type StageTiming } from './stage.ts'
import { EMOTE_PILE_CSS } from './styles.ts'

/**
 * "Emote Pile · Crown, staged" (direction B of the 2026-10-07 banner round),
 * ported from the lab's `PileFamily(stage, o, 'crown')`: chat emotes drop in,
 * bounce and stack. Every seventh drop is yours: your crest, bigger and
 * glowing in your paint, with a small "you" tag riding above the newest one.
 * Hover makes the pile jump and drops yours in; at a peak a row of nine lands,
 * then yours on top, and the glow behind the pile swells (`data-glow="peak"`).
 *
 * Staged runs calmer than the lab: about half its drop rate, a peak every 28
 * to 36 s, and fewer bodies on screen.
 *
 * The lab's bodies are circles. The wide 7TV emotes this set adds are about
 * three times wider than tall, so a wide body keeps the same physics with an
 * ellipse (shorter, emote-wide) and tumbles less; a square emote's body is the
 * lab's circle exactly. A crest tumbles as little as a wide emote, so it
 * lands upright enough to read.
 */
interface Body {
  el: HTMLElement
  inner: HTMLElement
  x: number
  y: number
  vx: number
  vy: number
  rx: number
  ry: number
  rot: number
  vr: number
  spin: number
  box: Box
  look: 'ambient' | 'you'
  dying: boolean
}
interface Box { l: number; r: number; b: number }

/**
 * A wide body's height as a share of the lab's circle (so a 3:1 emote covers
 * about the area of a lab emote), and how much it may tumble.
 */
const WIDE_HEIGHT = 0.57
const WIDE_SPIN = 0.35
const WIDE_TILT = 20

/** The staged banner's stream: about half the lab's pace, a peak every 28 to 36 s. */
export const STAGED_TIMING: StageTiming = { pace: 0.22, firstPeak: 8, peakEvery: [28, 36] }
/** How long a peak's glow stays swollen. */
const GLOW_MS = 1400

export function EmotePile(stage: HTMLElement, context: StageContext, kit: Kit): StageModel {
  const { still } = context
  const bodies: Body[] = []
  let W = 0
  let H = 0
  let t = 0
  let nextAt = 0.3
  let spawned = 0
  let built = false
  const R = 12
  const CAP = 22
  let floorBox: Box | null = null
  // The "you" tag rides above your newest crest; bodies are drawn under it.
  const tag = document.createElement('span')
  tag.className = 'spk-tag'
  tag.append(kitName(kit))
  stage.append(tag)
  let tagW = 0
  let tagH = 16

  function makeBody({ name, r, x, y, box, look, vx, vy }: { name: KitEmoteName; r: number; x: number; y: number; box: Box; look: Body['look']; vx?: number; vy?: number }): Body {
    const aspect = look === 'ambient' ? emoteAspect(name) : 1
    const isWide = aspect > 1.5
    const ry = isWide ? r * WIDE_HEIGHT : r
    const rx = isWide ? ry * aspect : r
    const spin = look === 'you' || isWide ? WIDE_SPIN : 1
    const el = document.createElement('div')
    el.className = 'spk-body'
    el.style.width = `${rx * 2}px`
    el.style.height = `${ry * 2}px`
    const inner = document.createElement('div')
    inner.className = 'spk-inner'
    inner.append(look === 'ambient' ? emoteImg(name, ry * 2, still) : kitCrest(kit, Math.round(r * 2)))
    el.append(inner)
    if (look === 'you') el.classList.add('spk-you')
    stage.insertBefore(el, tag)
    const b: Body = { el, inner, x, y, vx: vx ?? rand(-30, 30), vy: vy ?? rand(0, 40), rx, ry, rot: rand(-25, 25) * spin, vr: rand(-180, 180) * spin, spin, box, look, dying: false }
    bodies.push(b)
    return b
  }
  function kill(b: Body, ms = 350) {
    if (b.dying) return
    b.dying = true
    const done = () => { b.el.remove(); const i = bodies.indexOf(b); if (i >= 0) bodies.splice(i, 1) }
    if (still || typeof b.el.animate !== 'function') { done(); return }
    b.el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, fill: 'forwards' }).onfinish = done
  }
  function step(dt: number) {
    for (const b of bodies) {
      if (b.dying) continue
      b.vy += 900 * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.rot += b.vr * dt
      if (b.spin < 1) b.rot = Math.max(-WIDE_TILT, Math.min(WIDE_TILT, b.rot))
      const bx = b.box
      if (b.y > bx.b - b.ry) { b.y = bx.b - b.ry; if (b.vy > 0) b.vy *= -0.22; if (Math.abs(b.vy) < 14) b.vy = 0; b.vx *= 0.9; b.vr = b.vx * 2.4 * b.spin }
      if (b.x < bx.l + b.rx) { b.x = bx.l + b.rx; b.vx = Math.abs(b.vx) * 0.35 }
      if (b.x > bx.r - b.rx) { b.x = bx.r - b.rx; b.vx = -Math.abs(b.vx) * 0.35 }
    }
    for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i], b = bodies[j]
      if (a.dying || b.dying || a.box !== b.box) continue
      const dx = b.x - a.x, dy = b.y - a.y
      // The lab's overlap test, d < 0.92 (ra + rb), measured per axis so an ellipse fits.
      const dn = Math.hypot(dx / (a.rx + b.rx), dy / (a.ry + b.ry)) || 0.0001
      if (dn < 0.92) {
        const push = (0.92 / dn - 1) / 2
        a.x -= dx * push; a.y -= dy * push; b.x += dx * push; b.y += dy * push
        const d = Math.hypot(dx, dy) || 0.01, nx = dx / d, ny = dy / d
        const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny
        if (rv < 0) { const imp = -rv * 0.6; a.vx -= imp * nx; a.vy -= imp * ny; b.vx += imp * nx; b.vy += imp * ny }
        a.vx *= 0.985; b.vx *= 0.985
      }
    }
  }
  /** Your newest crest still on stage. */
  function yours(): Body | null {
    for (let i = bodies.length - 1; i >= 0; i--) if (bodies[i].look === 'you' && !bodies[i].dying) return bodies[i]
    return null
  }
  function render() {
    for (const b of bodies) {
      b.el.style.transform = `translate(${b.x - b.rx}px, ${b.y - b.ry}px)`
      b.inner.style.transform = `rotate(${b.rot}deg)`
    }
    const mine = yours()
    if (!mine) { tag.style.opacity = '0'; return }
    if (!tagW) { tagW = tag.offsetWidth || 34; tagH = tag.offsetHeight || 16 }
    const y = mine.y - mine.ry - tagH - 7
    tag.style.transform = `translate(${clamp(mine.x - tagW / 2, 0, Math.max(0, W - tagW))}px, ${y}px)`
    tag.style.opacity = y > -tagH ? '1' : '0'
  }
  function kick() {
    for (const b of bodies) if (!b.dying) { b.vy -= rand(220, 360); b.vx += rand(-80, 80); b.vr += rand(-300, 300) * b.spin }
  }
  function crownSpawn(you: boolean, x?: number) {
    if (!floorBox) return
    const r = you ? R * 1.45 : R
    makeBody({ name: pick(AMBIENT), r, x: x ?? (you ? rand(W * 0.35, W * 0.7) : rand(r, W - r)), y: -r - rand(0, 16), box: floorBox, look: you ? 'you' : 'ambient' })
    const alive = bodies.filter(b => !b.dying)
    const crests = alive.filter(b => b.look === 'you')
    if (crests.length > 2) kill(crests[0])
    if (alive.length > CAP) { const old = alive.find(b => b.look !== 'you'); if (old) kill(old) }
  }
  function tick(dt: number) {
    if (!W) {
      W = stage.clientWidth; H = stage.clientHeight
      // Nothing to draw into yet (the stage is hidden at this width).
      if (!W || !H) { W = 0; return }
      floorBox = { l: 0, r: W, b: H }
      if (!built) {
        built = true
        for (let k = 0; k < 9; k++) crownSpawn(false)
        crownSpawn(true)
        for (const b of bodies) b.y = rand(H * 0.3, H)
        for (let k = 0; k < 120; k++) step(1 / 60)
      }
    }
    t += dt
    const p = context.pace()
    if (t >= nextAt) { spawned++; crownSpawn(spawned % 7 === 0); nextAt = t + (1.5 - p * 1.25) * rand(0.6, 1.3) }
    step(dt / 2); step(dt / 2)
    render()
  }
  return {
    tick,
    onHot() { kick(); crownSpawn(true) },
    peak() {
      for (let k = 0; k < 9; k++) context.later(() => crownSpawn(false, (W / 10) * (k + 1)), k * 60)
      context.later(() => crownSpawn(true, W * 0.55), 750)
      stage.dataset.glow = 'peak'
      context.later(() => { delete stage.dataset.glow }, GLOW_MS)
    },
    resize() {
      // One floor for every body, resized in place so the pile keeps colliding.
      const width = stage.clientWidth, height = stage.clientHeight
      if (!built || !width || !height) return
      W = width; H = height
      if (floorBox) Object.assign(floorBox, { r: W, b: H })
    },
    // Let the last drops land, so the still frame is a resting pile.
    settle() { for (let k = 0; k < 240; k++) step(1 / 60); render() },
  }
}

/** Draws the staged Crown pile into `stage` until the returned stop is called. */
export function mountEmotePile(stage: HTMLElement, kit: Kit): () => void {
  const own: Kit = { ...kit }
  for (const [name, value] of Object.entries(finishVars(own.finish))) stage.style.setProperty(name, value)
  stage.dataset.mode = 'crown'
  const stop = mountStage(stage, EMOTE_PILE_CSS, still => runStage(stage, still, context => EmotePile(stage, context, own), STAGED_TIMING))
  return () => { stop(); delete stage.dataset.glow }
}
