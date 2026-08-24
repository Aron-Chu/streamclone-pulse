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

  function renderPicker(selectedKeys: string[] = []) {
    act(() => {
      root.render(
        createElement(SevenTvEmotePanel, {
          expanded: true,
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
})
