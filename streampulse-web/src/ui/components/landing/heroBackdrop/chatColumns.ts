import { emoteDeck, findHeroEmote, HERO_EMOTES, isWideEmote, type HeroEmote } from '../heroEmotes'
import { perLine, type ChatSource, type HeroMoment } from '../heroBackdropModel'
import { formatHubInt } from '../../hub/v5/hubV5Model'
import { feedAgo } from '../../hub/v5/hubV5FeedModel'
import { emoteImg, failedEmotes, makeChip, NO_PART, type Part, type Pointer, type SearchEvent } from './shared'

/**
 * Counted chat: two columns in the gutters, rebuilt from counts instead of invented messages. A line stands
 * for a batch of counted messages in one channel and shows the channel's public name with blank bars where
 * the words would be: never the words, never who wrote them. Chat per minute sets the pace. Hovering pauses
 * a column so a line can be read; typing a channel in the search lights its lines; a live moment adds its
 * own line. The columns lean back toward the headline. DOM and CSS 3D, no library.
 */

const LH = 27
/** Below this width a column cannot hold a channel name and a bar. */
const MIN_COL = 120
/**
 * A new line slides the column up: the offset falls by e^-7 a second and stops under 0.2 px. The browser's
 * compositor runs the slide, so it stays smooth while the background's own loop draws 30 frames a second.
 */
const SLIDE_RATE = 7
const SLIDE_STOP_PX = 0.2
const SLIDE_STEPS = 16

const hue = (s: string) => [...s].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7) % 360

interface Column {
  el: HTMLElement
  inner: HTMLElement
  left: boolean
  lines: HTMLElement[]
  /** The offset when the slide last started, at `offAt` (performance.now()). */
  off: number
  offAt: number
  slide: Animation | null
  /** The running slide's sampled offsets and length, so a new line starts from where the column really is. */
  ys: number[]
  ms: number
  wait: number
  paused: boolean
}

const offsetAt = (col: Column, now: number) => col.off * Math.exp((-SLIDE_RATE * (now - col.offAt)) / 1000)

/** Where the column is now: on its slide's own samples while one runs (one not started yet is at its start). */
function offsetNow(col: Column, now: number) {
  if (!col.slide || !col.ys.length) return offsetAt(col, now)
  const t = col.slide.currentTime
  const at = typeof t === 'number' ? Math.max(0, t) : 0
  if (at >= col.ms) return 0
  const x = (at / col.ms) * SLIDE_STEPS
  const k = Math.floor(x)
  return col.ys[k] + (col.ys[k + 1] - col.ys[k]) * (x - k)
}

/** Adds `by` px to the column's offset and slides it back to rest from there. */
function slideUp(col: Column, by: number) {
  const now = performance.now()
  const from = offsetNow(col, now) + by
  col.off = from
  col.offAt = now
  col.slide?.cancel()
  col.slide = null
  col.ys = []
  // Without the Web Animations API the frame loop moves it instead (tick).
  if (typeof col.inner.animate !== 'function') return
  const ms = (Math.log(from / SLIDE_STOP_PX) / SLIDE_RATE) * 1000
  const frames: Keyframe[] = []
  for (let k = 0; k <= SLIDE_STEPS; k++) {
    const p = k / SLIDE_STEPS
    const y = k === SLIDE_STEPS ? 0 : from * Math.exp((-SLIDE_RATE * p * ms) / 1000)
    col.ys.push(y)
    frames.push({ offset: p, transform: `translateY(${y.toFixed(2)}px)` })
  }
  col.ms = ms
  col.slide = col.inner.animate(frames, { duration: ms, easing: 'linear' })
}

export function mountChatColumns(host: HTMLElement, stage: HTMLElement, sources: readonly ChatSource[], reduced: boolean): Part {
  host.replaceChildren()
  const cols: Column[] = (['left', 'right'] as const).map((side) => {
    const el = document.createElement('div')
    el.className = `sl-chatbg__col sl-chatbg__col--${side}`
    const inner = document.createElement('div')
    inner.className = 'sl-chatbg__inner'
    el.appendChild(inner)
    const pill = document.createElement('div')
    pill.className = 'sl-chatbg__paused'
    pill.textContent = 'Paused while you read'
    el.appendChild(pill)
    host.appendChild(el)
    return { el, inner, left: side === 'left', lines: [], off: 0, offAt: 0, slide: null, ys: [], ms: 0, wait: 0, paused: false }
  })
  if (cols[0].el.clientWidth < MIN_COL) {
    host.replaceChildren()
    return NO_PART
  }

  const R = Math.random
  const total = sources.reduce((s, c) => s + c.chatPerMin, 0)
  const step = perLine(total)
  // New lines a second in each column: one line per `step` counted messages, split across the two columns.
  const rate = Math.max(0.12, total / step / 60 / 2)
  const visible = Math.ceil(cols[0].el.clientHeight / LH) + 2
  const deck = emoteDeck(HERO_EMOTES, R)
  const pickEmote = () => deck((e) => failedEmotes.has(e.name) || isWideEmote(e))
  const byLogin = new Map(sources.map((s) => [s.login, s]))
  let query = ''
  const matches = (s: ChatSource) => !!query && (s.name.toLowerCase().startsWith(query) || s.login.startsWith(query))

  function pickSource(): ChatSource | undefined {
    let sum = 0
    const w = sources.map((c) => {
      const v = c.chatPerMin * (matches(c) ? 40 : 1)
      sum += v
      return v
    })
    let x = R() * sum
    for (let i = 0; i < sources.length; i++) if ((x -= w[i]) <= 0) return sources[i]
    return sources[0]
  }

  function tone(el: HTMLElement) {
    const s = byLogin.get(el.dataset.login ?? '')
    const m = !!s && matches(s)
    el.classList.toggle('is-match', m)
    el.classList.toggle('is-dim', !!query && !m && !el.classList.contains('is-moment'))
  }

  function countedLine(s: ChatSource): HTMLElement {
    const el = document.createElement('div')
    el.className = 'sl-chatbg__line'
    el.dataset.login = s.login
    const name = document.createElement('b')
    name.textContent = s.name
    name.style.setProperty('--sl-name-h', String(hue(s.login)))
    el.appendChild(name)
    for (let i = 0, n = 1 + Math.floor(R() * 3.4); i < n; i++) {
      const bar = document.createElement('s')
      bar.style.width = `${Math.round(12 + R() * 44)}px`
      el.appendChild(bar)
    }
    // A line carries an emote about as often as that channel's chat does; under reduced motion, none (no
    // animated pictures, and nothing to download).
    if (!reduced && R() < s.emoteShare * 0.6) {
      const e = pickEmote()
      if (e) el.appendChild(emoteImg(e, 19))
    }
    tone(el)
    return el
  }

  function momentLine(m: HeroMoment): HTMLElement {
    const el = document.createElement('div')
    el.className = 'sl-chatbg__line is-moment'
    el.dataset.login = m.login
    el.dataset.at = String(m.at)
    el.dataset.name = m.name
    const e: HeroEmote | undefined = !reduced && m.emote ? findHeroEmote(m.emote) : undefined
    if (e && !failedEmotes.has(e.name)) el.appendChild(emoteImg(e, 19))
    const b = document.createElement('b')
    b.textContent = `▲ ${m.short}`
    const t = document.createElement('span')
    t.textContent = `${m.label} · ${m.name}`
    el.append(b, t)
    return el
  }

  function push(col: Column, el: HTMLElement, animate: boolean) {
    col.inner.appendChild(el)
    col.lines.push(el)
    if (animate) slideUp(col, LH)
    while (col.lines.length > visible) col.lines.shift()?.remove()
  }
  if (sources.length) {
    for (const col of cols) {
      for (let i = 0; i < visible; i++) {
        const s = pickSource()
        if (s) push(col, countedLine(s), false)
      }
      col.wait = R() / rate
    }
  }

  const tip = makeChip(stage)
  let hot: HTMLElement | null = null
  let turn = 0

  function placeTip() {
    if (!hot) return
    const sr = stage.getBoundingClientRect()
    const b = hot.getBoundingClientRect()
    const left = hot.closest('.sl-chatbg__col--left') != null
    tip.at((left ? b.left + 90 : b.right - 90) - sr.left, b.top - sr.top, sr.width)
  }

  return {
    tick(now, dt) {
      for (const col of cols) {
        if (!reduced && !col.paused && sources.length) {
          col.wait -= dt * (query ? 1.6 : 1)
          if (col.wait <= 0) {
            const s = pickSource()
            if (s) push(col, countedLine(s), true)
            col.wait = (0.55 + R() * 0.9) / rate
          }
        }
        if (col.slide || !col.off) continue
        const y = offsetAt(col, now)
        if (y > SLIDE_STOP_PX) col.inner.style.transform = `translateY(${y.toFixed(1)}px)`
        else {
          col.off = 0
          col.inner.style.transform = ''
        }
      }
      if (hot) placeTip()
    },
    pointer(p: Pointer | null) {
      // The columns are first to read the pointer; what they hold, the other layers leave alone.
      let hitCol: Column | null = null
      let hitLine: HTMLElement | null = null
      if (p) {
        for (const col of cols) {
          const r = col.el.getBoundingClientRect()
          if (p.x < r.left || p.x > r.right || p.y < r.top || p.y > r.bottom) continue
          hitCol = col
          for (const ln of col.lines) {
            const b = ln.getBoundingClientRect()
            if (p.y >= b.top && p.y < b.bottom) hitLine = ln
          }
        }
      }
      for (const col of cols) {
        const paused = col === hitCol
        if (paused !== col.paused) {
          col.paused = paused
          col.el.classList.toggle('is-paused', paused)
        }
      }
      if (hitLine !== hot) {
        hot?.classList.remove('is-hot')
        hot = hitLine
        if (hot) {
          hot.classList.add('is-hot')
          if (hot.dataset.at) {
            tip.show({ text: hot.dataset.name ?? '', small: feedAgo(Number(hot.dataset.at), Date.now()) })
          } else {
            const s = byLogin.get(hot.dataset.login ?? '')
            if (s) tip.show({ text: s.name, small: `${formatHubInt(s.chatPerMin)} chat/min · ${formatHubInt(s.viewers)} watching` })
            else tip.hide()
          }
          placeTip()
        } else tip.hide()
      }
      return hitCol != null
    },
    search(ev: SearchEvent, value: string) {
      const q = value.trim().toLowerCase()
      const next = ev !== 'blur' && q.length >= 2 && sources.some((s) => s.name.toLowerCase().startsWith(q) || s.login.startsWith(q)) ? q : ''
      if (next === query) return
      query = next
      for (const col of cols) for (const ln of col.lines) tone(ln)
    },
    moment(m: HeroMoment) {
      let col = cols[turn++ % 2]
      if (col.paused) col = cols.find((c) => c !== col) ?? col
      const el = momentLine(m)
      if (reduced) {
        // Nothing moves, so the line goes in where it can be read, above the bottom fade.
        const at = Math.max(0, col.lines.length - 6)
        col.inner.insertBefore(el, col.lines[at] ?? null)
        col.lines.splice(at, 0, el)
        while (col.lines.length > visible) col.lines.shift()?.remove()
      } else push(col, el, true)
    },
    dispose() {
      tip.dispose()
      for (const col of cols) col.slide?.cancel()
      host.replaceChildren()
    },
  }
}
