import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { MomentsFeedItem } from '../src/lib/momentsFeed'
import { checkMoment, SERIES_AFTER, SERIES_BEFORE, seriesFromSpark } from '../src/lib/momentsChecked'
import { chartElement, chartRange, chartSvg, compared, type ChartDrawing } from '../src/ui/components/moments/checked/momentChartSvg'

const fixture = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/moments_feed_v1.json'), 'utf8')) as { generatedAt: number; items: MomentsFeedItem[] }
const pool = fixture.items.map(item => checkMoment(item, fixture.generatedAt))

beforeAll(() => {
  // jsdom has no canvas: the labels fall back to an estimated width
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})

function texts(d: ChartDrawing) {
  return d.nodes.filter(n => n.tag === 'text').map(n => ({ cls: n.attrs.class ?? '', text: n.text ?? '', x: Number(n.attrs.x), y: Number(n.attrs.y) }))
}
const classes = (d: ChartDrawing) => d.nodes.map(n => n.attrs.class ?? '')

describe('checked moment chart', () => {
  it('draws the sparkline’s minutes, the compared band and its average', () => {
    const m = pool.find(x => compared(x)?.[0] === -16)!
    const s = seriesFromSpark(m)
    expect(chartRange(m, s)[0]).toBe(-16)
    const drawn = chartSvg(m, s, m.kind, 600, false, null, true)
    expect(drawn.geo.H).toBe(200)
    expect(classes(drawn)).toContain('mk-band')
    expect(classes(drawn)).toContain('mk-cb mo')
    expect(drawn.attrs.tabindex).toBe('0')
    const labels = texts(drawn).map(t => t.text)
    expect(labels).toContain('the 15 minutes compared')
    expect(labels.some(t => /^average /.test(t))).toBe(true)
  })

  it('shortens the band label on a phone so it stays inside the band (R2-5)', () => {
    // the opened moment's /minutes: 32 before to 16 after, so the band is narrow on a phone
    const m = pool.find(x => compared(x)?.[0] === -16 && x.item.offsetSeconds > 40 * 60)!
    const full = Array.from({ length: SERIES_BEFORE + SERIES_AFTER + 1 }, (_, i) => 100 + i)
    const series = { c: full, e: full, v: full.map(() => null), t3: full.map(() => null), fromSpark: false }
    const phone = chartSvg(m, series, m.kind, 240, true, null, false)
    expect(phone.geo.H).toBe(170)
    expect([phone.geo.lo, phone.geo.hi]).toEqual([-32, 16])
    expect(texts(phone).map(t => t.text)).toContain('15 min compared')
    expect(texts(chartSvg(m, series, m.kind, 900, false, null, false)).map(t => t.text)).toContain('the 15 minutes compared')
  })

  it('keeps the moment’s label off the band’s label at every width (R2-5)', () => {
    let checked = 0
    for (const m of pool) {
      for (const width of [240, 330, 420, 600]) {
        const t = texts(chartSvg(m, seriesFromSpark(m), m.kind, width, width < 400, null, false))
        const band = t.find(x => /compared$/.test(x.text)), mark = t.find(x => x.cls.includes('mk-an-m'))
        if (!band || !mark) continue
        checked += 1
        const bandR = band.x + band.text.length * 6.4, markR = mark.x + mark.text.length * 6.8
        const overlapX = mark.x < bandR + 4 && markR > band.x
        expect(overlapX && Math.abs(mark.y - band.y) < 14, `${m.key} at ${width}`).toBe(false)
        expect(markR).toBeLessThanOrEqual(Math.max(240, width) + 0.5)
      }
    }
    expect(checked).toBeGreaterThan(100)
  })

  it('marks a held minute', () => {
    const m = pool[0]
    const drawn = chartSvg(m, seriesFromSpark(m), m.kind, 600, false, -3, true)
    expect(drawn.nodes.some(n => 'data-lk' in n.attrs)).toBe(true)
    expect(drawn.nodes.find(n => n.attrs['data-i'] === '-3')?.attrs.class).toMatch(/^mk-cb\b.* lk$/)
  })

  it('builds the chart from elements, with every label as text', () => {
    const m = pool[0]
    const drawn = chartSvg(m, seriesFromSpark(m), m.kind, 600, false, null, true)
    const svg = chartElement(drawn)
    expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg')
    expect(svg.getAttribute('aria-label')).toBe(drawn.attrs['aria-label'])
    expect(svg.children).toHaveLength(drawn.nodes.length)
    expect([...svg.querySelectorAll('text')].map(t => t.textContent)).toEqual(texts(drawn).map(t => t.text))
    // a label is never read as markup
    const odd = chartElement({ attrs: {}, nodes: [{ tag: 'text', attrs: {}, text: '<img src=x onerror=alert(1)>' }], geo: drawn.geo })
    expect(odd.querySelector('img')).toBeNull()
    expect(odd.textContent).toBe('<img src=x onerror=alert(1)>')
  })
})

describe('checked moments typography floor', () => {
  it('sets no type under 12px', () => {
    const dir = resolve(process.cwd(), 'src/ui/components/moments/checked')
    const offenders: string[] = []
    for (const name of readdirSync(dir).filter(n => n.endsWith('.css'))) {
      const css = readFileSync(resolve(dir, name), 'utf8')
      for (const match of css.matchAll(/font(?:-size)?:[^;]*?(\d*\.?\d+)(px|rem)/g)) {
        const px = Number(match[1]) * (match[2] === 'rem' ? 16 : 1)
        if (px < 12) offenders.push(`${name}: ${match[0]}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
