import { describe, expect, it, vi } from 'vitest'
import { fetchRankedAvailability, normalizeRankedAvailability } from '../src/lib/discoveryAvailability'
import type { DiscoveryDay } from '../src/lib/discoveryCatalogue'

const DAY = 86_400_000
const date = (ms: number) => new Date(ms).toISOString().slice(0, 10)
function fixture(from = '2026-09-10', through = '2026-09-14', login = '') {
  const days: DiscoveryDay[] = Array.from({ length: (Date.parse(through) - Date.parse(from)) / DAY }, (_, index) => ({
    day: date(Date.parse(from) + index * DAY), state: 'no_measurement', coverage: 'none',
    streams: 0, measuredStreamMinutes: 0, chatMessages: null, emoteUses: null, detections: null,
  }))
  return { schemaVersion: 1, state: 'ready', scope: 'indexed_completed_public_irc_streams', login,
    asOf: '2026-09-14T12:00:00Z', serverToday: '2026-09-14', certifiedFrom: from,
    certifiedThroughExclusive: through, verifiedAt: '2026-09-14T11:59:00Z', certificateGeneration: 7, days }
}

describe('ranked availability', () => {
  it('accepts consecutive completed days and exact creator scope', () => {
    const value = fixture('2026-09-10', '2026-09-14', 'dona')
    value.days[1] = { day: '2026-09-11', state: 'measured', coverage: 'partial', streams: 1,
      measuredStreamMinutes: 12, chatMessages: 0, emoteUses: 0, detections: 0 }
    expect(normalizeRankedAvailability(value, 'dona')).toMatchObject({ certifiedFrom: '2026-09-10',
      certifiedThroughExclusive: '2026-09-14', certificateGeneration: 7, days: value.days })
  })
  it('rejects open today, expired proof, mismatched scope and missing days', () => {
    const base = fixture()
    for (const change of [
      { certifiedThroughExclusive: '2026-09-15' }, { serverToday: '2026-09-15' },
      { verifiedAt: '2026-09-14T09:59:00Z' }, { certificateGeneration: 0 },
      { scope: 'indexed_public_irc_streams' }, { days: base.days.slice(1) },
      { days: [{ ...base.days[0], day: '2026-09-12' }, ...base.days.slice(1)] },
      { days: [{ ...base.days[0], state: 'measured' }, ...base.days.slice(1)] },
    ]) expect(() => normalizeRankedAvailability({ ...base, ...change })).toThrow(/could not be verified/)
    expect(() => normalizeRankedAvailability(base, 'dona')).toThrow(/could not be verified/)
  })
  it('calls only the certified availability route with exact login', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(fixture('2026-09-10', '2026-09-14', 'dona'))))
    try {
      await fetchRankedAvailability('dona', new AbortController().signal)
      expect(new URL(String(spy.mock.calls[0][0])).pathname).toBe('/v1/public/discovery/ranked/availability')
      expect(new URL(String(spy.mock.calls[0][0])).searchParams.get('login')).toBe('dona')
    } finally { spy.mockRestore() }
  })
})
