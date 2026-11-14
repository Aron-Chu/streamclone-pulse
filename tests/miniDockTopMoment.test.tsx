// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LiveHeatPoint } from '@streampulse/pulse-core'
import { MiniDock } from '../src/ui/MiniDock.tsx'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * The Mini dock shows the first row of the panel's Top moments list, with a
 * Jump that does what the list's Jump does. With no moment it looks as before.
 */

const point: LiveHeatPoint = {
  minuteTs: '2026-06-11T12:05:00.000Z',
  offsetSeconds: 300,
  score: 95,
  estimated: false,
  reason: 'chat_spike',
  reasonLabel: 'Chat spike',
  chatCount: 40,
  emoteCount: 3,
  topEmotes: [],
  collecting: false,
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function renderDock(props: Partial<Parameters<typeof MiniDock>[0]> = {}) {
  const handlers = { onExpand: vi.fn(), onSettings: vi.fn(), onHide: vi.fn(), onTrack: vi.fn(), onJumpTopMoment: vi.fn() }
  act(() => {
    root.render(
      <MiniDock
        login="test"
        payload={null}
        tracking
        isLive
        trackBusy={false}
        {...handlers}
        {...props}
      />,
    )
  })
  return handlers
}

describe('Mini dock top moment', () => {
  it('shows the top moment with its time and reason, and Jump jumps to it', () => {
    const handlers = renderDock({ topMoment: point })
    const moment = host.querySelector('[data-mini-top-moment="true"]')
    expect(moment?.textContent).toContain('Top moment')
    expect(moment?.textContent).toContain('about 0:05:00')
    expect(moment?.textContent).toContain('Chat spike')
    // The moment replaces the brand and status line.
    expect(host.querySelector('.pulse-mini-brand')).toBeNull()

    const jump = host.querySelector<HTMLButtonElement>('[data-mini-top-moment-jump="true"]')!
    expect(jump.textContent).toContain('Jump')
    act(() => jump.click())
    expect(handlers.onJumpTopMoment).toHaveBeenCalledWith(point)
    // Jump does not also open the panel.
    expect(handlers.onExpand).not.toHaveBeenCalled()

    // The control that opens the full panel stays.
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Expand panel"]')!.click())
    expect(handlers.onExpand).toHaveBeenCalledTimes(1)
  })

  it('names its main button and says where Jump goes (EXT-MOMENTS-9)', () => {
    renderDock({ topMoment: point, jumpLabel: 'Jump in VOD' })
    expect(host.querySelector('.pulse-mini-dock-main')?.getAttribute('aria-label')).toBe('Expand Pulse panel')
    expect(host.querySelector('[data-mini-top-moment-jump="true"]')?.getAttribute('aria-label'))
      .toBe('Jump in VOD to the top moment at about 0:05:00')
  })

  it('says what Jump did across its whole second line for a few seconds, with a real Open Analytics, read out as a status (U1)', async () => {
    vi.useFakeTimers()
    try {
      const text = 'Past Twitch’s rewind window'
      const analytics = vi.fn()
      renderDock({ topMoment: point, onJumpTopMoment: () => Promise.resolve({ ok: false, text }), onAnalyticsTopMoment: analytics })
      await act(async () => { host.querySelector<HTMLButtonElement>('[data-mini-top-moment-jump="true"]')!.click() })
      expect(host.querySelector('.pulse-mini-dock')?.classList.contains('pulse-mini-dock-noted')).toBe(true)
      // Its own line, outside the main button; the time and reason stay where they were.
      expect(host.querySelector('.pulse-mini-dock-main .pulse-mini-note')).toBeNull()
      expect(host.querySelector('.pulse-mini-note-row .pulse-mini-note')?.textContent).toBe(text)
      expect(host.querySelector('.pulse-mini-note')?.classList.contains('pulse-note-warn')).toBe(true)
      expect(host.querySelector('.pulse-mini-moment-detail')?.textContent).toBe('about 0:05:00 · Chat spike')
      expect(host.querySelector('[role="status"]')?.textContent).toBe(text)
      // Jump stays Jump; Open Analytics is a button that opens Analytics at the moment.
      expect(host.querySelector('[data-mini-top-moment-jump="true"]')?.textContent).toBe('Jump')
      const open = host.querySelector<HTMLButtonElement>('button.pulse-mini-note-link')!
      expect(open.textContent).toBe('Open Analytics')
      act(() => open.click())
      expect(analytics).toHaveBeenCalledWith(point)
      act(() => { vi.advanceTimersByTime(5000) })
      expect(host.querySelector('.pulse-mini-note-row')).toBeNull()
      expect(host.querySelector('.pulse-mini-dock')?.classList.contains('pulse-mini-dock-noted')).toBe(false)
      expect(host.querySelector('[role="status"]')?.textContent).toBe('')
    } finally {
      vi.useRealTimers()
    }
  })

  it('moves focus on Open Analytics to Jump, the control that stays, when the note clears', async () => {
    vi.useFakeTimers()
    try {
      renderDock({ topMoment: point, onJumpTopMoment: () => Promise.resolve({ ok: false, text: 'Past Twitch’s rewind window' }), onAnalyticsTopMoment: vi.fn() })
      const jump = host.querySelector<HTMLButtonElement>('[data-mini-top-moment-jump="true"]')!
      await act(async () => { jump.click() })
      host.querySelector<HTMLButtonElement>('button.pulse-mini-note-link')!.focus()
      act(() => { vi.advanceTimersByTime(5000) })
      expect(host.querySelector('.pulse-mini-note-link')).toBeNull()
      expect(document.activeElement).toBe(jump)
    } finally {
      vi.useRealTimers()
    }
  })

  it('leaves focus alone when the note clears with focus elsewhere', async () => {
    vi.useFakeTimers()
    try {
      renderDock({ topMoment: point, onJumpTopMoment: () => Promise.resolve({ ok: false, text: 'Past Twitch’s rewind window' }), onAnalyticsTopMoment: vi.fn() })
      await act(async () => { host.querySelector<HTMLButtonElement>('[data-mini-top-moment-jump="true"]')!.click() })
      const gear = host.querySelector<HTMLButtonElement>('button[aria-label="Open settings"]')!
      gear.focus()
      act(() => { vi.advanceTimersByTime(5000) })
      expect(document.activeElement).toBe(gear)
    } finally {
      vi.useRealTimers()
    }
  })

  it('offers no Open Analytics after a Jump that worked', async () => {
    renderDock({ topMoment: point, onJumpTopMoment: () => Promise.resolve({ ok: true, text: 'Jumped to 0:05:00' }), onAnalyticsTopMoment: vi.fn() })
    await act(async () => { host.querySelector<HTMLButtonElement>('[data-mini-top-moment-jump="true"]')!.click() })
    expect(host.querySelector('.pulse-mini-note')?.textContent).toBe('Jumped to 0:05:00')
    expect(host.querySelector('.pulse-mini-note-link')).toBeNull()
  })

  it('looks as before when there is no moment', () => {
    renderDock({ topMoment: null })
    expect(host.querySelector('[data-mini-top-moment="true"]')).toBeNull()
    expect(host.querySelector('[data-mini-top-moment-jump="true"]')).toBeNull()
    expect(host.querySelector('.pulse-mini-brand')?.textContent).toBe('Pulse')
    expect(host.querySelector('.pulse-mini-status-text')?.textContent).toBe('Tracking')
  })
})
