import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  HUB_DEFAULT_WINDOW,
  HUB_URL_ONLY_WINDOWS,
  HUB_VISIBLE_WINDOWS,
  hubWindowMinutes,
  hubWindowOption,
  isHubLongWindow,
  isHubUrlWindow,
  parseHubWindowParam,
} from '../src/lib/hubWindows'

const DAY = 24 * 60

describe('hub windows (plan H1 / AD-14)', () => {
  it('shows 30m / 24h / 7d and keeps 1mo / 3mo / 1y reachable by URL only', () => {
    expect(HUB_VISIBLE_WINDOWS.map(option => [option.key, option.label, option.minutes])).toEqual([
      ['30m', '30m', 30],
      ['24h', '24h', DAY],
      ['7d', '7d', 7 * DAY],
    ])
    expect(HUB_URL_ONLY_WINDOWS.map(option => [option.key, option.label, option.minutes])).toEqual([
      ['1m', '1mo', 30 * DAY],
      ['3m', '3mo', 90 * DAY],
      ['1y', '1 year', 365 * DAY],
    ])
    expect(Object.isFrozen(HUB_VISIBLE_WINDOWS)).toBe(true)
    expect(HUB_DEFAULT_WINDOW).toBe('24h')
  })

  it('classifies windows', () => {
    expect(['30m', '24h', '7d', '1m', '3m', '1y'].every(isHubUrlWindow)).toBe(true)
    expect(['6m', 'all', 'recent', '', 'toString', '__proto__', null, 7].some(isHubUrlWindow)).toBe(false)
    expect(['1m', '3m', '1y'].every(isHubLongWindow)).toBe(true)
    expect(['30m', '24h', '7d', undefined].some(isHubLongWindow)).toBe(false)
    expect(hubWindowMinutes('7d')).toBe(7 * DAY)
    expect(hubWindowOption('1y').label).toBe('1 year')
  })

  it('parses ?window= first, then ?activityWindow=, and falls back to 24h', () => {
    expect(parseHubWindowParam('?window=7d')).toBe('7d')
    expect(parseHubWindowParam('?activityWindow=30m')).toBe('30m')
    expect(parseHubWindowParam('?window=1y&activityWindow=30m')).toBe('1y')
    // An empty `window` falls through to `activityWindow`, like `a || b` on the page.
    expect(parseHubWindowParam('?window=&activityWindow=3m')).toBe('3m')
    // An unknown `window` does not fall through: the page reads `window || activityWindow` once.
    expect(parseHubWindowParam('?window=6m&activityWindow=30m')).toBe('24h')
    expect(parseHubWindowParam('?window=toString')).toBe('24h')
    expect(parseHubWindowParam('')).toBe('24h')
    expect(parseHubWindowParam(null)).toBe('24h')
    expect(parseHubWindowParam(new URLSearchParams({ window: '1m' }))).toBe('1m')
  })

  it('matches the landing page rule while the page still has its own table', () => {
    const source = readFileSync(resolve(__dirname, '../src/routes/analytics/AnalyticsLandingPage.tsx'), 'utf8')
    const table = /const ACTIVITY_WINDOW_MINUTES[^=]*=\s*\{([\s\S]*?)\};/.exec(source)
    if (!table) {
      // U4 moved the page onto hubWindows: nothing left to compare.
      expect(source).toMatch(/from ["']\.\.\/\.\.\/lib\/hubWindows["']/)
      return
    }
    const entries = [...table[1].matchAll(/"([^"]+)":\s*([^,\n]+),/g)]
      // Each value is a product of integers ("3 * 30 * 24 * 60"); multiply it out without eval.
      .map(([, key, expr]) => [key, expr.split('*').reduce((product, factor) => product * Number(factor.trim()), 1)] as const)
    const ours = [...HUB_VISIBLE_WINDOWS, ...HUB_URL_ONLY_WINDOWS].map(option => [option.key, option.minutes] as const)
    expect(entries).toEqual(ours)
    expect(source).toContain('searchParams.get("window") || searchParams.get("activityWindow")')
    expect(source).toMatch(/:\s*"24h";/)
  })

  it('imports nothing (it ships in the entry chunk)', () => {
    const source = readFileSync(resolve(__dirname, '../src/lib/hubWindows.ts'), 'utf8')
    expect(source).not.toMatch(/^\s*import\s/m)
  })
})
