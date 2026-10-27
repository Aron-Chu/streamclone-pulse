import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { MomentsFeedItem } from '../src/lib/momentsFeed'
import { checkMoment, topBursts } from '../src/lib/momentsChecked'
import {
  TOP_ROWS, TOP_WINDOWS, topAgo, topCount, topCurve, topFrom, topGames, topMomentsHref, topNextWindow, topRowAria, topRows, topWindow,
} from '../src/ui/components/hub/v5/hubV5TopModel'

const fixture = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/moments_feed_v1.json'), 'utf8')) as { generatedAt: number; items: MomentsFeedItem[] }
const NOW = fixture.generatedAt
const MIN = 60_000

describe('Top moments windows', () => {
  it('runs 1 h to 7 days, 24 h first, each offering the next one up', () => {
    expect(TOP_WINDOWS.map((w) => w.key)).toEqual(['1h', '6h', '24h', '7d'])
    expect(topNextWindow('1h')?.key).toBe('6h')
    expect(topNextWindow('7d')).toBeNull()
    expect(topWindow('6h').words).toBe('the last 6 hours')
  })

  it('floors a window start to the minute, so readers in one minute share the URL', () => {
    const t = Date.UTC(2026, 9, 25, 12, 30, 41, 500)
    expect(topFrom(t, '1h')).toBe(Date.UTC(2026, 9, 25, 11, 30))
    expect(topFrom(t + 15_000, '1h')).toBe(topFrom(t, '1h'))
    expect(topFrom(t, '7d')).toBe(Date.UTC(2026, 9, 18, 12, 30))
  })
})

describe('Top moments rows', () => {
  it('Top keeps the Moments page rule: moments that hold up and rose, one per burst, at most 20', () => {
    const rows = topRows(fixture.items, 'top', NOW)
    expect(rows.length).toBeLessThanOrEqual(TOP_ROWS)
    for (const m of rows) expect([m.item.verdict, m.item.checks.rise?.code]).toEqual(['ok', 'rose'])
    const want = topBursts(fixture.items.map((item) => checkMoment(item, NOW)).filter((m) => m.rowX != null)).slice(0, TOP_ROWS)
    expect(rows.map((m) => m.key)).toEqual(want.map((m) => m.key))
  })

  it('Latest shows every moment that holds up or partly does, newest first', () => {
    const rows = topRows(fixture.items, 'new', NOW)
    expect(rows).toHaveLength(Math.min(TOP_ROWS, fixture.items.filter((i) => i.verdict !== 'bad').length))
    expect(rows.some((m) => m.item.verdict === 'warn')).toBe(true)
    expect(rows.every((m) => m.item.verdict !== 'bad')).toBe(true)
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1]!.at).toBeGreaterThanOrEqual(rows[i]!.at)
  })

  it('counts a tab as the moments that hold up or partly do, else the feed total', () => {
    expect(topCount({ total: 40, verdicts: { ok: 20, warn: 6, bad: 14 } })).toBe(26)
    expect(topCount({ total: 40, verdicts: null })).toBe(40)
  })

  it('lists the window games, keeping a picked game that the window left empty', () => {
    const cats = [
      { id: '1', name: 'Overwatch', moments: 8, liveChannels: 2 },
      { id: '2', name: 'Dota 2', moments: 0, liveChannels: 0 },
    ]
    expect(topGames(cats).map((g) => g.name)).toEqual(['Overwatch'])
    expect(topGames(cats, { id: '2', name: 'Dota 2', art: null, moments: 3 })).toEqual([
      expect.objectContaining({ name: 'Overwatch', moments: 8 }),
      { id: '2', name: 'Dota 2', art: null, moments: 0 },
    ])
    expect(topGames(null)).toEqual([])
  })

  it('words a row age short and its label in full', () => {
    expect(topAgo(NOW - 20_000, NOW)).toBe('now')
    expect(topAgo(NOW - 13 * MIN, NOW)).toBe('13m')
    expect(topAgo(NOW - 125 * MIN, NOW)).toBe('2h')
    expect(topAgo(NOW - 50 * 60 * MIN, NOW)).toBe('2d')
    const m = topRows(fixture.items, 'top', NOW)[0]!
    const aria = topRowAria(m, 1, NOW, false)
    expect(aria.startsWith(`1. ${m.name}`)).toBe(true)
    expect(aria).toMatch(/ times usual/)
    expect(aria).toMatch(/Show the minutes around it\.$/)
    expect(topRowAria(m, null, NOW, true)).toMatch(/^[^0-9].*Hide the minutes around it\.$/)
  })

  it('sends "see all" to the Moments page in the same order and game', () => {
    expect(topMomentsHref('top', null)).toBe('/analytics/moments?view=top')
    expect(topMomentsHref('new', '509672')).toBe('/analytics/moments?game=509672')
    expect(topMomentsHref('new', null)).toBe('/analytics/moments')
  })
})

describe('Top moments opened row', () => {
  const m = checkMoment(fixture.items.find((i) => i.verdict === 'ok' && i.spark.chat.every((v) => v != null))!, NOW)

  it('draws the 25 minutes around the moment, its own minutes shaded, inside the box', () => {
    const c = topCurve(m)
    expect(c.span.x).toBeGreaterThanOrEqual(0)
    expect(c.span.x + c.span.w).toBeLessThanOrEqual(c.w + 0.1)
    expect(c.from).toBe(m.at - m.item.spark.momentIndex * MIN)
    expect(c.to - c.from).toBe(24 * MIN)
    expect(c.chat.startsWith('M')).toBe(true)
    expect(c.area.endsWith('Z')).toBe(true)
  })

  it('breaks a line where a minute was not measured', () => {
    const chat = m.item.spark.chat.map((v, i) => (i === 5 ? null : v))
    const gap = checkMoment({ ...m.item, spark: { ...m.item.spark, chat } }, NOW)
    expect(topCurve(gap).chat.match(/M/g)).toHaveLength(2)
  })
})
