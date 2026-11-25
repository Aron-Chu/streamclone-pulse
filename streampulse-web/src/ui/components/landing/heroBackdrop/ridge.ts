import type { HeroMoment, RidgeData, RidgeRow } from '../heroBackdropModel'
import { formatHubInt } from '../../hub/v5/hubV5Model'
import { feedAgo } from '../../hub/v5/hubV5FeedModel'
import { findHeroEmote } from '../heroEmotes'
import { clamp, makeChip, mixRgb, NO_PART, rgba, tokenRgb, type Part, type Pointer, type Rgb, type SearchEvent } from './shared'

/**
 * The chat ridge: the network's last complete minutes (chat, emotes by provider, viewers), one line per
 * series in perspective across the lower half of the first screen, each line scaled to itself. Plain canvas
 * 2D. Between two series lines, fainter lines trace the surface between them for depth, as the board's
 * per-channel lines did (11-22); only the series lines answer a hover. A minute that was not recorded is a
 * gap in every line that touches it.
 *
 * Motion (none under reduced motion): the lines rise from flat when the page opens, a soft light runs along
 * them from the oldest minute to the newest, and a live moment swells its minute and ripples into the lines
 * beside it while its label shows.
 */

const ZF = 6
const ZN = 2
const CAM = 1.25
const ease = (p: number, s = 1.25) => 1 + (s + 1) * (p - 1) ** 3 + s * (p - 1) ** 2
const easeOut = (p: number) => 1 - (1 - p) ** 3

/** How many lines the board drew: one per channel, 15 on a desktop and 9 on a phone. */
const LINES_DESKTOP = 15
const LINES_PHONE = 9
const LINE_GAP_PX = 32
const ENTER_MS = 1000
const ENTER_STAGGER_MS = 45
const SWEEP_MS = 9000
const MARK_MS = 4200
const SWELL = 0.24
const SWELL_FALL_MS = 800
const RIPPLE_LINES = 3
const RIPPLE_DELAY_MS = 90
/** How long after a moment's label goes that its swell is still falling, ripples included. */
const SWELL_TAIL_MS = RIPPLE_LINES * RIPPLE_DELAY_MS + SWELL_FALL_MS + 100
/** A tilt this close to the pointer's is the pointer's: the lines stop moving and the canvas stops drawing. */
const TILT_SETTLED = 0.001
/** How far a stroke, its smoothing or a mark reaches past a line's points, in CSS pixels. */
const INK_PAD = 8

/** Surface lines between two neighbouring series, so the field has about as many lines as the board's. */
export function meshPerGap(rows: number, target: number): number {
  if (rows < 2) return 0
  return Math.max(0, Math.round((target - rows) / (rows - 1)))
}

interface Line {
  /** The series row this line draws, or null for a surface line between rows a and b. */
  row: number | null
  a: number
  b: number
  t: number
}

interface Mark {
  row: number
  line: number
  i: number
  born: number
  until: number
}

/**
 * `farAt` is where the page wants the far line, in stage pixels (just above the hero's buttons); without it the
 * far line sits at 60% of the stage.
 */
export function mountRidge(canvas: HTMLCanvasElement, stage: HTMLElement, data: RidgeData, reduced: boolean, enteredAt?: number, farAt?: number): Part {
  const rows = data.rows
  const COLS = data.times.length
  const W = stage.clientWidth
  const H = stage.clientHeight
  const g = rows.length && COLS >= 2 && W > 0 && H > 0 ? canvas.getContext('2d') : null
  if (!g) return NO_PART
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = Math.round(W * dpr)
  canvas.height = Math.round(H * dpr)
  g.setTransform(dpr, 0, 0, dpr, 0, 0)

  const phone = W < 760
  const ROWS = rows.length
  const INK = tokenRgb(stage, '--sc-foreground', [250, 250, 250])
  const TONE: Record<string, Rgb> = {
    chat: tokenRgb(stage, '--sc-chart-1', [45, 212, 245]),
    emotes: tokenRgb(stage, '--sc-chart-2', [167, 139, 250]),
    viewers: tokenRgb(stage, '--sc-chart-3', [20, 210, 150]),
  }
  const ROSE = tokenRgb(stage, '--sc-chart-5', [244, 98, 128])
  // 7TV keeps its colour; the Twitch, BTTV and FFZ rows stay plain ink rather than borrow it.
  const toneOf = (r: RidgeRow) =>
    r.key === 'chat' ? TONE.chat : r.key === 'viewers' ? TONE.viewers : r.key === 'emotes' || r.key === 'seventv' ? TONE.emotes : INK

  // Lines sit on a floor seen from a low camera: the far line's baseline at farY, the near one just under the bottom.
  // On a desktop the far line follows the copy, so on a short screen the lines start under the trending row
  // instead of behind it; the fade at the top of the canvas moves with it.
  const farY = phone ? H * 0.76 : farAt != null && Number.isFinite(farAt) ? clamp(farAt, H * 0.45, H * 0.75) : H * 0.6
  canvas.style.setProperty('--sl-ridge-from', `${Math.round(farY - 60)}px`)
  canvas.style.setProperty('--sl-ridge-to', `${Math.round(farY + 20)}px`)
  const nearY = H * 1.03

  // Far to near: each series line, then the surface lines between it and the next series. A short band gets
  // fewer lines (about one per 32 px), so it never packs into a flat strip.
  const target = phone ? LINES_PHONE : clamp(Math.round((nearY - farY) / LINE_GAP_PX), 7, LINES_DESKTOP)
  const between = meshPerGap(ROWS, target)
  const lines: Line[] = []
  const rowLine: number[] = []
  for (let r = 0; r < ROWS; r++) {
    rowLine[r] = lines.length
    lines.push({ row: r, a: r, b: r, t: 0 })
    if (r < ROWS - 1) for (let k = 1; k <= between; k++) lines.push({ row: null, a: r, b: r + 1, t: k / (between + 1) })
  }
  const L = lines.length

  const F = (nearY - farY) / (CAM * (1 / ZN - 1 / ZF))
  const HY = farY - (F * CAM) / ZF
  const AMP = phone ? 0.24 : 0.28
  const lineZ = (l: number) => (L === 1 ? ZN : ZF - ((ZF - ZN) * l) / (L - 1))
  const depthOf = (l: number) => (L === 1 ? 1 : l / (L - 1))

  // Where a minute is not recorded, the line breaks; underneath, the nearest recorded height still hides
  // the lines behind it.
  const filled = rows.map((row) => {
    const out = row.heights.slice()
    let last: number | null = null
    for (let i = 0; i < out.length; i++) if (out[i] == null) out[i] = last; else last = out[i]
    last = null
    for (let i = out.length - 1; i >= 0; i--) if (out[i] == null) out[i] = last; else last = out[i]
    return out.map((v) => v ?? 0.1)
  })
  const base = lines.map((ln) => filled[ln.a].map((v, i) => v + (filled[ln.b][i] - v) * ln.t))
  const recorded = lines.map((ln) => rows[ln.a].heights.map((v, i) => v != null && rows[ln.b].heights[i] != null))

  const born = enteredAt ?? performance.now()
  const hi = rows.map(() => 0)
  const marks: Mark[] = []
  const pn = { x: 0, y: 0 }
  const pt = { x: 0, y: 0 }
  let quiet = false
  let dirty = true
  let swept = false
  let hover: { row: number; i: number; x: number } | null = null
  let drawn: Array<Array<[number, number]>> = []
  /** Where the running light is in the picture on the canvas now (x from, x to), or null when it is not. */
  let band: [number, number] | null = null
  /** Each line's own stroke gradient, kept while its light and the search's hush stay the same. */
  const lineGrad: Array<{ lit: number; quiet: boolean; grad: CanvasGradient } | null> = lines.map(() => null)
  const hoverChip = makeChip(stage)
  const markChip = makeChip(stage, 'moment')

  const colX = (u: number, Z: number) => W / 2 + (u / (COLS - 1) - 0.5) * (W + 80) + (-pn.x * 0.12 * F) / Z
  const grow = (age: number) => (reduced ? 1 : age <= 0 ? 0 : age >= 900 ? 1 : ease(age / 900))
  const rise = (l: number, now: number) => {
    if (reduced) return 1
    const p = (now - born - l * ENTER_STAGGER_MS) / ENTER_MS
    return p <= 0 ? 0 : p >= 1 ? 1 : ease(p, 0.9)
  }

  /** A live moment's swell at line l, minute i: its own line most, the lines beside it a little later and less. */
  function swell(l: number, i: number, now: number) {
    if (reduced) return 0
    let v = 0
    for (const m of marks) {
      const d = Math.abs(l - m.line)
      if (d > RIPPLE_LINES) continue
      const delay = d * RIPPLE_DELAY_MS
      const up = grow(now - m.born - delay)
      const down = now < m.until + delay ? 1 : 1 - easeOut(clamp((now - m.until - delay) / SWELL_FALL_MS, 0, 1))
      if (up <= 0 || down <= 0) continue
      v += SWELL * 0.55 ** d * up * down * Math.exp(-(((i - m.i) / 1.3) ** 2))
    }
    return v
  }

  function points(l: number, now: number): Array<[number, number]> {
    const Z = lineZ(l)
    const py = (pn.y * 0.03 * F) / Z
    const e = rise(l, now)
    const out: Array<[number, number]> = []
    for (let i = 0; i < COLS; i++) out.push([colX(i, Z), HY + (F * (CAM - AMP * (base[l][i] * e + swell(l, i, now)))) / Z + py])
    return out
  }

  function trace(pts: Array<[number, number]>, from = 0, to = pts.length - 1) {
    g!.moveTo(pts[from][0], pts[from][1])
    for (let k = from + 1; k < to; k++) {
      const mx = (pts[k][0] + pts[k + 1][0]) / 2
      const my = (pts[k][1] + pts[k + 1][1]) / 2
      g!.quadraticCurveTo(pts[k][0], pts[k][1], mx, my)
    }
    g!.lineTo(pts[to][0], pts[to][1])
  }

  /** One stroke per recorded run of minutes. */
  function strokeRuns(l: number, pts: Array<[number, number]>) {
    g!.beginPath()
    let start = -1
    for (let i = 0; i <= COLS; i++) {
      const ok = i < COLS && recorded[l][i]
      if (ok && start < 0) start = i
      if (!ok && start >= 0) {
        if (i - 1 > start) trace(pts, start, i - 1)
        start = -1
      }
    }
    g!.stroke()
  }

  const yAt = (pts: Array<[number, number]>, x: number) => {
    for (let k = 1; k < pts.length; k++) {
      if (pts[k][0] >= x) {
        const [x0, y0] = pts[k - 1]
        const [x1, y1] = pts[k]
        return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0 || 1)
      }
    }
    return pts[pts.length - 1][1]
  }

  /** How much a lit line may brighten at u (0-1 across the screen): little behind the words, fully in the gutters. */
  const centre = (u: number) => 1 - 0.65 * clamp(1 - Math.abs(u - 0.5) / 0.22, 0, 1)

  /** Where the running light is (0-1 across a line) on the nearest line; each farther line is up to 0.1 ahead. */
  const sweepAt = (now: number) => (((now - born) % SWEEP_MS) / SWEEP_MS) * 1.5 - 0.25
  /** Whether the running light is on any line now. */
  const sweepShows = (now: number) => {
    const u = sweepAt(now)
    return u + 0.1 > -0.08 && u < 1.08
  }

  /** The x-range the running light covers at `now`, across every line, or null when it is on none. */
  function sweepBand(now: number): [number, number] | null {
    if (reduced || quiet) return null
    const sweepU = sweepAt(now)
    let lo = Infinity
    let hi2 = -Infinity
    for (let l = 0; l < L; l++) {
      const u = sweepU + (1 - depthOf(l)) * 0.1
      if (!(u > -0.08 && u < 1.08)) continue
      const Z = lineZ(l)
      const x0 = colX(0, Z)
      const x1 = colX(COLS - 1, Z)
      lo = Math.min(lo, x0 + (x1 - x0) * clamp(u - 0.08, 0, 1))
      hi2 = Math.max(hi2, x0 + (x1 - x0) * clamp(u + 0.08, 0, 1))
    }
    return lo <= hi2 ? [lo, hi2] : null
  }

  function lineGradient(l: number, tone: Rgb, a: number, mid: number, lit: number): CanvasGradient {
    const kept = lineGrad[l]
    if (kept && kept.lit === lit && kept.quiet === quiet) return kept.grad
    const grad = g!.createLinearGradient(0, 0, W, 0)
    grad.addColorStop(0, rgba(tone, a))
    grad.addColorStop(0.27, rgba(tone, a))
    grad.addColorStop(0.4, rgba(tone, mid))
    grad.addColorStop(0.6, rgba(tone, mid))
    grad.addColorStop(0.73, rgba(tone, a))
    grad.addColorStop(1, rgba(tone, a))
    lineGrad[l] = { lit, quiet, grad }
    return grad
  }

  /**
   * The whole picture, or with `onlyLight` the strip the running light left and the one it is in now: when
   * nothing else moved, the rest of the canvas already holds the same pixels.
   */
  function draw(now: number, onlyLight = false) {
    const next = sweepBand(now)
    let strip: [number, number] | null = null
    if (onlyLight) {
      const from = Math.min(band?.[0] ?? Infinity, next?.[0] ?? Infinity) - INK_PAD
      const to = Math.max(band?.[1] ?? -Infinity, next?.[1] ?? -Infinity) + INK_PAD
      band = next
      if (!(from < to)) return
      // On whole device pixels, so the strip's edges meet the pixels kept beside it exactly.
      const a = Math.max(0, Math.floor(from * dpr) / dpr)
      const b = Math.min(W, Math.ceil(to * dpr) / dpr)
      if (!(a < b)) return
      strip = [a, b]
      g!.save()
      g!.beginPath()
      g!.rect(a, 0, b - a, H + 1)
      g!.clip()
      g!.clearRect(a, 0, b - a, H + 1)
    } else {
      band = next
      g!.clearRect(0, 0, W, H)
    }
    drawn = []
    const sweepU = sweepAt(now)
    /** The lowest ink drawn so far: below it the canvas is still clear, so a cut there changes nothing. */
    let inkTo = -Infinity
    for (let l = 0; l < L; l++) {
      const ln = lines[l]
      const row = ln.row != null ? rows[ln.row] : null
      const pts = points(l, now)
      drawn.push(pts)
      let lineTo = -Infinity
      for (const q of pts) if (q[1] > lineTo) lineTo = q[1]
      // Cut away what this nearer line hides, so the page's own background shows below it. The cut stops under
      // the lowest ink already drawn (and never above this line), not at the bottom of the canvas.
      if (inkTo > -Infinity) {
        const bottom = Math.min(H + 10, Math.max(inkTo + INK_PAD, lineTo))
        g!.globalCompositeOperation = 'destination-out'
        g!.beginPath()
        trace(pts)
        g!.lineTo(W + 60, bottom)
        g!.lineTo(-60, bottom)
        g!.closePath()
        g!.fillStyle = '#000'
        g!.fill()
        g!.globalCompositeOperation = 'source-over'
      }
      inkTo = Math.max(inkTo, lineTo)

      const depth = depthOf(l)
      const lit = ln.row != null ? hi[ln.row] : Math.max(hi[ln.a] * (1 - ln.t), hi[ln.b] * ln.t) * 0.35
      const a0 = (0.13 + 0.3 * depth) * (row ? 1 : 0.62) * (quiet ? 0.55 : 1) * (phone ? 0.6 : 1)
      const tone = row ? mixRgb(INK, toneOf(row), lit) : INK
      const a = Math.max(a0, lit * 0.92)
      // The centre stays dim even for a lit line, so a highlight never runs bright behind the buttons.
      const mid = a * (0.4 - 0.18 * lit)
      g!.strokeStyle = lineGradient(l, tone, a, mid, lit)
      g!.lineWidth = (row ? 1.1 : 0.8) + depth * 0.5 + lit * 0.9
      strokeRuns(l, pts)

      // The light that runs from the oldest minute to the newest; the far lines a beat ahead of the near ones.
      if (!reduced && !quiet) {
        const u = sweepU + (1 - depth) * 0.1
        if (u > -0.08 && u < 1.08) {
          const boost = (row ? 0.34 : 0.22) * centre(u) * (phone ? 0.6 : 1) * rise(l, now)
          const sweepTone = row ? mixRgb(INK, toneOf(row), 0.55) : INK
          const sg = g!.createLinearGradient(pts[0][0], 0, pts[COLS - 1][0], 0)
          const stop = (p: number, al: number) => sg.addColorStop(clamp(p, 0, 1), rgba(sweepTone, al))
          stop(u - 0.08, 0)
          stop(u, boost)
          stop(u + 0.08, 0)
          g!.strokeStyle = sg
          g!.lineWidth = (row ? 1.5 : 1.1) + depth * 0.5
          strokeRuns(l, pts)
        }
      }

      if (ln.row == null) continue
      for (const m of marks) {
        if (m.line !== l) continue
        const live = now < m.until
        g!.beginPath()
        g!.arc(pts[m.i][0], pts[m.i][1], (3 + depth * 1.5) * Math.max(0.01, grow(now - m.born)), 0, Math.PI * 2)
        g!.fillStyle = live ? rgba(ROSE, 0.95) : rgba(mixRgb(INK, ROSE, 0.6), 0.45)
        g!.fill()
      }
    }
    if (strip) g!.restore()
    const live = marks.find((m) => now < m.until)
    if (live && drawn[live.line]) markChip.at(drawn[live.line][live.i][0], drawn[live.line][live.i][1], W)
    if (hover && drawn[rowLine[hover.row]]) hoverChip.at(hover.x, yAt(drawn[rowLine[hover.row]], hover.x), W)
  }

  function hitTest(x: number, y: number) {
    if (y < farY - 90 || !drawn.length) return null
    let best: { row: number; d: number } | null = null
    let cover = Infinity
    // Near to far: a line can be pointed at only where no nearer line hides it.
    for (let l = L - 1; l >= 0; l--) {
      const ly = yAt(drawn[l], x)
      if (ly >= cover) continue
      cover = ly
      const row = lines[l].row
      if (row == null) continue
      const d = Math.abs(ly - y)
      if (d < 22 && (!best || d < best.d)) best = { row, d }
    }
    if (!best) return null
    const Z = lineZ(rowLine[best.row])
    const x0 = colX(0, Z)
    const x1 = colX(COLS - 1, Z)
    const i = Math.round(((x - x0) / (x1 - x0 || 1)) * (COLS - 1))
    return i >= 0 && i < COLS ? { row: best.row, i, x } : null
  }

  function hoverText(r: number, i: number) {
    const row = rows[r]
    const v = row.values[i]
    const ago = feedAgo(data.times[i], Date.now())
    if (v == null) return { text: row.label, small: `not recorded · ${ago}` }
    const n = `${row.atLeast[i] ? 'at least ' : ''}${formatHubInt(v)}`
    return { text: row.label, small: `${n} ${row.unit} · ${ago}` }
  }

  return {
    tick(now, dt) {
      // The canvas draws only while something on it moves: the rise, the running light (and one frame after it
      // leaves, to clear it), a swell, the tilt, a highlight. Between sweeps the last picture stays up.
      let busy = dirty
      /** Something besides the running light moved, so the whole picture is drawn. */
      let whole = dirty
      for (let r = 0; r < ROWS; r++) {
        const want = hover?.row === r || marks.some((m) => m.row === r && now < m.until) ? 1 : 0
        const next = reduced ? want : hi[r] + (want - hi[r]) * Math.min(1, dt * 10)
        const v = Math.abs(want - next) < 0.004 ? want : next
        if (v !== hi[r]) busy = whole = true
        hi[r] = v
      }
      if (!reduced) {
        const k = 1 - Math.exp(-dt * 4)
        for (const ax of ['x', 'y'] as const) {
          const d = pt[ax] - pn[ax]
          if (!d) continue
          pn[ax] = Math.abs(d) < TILT_SETTLED ? pt[ax] : pn[ax] + d * k
          busy = whole = true
        }
        if (now - born < ENTER_MS + L * ENTER_STAGGER_MS + 100) busy = whole = true
        if (marks.some((m) => now < m.until + SWELL_TAIL_MS)) busy = whole = true
        const sweeping = !quiet && sweepShows(now)
        if (sweeping || swept) busy = true
        swept = sweeping
      }
      for (const m of marks) if (now >= m.until && now < m.until + 100) busy = whole = true
      if (!marks.some((m) => now < m.until)) markChip.hide()
      if (busy) draw(now, !whole)
      dirty = false
    },
    pointer(p: Pointer | null, claimed: boolean) {
      if (phone) return false
      const sr = stage.getBoundingClientRect()
      const x = p ? p.x - sr.left : 0
      const y = p ? p.y - sr.top : 0
      const inside = !!p && y >= 0 && y <= H
      // The tilt still follows the pointer while another layer holds it; only the label waits.
      pt.x = inside ? clamp((x - W / 2) / (W / 2), -1, 1) : 0
      pt.y = inside ? clamp((y - H / 2) / (H / 2), -1, 1) : 0
      const h = inside && !claimed ? hitTest(x, y) : null
      hover = h
      if (h) hoverChip.show(hoverText(h.row, h.i))
      else hoverChip.hide()
      dirty = true
      return h != null
    },
    search(ev: SearchEvent) {
      const q = ev === 'focus' ? true : ev === 'blur' ? false : quiet
      if (q !== quiet) {
        quiet = q
        dirty = true
      }
    },
    moment(m: HeroMoment, nowMs: number) {
      const span = data.times[COLS - 1] + data.bucketMs - data.times[0]
      const i = Math.floor((m.at - data.times[0]) / data.bucketMs)
      if (m.at < data.times[0] || m.at - data.times[0] >= span || i < 0 || i >= COLS) return
      const want = m.series === 'emotes' ? ['emotes', 'seventv', 'chat'] : ['chat']
      const row = want.map((k) => rows.findIndex((r) => r.key === k)).find((r) => r >= 0)
      if (row == null || rows[row].heights[i] == null) return
      const now = performance.now()
      const prior = marks.findIndex((x) => x.row === row && x.i === i)
      if (prior >= 0) marks.splice(prior, 1)
      marks.push({ row, line: rowLine[row], i, born: now, until: now + MARK_MS })
      if (marks.length > 3) marks.shift()
      // On phones the ridge sits behind the search, so a label would cover words: the mark alone shows.
      if (!phone) markChip.show({ text: `▲ ${m.short} ${m.label} · ${m.name}`, small: feedAgo(m.at, nowMs), emote: reduced ? null : findHeroEmote(m.emote) ?? null })
      dirty = true
    },
    resume() {
      // The last picture may hold a swell or the light that ended while nothing drew.
      dirty = true
    },
    dispose() {
      hoverChip.dispose()
      markChip.dispose()
      g!.clearRect(0, 0, W, H)
      band = null
    },
  }
}
