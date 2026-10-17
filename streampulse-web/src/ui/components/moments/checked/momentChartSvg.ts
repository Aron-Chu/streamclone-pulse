import { clk, int, tick, SERIES_BEFORE, type CheckedMoment, type MinuteSeries } from '../../../../lib/momentsChecked'
import type { MomentMetricKind } from '../../../../lib/momentsFeed'

/**
 * The detail chart (moments-r2 drawChart): per-minute bars from 32 minutes
 * before the moment to 16 after, the compared minutes shaded with their
 * average dashed, the moment teal and labelled. Minutes are counted from the
 * moment (rel 0); the series index is rel + SERIES_BEFORE.
 */
export interface ChartGeo { lo: number; hi: number; bw: number; T: number; ph: number; W: number; H: number }

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
export const seriesOf = (s: MinuteSeries, metric: MomentMetricKind) => (metric === 'emotes' ? s.e : s.c)
export const atRel = (arr: Array<number | null>, rel: number) => arr[SERIES_BEFORE + rel] ?? null
export const tAt = (m: CheckedMoment, rel: number) => m.at + rel * 60_000

/** The drawn minutes: from the stream's first minute (or 32 before) to the last one measured (at most 16 after). */
export function chartRange(m: CheckedMoment, s: MinuteSeries): [number, number] {
  const lo = s.fromSpark ? Math.max(-16, m.winFrom) : Math.max(-SERIES_BEFORE, -Math.floor(m.item.offsetSeconds / 60))
  let hi = 0
  for (let rel = 1; rel <= (s.fromSpark ? 8 : 16); rel += 1) {
    if (atRel(s.c, rel) != null || atRel(s.e, rel) != null || atRel(s.v, rel) != null) hi = rel
  }
  return [lo, hi]
}

/** The minutes compared: winFrom..-2 (none when the stream opened under two minutes before). */
export const compared = (m: CheckedMoment): [number, number] | null => (m.winFrom <= -2 ? [m.winFrom, -2] : null)

let measure: CanvasRenderingContext2D | null | undefined
/** A chart label's width in px (Inter 500 12px), measured, so labels can keep clear of each other. */
function textW(text: string): number {
  if (measure === undefined) {
    try { measure = document.createElement('canvas').getContext('2d') } catch { measure = null }
    if (measure) measure.font = '500 12px Inter, system-ui, sans-serif'
  }
  return measure ? measure.measureText(text).width : text.length * 6.4
}

export function chartSvg(m: CheckedMoment, s: MinuteSeries, metric: MomentMetricKind, width: number, phone: boolean, held: number | null, focusable: boolean): { html: string; geo: ChartGeo } {
  const arr = seriesOf(s, metric)
  const Wd = Math.max(240, Math.round(width || 400)), H = phone ? 170 : 200, T = 30, B = 22, ph = H - T - B
  const [lo, hi] = chartRange(m, s), n = hi - lo + 1, bw = Wd / n, gap = Math.max(1, bw * 0.24)
  const vals: Array<number | null> = []
  for (let rel = lo; rel <= hi; rel += 1) vals.push(atRel(arr, rel))
  const base = metric === 'emotes' ? m.baseE : m.baseC
  const max = Math.max(1, base ?? 0, ...vals.filter((v): v is number => v != null)) * 1.06
  const X = (rel: number) => (rel - lo) * bw, Y = (v: number) => T + ph - (v / max) * ph
  const win = compared(m), bLo = win ? Math.max(lo, win[0]) : null, bHi = win ? win[1] : null
  const winN = win ? win[1] - win[0] + 1 : 0
  let g = `<line class="mk-gl" x1="0" x2="${Wd}" y1="${T + ph + 0.5}" y2="${T + ph + 0.5}"/>`
  let bandLab: { x: number; r: number; y: number } | null = null
  if (bLo != null && bHi != null && bHi >= bLo) {
    const bandW = X(bHi) + bw - X(bLo)
    let txt = `the ${winN} minutes compared`
    if (textW(txt) + 4 > bandW) txt = `${winN} min compared` // R2-5: on a phone the long label ran past the band, onto the moment's
    bandLab = { x: X(bLo) + 4, r: X(bLo) + 4 + textW(txt), y: T - 12 }
    g += `<rect class="mk-band" x="${X(bLo).toFixed(1)}" y="${T - 6}" width="${bandW.toFixed(1)}" height="${ph + 6}"/>`
    g += `<text class="mk-an2" x="${bandLab.x.toFixed(1)}" y="${bandLab.y}">${txt}</text>`
  }
  const lk = held != null && held >= lo && held <= hi ? held : null
  if (lk != null) g += `<rect class="mk-lk-b" data-lk x="${(X(lk) + 0.5).toFixed(1)}" y="${T - 6}" width="${Math.max(1, bw - 1).toFixed(1)}" height="${ph + 6}" rx="2"/>`
  vals.forEach((v, j) => {
    if (v == null) return
    const rel = lo + j, h = Math.max(1, T + ph - Y(v))
    const cls = (rel === 0 ? 'mk-cb mo' : bLo != null && bHi != null && rel >= bLo && rel <= bHi ? 'mk-cb in' : 'mk-cb') + (rel === lk ? ' lk' : '')
    g += `<rect class="${cls}" data-i="${rel}" x="${(X(rel) + gap / 2).toFixed(1)}" y="${(T + ph - h).toFixed(1)}" width="${Math.max(1, bw - gap).toFixed(1)}" height="${h.toFixed(1)}" rx="1"/>`
  })
  if (base != null && bLo != null && bHi != null) {
    const y = Y(base).toFixed(1)
    g += `<line class="mk-base" x1="${X(bLo).toFixed(1)}" x2="${(X(bHi) + bw).toFixed(1)}" y1="${y}" y2="${y}"/>`
    g += `<text class="mk-an2" x="${(X(bLo) + 4).toFixed(1)}" y="${(Y(base) - 5).toFixed(1)}">average ${int(base)}</text>`
  }
  // the moment, labelled above its bar; never off the plot, above every bar it spans, and clear of the band's label
  const mv = atRel(arr, 0)
  if (mv != null) {
    const lab = `${clk(m.at)} · ${int(mv)}`, lw = lab.length * 6.8
    let x0 = Math.min(Wd - lw, Math.max(0, X(0) + bw / 2 - lw / 2))
    const topOver = (x: number) => {
      let t = mv
      for (let rel = Math.floor(x / bw) + lo; rel <= Math.min(hi, Math.floor((x + lw) / bw) + lo); rel += 1) {
        const v = atRel(arr, rel)
        if (v != null) t = Math.max(t, v)
      }
      return t
    }
    let y = Math.max(12, Y(topOver(x0)) - 7)
    const hits = (x: number, yy: number) => !!bandLab && x < bandLab.r + 10 && x + lw > bandLab.x && Math.abs(yy - bandLab.y) < 18
    if (bandLab && hits(x0, y)) {
      x0 = Math.min(Wd - lw, bandLab.r + 10)
      y = Math.max(12, Y(topOver(x0)) - 7)
      if (hits(x0, y)) y = bandLab.y + 18
    }
    g += `<text class="mk-an mk-an-m" x="${x0.toFixed(1)}" y="${y.toFixed(1)}">${esc(lab)}</text>`
  }
  // ticks every 10 minutes of clock time
  for (let rel = lo; rel <= hi; rel += 1) {
    const t = tAt(m, rel)
    if (new Date(t).getMinutes() % 10) continue
    const x = X(rel) + bw / 2
    if (x < 16 || x > Wd - 16) continue
    g += `<text class="mk-tk" text-anchor="middle" x="${x.toFixed(1)}" y="${H - 4}">${esc(tick(t))}</text>`
  }
  g += `<line class="mk-cur" data-cur x1="0" x2="0" y1="${T - 6}" y2="${T + ph}" visibility="hidden"/>`
  g += `<rect data-hit x="0" y="0" width="${Wd}" height="${H}" fill="transparent"/>`
  const label = `${metric === 'emotes' ? 'Emotes' : 'Chat'} per minute from ${clk(tAt(m, lo))} to ${clk(tAt(m, hi))}. The moment, ${clk(m.at)}, had ${int(mv)}; the ${winN} minutes compared averaged ${int(base)}.${focusable ? ' Click a bar, or use the arrow keys, to hold that minute.' : ''}`
  return {
    html: `<svg viewBox="0 0 ${Wd} ${H}" width="${Wd}" height="${H}"${focusable ? ' tabindex="0"' : ''} role="img" aria-label="${esc(label)}">${g}</svg>`,
    geo: { lo, hi, bw, T, ph, W: Wd, H },
  }
}

/** The minute under a pointer. */
export function relAt(svg: SVGSVGElement, geo: ChartGeo, clientX: number): number {
  const r = svg.getBoundingClientRect(), x = (clientX - r.left) * (geo.W / Math.max(1, r.width))
  return Math.max(geo.lo, Math.min(geo.hi, geo.lo + Math.floor(x / geo.bw)))
}

/** Bars rise left to right with the moment's last ('grow'), or ease to their new heights ('morph'). */
export function tweenBars(svg: SVGSVGElement, anim: 'grow' | 'morph', prev: Map<string, [number, number]>, floor: number) {
  const bars = [...svg.querySelectorAll<SVGRectElement>('rect.mk-cb')], D = anim === 'grow' ? 260 : 220, t0 = performance.now()
  const jobs = bars.map((b, j) => {
    const ty = Number(b.getAttribute('y')), th = Number(b.getAttribute('height')), o = anim === 'morph' ? prev.get(b.dataset.i ?? '') : undefined
    const fy = o ? o[0] : floor, fh = o ? o[1] : 0
    b.setAttribute('y', String(fy))
    b.setAttribute('height', String(fh))
    return { b, fy, fh, ty, th, d: anim === 'grow' ? (b.classList.contains('mo') ? bars.length * 4 + 60 : j * 4) : 0 }
  })
  svg.classList.add(`anim-${anim}`)
  const ease = (p: number) => 1 - Math.pow(1 - p, 3)
  const step = (t: number) => {
    let more = false
    for (const q of jobs) {
      const p = Math.min(1, Math.max(0, (t - t0 - q.d) / D)), e = ease(p)
      if (p < 1) more = true
      q.b.setAttribute('y', (q.fy + (q.ty - q.fy) * e).toFixed(1))
      q.b.setAttribute('height', (q.fh + (q.th - q.fh) * e).toFixed(1))
    }
    if (more && svg.isConnected) requestAnimationFrame(step)
  }
  step(t0)
}
