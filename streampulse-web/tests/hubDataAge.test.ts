import { describe, expect, it } from 'vitest'
import { hubDataAsOf, olderHubDataAsOf } from '../src/lib/hubDataAge'

const receivedAt = Date.parse('2026-10-29T12:00:00Z')
const old = '2026-10-29T11:55:00Z'

describe('hub data age provenance', () => {
  it('prefers Worker copy age over snapshot age, and adds exposed HTTP cache residence', () => {
    expect(hubDataAsOf({ generatedAt: old, snapshot: { ageSeconds: 40 } }, { receivedAt, hubCopyAge: '900', responseAge: '9' })).toBe(receivedAt - 909_000)
  })
  it('uses server snapshot age and preserves time elapsed after receipt', () => {
    const anchor = hubDataAsOf({ generatedAt: old, snapshot: { ageSeconds: 45 } }, { receivedAt, responseAge: '0' })!
    expect(receivedAt + 30_000 - anchor).toBe(75_000)
  })
  it('does not treat malformed copy-age or intermediary-age headers as a fresh response', () => {
    const raw = { generatedAt: old, snapshot: { ageSeconds: 45 } }
    expect(hubDataAsOf(raw, { receivedAt, hubCopyAge: '10', responseAge: '-1' })).toBeNull()
    expect(hubDataAsOf(raw, { receivedAt, hubCopyAge: 'invalid', responseAge: '0' })).toBeNull()
    expect(hubDataAsOf(raw, { receivedAt, responseAge: '' })).toBeNull()
  })
  it('requires exposed cache residence or an explicit no-store contract', () => {
    const raw = { generatedAt: old, snapshot: { ageSeconds: 45 } }
    expect(hubDataAsOf(raw, { receivedAt, hubCopyAge: '900' })).toBeNull()
    expect(hubDataAsOf(raw, { receivedAt, hubCopyAge: '900', responseCacheControl: 'public, max-age=30' })).toBeNull()
    expect(hubDataAsOf(raw, { receivedAt, hubCopyAge: '900', responseCacheControl: 'private, no-store' })).toBe(receivedAt - 900_000)
    expect(hubDataAsOf(raw, { receivedAt, responseCacheControl: 'no-store' })).toBe(receivedAt - 45_000)
  })
  it('uses origin Date to tolerate a client clock two minutes ahead or behind', () => {
    const generatedAt = '2026-10-29T11:59:00Z'
    for (const skew of [-120_000, 120_000]) {
      expect(hubDataAsOf({ generatedAt }, { receivedAt: receivedAt + skew, responseDate: 'Thu, 29 Oct 2026 12:00:00 GMT', responseAge: '0' })).toBe(receivedAt + skew - 60_000)
    }
  })
  it('does not claim a current age for missing, invalid, or future times', () => {
    expect(hubDataAsOf({}, { receivedAt })).toBeNull()
    expect(hubDataAsOf({ generatedAt: 'not-a-date' }, { receivedAt, hubCopyAge: '-2' })).toBeNull()
    expect(hubDataAsOf({ generatedAt: '2026-10-29T12:00:01Z' }, { receivedAt })).toBeNull()
    expect(hubDataAsOf({ generatedAt: old, snapshot: { ageSeconds: -1 } }, { receivedAt, hubCopyAge: '12x' })).toBeNull()
    expect(hubDataAsOf({ generatedAt: old }, { receivedAt })).toBeNull()
  })
  it('uses the oldest component of a merged result and propagates unknown', () => {
    expect(olderHubDataAsOf(receivedAt - 30_000, receivedAt - 90_000)).toBe(receivedAt - 90_000)
    expect(olderHubDataAsOf(receivedAt, null)).toBeNull()
  })
})
