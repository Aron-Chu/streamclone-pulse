// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExtensionEmote } from '../src/shared/messages.ts'
import { emoteSelectionKey } from '../src/ui/chatActivityEmotes.ts'

vi.mock('../src/ui/PulseEmoteImg.tsx', () => ({
  PulseEmoteImg: ({ emote }: { emote: ExtensionEmote }) =>
    createElement('span', { 'data-test-emote': emote.name }, emote.name),
}))

import { SevenTvEmotePanel } from '../src/ui/SevenTvEmotePanel.tsx'

function makeEmotes(count: number): ExtensionEmote[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `emote-${index}`,
    name: `EMOTE_${index}`,
    count: 1_000 - index,
    provider: '7tv',
  }))
}

describe('SevenTvEmotePanel packed picker', () => {
  let container: HTMLDivElement
  let root: Root
  const emotes = makeEmotes(14)
  const rollups = [{
    offsetSeconds: 0,
    chatCount: 1,
    sevenTvEmoteCount: 14,
    topEmotes: emotes,
  }]

  beforeEach(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function renderPicker(selectedKeys: string[] = [], expanded = true) {
    act(() => {
      root.render(
        createElement(SevenTvEmotePanel, {
          expanded,
          onToggleExpanded: vi.fn(),
          backendUrl: 'https://api.streampulse.stream',
          rollups,
          topEmotes: emotes,
          selectedKeys,
          onToggleEmote: vi.fn(),
          selectedOffsetSeconds: null,
          maxSelected: 6,
        }),
      )
    })
  }

  it('keeps the picker mounted for enter/exit motion and removes collapsed controls from tab order', () => {
    renderPicker([], false)
    const collapsedBody = container.querySelector('[data-emote-picker-body]')
    expect(collapsedBody).not.toBeNull()
    expect(collapsedBody?.getAttribute('data-expanded')).toBe('false')
    expect(collapsedBody?.getAttribute('aria-hidden')).toBe('true')
    expect((collapsedBody as HTMLElement).style.gridTemplateRows).toBe('0fr')
    expect((collapsedBody as HTMLElement).style.padding).toBe('0px 8px')
    expect((collapsedBody as HTMLElement).style.borderTop).toBe('0px solid transparent')
    expect((collapsedBody as HTMLElement).style.maxHeight).toBe('')
    expect(container.querySelector<HTMLButtonElement>('.pulse-seven-tv-chip')?.tabIndex).toBe(-1)
    expect(container.querySelector<HTMLButtonElement>('[data-emote-picker-more]')?.tabIndex).toBe(-1)

    renderPicker([], true)
    expect(container.querySelector('[data-emote-picker-body]')).toBe(collapsedBody)
    expect(container.querySelector('[data-emote-picker-body]')?.getAttribute('data-expanded')).toBe('true')
    expect(container.querySelector('[data-emote-picker-body]')?.getAttribute('aria-hidden')).toBe('false')
    expect((container.querySelector('[data-emote-picker-body]') as HTMLElement).style.gridTemplateRows).toBe('1fr')
    expect((container.querySelector('[data-emote-picker-body]') as HTMLElement).style.padding).toBe('7px 8px 8px')
    expect((container.querySelector('[data-emote-picker-body]') as HTMLElement).style.transition).toContain('grid-template-rows')
    expect(container.querySelector<HTMLButtonElement>('.pulse-seven-tv-chip')?.tabIndex).toBe(0)
    expect(container.querySelector<HTMLButtonElement>('[data-emote-picker-more]')?.tabIndex).toBe(0)
  })

  it('shows twelve chips first and expands the rest with one more control', () => {
    renderPicker()
    expect(container.querySelectorAll('[data-emote-picker-grid] .pulse-seven-tv-chip')).toHaveLength(12)
    expect(container.querySelector('[data-emote-picker-more]')?.textContent).toBe('+2 more')

    act(() => {
      ;(container.querySelector('[data-emote-picker-more]') as HTMLButtonElement).click()
    })
    expect(container.querySelectorAll('[data-emote-picker-grid] .pulse-seven-tv-chip')).toHaveLength(14)
    expect(container.querySelector('[data-emote-picker-more]')?.textContent).toBe('Show fewer')
  })

  it('enforces six selected lines and leaves the seventh chip disabled', () => {
    let selectedKeys: string[] = []
    renderPicker(selectedKeys)
    selectedKeys = emotes.slice(0, 6).map(emote => emoteSelectionKey(emote))
    renderPicker(selectedKeys)

    const chips = [...container.querySelectorAll<HTMLButtonElement>('[data-emote-picker-grid] .pulse-seven-tv-chip')]
    expect(chips.slice(0, 6).every(chip => chip.getAttribute('aria-selected') === 'true')).toBe(true)
    expect(chips[6]?.disabled).toBe(true)
    expect(container.querySelector('.pulse-seven-tv-chip-active')?.className).toContain('pulse-seven-tv-chip-active')
  })

  it('normalizes stale selections to the six-line cap in the accessible label', () => {
    const selectedKeys = emotes.slice(0, 8).map(emote => emoteSelectionKey(emote))
    renderPicker(selectedKeys)
    expect(container.querySelector('.pulse-seven-tv-toggle')?.textContent).toContain('6/6')
    expect(container.querySelector('[data-emote-picker-grid]')?.getAttribute('aria-label')).toContain('6 of 6 selected')
  })

  it('does not retain a clipping max-height when the expanded list grows', () => {
    renderPicker([], true)
    const body = container.querySelector('[data-emote-picker-body]') as HTMLElement
    expect(body.style.maxHeight).toBe('')
    expect(container.querySelector('[data-emote-picker-body] > div')?.getAttribute('style')).toContain('min-height: 0')
  })

  it('resets the expanded list when the picker is closed and reopened', () => {
    renderPicker()
    act(() => {
      ;(container.querySelector('[data-emote-picker-more]') as HTMLButtonElement).click()
    })
    expect(container.querySelectorAll('[data-emote-picker-grid] .pulse-seven-tv-chip')).toHaveLength(14)
    renderPicker([], false)
    renderPicker([], true)
    expect(container.querySelectorAll('[data-emote-picker-grid] .pulse-seven-tv-chip')).toHaveLength(12)
  })
})
