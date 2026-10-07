import { afterEach, describe, expect, it, vi } from 'vitest'
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
  scheduleNativeChatFocusHandoff,
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
  CHAT_MOVE_CHECK_MS,
  measureSidebarSnapLayout,
  observeChatSnapLayout,
  overlapsChatColumn,
  resolveChatBottomBound,
  resolveChatScope,
  SNAP_LAYOUT_HOLD_MS,
  type SidebarSnapLayout,
} from '../src/content/twitchChat.ts'
import { overlayBaseStyles } from '../src/ui/overlayStyles.ts'
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

  function makeFocusTimerHarness() {
    let now = 0
    let nextId = 1
    const timers = new Map<number, { callback: () => void; delayMs: number }>()

    return {
      now: () => now,
      setTimeout(callback: () => void, delayMs: number): number {
        const id = nextId++
        timers.set(id, { callback, delayMs })
        return id
      },
      clearTimeout(handle: unknown): void {
        timers.delete(handle as number)
      },
      runNext(): void {
        const [id, timer] = timers.entries().next().value ?? []
        if (id === undefined || !timer) return
        timers.delete(id as number)
        now += (timer as { delayMs: number }).delayMs
        ;(timer as { callback: () => void }).callback()
      },
      pending(): number {
        return timers.size
      },
      advance(ms: number): void {
        now += ms
      },
    }
  }

  it('retries until Twitch remounts the composer, then stops after success', () => {
    const dom = new JSDOM('<body></body>')
    const timers = makeFocusTimerHarness()
    const handoff = scheduleNativeChatFocusHandoff({
      doc: dom.window.document,
      now: timers.now,
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
      retryIntervalMs: 25,
      timeoutMs: 100,
    })

    timers.runNext()
    expect(handoff.active).toBe(true)
    expect(timers.pending()).toBe(1)

    const editor = dom.window.document.createElement('div')
    editor.setAttribute('role', 'textbox')
    editor.setAttribute('contenteditable', 'true')
    Object.defineProperty(editor, 'getBoundingClientRect', { value: () => rect(320, 32) })
    dom.window.document.body.appendChild(editor)

    timers.runNext()
    expect(dom.window.document.activeElement).toBe(editor)
    expect(handoff.active).toBe(false)
    expect(timers.pending()).toBe(0)
  })

  it('times out and does not focus an editor that appears after the retry window', () => {
    const dom = new JSDOM('<body></body>')
    const timers = makeFocusTimerHarness()
    const handoff = scheduleNativeChatFocusHandoff({
      doc: dom.window.document,
      now: timers.now,
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
      retryIntervalMs: 25,
      timeoutMs: 75,
    })

    while (timers.pending() > 0) timers.runNext()

    expect(handoff.active).toBe(false)
    expect(timers.pending()).toBe(0)
    const editor = dom.window.document.createElement('div')
    editor.setAttribute('role', 'textbox')
    editor.setAttribute('contenteditable', 'true')
    Object.defineProperty(editor, 'getBoundingClientRect', { value: () => rect(320, 32) })
    dom.window.document.body.appendChild(editor)
    expect(dom.window.document.activeElement).not.toBe(editor)
  })

  it('cancels on user intent so a later remount cannot steal focus', () => {
    const dom = new JSDOM('<body><button>Elsewhere</button></body>')
    const timers = makeFocusTimerHarness()
    const handoff = scheduleNativeChatFocusHandoff({
      doc: dom.window.document,
      now: timers.now,
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
      retryIntervalMs: 25,
      timeoutMs: 100,
    })

    dom.window.document.querySelector('button')?.dispatchEvent(
      new dom.window.MouseEvent('pointerdown', { bubbles: true }),
    )
    expect(handoff.active).toBe(false)
    expect(timers.pending()).toBe(0)

    const editor = dom.window.document.createElement('div')
    editor.setAttribute('role', 'textbox')
    editor.setAttribute('contenteditable', 'true')
    Object.defineProperty(editor, 'getBoundingClientRect', { value: () => rect(320, 32) })
    dom.window.document.body.appendChild(editor)
    expect(dom.window.document.activeElement).not.toBe(editor)
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

/**
 * A JSDOM Twitch-like page whose element rects are set per element. The chat
 * stack is `.channel-root__right-column`; the header row sits above the
 * chat-room section, as on Twitch, and the composer sits inside it.
 */
function makeStackedChatPage(options: { stack?: boolean } = {}) {
  const stack = options.stack ?? true
  const dom = new JSDOM(`
    <nav class="side-nav"><button aria-label="Collapse Side Nav" data-test="side-nav-collapse"></button></nav>
    <div class="whispers"><div role="textbox" contenteditable="true" data-test="whisper"></div></div>
    <div class="${stack ? 'channel-root__right-column' : 'outer'}" data-test="stack">
      <div class="stream-chat-header" data-test="header">
        <button data-a-target="right-column__toggle-collapse-btn" aria-label="Collapse Chat" data-test="collapse"></button>
        <h2 data-a-target="chat-room-header-line" data-test="title">Stream chat</h2>
        <button data-a-target="chat-viewers" aria-label="Users in chat" data-test="viewers"></button>
      </div>
      <section data-test-selector="chat-room-component-layout" data-test="column">
        <div data-test-selector="chat-scrollable-area" data-test="messages"></div>
        <div data-a-target="chat-input" role="textbox" contenteditable="true" data-test="composer"></div>
      </section>
    </div>`, { url: 'https://www.twitch.tv/fixturechan' })
  const doc = dom.window.document
  const byTest = (name: string) => doc.querySelector(`[data-test="${name}"]`) as HTMLElement
  const rects = new Map<Element, DOMRect>()
  const place = (name: string, box: { top: number; left: number; width: number; height: number } | null) => {
    if (box) rects.set(byTest(name), positionedRect(box))
    else rects.delete(byTest(name))
  }
  Object.defineProperty(dom.window.Element.prototype, 'getBoundingClientRect', {
    configurable: true,
    value(this: Element) {
      // Like a browser: a detached element measures as an empty rect.
      return (this.isConnected && rects.get(this)) || positionedRect({ top: 0, left: 0, width: 0, height: 0 })
    },
  })
  // 1024 x 768 viewport (JSDOM default); the chat stack is on the right.
  place('stack', { top: 50, left: 680, width: 340, height: 718 })
  place('header', { top: 50, left: 680, width: 340, height: 50 })
  place('collapse', { top: 60, left: 690, width: 30, height: 30 })
  place('title', { top: 64, left: 760, width: 120, height: 22 })
  place('viewers', { top: 60, left: 980, width: 30, height: 30 })
  place('column', { top: 100, left: 680, width: 340, height: 668 })
  place('messages', { top: 100, left: 680, width: 340, height: 560 })
  place('composer', { top: 690, left: 690, width: 320, height: 40 })
  // Stray controls elsewhere on the page.
  place('side-nav-collapse', { top: 54, left: 8, width: 30, height: 30 })
  place('whisper', { top: 600, left: 700, width: 300, height: 36 })
  return { dom, doc, byTest, place }
}

type StackedChatPage = ReturnType<typeof makeStackedChatPage>

describe('chat stack scoping', () => {
  it('reads header controls and the composer only inside the chat stack', () => {
    const page = makeStackedChatPage()
    const column = page.byTest('column')
    expect(resolveChatScope(page.doc, column)).toBe(page.byTest('stack'))
    // The strays really match the selectors, so this is not passing by accident.
    expect(Array.from(page.doc.querySelectorAll('button[aria-label*="Collapse" i]')))
      .toContain(page.byTest('side-nav-collapse'))
    expect(Array.from(page.doc.querySelectorAll('[contenteditable="true"][role="textbox"]')))
      .toContain(page.byTest('whisper'))

    const layout = measureSidebarSnapLayout(page.doc)
    expect(layout).not.toBeNull()
    // Header row = collapse/title/viewers (60..90), not pulled up to the side-nav toggle at 54.
    expect(layout!.header.top).toBe(60)
    expect(layout!.panel.top).toBe(90)
    // Bottom = chat composer (690) - 2, not the whisper composer at 600 docked over the column.
    expect(layout!.panel.bottom).toBe(688)
    expect(resolveChatBottomBound(page.doc)).toBe(690)
    // Tab slot sits between the stack's own collapse and viewers controls.
    expect(layout!.headerTabs.left).toBe(724)
  })

  it('without a chat stack keeps the document-wide read but ignores controls off the column', () => {
    const page = makeStackedChatPage({ stack: false })
    expect(resolveChatScope(page.doc, page.byTest('column'))).toBe(page.doc)
    const layout = measureSidebarSnapLayout(page.doc)
    // The side-nav toggle (x 8..38) does not overlap the column (x 680..1020).
    expect(layout!.header.top).toBe(60)
  })

  it('accepts only rects that overlap the column by more than the 8 px slack', () => {
    const column = { left: 680, right: 1020 }
    expect(overlapsChatColumn({ left: 8, right: 38 }, column)).toBe(false)
    expect(overlapsChatColumn({ left: 600, right: 687 }, column)).toBe(false)
    expect(overlapsChatColumn({ left: 600, right: 688 }, column)).toBe(true)
    expect(overlapsChatColumn({ left: 1012, right: 1100 }, column)).toBe(true)
    expect(overlapsChatColumn({ left: 1013, right: 1100 }, column)).toBe(false)
  })
})

describe('panel bottom while the composer is missing', () => {
  it('uses the page reserve and records the route and whether a composer placed it', () => {
    const page = makeStackedChatPage()
    const placed = measureSidebarSnapLayout(page.doc)!
    expect(placed).toMatchObject({ path: '/fixturechan', composer: true })
    expect(placed.panel.bottom).toBe(688)

    page.place('composer', null)
    // The 150 px reserve (column bottom 768 - 150).
    expect(measureSidebarSnapLayout(page.doc)).toMatchObject({ composer: false, panel: { bottom: 618 } })

    // A VOD's chat replay has no composer: its own 48 px reserve.
    page.dom.window.history.pushState(null, '', '/fixturechan/videos/1234567890')
    expect(measureSidebarSnapLayout(page.doc)).toMatchObject({
      path: '/fixturechan/videos/1234567890',
      composer: false,
      panel: { bottom: 720 },
    })
  })
})

describe('observeChatSnapLayout', () => {
  function installObserverGlobals(page: StackedChatPage) {
    let clock = 10_000
    let nextId = 1
    const intervals = new Map<number, () => void>()
    const timeouts = new Map<number, () => void>()
    const frames = new Map<number, () => void>()
    const listeners: string[] = []
    const fakeWindow = {
      setInterval: (fn: () => void) => { intervals.set(nextId, fn); return nextId++ },
      clearInterval: (id: number) => { intervals.delete(id) },
      setTimeout: (fn: () => void) => { timeouts.set(nextId, fn); return nextId++ },
      clearTimeout: (id: number) => { timeouts.delete(id) },
      requestAnimationFrame: (fn: () => void) => { frames.set(nextId, fn); return nextId++ },
      cancelAnimationFrame: (id: number) => { frames.delete(id) },
      addEventListener: (type: string) => { listeners.push(type) },
      removeEventListener: () => {},
    }
    vi.stubGlobal('window', fakeWindow)
    vi.stubGlobal('document', page.doc)
    vi.stubGlobal('MutationObserver', page.dom.window.MutationObserver)
    vi.spyOn(Date, 'now').mockImplementation(() => clock)
    return {
      listeners,
      /** One 250 ms tick of the move check / periodic measure. */
      tick() {
        clock += CHAT_MOVE_CHECK_MS
        for (const fn of [...intervals.values()]) fn()
      },
      /** Run a scheduled remeasure burst to its final measurement. */
      flushBurst() {
        frames.clear()
        clock += 700
        const pending = [...timeouts.values()]
        timeouts.clear()
        for (const fn of pending) fn()
      },
      pendingBursts: () => timeouts.size,
      intervalCount: () => intervals.size,
    }
  }

  function observe(initial: SidebarSnapLayout | null = null) {
    const seen: Array<SidebarSnapLayout | null> = []
    const stop = observeChatSnapLayout(layout => seen.push(layout), initial)
    return { seen, stop }
  }

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('holds the last layout through a brief chat remount instead of hiding the panel', () => {
    const page = makeStackedChatPage()
    const env = installObserverGlobals(page)
    const { seen, stop } = observe()
    expect(seen).toHaveLength(1)
    expect(seen[0]?.panel.bottom).toBe(688)

    // Twitch remounts the whole right column: no chat column on the page for a moment.
    const stack = page.byTest('stack')
    stack.remove()
    // The tick sees the detached column and starts a burst; its measure finds no column.
    env.tick()
    expect(env.pendingBursts()).toBe(1)
    env.flushBurst()
    expect(seen).toHaveLength(1)

    // It comes back inside the hold with the same geometry: no null, no blink.
    page.doc.body.append(stack)
    env.tick()
    expect(seen).toHaveLength(1)
    // And the hold is over: a later remount starts a fresh one.
    env.tick()
    env.tick()
    expect(seen).toHaveLength(1)
    stop()
  })

  it('keeps the panel in place when only the chat-room section remounts', () => {
    const page = makeStackedChatPage()
    const env = installObserverGlobals(page)
    const { seen, stop } = observe()
    const before = seen[0]!.panel

    // The section (and its composer) goes; the right column stays and stands in as the column.
    page.byTest('column').remove()
    env.tick()
    env.flushBurst()
    expect(seen.at(-1)).not.toBeNull()
    expect(seen.at(-1)!.panel).toEqual(before)
    stop()
  })

  it('drops the layout once the hold runs out', () => {
    const page = makeStackedChatPage()
    const env = installObserverGlobals(page)
    const { seen, stop } = observe()
    page.byTest('stack').remove()
    env.tick()
    env.flushBurst()
    expect(seen).toHaveLength(1)
    // Ticks keep measuring while the hold runs, then the null goes out.
    for (let elapsed = CHAT_MOVE_CHECK_MS; elapsed <= SNAP_LAYOUT_HOLD_MS; elapsed += CHAT_MOVE_CHECK_MS) env.tick()
    expect(seen).toHaveLength(2)
    expect(seen[1]).toBeNull()
    stop()
  })

  it('drops at once when the column is still on the page but collapsed', () => {
    const page = makeStackedChatPage()
    const env = installObserverGlobals(page)
    const { seen, stop } = observe()
    page.place('stack', { top: 50, left: 1010, width: 10, height: 718 })
    page.place('column', { top: 100, left: 1010, width: 10, height: 668 })
    // The next full measure (every 2 s) sees a collapsed column and drops it without a hold.
    for (let i = 0; i < 8; i += 1) env.tick()
    expect(seen).toHaveLength(2)
    expect(seen[1]).toBeNull()
    stop()
  })

  it('installs no scroll listener and catches a move without a resize on the next tick', () => {
    const page = makeStackedChatPage()
    const env = installObserverGlobals(page)
    const { seen, stop } = observe()
    expect(env.listeners).not.toContain('scroll')
    expect(env.listeners).toContain('resize')

    // An ancestor transform shifts the whole chat stack 24 px down; nothing resizes.
    for (const name of ['stack', 'header', 'collapse', 'title', 'viewers', 'column', 'messages', 'composer']) {
      const rect = page.byTest(name).getBoundingClientRect()
      page.place(name, { top: rect.top + 24, left: rect.left, width: rect.width, height: rect.height })
    }
    expect(seen).toHaveLength(1)
    env.tick()
    expect(env.pendingBursts()).toBe(1)
    env.flushBurst()
    expect(seen).toHaveLength(2)
    expect(seen[1]?.header.top).toBe(84)
    expect(seen[1]?.panel.bottom).toBe(712)

    stop()
    expect(env.intervalCount()).toBe(0)
  })

  it('starts from a seeded layout without re-emitting it, and holds it through a remount', () => {
    const page = makeStackedChatPage()
    const placed = measureSidebarSnapLayout(page.doc)!
    const env = installObserverGlobals(page)

    const restarted = observe(placed)
    expect(restarted.seen).toHaveLength(0)
    restarted.stop()

    page.byTest('stack').remove()
    const { seen, stop } = observe(placed)
    expect(seen).toHaveLength(0)
    env.tick()
    expect(seen).toHaveLength(0)
    stop()
  })

  it('holds the panel bottom through a brief composer gap on the same page', () => {
    const page = makeStackedChatPage()
    const env = installObserverGlobals(page)
    const { seen, stop } = observe()
    expect(seen[0]).toMatchObject({ composer: true, panel: { bottom: 688 } })

    // A reply bar swap: no composer for a moment. The next full measure (every 2 s) starts a hold.
    page.place('composer', null)
    for (let i = 0; i < 8; i += 1) env.tick()
    expect(seen).toHaveLength(1)
    // It comes back inside the hold: the panel never dropped to the 150 px reserve.
    page.place('composer', { top: 690, left: 690, width: 320, height: 40 })
    for (let i = 0; i < 9; i += 1) env.tick()
    expect(seen).toHaveLength(1)
    stop()
  })

  it('gives the panel the reserve once the composer stays missing past the hold', () => {
    const page = makeStackedChatPage()
    const env = installObserverGlobals(page)
    const { seen, stop } = observe()
    page.place('composer', null)
    for (let i = 0; i < 8; i += 1) env.tick()
    expect(seen).toHaveLength(1)
    // Ticks keep measuring while the hold runs, then the 150 px reserve goes out.
    for (let elapsed = CHAT_MOVE_CHECK_MS; elapsed <= SNAP_LAYOUT_HOLD_MS; elapsed += CHAT_MOVE_CHECK_MS) env.tick()
    expect(seen).toHaveLength(2)
    expect(seen[1]).toMatchObject({ composer: false, panel: { bottom: 618 } })
    // While it stays missing, no new hold starts and nothing moves.
    for (let i = 0; i < 16; i += 1) env.tick()
    expect(seen).toHaveLength(2)
    stop()
  })

  it('never carries a live composer inset onto a VOD chat replay', () => {
    const page = makeStackedChatPage()
    // A live channel: the panel ends at the composer, 80 px above the column bottom.
    const live = measureSidebarSnapLayout(page.doc)!
    expect(live.panel.bottom).toBe(688)
    const env = installObserverGlobals(page)

    // Open one of its VODs. The observer restarts from the placed live layout,
    // and the VOD's chat replay has no composer: its 48 px reserve at once.
    page.dom.window.history.pushState(null, '', '/fixturechan/videos/1234567890')
    page.place('composer', null)
    const { seen, stop } = observe(live)
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ composer: false, panel: { bottom: 720 } })
    // Re-measured from its own layout, it stays on the reserve.
    for (let i = 0; i < 16; i += 1) env.tick()
    expect(seen).toHaveLength(1)
    stop()
  })

  it('gives a channel reached without a composer its own reserve at once', () => {
    const page = makeStackedChatPage()
    const env = installObserverGlobals(page)
    const { seen, stop } = observe()
    // Raid or click through to a channel whose chat has no composer (logged out, subscriber-only).
    page.dom.window.history.pushState(null, '', '/otherchan')
    page.place('composer', null)
    for (let i = 0; i < 8; i += 1) env.tick()
    expect(seen).toHaveLength(2)
    expect(seen[1]).toMatchObject({ path: '/otherchan', composer: false, panel: { bottom: 618 } })
    stop()
  })

  it.each(['/directory', '/fixturechan/videos'])('drops at once when the route leaves chat (%s)', path => {
    const page = makeStackedChatPage()
    const env = installObserverGlobals(page)
    const { seen, stop } = observe()
    // Twitch unmounts the right column on the new page.
    page.dom.window.history.pushState(null, '', path)
    page.byTest('stack').remove()
    env.tick()
    env.flushBurst()
    expect(seen).toHaveLength(2)
    expect(seen[1]).toBeNull()
    stop()
  })

  it.each(['/otherchan', '/videos/1234567890'])('still holds a remount on the way to another page with chat (%s)', path => {
    const page = makeStackedChatPage()
    const env = installObserverGlobals(page)
    const { seen, stop } = observe()
    page.dom.window.history.pushState(null, '', path)
    const stack = page.byTest('stack')
    stack.remove()
    env.tick()
    env.flushBurst()
    expect(seen).toHaveLength(1)
    page.doc.body.append(stack)
    env.tick()
    expect(seen).toHaveLength(1)
    stop()
  })

  it('drops a seeded layout at once when a restart lands on a page without chat', () => {
    const page = makeStackedChatPage()
    const placed = measureSidebarSnapLayout(page.doc)!
    installObserverGlobals(page)
    page.dom.window.history.pushState(null, '', '/directory')
    page.byTest('stack').remove()
    const { seen, stop } = observe(placed)
    expect(seen).toEqual([null])
    stop()
  })
})

describe('sidebar panel entrance animation', () => {
  it('never runs on the sidebar panel shell, even before shadow.css loads', () => {
    const dom = new JSDOM(`<style>${overlayBaseStyles}</style><section class="pulse-shell placement-sidebar pulse-sidebar-panel"></section><section class="pulse-shell placement-right"></section>`)
    const [sidebar, floating] = Array.from(dom.window.document.querySelectorAll('section'))
    expect(dom.window.getComputedStyle(sidebar).animationName).toBe('none')
    expect(dom.window.getComputedStyle(floating).animationName).toBe('pulse-in-right')
  })
})
