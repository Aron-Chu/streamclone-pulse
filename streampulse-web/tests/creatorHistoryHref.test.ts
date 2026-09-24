import { describe, expect, it } from 'vitest'
import { creatorHistoryHref } from '../src/lib/creatorHistoryHref'
import { readHistoryRankedScope } from '../src/lib/discoveryRanked'

describe('creator history navigation', () => {
  it('opens creator History without guessing that a detection day is certified', () => {
    const now = new Date('2026-09-14T12:00:00Z')
    const href = creatorHistoryHref('dona')
    expect(href).toBe('/analytics/moments?view=history&scope=creator&creator=dona')
    const scope = readHistoryRankedScope(new URLSearchParams(href!.split('?')[1]), now, '2026-08-16', '2026-09-14')
    expect(scope).toMatchObject({ creator: 'dona', from: '2026-08-16', to: '2026-09-14' })
  })
  it('leaves date choice to the certified server window', () => {
    expect(creatorHistoryHref('caedrel')).toBe('/analytics/moments?view=history&scope=creator&creator=caedrel')
  })
  it('does not turn invalid creator metadata into navigation', () => {
    for (const login of ['', '../dona', 'dona&stream=other', 'https://example.com']) expect(creatorHistoryHref(login)).toBeNull()
  })
})
