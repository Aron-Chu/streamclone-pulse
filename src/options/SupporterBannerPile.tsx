import { useEffect, useRef } from 'react'
import { SUPPORTER_TENURES } from '../shared/supporterPaint.ts'

/** 7TV global-set emotes the extension already shows elsewhere. */
const PILE_EMOTES = [
  '01HM524VE80004SKSHMCZWXH1T',
  '01FKSDK14G0008TM5NY9QEG0QV',
  '01GAM8EFQ00004MXFXAJYKA859',
  '01GB2S7H7000018VJGJ4A9BMFS',
  '01GAFTZ9K80003DHH026MC7JW0',
  '01GB2ZJFBG000DTBJYANG8XYFP',
  '01GAZ199Z8000FEWHS6AT5QZV0',
  '01FE3XY508000AA32JP519W2EW',
]
const RADIUS = 13
const MAX_BODIES = 22
const GRAVITY = 900

interface Body { el: HTMLElement; inner: HTMLElement; x: number; y: number; vx: number; vy: number; rot: number; vr: number; retiring: boolean }

/**
 * Emotes that drop, bounce and pile up behind the full-settings Supporter
 * banner, with a tenure crest in every fifth drop. Hovering the banner makes
 * the pile jump.
 *
 * Purely decorative: it runs only while visible in a shown tab, caps its body
 * count, and under reduced motion settles one still pile of static images.
 */
export function SupporterBannerPile() {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const stage = ref.current
    if (!stage) return
    const still = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const bodies: Body[] = []
    let width = stage.clientWidth
    let height = stage.clientHeight
    let spawned = 0
    let clock = 0
    let nextDrop = 0
    let frame = 0
    let last = 0
    let inView = true

    const retire = (body: Body) => {
      body.retiring = true
      const remove = () => { body.el.remove(); bodies.splice(bodies.indexOf(body), 1) }
      if (still || typeof body.el.animate !== 'function') { remove(); return }
      body.el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 350, fill: 'forwards' }).onfinish = remove
    }
    const drop = (x = RADIUS + Math.random() * Math.max(1, width - 2 * RADIUS), y = -RADIUS - Math.random() * 20) => {
      spawned++
      const el = document.createElement('span')
      el.className = 'pulse-pile-body'
      const inner = document.createElement('span')
      inner.className = 'pulse-pile-inner'
      if (spawned % 5 === 0) {
        const crest = document.createElement('i')
        crest.className = 'pulse-crest'
        crest.dataset.tenure = SUPPORTER_TENURES[(spawned / 5) % SUPPORTER_TENURES.length].id
        inner.append(crest)
      } else {
        const img = document.createElement('img')
        img.alt = ''
        img.decoding = 'async'
        img.draggable = false
        img.referrerPolicy = 'no-referrer'
        img.src = `https://cdn.7tv.app/emote/${PILE_EMOTES[spawned % PILE_EMOTES.length]}/${still ? '1x_static' : '1x'}.webp`
        img.onerror = () => { img.style.visibility = 'hidden' }
        inner.append(img)
      }
      el.append(inner)
      stage.append(el)
      bodies.push({ el, inner, x, y, vx: Math.random() * 60 - 30, vy: Math.random() * 40, rot: Math.random() * 50 - 25, vr: Math.random() * 360 - 180, retiring: false })
      const resting = bodies.filter(body => !body.retiring)
      if (resting.length > MAX_BODIES) retire(resting[0])
    }
    const step = (dt: number) => {
      for (const body of bodies) {
        if (body.retiring) continue
        body.vy += GRAVITY * dt
        body.x += body.vx * dt
        body.y += body.vy * dt
        body.rot += body.vr * dt
        if (body.y > height - RADIUS) {
          body.y = height - RADIUS
          body.vy = body.vy > 0 ? body.vy * -0.22 : body.vy
          if (Math.abs(body.vy) < 14) body.vy = 0
          body.vx *= 0.9
          body.vr = body.vx * 2.4
        }
        if (body.x < RADIUS) { body.x = RADIUS; body.vx = Math.abs(body.vx) * 0.35 }
        if (body.x > width - RADIUS) { body.x = width - RADIUS; body.vx = -Math.abs(body.vx) * 0.35 }
      }
      for (let i = 0; i < bodies.length; i++) {
        for (let j = i + 1; j < bodies.length; j++) {
          const a = bodies[i], b = bodies[j]
          if (a.retiring || b.retiring) continue
          const dx = b.x - a.x, dy = b.y - a.y
          const distance = Math.hypot(dx, dy) || 0.01
          const overlap = RADIUS * 2 * 0.92 - distance
          if (overlap <= 0) continue
          const nx = dx / distance, ny = dy / distance
          a.x -= nx * overlap / 2; a.y -= ny * overlap / 2
          b.x += nx * overlap / 2; b.y += ny * overlap / 2
          const closing = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny
          if (closing < 0) {
            const impulse = -closing * 0.6
            a.vx -= impulse * nx; a.vy -= impulse * ny
            b.vx += impulse * nx; b.vy += impulse * ny
          }
        }
      }
    }
    const render = () => {
      for (const body of bodies) {
        body.el.style.transform = `translate(${body.x - RADIUS}px, ${body.y - RADIUS}px)`
        body.inner.style.transform = `rotate(${body.rot}deg)`
      }
    }
    const settle = (count: number) => {
      for (let k = 0; k < count; k++) drop(undefined, Math.random() * height)
      for (let k = 0; k < 180; k++) step(1 / 60)
      render()
    }

    settle(still ? 14 : 10)
    if (still) return () => { stage.replaceChildren() }

    const tick = (now: number) => {
      frame = 0
      const dt = Math.min(0.05, last ? (now - last) / 1000 : 0)
      last = now
      clock += dt
      if (clock >= nextDrop) { drop(); nextDrop = clock + 0.7 + Math.random() * 0.9 }
      step(dt / 2)
      step(dt / 2)
      render()
      schedule()
    }
    const schedule = () => {
      if (frame || !inView || document.hidden) return
      frame = requestAnimationFrame(tick)
    }
    const pause = () => { if (frame) cancelAnimationFrame(frame); frame = 0; last = 0 }
    const visibility = () => { if (document.hidden) pause(); else schedule() }
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting
      if (inView) schedule(); else pause()
    })
    observer?.observe(stage)
    const jump = () => {
      for (const body of bodies) {
        if (body.retiring) continue
        body.vy -= 220 + Math.random() * 140
        body.vx += Math.random() * 160 - 80
        body.vr += Math.random() * 600 - 300
      }
    }
    const host = stage.closest('button')
    host?.addEventListener('pointerenter', jump)
    const resize = () => { width = stage.clientWidth; height = stage.clientHeight }
    window.addEventListener('resize', resize)
    document.addEventListener('visibilitychange', visibility)
    schedule()
    return () => {
      pause()
      observer?.disconnect()
      host?.removeEventListener('pointerenter', jump)
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', visibility)
      stage.replaceChildren()
    }
  }, [])
  return <span ref={ref} className="pulse-supporter-banner-pile" aria-hidden="true" />
}
