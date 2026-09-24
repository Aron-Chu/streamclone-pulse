import { afterEach, describe, expect, it, vi } from 'vitest'
import { duration, formatDateTime, relativeTime } from './consoleFormat.ts'

describe('measurement timestamp display', () => {
  afterEach(() => vi.useRealTimers())
  it('does not turn sentinel or future source values into ages or current freshness', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-04T12:00:00Z'))
    for (const value of ['0001-01-01T00:00:00Z', '2099-01-01T00:00:00Z', 'bad-date']) {
      expect(relativeTime(value)).toBe('-')
      expect(formatDateTime(value)).toBe('-')
    }
    expect(relativeTime('2026-09-04T11:00:00Z')).toBe('1h ago')
    expect(duration({ startedAt: '0001-01-01T00:00:00Z', endedAt: '2026-09-04T11:00:00Z' } as Parameters<typeof duration>[0])).toBe('-')
  })
})
