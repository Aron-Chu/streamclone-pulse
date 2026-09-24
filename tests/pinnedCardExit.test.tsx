// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  nextPinnedCardHold,
  usePinnedCardHold,
  SELECTED_MOMENT_CARD_EXIT_MS,
} from '../src/ui/pinnedCardExit.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let host: HTMLDivElement | undefined

function Card({ value, reducedMotion }: { value: string | null; reducedMotion: boolean }) {
  const hold = usePinnedCardHold(value, reducedMotion)
  if (!hold.point) return null
  return <div data-exiting={hold.exiting ? 'true' : 'false'}>{hold.point}</div>
}

function render(value: string | null, reducedMotion = false) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root!.render(<Card value={value} reducedMotion={reducedMotion} />))
}

function update(value: string | null, reducedMotion = false) {
  act(() => root!.render(<Card value={value} reducedMotion={reducedMotion} />))
}

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = undefined
  host = undefined
  vi.useRealTimers()
})

describe('nextPinnedCardHold', () => {
  it('takes the incoming value and is never exiting while one exists', () => {
    expect(nextPinnedCardHold({ incoming: 'b', held: 'a', exiting: true, reducedMotion: false }))
      .toEqual({ held: 'b', exiting: false })
  })

  it('holds the last value for the exit window when the selection clears', () => {
    expect(nextPinnedCardHold({ incoming: null, held: 'a', exiting: false, reducedMotion: false }))
      .toEqual({ held: 'a', exiting: true })
  })

  it('drops immediately under reduced motion, and when there is nothing held', () => {
    expect(nextPinnedCardHold({ incoming: null, held: 'a', exiting: false, reducedMotion: true }))
      .toEqual({ held: null, exiting: false })
    expect(nextPinnedCardHold({ incoming: null, held: null, exiting: false, reducedMotion: false }))
      .toEqual({ held: null, exiting: false })
  })
})

describe('usePinnedCardHold', () => {
  it('keeps the card mounted and marked exiting, then unmounts after the window', () => {
    vi.useFakeTimers()
    render('moment-a')
    expect(host!.textContent).toBe('moment-a')
    expect(host!.querySelector('[data-exiting="false"]')).toBeTruthy()

    update(null)
    // Still on screen so CSS has something to fade and collapse.
    expect(host!.textContent).toBe('moment-a')
    expect(host!.querySelector('[data-exiting="true"]')).toBeTruthy()

    act(() => { vi.advanceTimersByTime(SELECTED_MOMENT_CARD_EXIT_MS - 1) })
    expect(host!.textContent).toBe('moment-a')

    act(() => { vi.advanceTimersByTime(2) })
    expect(host!.textContent).toBe('')
  })

  it('cancels the exit when a new selection arrives mid-flight', () => {
    vi.useFakeTimers()
    render('moment-a')
    update(null)
    expect(host!.querySelector('[data-exiting="true"]')).toBeTruthy()

    update('moment-b')
    expect(host!.textContent).toBe('moment-b')
    expect(host!.querySelector('[data-exiting="false"]')).toBeTruthy()

    // The superseded timer must not blank the replacement card.
    act(() => { vi.advanceTimersByTime(SELECTED_MOMENT_CARD_EXIT_MS * 2) })
    expect(host!.textContent).toBe('moment-b')
  })

  it('unmounts without a hold under reduced motion', () => {
    vi.useFakeTimers()
    render('moment-a', true)
    expect(host!.textContent).toBe('moment-a')
    update(null, true)
    expect(host!.textContent).toBe('')
  })

  it('re-arms after a completed exit, so a later selection still holds', () => {
    vi.useFakeTimers()
    render('moment-a')
    update(null)
    act(() => { vi.advanceTimersByTime(SELECTED_MOMENT_CARD_EXIT_MS + 1) })
    expect(host!.textContent).toBe('')

    update('moment-c')
    expect(host!.textContent).toBe('moment-c')
    update(null)
    expect(host!.querySelector('[data-exiting="true"]')).toBeTruthy()
    expect(host!.textContent).toBe('moment-c')
  })
})
