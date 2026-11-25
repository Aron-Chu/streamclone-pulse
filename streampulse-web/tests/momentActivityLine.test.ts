import { describe, expect, it } from 'vitest'
import { ACTIVITY_FRAME_PHOTO, momentActivityGeometry, momentActivityHeadline, momentActivitySeries } from '../src/lib/momentActivityLine'
import type { MomentMinuteSlot, MomentMinuteWindow } from '../src/lib/momentMinuteWindow'

/** A window of slots -30…+10 where `chat(relative)` gives a measured minute's count, or null for a gap. */
function window(chat: (relative: number) => number | null, emotes: (relative: number) => number | undefined = () => undefined): MomentMinuteWindow {
  const slots: MomentMinuteSlot[] = []
  for (let relative = -30; relative <= 10; relative += 1) {
    const value = chat(relative)
    const count = emotes(relative)
    slots.push(value == null ? { relative, state: 'unmeasured', chatPerMin: null }
      : count == null ? { relative, state: 'measured', chatPerMin: value }
        : { relative, state: 'measured', chatPerMin: value, emotesPerMin: count })
  }
  return { slots } as MomentMinuteWindow
}
const subpaths = (path: string) => path.split('M').filter(Boolean).length
/** Every y the path passes through or pulls toward: its points and its curves' control points. */
const ys = (path: string) => [...path.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map(match => Number(match[2]))

describe('moment activity line', () => {
  it('draws only the ten minutes either side of the moment, and nothing when none of them was measured', () => {
    const geometry = momentActivityGeometry(window(() => 100), 50)!
    // 21 minutes: one move and 20 curves.
    expect(subpaths(geometry.line)).toBe(1)
    expect(geometry.line.match(/C/g)).toHaveLength(20)
    expect(momentActivityGeometry(window(relative => relative < -10 ? 100 : null), 50)).toBeNull()
  })

  it('breaks the line at a gap instead of dropping it to zero, and shows a lone minute as a dot', () => {
    const geometry = momentActivityGeometry(window(relative => relative === -3 || relative === 5 ? null : relative === 7 ? 90 : relative > 5 ? null : 100), 50)!
    // -10…-4, -2…4, then 7 alone.
    expect(subpaths(geometry.line)).toBe(3)
    expect(geometry.line).toMatch(/h0\.01$/)
    // The area closes each run on its own.
    expect(geometry.area.match(/Z/g)).toHaveLength(3)
  })

  it('smooths the line without overshooting: a quiet minute beside a spike never dips below what was counted', () => {
    const geometry = momentActivityGeometry(window(relative => relative === 0 ? 500 : 100), 100)!
    // On screen lower is larger: no part of the line goes below the quiet minutes' level (its first point's), or above the spike's.
    const quietY = ys(geometry.line)[0]!
    expect(Math.max(...ys(geometry.line))).toBeLessThanOrEqual(quietY + 0.05)
    expect(Math.min(...ys(geometry.line))).toBeGreaterThanOrEqual(geometry.moment!.y - 0.05)
  })

  it('places the moment, the usual level and the floor in the frame it is given', () => {
    const geometry = momentActivityGeometry(window(relative => relative === 0 ? 400 : 100), 100)!
    expect(geometry.moment).not.toBeNull()
    expect(geometry.momentAt).toBeCloseTo(0.5, 2)
    // Busier is higher: the moment sits above the usual line, which sits above the floor.
    expect(geometry.moment!.y).toBeLessThan(geometry.baselineY!)
    expect(geometry.baselineY!).toBeLessThan(geometry.floor)
    expect(geometry.moment!.y).toBeGreaterThanOrEqual(geometry.top)
    // Over a picture, the same line keeps to the picture's bottom third.
    const low = momentActivityGeometry(window(relative => relative === 0 ? 400 : 100), 100, { frame: ACTIVITY_FRAME_PHOTO })!
    expect(low.top).toBe(ACTIVITY_FRAME_PHOTO.top)
    expect(low.floor).toBe(ACTIVITY_FRAME_PHOTO.bottom)
    expect(low.moment!.y).toBeGreaterThanOrEqual(ACTIVITY_FRAME_PHOTO.top)
  })

  it('times the moment along the line as drawn, so its dot lands when a shorter line reaches it', () => {
    // Measured from ten minutes before to two after: the moment is 10 of the line's 12 minutes in.
    const geometry = momentActivityGeometry(window(relative => relative > 2 ? null : 100), 50)!
    expect(geometry.momentAt).toBeCloseTo(10 / 12, 2)
  })

  it('has no usual line without a usable average, and no moment point when its own minute was not measured', () => {
    expect(momentActivityGeometry(window(() => 100), null)!.baselineY).toBeNull()
    expect(momentActivityGeometry(window(() => 100), 0)!.baselineY).toBeNull()
    expect(momentActivityGeometry(window(() => 100), Number.NaN)!.baselineY).toBeNull()
    expect(momentActivityGeometry(window(relative => relative === 0 ? null : 100), 50)!.moment).toBeNull()
  })

  it('finds the surge: the unbroken run up to the moment at twice the usual level or more, two minutes at least', () => {
    // Usual 100; -4…0 run at 200–400, -5 is 150.
    const surge = momentActivityGeometry(window(relative => relative >= -4 && relative <= 0 ? 200 + (relative + 4) * 50 : 150), 100)!.surge
    expect(surge).toMatchObject({ minutes: 5 })
    expect(surge!.fromX).toBeLessThan(surge!.toX)
    // One minute high is a spike, not a surge.
    expect(momentActivityGeometry(window(relative => relative === 0 ? 500 : 100), 100)!.surge).toBeNull()
    // A gap ends the run.
    expect(momentActivityGeometry(window(relative => relative === -1 ? null : relative >= -4 && relative <= 0 ? 300 : 100), 100)!.surge).toBeNull()
    // No usual level, no surge.
    expect(momentActivityGeometry(window(() => 300), null)!.surge).toBeNull()
  })

  it('draws the other series as bars, only for minutes that counted it, scaled to the busiest', () => {
    const geometry = momentActivityGeometry(window(() => 100, relative => relative === 0 ? 40 : relative === -2 ? 10 : relative === 3 ? 0 : undefined), 50)!
    expect(geometry.series).toBe('chat')
    expect(geometry.bars.map(bar => bar.relative)).toEqual([-2, 0])
    const [low, high] = geometry.bars
    expect(high!.height).toBeGreaterThan(low!.height)
    expect(high!.y + high!.height).toBeCloseTo(geometry.floor, 1)
    expect(momentActivityGeometry(window(() => 100), 50)!.bars).toEqual([])
    // With emotes as the line, chat is the bars: every measured minute has one.
    const emotes = momentActivityGeometry(window(() => 100, () => 20), 10, { series: 'emotes' })!
    expect(emotes.series).toBe('emotes')
    expect(emotes.bars).toHaveLength(21)
  })

  it('draws emotes as the line only when the minutes carry them at the moment and across most of the range', () => {
    const dense = window(() => 100, relative => relative % 5 === 1 ? undefined : 20)
    expect(momentActivitySeries(dense, 'emotes')).toBe('emotes')
    expect(momentActivitySeries(dense, 'chat')).toBe('chat')
    expect(momentActivitySeries(dense, undefined)).toBe('chat')
    // Under 60% of minutes with emotes, or none in the moment's own minute: chat.
    expect(momentActivitySeries(window(() => 100, relative => relative % 2 ? undefined : 20), 'emotes')).toBe('chat')
    expect(momentActivitySeries(window(() => 100, relative => relative === 0 ? undefined : 20), 'emotes')).toBe('chat')
  })

  it('says the moment’s × in the one wording, with the surge’s length only when it lasted', () => {
    expect(momentActivityHeadline('2.7× more chat', 4)).toBe('2.7× more chat · 4 min surge')
    expect(momentActivityHeadline('2.7× more chat', 1)).toBe('2.7× more chat')
    expect(momentActivityHeadline('6.2× more emotes', null)).toBe('6.2× more emotes')
  })
})
