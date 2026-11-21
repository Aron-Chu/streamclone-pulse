import { afterEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
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

const doms: JSDOM[] = []
afterEach(() => { for (const dom of doms.splice(0)) dom.window.close() })

const languages = [
  { lang: 'en', title: 'Community', back: 'Go back to Chat' },
  { lang: 'de', title: 'Community', back: 'Zurück zum Chat' },
  { lang: 'ja', title: 'コミュニティ', back: 'チャットに戻る' },
]

function twitchDoc(language: typeof languages[number], open: boolean, layout: 'channel' | 'popout') {
  const dom = new JSDOM(`<html lang="${language.lang}"><body>
    <section data-test-selector="chat-room-component-layout">
      <h4 data-test-selector="chat-room-header-label">${open ? language.title : 'Chat'}</h4>
      <button data-test-selector="chat-viewer-list" aria-label="${open ? language.back : language.title}">
        <svg><path d="${open && layout === 'channel' ? 'M9 10h2v2H9v-2Zm6 0h-2v2h2v-2Z' : 'M8 2a5 5 0 0 0-1 9.9'}"></path></svg>
      </button>
      ${open && layout === 'popout' ? `<button data-test-selector="close-viewer-list" aria-label="${language.back}"></button>` : ''}
      ${!open || layout === 'channel' ? '<div data-a-target="chat-input" contenteditable="true"></div>' : ''}
    </section>
  </body></html>`)
  doms.push(dom)
  // jsdom has no layout; keep its real DOM/selectors and supply rendered boxes.
  for (const el of dom.window.document.querySelectorAll('*')) {
    el.getBoundingClientRect = () => ({
      x: 0, y: 0, top: 0, left: 0,
      width: el.closest('[hidden]') ? 0 : 32,
      height: el.closest('[hidden]') ? 0 : 32,
      right: 32, bottom: 32, toJSON: () => ({}),
    })
  }
  return dom.window.document
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

  for (const language of languages) {
    for (const layout of ['channel', 'popout'] as const) {
      it(`${language.lang} ${layout}: detects an open list without English labels or ARIA state`, () => {
        expect(isTwitchChattersOpen(twitchDoc(language, true, layout))).toBe(true)
      })
      it(`${language.lang} ${layout}: keeps a closed list unpressed`, () => {
        expect(isTwitchChattersOpen(twitchDoc(language, false, layout))).toBe(false)
      })
    }
  }

  it('does not mistake a missing composer for an open list', () => {
    const doc = twitchDoc(languages[1]!, false, 'channel')
    doc.querySelector('[data-a-target="chat-input"]')!.remove()
    expect(isTwitchChattersOpen(doc)).toBe(false)
  })

  it('ignores a hidden close control', () => {
    const doc = twitchDoc(languages[1]!, true, 'popout')
    doc.querySelector('[data-test-selector="close-viewer-list"]')!.setAttribute('hidden', '')
    expect(isTwitchChattersOpen(doc)).toBe(false)
  })

  it('ignores a hidden return-to-chat icon', () => {
    const doc = twitchDoc(languages[1]!, true, 'channel')
    doc.querySelector('[data-test-selector="chat-viewer-list"]')!.setAttribute('hidden', '')
    expect(isTwitchChattersOpen(doc)).toBe(false)
  })

  it('does not confuse the same icon elsewhere with the chatters state', () => {
    const doc = twitchDoc(languages[1]!, true, 'channel')
    doc.querySelector('[data-test-selector="chat-viewer-list"]')!.removeAttribute('data-test-selector')
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
