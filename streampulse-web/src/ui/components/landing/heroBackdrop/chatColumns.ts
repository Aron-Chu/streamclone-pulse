import { emoteDeck, findHeroEmote, HERO_EMOTES, isWideEmote, type HeroEmote } from '../heroEmotes'
import { MADE_UP_CHAT, perLine, type ChatSource, type HeroMoment, type MadeUpLine } from '../heroBackdropModel'
import { formatHubInt } from '../../hub/v5/hubV5Model'
import { feedAgo } from '../../hub/v5/hubV5FeedModel'
import { emoteImg, failedEmotes, makeChip, NO_PART, type Part, type Pointer, type SearchEvent } from './shared'

/**
 * The side chat: two columns in the gutters. Each line is made up: a name with a dot or a dash, which a Twitch
 * login cannot have, and a short reaction. Never real chat words or who wrote them (PRODUCT.md, rollup-first).
 * What is real: the pace, from the network's chat per minute; more emotes when that chat is emote-heavy; and a
 * live moment's own line. Hovering pauses a column so a line can be read, and says the line is made up. Typing
 * a channel in the search lights its moment lines (the made-up lines belong to no channel). The columns lean
 * back toward the headline. DOM and CSS 3D, no library.
 */

const LH = 27
/** Below this width a column cannot hold a name and a few words. */
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
  // New lines a second in each column: one per `step` counted messages, split across the two columns, so the
  // network's pace sets the speed (never slower than a line every 8 s).
  const rate = Math.max(0.12, total / step / 60 / 2)
  // Lines with words carry an emote more often when the network's chat is emote-heavy; a few lines are only one.
  const emoteShare = total > 0 ? sources.reduce((s, c) => s + c.emoteShare * c.chatPerMin, 0) / total : 0
  const visible = Math.ceil(cols[0].el.clientHeight / LH) + 2
  const deck = emoteDeck(HERO_EMOTES, R)
  const pickEmote = () => deck((e) => failedEmotes.has(e.name) || isWideEmote(e))
  const pace = `Real pace: ${formatHubInt(total)} chat/min across ${formatHubInt(sources.length)} channels`
  let query = ''

  const shuffled = () => {
    const out = MADE_UP_CHAT.slice()
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(R() * (i + 1))
      ;[out[i], out[j]] = [out[j], out[i]]
    }
    return out
  }
  // The made-up lines come round in a shuffled order, each once before any repeats, and a line still on screen
  // in either column waits: two full columns hold fewer lines than the list.
  let bag: MadeUpLine[] = []
  function nextLine(withText = false): MadeUpLine {
    const onScreen = new Set<string>()
    for (const c of cols) for (const ln of c.lines) if (ln.dataset.user) onScreen.add(ln.dataset.user)
    const fits = (l: MadeUpLine) => !onScreen.has(l.user) && (!withText || !!l.text)
    if (!bag.some(fits)) bag = shuffled().concat(bag)
    for (let i = bag.length - 1; i >= 0; i--) if (fits(bag[i])) return bag.splice(i, 1)[0]
    // Only when every line is already on screen (a very tall window).
    return bag.pop() as MadeUpLine
  }

  /** While the search names a live channel, that channel's moment lines light up. */
  function tone(el: HTMLElement) {
    const login = el.dataset.login
    const name = (el.dataset.name ?? '').toLowerCase()
    el.classList.toggle('is-match', !!query && !!login && (login.startsWith(query) || name.startsWith(query)))
  }

  function fill(el: HTMLElement, line: MadeUpLine, e: HeroEmote | undefined) {
    el.dataset.user = line.user
    const name = document.createElement('b')
    name.textContent = `${line.user}:`
    name.style.setProperty('--sl-name-h', String(hue(line.user)))
    el.replaceChildren(name)
    if (line.text) {
      const msg = document.createElement('span')
      msg.className = 'sl-chatbg__msg'
      msg.textContent = line.text
      el.appendChild(msg)
    }
    if (!e) return
    const img = emoteImg(e, 19)
    // A line that is only an emote whose picture fails would be a bare name, so it takes a line with words.
    if (!line.text) img.addEventListener('error', () => fill(el, nextLine(true), undefined), { once: true })
    el.appendChild(img)
  }

  function chatLine(): HTMLElement {
    let line = nextLine()
    let e: HeroEmote | undefined
    // A line that is only an emote needs one to show. Under reduced motion there are none (no animated pictures,
    // nothing to download), and every emote may have failed to load; then it gives way to a line with words.
    if (!line.text) e = reduced ? undefined : pickEmote()
    if (!line.text && !e) line = nextLine(true)
    else if (line.text && !reduced && R() < emoteShare * 0.6) e = pickEmote()
    const el = document.createElement('div')
    el.className = 'sl-chatbg__line'
    fill(el, line, e)
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
    tone(el)
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
      for (let i = 0; i < visible; i++) push(col, chatLine(), false)
      // The first new line comes within a second, so a visitor sees the chat move before they scroll on.
      col.wait = Math.min(R() / rate, 0.3 + R() * 0.6)
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
          col.wait -= dt
          if (col.wait <= 0) {
            push(col, chatLine(), true)
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
          } else tip.show({ text: 'Made-up line', small: pace })
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
