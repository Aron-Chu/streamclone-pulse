// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LiveHeatPoint } from '@streampulse/pulse-core'
import { SelectedMomentCard } from '../src/ui/SelectedMomentCard.tsx'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const point: LiveHeatPoint = {
  minuteTs: '2026-08-29T12:00:00.000Z',
  offsetSeconds: 30,
  score: 92,
  estimated: false,
  reason: 'emote_spike',
  reasonLabel: 'Emote spike',
  chatCount: 794,
  emoteCount: 709,
  viewerCount: 10_800,
  collecting: false,
  topEmotes: [
    { key: 'hesRight', name: 'hesRight', count: 73 },
    { key: 'LOL', name: 'LOL', count: 63 },
    { key: 'PLACE', name: 'PLACE', count: 55 },
    { key: 'hidden', name: 'Fourth emote', count: 44 },
  ],
}

describe('SelectedMomentCard', () => {
  let root: Root | null = null
  let container: HTMLDivElement | null = null

  afterEach(() => {
    act(() => root?.unmount())
    root = null
    container?.remove()
    container = null
  })

  it('restores the compact legacy hierarchy and wires its two actions', () => {
    const onJump = vi.fn()
    const onAnalytics = vi.fn()
    const onClear = vi.fn()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    act(() => {
      root?.render(
        <SelectedMomentCard
          point={point}
          backendUrl="https://api.streampulse.stream"
          compact
          jumpLabel="Jump in player"
          onJump={onJump}
          onAnalytics={onAnalytics}
          onClear={onClear}
        />,
      )
    })

    expect(container.textContent).toContain('Selected moment')
    expect(container.textContent).toContain('Emote spike')
    expect(container.textContent).toContain('10.8K viewers · 794 chat · 709 emotes')
    expect(container.querySelectorAll('[data-moment-inspector-emote-row="true"]')).toHaveLength(3)
    expect(container.textContent).not.toContain('Fourth emote')
    expect(container.textContent).not.toContain('Bookmark')

    const actions = container.querySelector<HTMLElement>('[data-moment-inspector-action="jump"]')?.parentElement
    const jump = container.querySelector<HTMLButtonElement>('[data-moment-inspector-action="jump"]')
    const analytics = container.querySelector<HTMLButtonElement>('[data-moment-inspector-action="analytics"]')
    const clear = container.querySelector<HTMLButtonElement>('[aria-label="Clear selected moment"]')
    expect(actions?.style.justifyContent).toBe('space-between')
    expect(jump?.querySelector('[data-selected-moment-play-icon="true"]')).not.toBeNull()
    expect(analytics?.style.marginLeft).toBe('auto')
    act(() => jump?.click())
    act(() => analytics?.click())
    act(() => clear?.click())
    expect(onJump).toHaveBeenCalledOnce()
    expect(onJump).toHaveBeenCalledWith(point)
    expect(onAnalytics).toHaveBeenCalledOnce()
    expect(onAnalytics).toHaveBeenCalledWith(point)
    expect(onClear).toHaveBeenCalledOnce()
  })
})
