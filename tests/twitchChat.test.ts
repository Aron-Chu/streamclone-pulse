import { describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import {
  CHAT_HEADER_SELECTORS,
  CHAT_MESSAGE_LIST_IGNORE_SELECTORS,
  CHAT_MESSAGES_SELECTORS,
  buildSidebarBodyRect,
  clampPanelAboveChatChrome,
  computeHeaderTabInsets,
  computeHeaderTabsRect,
  createBoundedRemeasureScheduler,
  DEFAULT_CHAT_HEADER_HEIGHT,
  isChatRectInViewport,
  isUsableChatRect,
  focusNativeChatComposer,
  MIN_CHAT_HEIGHT,
  MIN_CHAT_WIDTH,
  pickChatColumn,
  resolveNativeChatComposer,
  resolveChatContentTop,
  resolveChatPanelRect,
  resolveChatHeaderBarRect,
  resolveChatHeaderHeight,
  shouldScheduleChatGeometryFromMutations,
  toChatRectSnapshot,
  type SidebarSnapLayout,
} from '../src/content/twitchChat.ts'
import { applyTwitchSidebarChromeHides } from '../src/content/twitchSidebarChrome.ts'
import {
  computeMessagesAreaRect,
  FALLBACK_CHAT_HEADER_HEIGHT,
  makeRect,
} from '../src/content/twitchLayout.ts'
import { normalizeOverlayPlacement, normalizeSidebarTab } from '../src/shared/storage.ts'

function rect(width: number, height: number): DOMRect {
  return {
    top: 0,
    left: 0,
    width,
    height,
    bottom: height,
    right: width,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect
}

const mockEl = {} as Element

function positionedRect({
  top,
  left,
  width,
  height,
}: {
  top: number
  left: number
  width: number
  height: number
}): DOMRect {
  return {
    top,
    left,
    width,
    height,
    bottom: top + height,
    right: left + width,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect
}

function makeAnchoredChatDocument(
  notification: { top: number; height: number } | null,
  messagesTop = 152,
  gift: { top: number; height: number } | null = null,
): Document {
  const column = positionedRect({ top: 100, left: 900, width: 340, height: 700 })
  const header = positionedRect({ top: 100, left: 900, width: 340, height: 52 })
  const messages = positionedRect({ top: messagesTop, left: 900, width: 340, height: 500 })
  const input = positionedRect({ top: 720, left: 900, width: 340, height: 60 })
  const notice = notification
    ? positionedRect({ top: notification.top, left: 900, width: 340, height: notification.height })
    : null
  const giftRow = gift
    ? positionedRect({ top: gift.top, left: 900, width: 340, height: gift.height })
    : null
  const element = (rect: DOMRect) => ({ getBoundingClientRect: () => rect })

  const querySelectorAll = (selector: string): Element[] => {
    if (selector.includes('chat-room-component-layout')) return [element(column) as Element]
    if (selector.includes('chat-room-header') && !selector.includes(' h2')) return [element(header) as Element]
    if (selector.includes('chat-scrollable-area')) return [element(messages) as Element]
    if (selector.includes('chat-input')) return [element(input) as Element]
    if (selector.includes('gift-card-upsell')) {
      return giftRow ? [element(giftRow) as Element] : []
    }
    if (selector.includes('chat-notification')) {
      return notice ? [element(notice) as Element] : []
    }
    return []
  }

  return {
    defaultView: { location: { pathname: '/xqc' } },
    querySelector: () => null,
    querySelectorAll,
  } as unknown as Document
}

function fakeMutationTarget({
  messageList = false,
  messageListRoot = false,
  chatColumn = false,
  transientBanner = false,
}: {
  messageList?: boolean
  messageListRoot?: boolean
  chatColumn?: boolean
  transientBanner?: boolean
} = {}): Element {
  const target = {
    nodeType: 1,
    parentElement: null,
    matches: (selector: string) => (
      (messageListRoot && CHAT_MESSAGE_LIST_IGNORE_SELECTORS.includes(selector))
      || (transientBanner && selector.includes('gift-card-upsell'))
      || (chatColumn && selector.includes('chat-room-component-layout'))
    ),
    closest: (selector: string) => {
      if (messageList && CHAT_MESSAGE_LIST_IGNORE_SELECTORS.includes(selector)) return target
      if (chatColumn && selector.includes('chat-room-component-layout')) return target
      return null
    },
    querySelector: () => null,
  }
  return target as unknown as Element
}

describe('pickChatColumn', () => {
  it('returns the first candidate with a usable rect', () => {
    const first = mockEl
    const second = mockEl
    const picked = pickChatColumn([
      { element: first, rect: rect(50, 400) },
      { element: second, rect: rect(340, 720) },
    ])
    expect(picked?.element).toBe(second)
  })

  it('returns null when no candidate is large enough', () => {
    expect(
      pickChatColumn([{ element: mockEl, rect: rect(MIN_CHAT_WIDTH - 1, MIN_CHAT_HEIGHT) }]),
    ).toBeNull()
  })

  it('accepts rects at the minimum usable size', () => {
    const picked = pickChatColumn([
      { element: mockEl, rect: rect(MIN_CHAT_WIDTH, MIN_CHAT_HEIGHT) },
    ])
    expect(picked?.element).toBe(mockEl)
  })
})

describe('isUsableChatRect', () => {
  it('rejects zero-width theater collapse', () => {
    expect(isUsableChatRect(rect(0, 800))).toBe(false)
  })

  it('rejects short popout remnants', () => {
    expect(isUsableChatRect(rect(320, 80))).toBe(false)
  })
})

describe('isChatRectInViewport', () => {
  it('rejects a chat column pushed completely beyond the viewport', () => {
    expect(isChatRectInViewport({ left: 1_024, right: 1_364, top: 0, bottom: 900 }, 1_024, 900)).toBe(false)
  })

  it('accepts a partially clipped but still visible column', () => {
    expect(isChatRectInViewport({ left: 980, right: 1_320, top: 0, bottom: 900 }, 1_024, 900)).toBe(true)
  })
})

describe('normalizeOverlayPlacement', () => {
  it('accepts sidebar placement', () => {
    expect(normalizeOverlayPlacement('sidebar')).toBe('sidebar')
  })

  it('falls back for unknown values', () => {
    expect(normalizeOverlayPlacement('floating-left')).toBe('sidebar')
  })
})

describe('normalizeSidebarTab', () => {
  it('defaults to pulse', () => {
    expect(normalizeSidebarTab(undefined)).toBe('pulse')
  })

  it('persists chat tab', () => {
    expect(normalizeSidebarTab('chat')).toBe('chat')
  })
})

describe('message-area selectors', () => {
  it('lists chat scrollable selectors', () => {
    expect(CHAT_MESSAGES_SELECTORS.length).toBeGreaterThan(0)
    expect(CHAT_MESSAGES_SELECTORS.some(s => s.includes('chat-scrollable'))).toBe(true)
  })

  it('lists chat header selectors', () => {
    expect(CHAT_HEADER_SELECTORS.some(s => s.includes('chat-room-header'))).toBe(true)
  })

  it('derives messages area below header fallback', () => {
    const column = makeRect(0, 100, 320, 500)
    const area = computeMessagesAreaRect(column, FALLBACK_CHAT_HEADER_HEIGHT)
    expect(area.top).toBe(100 + FALLBACK_CHAT_HEADER_HEIGHT)
    expect(area.height).toBe(500 - FALLBACK_CHAT_HEADER_HEIGHT)
  })

  it('falls back to default header height when header is missing', () => {
    const doc = {
      querySelector: () => null,
    } as unknown as Document
    expect(resolveChatHeaderHeight(doc, { querySelector: () => null } as unknown as Element)).toBe(
      DEFAULT_CHAT_HEADER_HEIGHT,
    )
  })
})

describe('native chat handoff', () => {
  it('resolves and focuses the visible editable composer instead of its wrapper', () => {
    const dom = new JSDOM('<div data-a-target="chat-input"></div><div role="textbox" contenteditable="true"></div>')
    const wrapper = dom.window.document.querySelector('[data-a-target="chat-input"]') as HTMLElement
    const editor = dom.window.document.querySelector('[contenteditable="true"]') as HTMLElement
    Object.defineProperty(wrapper, 'getBoundingClientRect', { value: () => rect(320, 48) })
    Object.defineProperty(editor, 'getBoundingClientRect', { value: () => rect(320, 32) })

    expect(resolveNativeChatComposer(dom.window.document)).toBe(editor)
    expect(focusNativeChatComposer(dom.window.document)).toBe(true)
    expect(dom.window.document.activeElement).toBe(editor)
  })

  it('skips hidden editors so a route transition cannot steal focus', () => {
    const dom = new JSDOM('<div role="textbox" contenteditable="true" style="display:none"></div>')
    const editor = dom.window.document.querySelector('[contenteditable="true"]') as HTMLElement
    Object.defineProperty(editor, 'getBoundingClientRect', { value: () => rect(320, 32) })

    expect(resolveNativeChatComposer(dom.window.document)).toBeNull()
    expect(focusNativeChatComposer(dom.window.document)).toBe(false)
  })
})

describe('computeHeaderTabsRect', () => {
  const header = toChatRectSnapshot({ top: 120, left: 900, width: 340, height: 52 })

  it('insets between collapse and community controls', () => {
    const tabs = computeHeaderTabsRect(header, 908, 1210, 10)
    expect(tabs.left).toBe(912)
    expect(tabs.width).toBe(294)
    expect(tabs.top).toBe(120)
    expect(tabs.height).toBe(52)
  })

  it('uses fallback inset when edge controls are missing', () => {
    const tabs = computeHeaderTabsRect(header, null, null, 36)
    expect(tabs.left).toBe(936)
    expect(tabs.width).toBe(268)
  })
})

describe('clampPanelAboveChatChrome', () => {
  it('shortens panel above chat input row', () => {
    const panel = toChatRectSnapshot({ top: 200, left: 900, width: 340, height: 600 })
    const clamped = clampPanelAboveChatChrome(panel, 720, 800)
    expect(clamped?.bottom).toBe(718)
    expect(clamped?.height).toBe(518)
  })

  it('uses bottom reserve when input bound is unknown', () => {
    const panel = toChatRectSnapshot({ top: 200, left: 900, width: 340, height: 600 })
    const clamped = clampPanelAboveChatChrome(panel, null, 800)
    expect(clamped?.bottom).toBe(650)
  })
})

describe('computeHeaderTabInsets', () => {
  it('derives padding from tab slot inside header bar', () => {
    const header = toChatRectSnapshot({ top: 100, left: 900, width: 340, height: 52 })
    const headerTabs = toChatRectSnapshot({ top: 100, left: 940, width: 260, height: 52 })
    expect(computeHeaderTabInsets(header, headerTabs)).toEqual({ paddingLeft: 40, paddingRight: 40 })
  })
})

describe('resolveChatHeaderBarRect', () => {
  it('aligns to collapse and chatters controls instead of a lower header container', () => {
    const collapseRect = { top: 96, left: 900, width: 28, height: 30, bottom: 126, right: 928 }
    const viewersRect = { top: 98, left: 1200, width: 28, height: 28, bottom: 126, right: 1228 }
    const containerRect = { top: 128, left: 900, width: 340, height: 52, bottom: 180, right: 1240 }
    const doc = {
      querySelector: () => null,
      querySelectorAll: (selector: string) => {
        if (selector.includes('toggle-collapse')) {
          return [{ getBoundingClientRect: () => collapseRect }] as unknown as NodeListOf<Element>
        }
        if (selector.includes('chat-viewers')) {
          return [{ getBoundingClientRect: () => viewersRect }] as unknown as NodeListOf<Element>
        }
        if (selector.includes('chat-room-header"]') && !selector.includes(' h2')) {
          return [{ getBoundingClientRect: () => containerRect }] as unknown as NodeListOf<Element>
        }
        if (selector.includes('chat-room-header"] h2')) {
          return [{ getBoundingClientRect: () => ({ top: 101, left: 980, width: 120, height: 22, bottom: 123, right: 1100 }) }] as unknown as NodeListOf<Element>
        }
        return [] as unknown as NodeListOf<Element>
      },
    } as unknown as Document
    const column = toChatRectSnapshot({ top: 80, left: 900, width: 340, height: 720 })
    const bar = resolveChatHeaderBarRect(doc, column)
    expect(bar?.top).toBe(96)
    expect(bar?.height).toBeLessThanOrEqual(60)
    expect(bar?.left).toBe(900)
    expect(bar?.width).toBe(340)
  })
})

describe('resolveChatContentTop', () => {
  it('stays on the stable header bottom when a gift promo row is present', () => {
    const doc = {
      querySelector: () => null,
      querySelectorAll: (selector: string) => {
        if (selector.includes('gift-card-upsell')) {
          return [
            {
              getBoundingClientRect: () => ({
                top: 132,
                left: 900,
                width: 340,
                height: 48,
                bottom: 180,
                right: 1240,
              }),
            },
          ] as unknown as NodeListOf<Element>
        }
        return [] as unknown as NodeListOf<Element>
      },
    } as unknown as Document
    const column = toChatRectSnapshot({ top: 80, left: 900, width: 340, height: 720 })
    const top = resolveChatContentTop(doc, 132, column)
    expect(top).toBe(132)
  })

  it('keeps panel.top structural when a chat-notification element is inserted', () => {
    const before = resolveChatPanelRect(makeAnchoredChatDocument(null))
    const withNotification = resolveChatPanelRect(
      makeAnchoredChatDocument({ top: 160, height: 56 }),
    )
    expect(before).not.toBeNull()
    expect(withNotification).not.toBeNull()
    // Structural anchor only: header bottom (152) with no gift row present.
    expect(before?.top).toBe(152)
    expect(withNotification?.top).toBe(before?.top)
    expect(withNotification?.top).not.toBe(216)
  })

  it('keeps panel.top structural when the chat-notification element is removed again', () => {
    const inserted = resolveChatPanelRect(makeAnchoredChatDocument({ top: 160, height: 56 }))
    const afterRemoval = resolveChatPanelRect(makeAnchoredChatDocument(null))
    expect(inserted).not.toBeNull()
    expect(afterRemoval?.top).toBe(inserted?.top)
    expect(afterRemoval?.top).toBe(152)
  })

  it('pins left/width to the chat column while a notification is present', () => {
    const withNotification = resolveChatPanelRect(makeAnchoredChatDocument({ top: 160, height: 56 }))
    expect(withNotification).not.toBeNull()
    expect(withNotification?.left).toBe(900)
    expect(withNotification?.width).toBe(340)
  })

  it('keeps panel.bottom above the chat input clamp while a notification is present', () => {
    const withNotification = resolveChatPanelRect(makeAnchoredChatDocument({ top: 160, height: 56 }))
    expect(withNotification).not.toBeNull()
    expect(withNotification?.bottom).toBeLessThan(720)
    expect(withNotification?.bottom).toBe(718)
  })

  it('keeps the host top and height stable when a transient gift row is inserted or removed', () => {
    const before = resolveChatPanelRect(makeAnchoredChatDocument(null))
    const inserted = resolveChatPanelRect(
      makeAnchoredChatDocument(null, 152, { top: 152, height: 48 }),
    )
    const afterRemoval = resolveChatPanelRect(makeAnchoredChatDocument(null))
    expect(before).not.toBeNull()
    expect(inserted).not.toBeNull()
    expect(afterRemoval).not.toBeNull()
    expect(inserted?.top).toBe(before?.top)
    expect(inserted?.height).toBe(before?.height)
    expect(afterRemoval?.top).toBe(before?.top)
    expect(afterRemoval?.height).toBe(before?.height)
  })

  it('ignores live message-list churn when deriving panel.top', () => {
    const calm = resolveChatPanelRect(makeAnchoredChatDocument(null))
    const churned = resolveChatPanelRect(makeAnchoredChatDocument(null, 300))
    expect(calm).not.toBeNull()
    expect(churned).not.toBeNull()
    expect(churned?.top).toBe(calm?.top)
    expect(churned?.top).toBe(152)
  })
})

describe('chat geometry mutation filtering', () => {
  it('ignores ordinary message and transient banner churn but schedules stable changes', () => {
    const message = fakeMutationTarget({ messageList: true })
    const messageList = fakeMutationTarget({ messageList: true, messageListRoot: true })
    const chatColumn = fakeMutationTarget({ chatColumn: true })
    const banner = fakeMutationTarget({ transientBanner: true })

    expect(
      shouldScheduleChatGeometryFromMutations([
        { type: 'childList', target: message },
        { type: 'attributes', target: message },
      ]),
    ).toBe(false)
    expect(
      shouldScheduleChatGeometryFromMutations([{ type: 'attributes', target: messageList }]),
    ).toBe(true)
    expect(
      shouldScheduleChatGeometryFromMutations([{ type: 'childList', target: chatColumn }]),
    ).toBe(true)
    expect(
      shouldScheduleChatGeometryFromMutations([{
        type: 'childList',
        target: fakeMutationTarget(),
        addedNodes: [banner] as unknown as NodeListOf<Node>,
      }]),
    ).toBe(false)
  })
})

describe('Twitch sidebar chrome restoration', () => {
  it('removes Pulse message hiding so Chat mode restores native content', () => {
    const style = {
      id: '',
      textContent: '',
      remove: vi.fn(),
    }
    const fakeDocument = {
      createElement: vi.fn(() => style),
      getElementById: vi.fn(() => style),
      head: { appendChild: vi.fn() },
    } as unknown as Document
    const previousDocument = (globalThis as { document?: Document }).document
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: fakeDocument,
    })

    try {
      applyTwitchSidebarChromeHides(true, true)
      expect(style.textContent).toContain('.channel-root__right-column [role="log"]')
      expect(style.textContent).toContain('[data-a-target="chat-scrollable-area__scroll-button"]')

      applyTwitchSidebarChromeHides(true, false)
      expect(style.textContent).not.toContain('.channel-root__right-column [role="log"]')
      expect(style.textContent).not.toContain('[data-a-target="chat-scrollable-area__scroll-button"]')
      expect(style.textContent).not.toContain('scrollbar-width: none')

      applyTwitchSidebarChromeHides(false)
      expect(style.remove).toHaveBeenCalledTimes(1)
    } finally {
      if (previousDocument) {
        Object.defineProperty(globalThis, 'document', {
          configurable: true,
          value: previousDocument,
        })
      } else {
        Reflect.deleteProperty(globalThis, 'document')
      }
    }
  })
})

describe('createBoundedRemeasureScheduler', () => {
  function createSchedulerHarness() {
    let now = 0
    let nextId = 1
    const frames = new Map<number, () => void>()
    const timeouts = new Map<number, () => void>()
    let measures = 0

    const scheduler = createBoundedRemeasureScheduler(
      () => {
        measures += 1
      },
      {
        now: () => now,
        requestAnimationFrame: callback => {
          const id = nextId++
          frames.set(id, callback)
          return id
        },
        cancelAnimationFrame: id => {
          frames.delete(id)
        },
        setTimeout: callback => {
          const id = nextId++
          timeouts.set(id, callback)
          return id
        },
        clearTimeout: id => {
          timeouts.delete(id)
        },
      },
    )

    return {
      scheduler,
      measures: () => measures,
      frameCount: () => frames.size,
      timeoutCount: () => timeouts.size,
      runFrame(): void {
        const oldestId = frames.keys().next().value
        if (oldestId === undefined) return
        const callback = frames.get(oldestId)
        frames.delete(oldestId)
        now += 16
        callback?.()
      },
      runFinalTimeout(): void {
        const oldestId = timeouts.keys().next().value
        if (oldestId === undefined) return
        const callback = timeouts.get(oldestId)
        timeouts.delete(oldestId)
        now = Math.max(now, 650)
        callback?.()
      },
    }
  }

  it('measures each rAF for the bounded window then stops rescheduling and fires one final measurement', () => {
    const harness = createSchedulerHarness()
    harness.scheduler.schedule()
    expect(harness.timeoutCount()).toBe(1)

    while (harness.frameCount() > 0) harness.runFrame()

    // ~600ms window at 16ms/frame steps: many burst measurements, then stop.
    expect(harness.measures()).toBeGreaterThan(20)
    expect(harness.measures()).toBeLessThan(100)
    expect(harness.frameCount()).toBe(0)
    expect(harness.timeoutCount()).toBe(1)

    const burstMeasures = harness.measures()
    harness.runFinalTimeout()
    expect(harness.measures()).toBe(burstMeasures + 1)
    expect(harness.frameCount()).toBe(0)
    expect(harness.timeoutCount()).toBe(0)
  })

  it('still performs exactly one final measurement when animation frames never run', () => {
    const harness = createSchedulerHarness()
    harness.scheduler.schedule()
    harness.runFinalTimeout()
    expect(harness.measures()).toBe(1)
    expect(harness.frameCount()).toBe(0)
    expect(harness.timeoutCount()).toBe(0)
  })

  it('does not extend the burst when re-triggered mid-window and dispose cancels everything', () => {
    const harness = createSchedulerHarness()
    harness.scheduler.schedule()
    harness.runFrame()
    harness.scheduler.schedule()
    expect(harness.frameCount()).toBe(1)
    expect(harness.timeoutCount()).toBe(1)

    harness.scheduler.dispose()
    expect(harness.frameCount()).toBe(0)
    expect(harness.timeoutCount()).toBe(0)

    const measuresAfterDispose = harness.measures()
    harness.runFinalTimeout()
    harness.scheduler.schedule()
    expect(harness.measures()).toBe(measuresAfterDispose)
  })
})

describe('buildSidebarBodyRect', () => {
  it('uses the clamped messages panel rect', () => {
    const layout: SidebarSnapLayout = {
      column: toChatRectSnapshot({ top: 80, left: 900, width: 340, height: 720 }),
      header: toChatRectSnapshot({ top: 80, left: 900, width: 340, height: 52 }),
      headerTabs: toChatRectSnapshot({ top: 80, left: 940, width: 260, height: 52 }),
      panel: toChatRectSnapshot({ top: 180, left: 900, width: 340, height: 500 }),
    }
    const body = buildSidebarBodyRect(layout)
    expect(body).toEqual(layout.panel)
  })
})
