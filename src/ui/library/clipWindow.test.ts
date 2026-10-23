import { describe, expect, it } from 'vitest'
import { centreClipWindow, clipOnTwitchUrl, defaultClipWindow, nudgeClipWindow, resizeClipWindow, twitchTime } from './clipWindow.ts'

describe('Clip window', () => {
  it('opens 30 s before the moment, 60 s long', () => {
    expect(defaultClipWindow(1812)).toEqual({ start: 1782, length: 60 })
    // Whole seconds: a fractional offset never puts a fraction in the link.
    expect(defaultClipWindow(1812.9)).toEqual({ start: 1782, length: 60 })
  })
  it('never starts before the stream', () => {
    expect(defaultClipWindow(12)).toEqual({ start: 0, length: 60 })
    expect(nudgeClipWindow({ start: 10, length: 30 }, -15)).toEqual({ start: 0, length: 30 })
    expect(centreClipWindow({ start: 100, length: 60 }, 20)).toEqual({ start: 0, length: 60 })
    expect(defaultClipWindow(Number.NaN).start).toBe(0)
  })
  it('nudges in 15 s steps and keeps the length', () => {
    expect(nudgeClipWindow({ start: 1782, length: 60 }, 15)).toEqual({ start: 1797, length: 60 })
    expect(nudgeClipWindow({ start: 1782, length: 30 }, -15)).toEqual({ start: 1767, length: 30 })
  })
  it('switches between 30 s and 60 s without moving the start', () => {
    expect(resizeClipWindow({ start: 1782, length: 60 }, 30)).toEqual({ start: 1782, length: 30 })
    expect(resizeClipWindow({ start: 1782, length: 30 }, 60)).toEqual({ start: 1782, length: 60 })
  })
  it('centres on a chart click, snapped to 5 s', () => {
    // 60 s centred on 1847 starts at 1817, the nearest 5 s step is 1815.
    expect(centreClipWindow({ start: 0, length: 60 }, 1847)).toEqual({ start: 1815, length: 60 })
    expect(centreClipWindow({ start: 0, length: 60 }, 1848)).toEqual({ start: 1820, length: 60 })
    expect(centreClipWindow({ start: 0, length: 30 }, 1847)).toEqual({ start: 1830, length: 30 })
    expect(centreClipWindow({ start: 0, length: 30 }, 1812.4).start % 5).toBe(0)
  })
  it('writes Twitch time as hours, two-digit minutes and two-digit seconds', () => {
    expect(twitchTime(3725)).toBe('1h02m05s')
    expect(twitchTime(30)).toBe('0h00m30s')
    expect(twitchTime(0)).toBe('0h00m00s')
    expect(twitchTime(36_000 + 59 * 60 + 59.9)).toBe('10h59m59s')
    expect(twitchTime(-4)).toBe('0h00m00s')
  })
  it('links the VOD at the window start, and nothing without a numeric VOD id', () => {
    expect(clipOnTwitchUrl('2806037629', { start: 1782, length: 60 })).toBe('https://www.twitch.tv/videos/2806037629?t=0h29m42s')
    for (const vodId of [null, undefined, '', 'v123', '12/34']) expect(clipOnTwitchUrl(vodId, { start: 1782, length: 60 })).toBeNull()
  })
})
