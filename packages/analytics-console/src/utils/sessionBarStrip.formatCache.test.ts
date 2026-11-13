import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => vi.restoreAllMocks())

it('reuses one clock formatter per zone without changing DST or day-period range text', async () => {
  vi.resetModules()
  const NativeFormat = Intl.DateTimeFormat
  const { stripClockRange } = await import('./sessionBarStrip.ts')
  const constructions = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (locale, options) {
    return new NativeFormat(locale, options)
  })
  const ranges = [
    ['2026-03-08T09:59:00Z', '2026-03-08T10:01:00Z'],
    ['2026-11-01T08:59:00Z', '2026-11-01T09:01:00Z'],
    ['2026-06-01T18:59:00Z', '2026-06-01T19:01:00Z'],
  ]
  for (const zone of ['America/Los_Angeles', 'UTC', 'Asia/Kolkata']) {
    for (const [a, b] of ranges) {
      const format = new NativeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: zone })
      const start = Date.parse(a!)
      const end = Date.parse(b!)
      const pa = format.formatToParts(start)
      const pb = format.formatToParts(end)
      const period = (p: Intl.DateTimeFormatPart[]) => p.find(x => x.type === 'dayPeriod')?.value
      const bare = (p: Intl.DateTimeFormatPart[]) => p.filter(x => x.type !== 'dayPeriod').map(x => x.value).join('').trim()
      const expected = period(pa) === period(pb)
        ? `${bare(pa)}–${new Date(end).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: zone })}`
        : `${format.format(start)}–${format.format(end)}`
      expect(stripClockRange(start, end, zone)).toBe(expected)
      expect(stripClockRange(start, end, zone)).toBe(expected)
    }
  }
  expect(constructions).toHaveBeenCalledTimes(3)
})


it('refreshes both clock and zone after the default OS zone changes, retaining configured formatter reuse', async () => {
  vi.resetModules()
  const NativeFormat = Intl.DateTimeFormat
  const { buildSessionBarStrip, stripClockRange } = await import('./sessionBarStrip.ts')
  let systemZone = 'America/Los_Angeles'
  const constructors = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (locale, options) {
    return new NativeFormat(locale, { ...options, timeZone: options?.timeZone ?? systemZone })
  })
  const start = Date.parse('2026-06-01T16:00:00Z')
  const end = start + 60_000
  const make = () => buildSessionBarStrip({
    span: { startSec: 0, endSec: 60, levelMinutes: 1 },
    rollups: [],
    startedAt: new Date(start).toISOString(),
    vodLinkState: { status: 'unavailable', label: '', detail: '' },
  })
  const expected = (zone: string) => {
    const clock = new NativeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: zone })
    const bare = clock.formatToParts(start).filter(p => p.type !== 'dayPeriod').map(p => p.value).join('').trim()
    const shortZone = new NativeFormat('en-US', { timeZoneName: 'short', timeZone: zone })
      .formatToParts(start).find(p => p.type === 'timeZoneName')?.value
    return { clockLabel: bare + '–' + clock.format(end), zone: shortZone }
  }
  for (const zone of ['America/Los_Angeles', 'UTC', 'America/Los_Angeles']) {
    systemZone = zone
    const model = make()
    expect({ clockLabel: model.clockLabel, zone: model.zone }).toEqual(expected(zone))
    expect(stripClockRange(start, end)).toBe(expected(zone).clockLabel)
  }
  expect(constructors.mock.calls.filter(([, options]) => options?.hour)).toHaveLength(2)
  expect(constructors.mock.calls.filter(([, options]) => options?.timeZoneName)).toHaveLength(2)
})
