import { afterEach, describe, expect, it } from 'vitest'
import {
  clearHubRecentLogins,
  HUB_RECENT_LOGINS_KEY,
  HUB_RECENT_LOGINS_MAX,
  readHubRecentLogins,
  recordHubRecentLogin,
} from '../src/lib/hubRecentChannels'

afterEach(() => {
  clearHubRecentLogins()
})

describe('hubRecentChannels', () => {
  it('records, dedupes, and caps recent logins', () => {
    recordHubRecentLogin('xqc', '2026-06-26T10:00:00.000Z')
    recordHubRecentLogin('sodapoppin', '2026-06-26T11:00:00.000Z')
    recordHubRecentLogin('xqc', '2026-06-26T12:00:00.000Z')

    const recent = readHubRecentLogins()
    expect(recent).toHaveLength(2)
    expect(recent[0]).toEqual({ login: 'xqc', openedAt: '2026-06-26T12:00:00.000Z' })
    expect(recent[1]?.login).toBe('sodapoppin')
  })

  it('normalizes login and rejects invalid values', () => {
    recordHubRecentLogin('  @XQC  ')
    expect(readHubRecentLogins()[0]?.login).toBe('xqc')

    recordHubRecentLogin('bad-name')
    expect(readHubRecentLogins()).toHaveLength(1)
  })

  it('respects max length', () => {
    for (let i = 0; i < HUB_RECENT_LOGINS_MAX + 3; i += 1) {
      recordHubRecentLogin(`user${i}`, `2026-06-26T10:0${i % 10}:00.000Z`)
    }
    expect(readHubRecentLogins()).toHaveLength(HUB_RECENT_LOGINS_MAX)
  })

  it('persists under sp.hub.recentLogins', () => {
    recordHubRecentLogin('divvity')
    expect(localStorage.getItem(HUB_RECENT_LOGINS_KEY)).toContain('divvity')
  })
})
