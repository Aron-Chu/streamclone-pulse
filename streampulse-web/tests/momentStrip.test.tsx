import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MomentStrip } from '../src/ui/components/moments/watch/MomentStrip'
import { formatStreamOffset } from '../src/lib/formatStreamOffset'

vi.mock('../src/ui/components/moments/MomentMinuteChart', () => ({ MomentMinuteChart: () => <div data-testid="chart" /> }))

const FROM = Date.parse('2026-11-14T10:35:00Z')
const TO = Date.parse('2026-11-14T10:45:00Z')
const MINUTE = Date.parse('2026-11-14T10:40:00Z')
// 10:40:00 is 2430 s into the stream (0:40:30).
const label = (ms: number) => formatStreamOffset(2430 + (ms - MINUTE) / 1000)
const clip = { id: 'FakeClipSlug-1', url: 'https://www.twitch.tv/fakechan01/clip/FakeClipSlug-1', thumbnailUrl: '', title: 'fake-pog play', durationSeconds: 28, from: '2026-11-14T10:39:52Z', to: '2026-11-14T10:40:20Z' }

function setup(over: Partial<Parameters<typeof MomentStrip>[0]> = {}) {
  const onAt = vi.fn()
  const props = { window: { from: FROM, to: TO }, minuteStart: MINUTE, clips: [clip], pins: [] as number[], at: MINUTE + 12_000, onAt, signedIn: true, label, moment: null, ...over }
  const view = render(<MomentStrip {...props} />)
  return { onAt, ...view }
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('MomentStrip', () => {
  it('has the heading and the hint for each sign-in state', () => {
    setup()
    expect(screen.getByRole('heading', { level: 2, name: 'The minutes around it' })).toBeTruthy()
    expect(screen.getByText('Tap a second to watch from there or pin your comment to it.')).toBeTruthy()
    cleanup()
    setup({ signedIn: false })
    expect(screen.getByText('Tap a second to watch from there.')).toBeTruthy()
  })

  it('has a range input over the window, in ms with a 1 s step, and a time label', () => {
    setup()
    const range = screen.getByRole('slider', { name: 'Second in the stream' })
    expect(range.getAttribute('type')).toBe('range')
    expect(range.getAttribute('min')).toBe(String(FROM))
    expect(range.getAttribute('max')).toBe(String(TO))
    expect(range.getAttribute('step')).toBe('1000')
    expect(range.getAttribute('aria-valuetext')).toBe('0:40:42')
  })

  it('moves at by one second on Arrow Right and Arrow Left, kept inside the window', () => {
    const { onAt } = setup()
    const range = screen.getByRole('slider')
    fireEvent.keyDown(range, { key: 'ArrowRight' })
    expect(onAt).toHaveBeenLastCalledWith(MINUTE + 13_000)
    fireEvent.keyDown(range, { key: 'ArrowLeft' })
    expect(onAt).toHaveBeenLastCalledWith(MINUTE + 11_000)
    cleanup()
    const edge = setup({ at: TO })
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowRight' })
    expect(edge.onAt).toHaveBeenLastCalledWith(TO)
  })

  it('clamps and rounds a typed value to whole seconds inside the window', () => {
    const { onAt } = setup()
    const range = screen.getByRole('slider')
    fireEvent.change(range, { target: { value: String(TO + 99_000) } })
    expect(onAt).toHaveBeenLastCalledWith(TO)
    fireEvent.change(range, { target: { value: String(FROM + 4_400) } })
    expect(onAt).toHaveBeenLastCalledWith(FROM + 4_000)
  })

  it('marks the pin equal to at with is-on, and a pin press moves at there', () => {
    const { onAt } = setup({ pins: [MINUTE + 12_000, MINUTE + 30_000] })
    const pins = screen.getAllByRole('button', { name: /^Comment at / })
    expect(pins).toHaveLength(2)
    expect(pins[0].className).toContain('is-on')
    expect(pins[1].className).not.toContain('is-on')
    fireEvent.click(pins[1])
    expect(onAt).toHaveBeenLastCalledWith(MINUTE + 30_000)
  })

  it('keys pins by the deduped second, and marks the current one with aria-current, not aria-pressed', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { onAt } = setup({ pins: [MINUTE + 12_000, MINUTE + 12_000, MINUTE + 30_000] })
    const pins = screen.getAllByRole('button', { name: /^Comment at / })
    expect(pins).toHaveLength(2)
    expect(pins[0].getAttribute('aria-current')).toBe('true')
    expect(pins[1].hasAttribute('aria-current')).toBe(false)
    for (const pin of pins) expect(pin.hasAttribute('aria-pressed')).toBe(false)
    fireEvent.click(pins[1])
    expect(onAt).toHaveBeenLastCalledWith(MINUTE + 30_000)
    expect(errors.mock.calls.flat().join(' ')).not.toContain('same key')
    errors.mockRestore()
  })

  it('merges pins under 24 px apart into one that picks the earliest second and names every time', () => {
    // The track measures 600 px for the 10-minute window: 1 s is 1 px, so 6 s apart merges and 42 s does not.
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 600, height: 44, x: 0, y: 0, top: 0, left: 0, right: 600, bottom: 44, toJSON: () => ({}) })
    const { onAt } = setup({ pins: [MINUTE + 12_000, MINUTE + 18_000, MINUTE + 60_000], at: MINUTE + 18_000 })
    const pins = screen.getAllByRole('button', { name: /^Comments? at / })
    expect(pins.map(p => p.getAttribute('aria-label'))).toEqual(['Comments at 0:40:42 and 0:40:48', 'Comment at 0:41:30'])
    expect(pins[0].className).toContain('is-on')
    fireEvent.click(pins[0])
    expect(onAt).toHaveBeenLastCalledWith(MINUTE + 12_000)
  })

  it('keeps a pin outside the span on the nearest edge: it never disappears', () => {
    // The span is the seconds a comment may sit at: here it ends a second before the window's end and starts a minute after its start.
    const from = FROM + 60_000
    const to = TO - 1_000
    setup({ window: { from, to }, pins: [FROM + 10_000, TO] })
    const pins = screen.getAllByRole('button', { name: /^Comment at / })
    expect(pins).toHaveLength(2)
    expect(pins[0].getAttribute('style')).toContain('left: 0%')
    expect(pins[1].getAttribute('style')).toContain('left: 100%')
  })

  it('gives the range input the id the comment chip points at', () => {
    setup()
    expect(screen.getByRole('slider').id).toBe('mw-second')
  })

  it('labels a clip band as a Twitch clip with its times, and outlines the minute', () => {
    setup()
    expect(screen.getByLabelText('Twitch clip, 0:40:22 to 0:40:50')).toBeTruthy()
    expect(screen.getByLabelText('The Moment\u2019s minute')).toBeTruthy()
  })

  it('draws the chart only when given a moment', () => {
    setup()
    expect(screen.queryByTestId('chart')).toBeNull()
    cleanup()
    setup({ moment: { key: 'k', login: 'fakechan01', streamId: '9000001', offsetSeconds: 2430, at: MINUTE, comparison: undefined } })
    expect(screen.getByTestId('chart')).toBeTruthy()
  })

  it('offers no second to pick, and no hint, on the read-only page', () => {
    setup({ pickable: false, signedIn: false })
    expect(screen.getByRole('heading', { level: 2, name: 'The minutes around it' })).toBeTruthy()
    expect(screen.queryByRole('slider')).toBeNull()
    expect(document.getElementById('mw-second')).toBeNull()
    expect(screen.queryByText(/Tap a second/)).toBeNull()
    // The clip bands and the minute outline still say where things are.
    expect(screen.getByLabelText('The Moment’s minute')).toBeTruthy()
  })
})
