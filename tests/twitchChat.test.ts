import { describe, expect, it } from 'vitest'
import {
  CHAT_HEADER_SELECTORS,
  CHAT_MESSAGES_SELECTORS,
  buildSidebarBodyRect,
  clampPanelAboveChatChrome,
  computeHeaderTabInsets,
  computeHeaderTabsRect,
  DEFAULT_CHAT_HEADER_HEIGHT,
  isChatRectOnscreen,
  isUsableChatRect,
  matchesChatMessageListAncestry,
  MIN_CHAT_HEIGHT,
  MIN_CHAT_WIDTH,
  PERIODIC_REMEASURE_MS,
  pickChatColumn,
  resolveChatContentTop,
  resolveChatHeaderBarRect,
  resolveChatHeaderHeight,
  shouldRerenderOverlayForSnapChange,
  sidebarSnapResizeObservationTargets,
  SNAP_DEBOUNCE_MS,
  snapLayoutChangedSignificantly,
  toChatRectSnapshot,
  type SidebarSnapLayout,
} from '../src/content/twitchChat.ts'
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

describe('isChatRectOnscreen', () => {
  it('rejects a full chat column parked beyond the right viewport edge', () => {
    const parked = {
      top: 142,
      left: 1280.8,
      right: 1620.8,
      bottom: 652,
    } as DOMRect
    expect(isChatRectOnscreen(parked, { width: 1280, height: 800 })).toBe(false)
  })

  it('accepts a right-docked column contained by the viewport', () => {
    const docked = { top: 56, left: 940, right: 1280, bottom: 800 } as DOMRect
    expect(isChatRectOnscreen(docked, { width: 1280, height: 800 })).toBe(true)
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
  it('starts below a durable bits / gift-progress row when present', () => {
    const doc = {
      querySelector: () => null,
      querySelectorAll: (selector: string) => {
        if (selector.includes('top-n-bitties-area') || selector.includes('bits-card')) {
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
    expect(top).toBe(180)
  })

  it('ignores hero cards, hype train, and drop banners under the bits row', () => {
    const doc = {
      querySelector: () => null,
      querySelectorAll: (selector: string) => {
        if (selector.includes('top-n-bitties-area') || selector.includes('bits-card')) {
          return [
            {
              getBoundingClientRect: () => ({
                top: 132,
                left: 900,
                width: 340,
                height: 40,
                bottom: 172,
                right: 1240,
              }),
            },
          ] as unknown as NodeListOf<Element>
        }
        if (
          selector.includes('chat-room-hero-card')
          || selector.includes('community-highlight')
          || selector.includes('hype-train')
          || selector.includes('chat-notification')
        ) {
          return [
            {
              getBoundingClientRect: () => ({
                top: 172,
                left: 900,
                width: 340,
                height: 120,
                bottom: 292,
                right: 1240,
              }),
            },
          ] as unknown as NodeListOf<Element>
        }
        return [] as unknown as NodeListOf<Element>
      },
    } as unknown as Document
    const column = toChatRectSnapshot({ top: 80, left: 900, width: 340, height: 720 })
    expect(resolveChatContentTop(doc, 132, column)).toBe(172)
    expect(resolveChatContentTop(doc, 132, column, { includeEphemeralNotices: true })).toBe(292)
  })

  it('does not follow the message-list top when notices push chat down', () => {
    const doc = {
      querySelector: () => null,
      querySelectorAll: (selector: string) => {
        if (selector.includes('chat-scrollable-area') || selector.includes('message-container')) {
          return [
            {
              getBoundingClientRect: () => ({
                top: 240,
                left: 900,
                width: 340,
                height: 400,
                bottom: 640,
                right: 1240,
              }),
            },
          ] as unknown as NodeListOf<Element>
        }
        return [] as unknown as NodeListOf<Element>
      },
    } as unknown as Document
    const column = toChatRectSnapshot({ top: 80, left: 900, width: 340, height: 720 })
    expect(resolveChatContentTop(doc, 132, column)).toBe(132)
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

function snapLayout(overrides?: {
  column?: { top: number; left: number; width: number; height: number }
  panel?: { top: number; left: number; width: number; height: number }
}): SidebarSnapLayout {
  const column = toChatRectSnapshot(overrides?.column ?? { top: 80, left: 900, width: 340, height: 720 })
  const panel = toChatRectSnapshot(overrides?.panel ?? { top: 180, left: 900, width: 340, height: 500 })
  return {
    column,
    header: toChatRectSnapshot({ top: 80, left: 900, width: 340, height: 52 }),
    headerTabs: toChatRectSnapshot({ top: 80, left: 940, width: 260, height: 52 }),
    panel,
  }
}

describe('snapLayoutChangedSignificantly', () => {
  it('ignores sub-threshold jitter', () => {
    const prev = snapLayout()
    const next = snapLayout({
      panel: { top: 181, left: 900, width: 340, height: 499 },
    })
    expect(snapLayoutChangedSignificantly(prev, next, 2)).toBe(false)
  })

  it('detects panel moves above the threshold', () => {
    const prev = snapLayout()
    const next = snapLayout({
      panel: { top: 190, left: 900, width: 340, height: 490 },
    })
    expect(snapLayoutChangedSignificantly(prev, next, 2)).toBe(true)
  })

  it('treats null ↔ layout as significant', () => {
    expect(snapLayoutChangedSignificantly(null, snapLayout())).toBe(true)
    expect(snapLayoutChangedSignificantly(snapLayout(), null)).toBe(true)
    expect(snapLayoutChangedSignificantly(null, null)).toBe(false)
  })
})

describe('shouldRerenderOverlayForSnapChange', () => {
  it('rerenders when snap presence flips', () => {
    expect(shouldRerenderOverlayForSnapChange(null, snapLayout())).toBe(true)
    expect(shouldRerenderOverlayForSnapChange(snapLayout(), null)).toBe(true)
  })

  it('rerenders when panel width changes', () => {
    const prev = snapLayout({ panel: { top: 180, left: 900, width: 340, height: 500 } })
    const next = snapLayout({ panel: { top: 180, left: 900, width: 360, height: 500 } })
    expect(shouldRerenderOverlayForSnapChange(prev, next)).toBe(true)
  })

  it('skips React rerender for geometry-only ticks', () => {
    const prev = snapLayout({ panel: { top: 180, left: 900, width: 340, height: 500 } })
    const next = snapLayout({ panel: { top: 200, left: 900, width: 340, height: 480 } })
    expect(shouldRerenderOverlayForSnapChange(prev, next)).toBe(false)
  })
})

describe('matchesChatMessageListAncestry', () => {
  it('matches chat scrollable selectors', () => {
    expect(
      matchesChatMessageListAncestry(sel =>
        sel.includes('chat-scrollable-area') ? {} : null,
      ),
    ).toBe(true)
  })

  it('rejects unrelated ancestry', () => {
    expect(matchesChatMessageListAncestry(() => null)).toBe(false)
  })
})

describe('snap timing constants', () => {
  it('keeps debounce and periodic remasure in the performance band', () => {
    expect(SNAP_DEBOUNCE_MS).toBeGreaterThanOrEqual(50)
    expect(SNAP_DEBOUNCE_MS).toBeLessThanOrEqual(120)
    expect(PERIODIC_REMEASURE_MS).toBeGreaterThanOrEqual(2000)
  })
})

describe('sidebarSnapResizeObservationTargets', () => {
  it('returns empty when the chat column is missing', () => {
    expect(sidebarSnapResizeObservationTargets(null)).toEqual([])
  })

  it('includes the chat column, parent, and grandparent for Stream Display Ad reflows', () => {
    const grandparent = { parentElement: null } as unknown as Element
    const parent = { parentElement: grandparent } as unknown as Element
    const column = { parentElement: parent } as unknown as Element
    expect(sidebarSnapResizeObservationTargets(column)).toEqual([column, parent, grandparent])
  })
})
