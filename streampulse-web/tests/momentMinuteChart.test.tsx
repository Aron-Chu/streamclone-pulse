import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createPortal } from 'react-dom'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MomentMinuteChart, momentChatBaseline } from '../src/ui/components/moments/MomentMinuteChart'
import { MomentInlineReveal, MOMENT_INLINE_CLOSE_MS } from '../src/ui/components/moments/MomentInlineReveal'
import * as minuteWindow from '../src/lib/momentMinuteWindow'
import type { LiveWireMomentComparison } from '../src/lib/liveWire'

const metric = (current: number, baseline: number) => ({ state: 'ready' as const, currentPerMin: current, baselinePerMin: baseline, multiplier: current / baseline,
  currentMeasuredMinutes: 1, currentExpectedMinutes: 1, baselineMeasuredMinutes: 30, baselineExpectedMinutes: 30, baselineCoveragePct: 100 })
const comparison = { baselineKind: 'current_stream_measured_average_before_event', eventAt: 0,
  baselineWindow: { start: 0, end: 0, expectedMinutes: 30, measuredMinutes: 30, coveragePct: 100 },
  chat: metric(393, 160), emotes: metric(133, 40),
  evidence: { ircBound: true, eventRollupAvailable: true, baselineMeasuredMinutes: 30, baselineExpectedMinutes: 30, baselineCoveragePct: 100 } } satisfies LiveWireMomentComparison
const moment = { key: '["xqc","s1",5400]', login: 'xqc', streamId: 's1', offsetSeconds: 5400, comparison }
/** 41 measured minutes except one gap, climbing to the moment's 393; `unrecorded` minutes carry no chat count. */
function minuteData(unrecorded: number[] = []): minuteWindow.MomentMinuteWindow {
  const slots = Array.from({ length: 41 }, (_, index): minuteWindow.MomentMinuteSlot => {
    const relative = index - 30
    if (relative === -12) return { relative, state: 'unmeasured', chatPerMin: null }
    if (unrecorded.includes(relative)) return { relative, state: 'unrecorded', chatPerMin: null }
    return { relative, state: 'measured', chatPerMin: relative === 0 ? 393 : 150 + index }
  })
  return { slots, measuredMinutes: 40 - unrecorded.length, unrecordedMinutes: unrecorded.length, complete: true }
}
function reduceMotion(matches: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: matches && query.includes('reduce'), media: query, onchange: null,
    addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }) as MediaQueryList)
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
  minuteWindow.clearMomentMinuteWindowCacheForTests()
})

describe('chat per minute chart', () => {
  it('shows a quiet placeholder while the open moment’s minutes load', () => {
    vi.spyOn(minuteWindow, 'loadMomentMinuteWindow').mockReturnValue(new Promise(() => {}))
    render(<MomentMinuteChart moment={moment} />)
    const figure = screen.getByRole('figure', { name: 'Chat per minute around this moment' })
    expect(figure.getAttribute('aria-busy')).toBe('true')
    expect(figure.querySelector('.moment-minutes__plot--loading')).not.toBeNull()
    expect(figure.querySelectorAll('.moment-minutes__bar')).toHaveLength(0)
    expect(minuteWindow.loadMomentMinuteWindow).toHaveBeenCalledWith(moment, expect.any(AbortSignal))
  })

  it('draws measured minutes, lights the moment, and marks the earlier average', async () => {
    reduceMotion(false)
    vi.spyOn(minuteWindow, 'loadMomentMinuteWindow').mockResolvedValue(minuteData())
    const { container } = render(<MomentMinuteChart moment={moment} />)
    const figure = await screen.findByRole('figure', { name: 'Chat per minute around this moment' })
    await waitFor(() => expect(figure.getAttribute('data-state')).toBe('ready'))
    const bars = container.querySelectorAll('.moment-minutes__bar')
    expect(bars).toHaveLength(40)
    expect(container.querySelector('[data-relative="-12"]')).toBeNull()
    expect(container.querySelector('[data-moment="true"]')?.getAttribute('data-relative')).toBe('0')
    // Bars grow out from the moment; the moment's own bar starts first.
    expect((container.querySelector('[data-moment="true"]') as SVGElement).style.animationDelay).toBe('0ms')
    expect((container.querySelector('[data-relative="-30"]') as SVGElement).style.animationDelay).toBe('270ms')
    const baseline = container.querySelector('.moment-minutes__baseline')!
    const max = 393 * 1.1
    expect(Number(baseline.getAttribute('y1'))).toBeCloseTo(120 - (160 / max) * 120, 5)
    expect(figure.querySelector('figcaption > span')!.textContent).toBe('2.5× the earlier average')
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe(
      'Chat per minute from 30 minutes before to 10 minutes after this moment. This minute: 393 chat per minute. Earlier average: 160 per minute. Highest: 393 per minute, at this minute. 40 of 41 minutes measured.')
    expect(container.querySelector('.moment-minutes__axis')!.textContent).toBe('30 min beforethis moment10 min after')
    expect(container.querySelector('.moment-minutes__legend')!.textContent).toContain('Earlier average 160/min')
  })

  it('replaces the header with the minute under the pointer', async () => {
    vi.spyOn(minuteWindow, 'loadMomentMinuteWindow').mockResolvedValue(minuteData())
    const { container } = render(<MomentMinuteChart moment={moment} />)
    await waitFor(() => expect(container.querySelectorAll('.moment-minutes__bar')).toHaveLength(40))
    const plot = container.querySelector('.moment-minutes__plot')!
    vi.spyOn(container.querySelector('svg')!, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 410, height: 120, right: 410, bottom: 120, x: 0, y: 0, toJSON: () => ({}) })
    const caption = container.querySelector('figcaption > span')!
    const pointAt = (clientX: number) => fireEvent(plot, new MouseEvent('pointermove', { bubbles: true, clientX }))
    pointAt(305)
    expect(caption.textContent).toBe('This minute · 393 chat / min')
    pointAt(255)
    expect(caption.textContent).toBe('5 min before · 175 chat / min')
    pointAt(185)
    expect(caption.textContent).toBe('12 min before · not measured')
    pointAt(405)
    expect(caption.textContent).toBe('10 min after · 190 chat / min')
    fireEvent.pointerLeave(plot)
    expect(caption.textContent).toBe('2.5× the earlier average')
  })

  it('omits the average line and its claim when the stream has no usable baseline', async () => {
    vi.spyOn(minuteWindow, 'loadMomentMinuteWindow').mockResolvedValue(minuteData())
    const unready = { ...comparison, chat: { ...comparison.chat, state: 'insufficient_baseline' as never } }
    const { container } = render(<MomentMinuteChart moment={{ ...moment, comparison: unready }} />)
    await waitFor(() => expect(container.querySelectorAll('.moment-minutes__bar')).toHaveLength(40))
    expect(container.querySelector('.moment-minutes__baseline')).toBeNull()
    expect(container.querySelector('figcaption > span')!.textContent).toBe('')
    expect(container.querySelector('.moment-minutes__legend')!.textContent).not.toContain('Earlier average')
    expect(screen.getByRole('img').getAttribute('aria-label')).not.toContain('Earlier average')
    expect(momentChatBaseline(undefined)).toBeNull()
    expect(momentChatBaseline({ ...comparison, chat: { ...comparison.chat, baselinePerMin: 0 } })).toBeNull()
  })

  it('says in one line when no minute in the window was measured, and draws nothing', async () => {
    vi.spyOn(minuteWindow, 'loadMomentMinuteWindow').mockResolvedValue(null)
    const { container } = render(<MomentMinuteChart moment={moment} />)
    expect(await screen.findByText('Chat per minute isn’t available for this part of the broadcast.')).toBeTruthy()
    expect(container.querySelector('svg')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Retry chat per minute' })).toBeNull()
  })

  it('says a failed read could not be loaded, never that the minutes do not exist, and retries it in place', async () => {
    const load = vi.spyOn(minuteWindow, 'loadMomentMinuteWindow')
      .mockRejectedValueOnce({ kind: 'timeout', status: 0 })
      .mockRejectedValueOnce({ kind: 'server', status: 503 })
      .mockResolvedValueOnce(minuteData())
    const { container } = render(<MomentMinuteChart moment={moment} />)
    const note = await screen.findByText(/Chat per minute couldn’t be loaded\./)
    expect(note.getAttribute('data-state')).toBe('error')
    expect(note.getAttribute('role')).toBe('status')
    expect(screen.queryByText('Chat per minute isn’t available for this part of the broadcast.')).toBeNull()
    expect(container.querySelector('svg')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry chat per minute' }))
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('button', { name: 'Retry chat per minute' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry chat per minute' }))
    await waitFor(() => expect(container.querySelectorAll('.moment-minutes__bar')).toHaveLength(40))
    expect(load).toHaveBeenCalledTimes(3)
    expect(screen.queryByRole('button', { name: 'Retry chat per minute' })).toBeNull()
  })

  it('marks a minute with no chat count as no chat recorded, never as a measured zero bar', async () => {
    vi.spyOn(minuteWindow, 'loadMomentMinuteWindow').mockResolvedValue(minuteData([-20, -19]))
    const { container } = render(<MomentMinuteChart moment={moment} />)
    await waitFor(() => expect(container.querySelectorAll('.moment-minutes__bar')).toHaveLength(38))
    expect(container.querySelector('.moment-minutes__bar[data-relative="-20"]')).toBeNull()
    expect(container.querySelectorAll('.moment-minutes__unrecorded')).toHaveLength(2)
    expect(container.querySelector('.moment-minutes__unrecorded[data-relative="-20"]')).not.toBeNull()
    expect(container.querySelector('.moment-minutes__legend')!.textContent).toContain('No chat recorded')
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('38 of 41 minutes measured. 2 minutes have no chat recorded.')
    const plot = container.querySelector('.moment-minutes__plot')!
    vi.spyOn(container.querySelector('svg')!, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 410, height: 120, right: 410, bottom: 120, x: 0, y: 0, toJSON: () => ({}) })
    fireEvent(plot, new MouseEvent('pointermove', { bubbles: true, clientX: 105 }))
    expect(container.querySelector('figcaption > span')!.textContent).toBe('20 min before · no chat recorded')
  })

  it('draws nothing for minutes before the broadcast or not returned yet, and counts only the minutes inside it', async () => {
    // Four minutes into a live broadcast: -30…-5 came before it started, +4…+10 have not arrived.
    const slots = Array.from({ length: 41 }, (_, index): minuteWindow.MomentMinuteSlot => {
      const relative = index - 30
      if (relative < -4 || relative > 3) return { relative, state: 'outside', chatPerMin: null }
      return { relative, state: 'measured', chatPerMin: relative === 0 ? 393 : 150 + index }
    })
    vi.spyOn(minuteWindow, 'loadMomentMinuteWindow').mockResolvedValue({ slots, measuredMinutes: 8, unrecordedMinutes: 0, complete: false })
    const { container } = render(<MomentMinuteChart moment={{ ...moment, offsetSeconds: 240 }} />)
    await waitFor(() => expect(container.querySelector('figure')?.getAttribute('data-state')).toBe('ready'))
    const bars = [...container.querySelectorAll('.moment-minutes__bar')]
    expect(bars.map(bar => Number(bar.getAttribute('data-relative')))).toEqual([-4, -3, -2, -1, 0, 1, 2, 3])
    for (const relative of [-30, -20, -5, 4, 7, 10]) expect(container.querySelector(`svg [data-relative="${relative}"]`)).toBeNull()
    expect(container.querySelector('.moment-minutes__unrecorded')).toBeNull()
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe(
      'Chat per minute from 30 minutes before to 10 minutes after this moment. This minute: 393 chat per minute. Earlier average: 160 per minute. Highest: 393 per minute, at this minute. 8 of 8 minutes measured. The first 26 minutes came before the broadcast started. The last 7 minutes aren’t available yet.')
    const plot = container.querySelector('.moment-minutes__plot')!
    vi.spyOn(container.querySelector('svg')!, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 410, height: 120, right: 410, bottom: 120, x: 0, y: 0, toJSON: () => ({}) })
    const caption = container.querySelector('figcaption > span')!
    const pointAt = (clientX: number) => fireEvent(plot, new MouseEvent('pointermove', { bubbles: true, clientX }))
    pointAt(105)
    expect(caption.textContent).toBe('20 min before · no data')
    pointAt(375)
    expect(caption.textContent).toBe('7 min after · no data')
    pointAt(265)
    expect(caption.textContent).toBe('4 min before · 176 chat / min')
  })

  it('does not count minutes that have not happened yet as missing, right after a live detection', async () => {
    // Every minute up to the moment was measured; the next ten have not arrived.
    const slots = Array.from({ length: 41 }, (_, index): minuteWindow.MomentMinuteSlot => {
      const relative = index - 30
      return relative > 0 ? { relative, state: 'outside', chatPerMin: null } : { relative, state: 'measured', chatPerMin: relative === 0 ? 393 : 150 + index }
    })
    vi.spyOn(minuteWindow, 'loadMomentMinuteWindow').mockResolvedValue({ slots, measuredMinutes: 31, unrecordedMinutes: 0, complete: false })
    render(<MomentMinuteChart moment={moment} />)
    await waitFor(() => expect(screen.getByRole('img').getAttribute('aria-label')).toContain('31 of 31 minutes measured. The last 10 minutes aren’t available yet.'))
    expect(screen.getByRole('img').getAttribute('aria-label')).not.toContain('before the broadcast started')
    // One minute left to arrive reads in the singular.
    cleanup()
    slots[40] = { relative: 10, state: 'outside', chatPerMin: null }
    for (let index = 31; index < 40; index += 1) slots[index] = { relative: index - 30, state: 'measured', chatPerMin: 150 }
    vi.mocked(minuteWindow.loadMomentMinuteWindow).mockResolvedValue({ slots, measuredMinutes: 40, unrecordedMinutes: 0, complete: false })
    render(<MomentMinuteChart moment={moment} />)
    await waitFor(() => expect(screen.getByRole('img').getAttribute('aria-label')).toContain('40 of 40 minutes measured. The last minute isn’t available yet.'))
  })

  it('says so when the moment’s own minute was not measured', async () => {
    const minutes = minuteData()
    minutes.slots[30] = { relative: 0, state: 'unmeasured', chatPerMin: null }
    vi.spyOn(minuteWindow, 'loadMomentMinuteWindow').mockResolvedValue({ ...minutes, measuredMinutes: 39 })
    const { container } = render(<MomentMinuteChart moment={moment} />)
    await waitFor(() => expect(container.querySelectorAll('.moment-minutes__bar')).toHaveLength(39))
    expect(container.querySelector('[data-moment="true"]')).toBeNull()
    const summary = screen.getByRole('img').getAttribute('aria-label')!
    expect(summary).toContain('This minute was not measured.')
    expect(summary).not.toContain('This minute:')
    expect(summary).toContain('39 of 41 minutes measured.')
  })

  it('draws no legend entry for unrecorded minutes when there are none', async () => {
    vi.spyOn(minuteWindow, 'loadMomentMinuteWindow').mockResolvedValue(minuteData())
    const { container } = render(<MomentMinuteChart moment={moment} />)
    await waitFor(() => expect(container.querySelectorAll('.moment-minutes__bar')).toHaveLength(40))
    expect(container.querySelector('.moment-minutes__unrecorded')).toBeNull()
    expect(container.querySelector('.moment-minutes__legend')!.textContent).not.toContain('No chat recorded')
    expect(screen.getByRole('img').getAttribute('aria-label')).not.toContain('no chat recorded')
  })

  it('draws at once under reduced motion', async () => {
    reduceMotion(true)
    vi.spyOn(minuteWindow, 'loadMomentMinuteWindow').mockResolvedValue(minuteData())
    const { container } = render(<MomentMinuteChart moment={moment} />)
    await waitFor(() => expect(container.querySelectorAll('.moment-minutes__bar')).toHaveLength(40))
    expect(container.querySelector('svg')!.getAttribute('data-motion')).toBe('reduced')
    expect([...container.querySelectorAll('.moment-minutes__bar')].every(bar => !bar.getAttribute('style'))).toBe(true)
  })
})

describe('inline reveal', () => {
  function Harness({ initial = false }: { initial?: boolean }) {
    const [open, setOpen] = useState(initial)
    const [presses, setPresses] = useState(0)
    return <>
      <button type="button" onClick={() => setOpen(value => !value)}>toggle</button>
      <output>{presses}</output>
      <MomentInlineReveal open={open} id="detail" onInsidePress={event => { if (event.type === 'click') setPresses(value => value + 1) }}>
        <section aria-label="Selected moment">Detail{createPortal(<button type="button">Portal menu item</button>, document.body)}</section>
      </MomentInlineReveal>
    </>
  }

  /** Every class the slot was committed with after it entered the document, oldest first. */
  function watchSlotClasses() {
    const seen: MutationRecord[] = []
    const observer = new MutationObserver(records => { seen.push(...records) })
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true })
    return () => {
      seen.push(...observer.takeRecords())
      observer.disconnect()
      return seen.filter(record => (record.target as Element).classList.contains('moments-inline')).map(record => record.oldValue)
    }
  }

  it('opens from 0fr, keeps the content while collapsing, then removes it', async () => {
    vi.useFakeTimers()
    reduceMotion(false)
    const { container } = render(<Harness />)
    expect(container.querySelector('.moments-inline')).toBeNull()
    const classesBefore = watchSlotClasses()
    // A browser only transitions from a style it has computed. The slot reads its own
    // layout while collapsed rather than relying on whatever else its page reads first.
    const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!
    const layoutReads: string[] = []
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('moments-inline')) layoutReads.push(this.className)
      return offsetHeight.get!.call(this) as number
    })
    fireEvent.click(screen.getByText('toggle'))
    const slot = container.querySelector<HTMLDivElement>('.moments-inline')!
    expect(slot.className).toContain('is-open')
    // It entered collapsed and only then opened, so the change to 1fr can transition.
    expect(classesBefore()).toEqual(['moments-inline'])
    expect(layoutReads).toEqual(['moments-inline'])
    expect(slot.id).toBe('detail')
    expect(slot.inert).toBe(false)
    fireEvent.click(screen.getByText('toggle'))
    expect(slot.className).toContain('is-closing')
    expect(slot.className).not.toContain('is-open')
    expect(slot.getAttribute('aria-hidden')).toBe('true')
    expect(slot.inert).toBe(true)
    expect(slot.id).toBe('')
    expect(slot.textContent).toContain('Detail')
    act(() => { vi.advanceTimersByTime(MOMENT_INLINE_CLOSE_MS) })
    expect(container.querySelector('.moments-inline')).toBeNull()
  })

  it('mounts already open without replaying the opening', () => {
    reduceMotion(false)
    const classesBefore = watchSlotClasses()
    const { container } = render(<Harness initial />)
    expect(container.querySelector('.moments-inline')!.className).toContain('is-open')
    expect(classesBefore()).toEqual([])
  })

  it('closes at once under reduced motion', () => {
    reduceMotion(true)
    const { container } = render(<Harness initial />)
    expect(container.querySelector('.moments-inline')!.className).toContain('is-open')
    fireEvent.click(screen.getByText('toggle'))
    expect(container.querySelector('.moments-inline')).toBeNull()
  })

  it('counts a press inside a portal its content renders as inside', () => {
    render(<Harness initial />)
    fireEvent.click(screen.getByText('Portal menu item'))
    expect(screen.getByRole('status').textContent).toBe('1')
    fireEvent.click(screen.getByText('toggle'))
    expect(screen.getByRole('status').textContent).toBe('1')
  })
})
