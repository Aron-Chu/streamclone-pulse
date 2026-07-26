import { describe, expect, it } from 'vitest'
import { normalizeLogin } from '../src/shared/login.ts'
import { normalizeWatchlist } from '../src/shared/watchlist.ts'

describe('normalizeLogin', () => {
  it('accepts valid twitch logins', () => {
    expect(normalizeLogin('AikoBliss')).toBe('aikobliss')
    expect(normalizeLogin(' xqc ')).toBe('xqc')
  })

  it('rejects invalid logins', () => {
    expect(normalizeLogin('')).toBeNull()
    expect(normalizeLogin('bad login')).toBeNull()
    expect(normalizeLogin('ab')).toBeNull()
  })
})

describe('normalizeWatchlist', () => {
  it('dedupes and sorts watchlist entries', () => {
    expect(normalizeWatchlist(['xqc', 'XQC', 'shroud', '', 'bad login'])).toEqual(['shroud', 'xqc'])
  })
})
