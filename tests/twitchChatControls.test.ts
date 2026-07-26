import { describe, expect, it, vi } from 'vitest'
import {
  isTwitchChattersOpen,
  toggleTwitchChatters,
} from '../src/content/twitchChatControls.ts'

function mockButton(label: string, rect = { width: 32, height: 32 }) {
  return {
    getAttribute: (name: string) => (name === 'aria-label' ? label : null),
    getBoundingClientRect: () => ({
      ...rect,
      top: 0,
      left: 0,
      right: rect.width,
      bottom: rect.height,
    }),
    click: vi.fn(),
  } as unknown as HTMLElement
}

function mockDoc(queryImpl: (selector: string) => Element | null): Document {
  return {
    querySelector: queryImpl,
    querySelectorAll: (selector: string) => {
      const el = queryImpl(selector)
      return (el ? [el] : []) as unknown as NodeListOf<Element>
    },
  } as unknown as Document
}

describe('isTwitchChattersOpen', () => {
  it('detects the Go back to Chat header control', () => {
    const back = mockButton('Go back to Chat')
    const doc = mockDoc((selector) => {
      if (selector.includes('Go back to Chat')) return back
      return null
    })
    expect(isTwitchChattersOpen(doc)).toBe(true)
  })

  it('detects Community header title', () => {
    const doc = mockDoc((selector) => {
      if (selector.includes('chat-room-header"] h4')) {
        return { textContent: 'Community' } as Element
      }
      return null
    })
    expect(isTwitchChattersOpen(doc)).toBe(true)
  })

  it('returns false when chat header shows Stream Chat', () => {
    const community = mockButton('Community')
    const doc = mockDoc((selector) => {
      if (selector.includes('Community" i')) return community
      if (selector.includes('chat-room-header"] h4')) {
        return { textContent: 'Stream Chat' } as Element
      }
      return null
    })
    expect(isTwitchChattersOpen(doc)).toBe(false)
  })
})

describe('toggleTwitchChatters', () => {
  it('clicks the unified chat-viewer-list toggle for open and close', () => {
    const toggle = mockButton('Community')
    const doc = mockDoc((selector) => {
      if (selector === '[data-test-selector="chat-viewer-list"]') return toggle
      return null
    })

    expect(toggleTwitchChatters(doc)).toBe(true)
    expect(toggle.click).toHaveBeenCalledTimes(1)

    const backToggle = mockButton('Go back to Chat')
    const openDoc = mockDoc((selector) => {
      if (selector === '[data-test-selector="chat-viewer-list"]') return backToggle
      if (selector.includes('Go back to Chat')) return backToggle
      return null
    })

    expect(toggleTwitchChatters(openDoc)).toBe(true)
    expect(backToggle.click).toHaveBeenCalledTimes(1)
  })

  it('closes via Go back to Chat when the unified toggle is missing', () => {
    const back = mockButton('Go back to Chat')
    const doc = mockDoc((selector) => {
      if (selector.includes('Go back to Chat')) return back
      if (selector.includes('chat-room-header"] h4')) {
        return { textContent: 'Community' } as Element
      }
      return null
    })

    expect(toggleTwitchChatters(doc)).toBe(true)
    expect(back.click).toHaveBeenCalledTimes(1)
  })

  it('opens via Community label when no unified toggle exists', () => {
    const community = mockButton('Community')
    const doc = mockDoc((selector) => {
      if (selector === '[data-test-selector="chat-viewer-list"]') return null
      if (selector.includes('Community" i')) return community
      return null
    })

    expect(toggleTwitchChatters(doc)).toBe(true)
    expect(community.click).toHaveBeenCalledTimes(1)
  })
})
