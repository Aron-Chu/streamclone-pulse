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
    expect(moment?.textContent).toContain('00:05')
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

  it('looks as before when there is no moment', () => {
    renderDock({ topMoment: null })
    expect(host.querySelector('[data-mini-top-moment="true"]')).toBeNull()
    expect(host.querySelector('[data-mini-top-moment-jump="true"]')).toBeNull()
    expect(host.querySelector('.pulse-mini-brand')?.textContent).toBe('Pulse')
    expect(host.querySelector('.pulse-mini-status-text')?.textContent).toBe('Tracking')
  })
})
