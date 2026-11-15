// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LiveHeatPoint } from '@streampulse/pulse-core'
import { SelectedMomentCard } from '../src/ui/SelectedMomentCard.tsx'
import { panelRule } from './helpers/panelRule.ts'

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
    expect(container.textContent).toContain('10.8K viewers · 794 chat/min · 709 emotes/min')
    // Nothing to say until Jump answers.
    expect(container.querySelector('.pulse-sel-note[role="status"]')?.textContent).toBe('')
    expect(container.querySelectorAll('[data-moment-inspector-emote-row="true"]')).toHaveLength(3)
    expect(container.textContent).not.toContain('Fourth emote')
    expect(container.textContent).not.toContain('Bookmark')

    const actions = container.querySelector<HTMLElement>('[data-moment-inspector-action="jump"]')?.parentElement
    const jump = container.querySelector<HTMLButtonElement>('[data-moment-inspector-action="jump"]')
    const analytics = container.querySelector<HTMLButtonElement>('[data-moment-inspector-action="analytics"]')
    const clear = container.querySelector<HTMLButtonElement>('[aria-label="Clear selected moment"]')
    expect(actions?.classList.contains('pulse-sel-actions')).toBe(true)
    expect(panelRule('pulse-sel-actions')).toContain(' justify-content: space-between;')
    expect(jump?.querySelector('[data-selected-moment-play-icon="true"]')).not.toBeNull()
    expect(analytics?.classList.contains('pulse-sel-link')).toBe(true)
    expect(panelRule('pulse-sel-link')).toContain(' margin-left: auto;')
    act(() => jump?.click())
    act(() => analytics?.click())
    act(() => clear?.click())
    expect(onJump).toHaveBeenCalledOnce()
    expect(onJump).toHaveBeenCalledWith(point)
    expect(onAnalytics).toHaveBeenCalledOnce()
    expect(onAnalytics).toHaveBeenCalledWith(point)
    expect(onClear).toHaveBeenCalledOnce()
  })

  it('fades a newly selected moment in place without remounting the card', () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const render = (value: LiveHeatPoint) => act(() => {
      root?.render(<SelectedMomentCard point={value} backendUrl="https://api.streampulse.stream" onJump={() => {}} onAnalytics={() => {}} />)
    })
    render(point)
    const card = container.querySelector('[data-selected-moment-card="true"]')
    const clock = () => container?.querySelector('[data-moment-inspector-clock="true"]')?.textContent
    const jump = () => container?.querySelector<HTMLButtonElement>('[data-moment-inspector-action="jump"]')
    const firstJump = jump()
    const firstClock = clock()
    // The first selection fades in with the card itself; only later swaps fade the details.
    expect(container.querySelector('.pulse-moment-card-swap')).toBeNull()
    act(() => firstJump?.focus())
    render({ ...point, offsetSeconds: 150, minuteTs: '2026-08-29T12:02:00.000Z' })
    expect(container.querySelector('[data-selected-moment-card="true"]')).toBe(card)
    expect(container.querySelector('.pulse-moment-card-swap')).not.toBeNull()
    expect(clock()).not.toBe(firstClock)
    // The details keep their nodes, so a focused action keeps focus.
    expect(jump()).toBe(firstJump)
    expect(document.activeElement).toBe(firstJump)
  })

  it('says what Jump did on the Analytics line under the buttons, for this moment only (U)', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const text = 'The VOD didn’t hold about 0:00:00'
    const onAnalytics = vi.fn()
    const render = (value: LiveHeatPoint) => act(() => {
      root?.render(<SelectedMomentCard point={value} backendUrl="https://api.streampulse.stream" jumpLabel="Jump in VOD"
        onJump={() => Promise.resolve({ ok: false, text })} onAnalytics={onAnalytics} />)
    })
    render(point)
    const note = () => container?.querySelector('.pulse-sel-note[role="status"]')
    const analytics = () => container?.querySelectorAll<HTMLButtonElement>('[data-moment-inspector-action="analytics"]')
    const before = analytics()![0]
    expect(before.textContent).toBe('Analytics↗')
    await act(async () => { container?.querySelector<HTMLButtonElement>('[data-moment-inspector-action="jump"]')!.click() })
    expect(note()?.textContent).toBe(text)
    expect(note()?.classList.contains('pulse-note-warn')).toBe(true)
    // The Analytics control never moves or changes: the note wraps in the band under the buttons beside it.
    expect(analytics()).toHaveLength(1)
    expect(analytics()![0]).toBe(before)
    expect(note()?.contains(before)).toBe(false)
    expect(before.textContent).toBe('Analytics↗')
    act(() => analytics()![0].click())
    expect(onAnalytics).toHaveBeenCalledTimes(1)
    expect(panelRule('pulse-sel-note')).toContain(' position: absolute;')
    expect(panelRule('pulse-sel-note')).not.toContain('nowrap')
    expect(panelRule('pulse-sel-actions')).toContain(' container-type: inline-size;')
    // Another moment in the card does not carry the last one's answer.
    render({ ...point, offsetSeconds: 150, minuteTs: '2026-08-29T12:02:00.000Z' })
    expect(note()?.textContent).toBe('')
    expect(analytics()).toHaveLength(1)
    expect(analytics()![0].textContent).toBe('Analytics↗')
  })

  it('tags a hello or goodbye spike Stream start or Stream end after its reason (E1)', () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root?.render(<SelectedMomentCard point={{ ...point, streamEdge: 'opening' }} backendUrl="https://api.streampulse.stream" onJump={() => {}} />)
    })
    expect(container.textContent).toContain('Emote spike')
    expect(container.querySelector('.pulse-edge-tag')?.textContent).toBe('Stream start')
    // A quiet tag: plain muted 11 px text, as the site, the Hub and the session write it.
    const tag = panelRule('pulse-edge-tag')
    expect(tag).toContain(' font-size: 11px;')
    expect(tag).toContain(' font-weight: 400;')
    for (const loud of ['border', 'background', 'padding']) expect(tag).not.toContain(loud)
  })
})
