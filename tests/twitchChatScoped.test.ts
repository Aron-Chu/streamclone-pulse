import { describe, expect, it } from 'vitest'
import {
  collectHeaderAnchorRects,
  intersectsHorizontally,
  SNAP_LAYOUT_ATTRIBUTE_FILTER,
  SNAP_LAYOUT_HOLD_MS,
  stabilizeSidebarSnapLayout,
} from '../src/content/twitchChat.ts'
import {
  HIDE_RULES,
  MESSAGES_HIDE_RULES,
  PULSE_CHAT_COLUMN_ATTR,
} from '../src/content/twitchSidebarChrome.ts'

describe('sidebar chrome scoping', () => {
  it('scopes hide rules under the pulse chat-column marker', () => {
    expect(HIDE_RULES).toContain(`[${PULSE_CHAT_COLUMN_ATTR}="1"]`)
    expect(HIDE_RULES).not.toMatch(/(?:^|\n)\s*\[data-a-target="chat-viewers"\]/)
  })

  it('never hides Twitch native message list selectors', () => {
    expect(MESSAGES_HIDE_RULES).toBe('')
    expect(HIDE_RULES).not.toContain('chat-scrollable-area')
    expect(HIDE_RULES).not.toContain('[role="log"]')
    expect(HIDE_RULES).not.toContain('chat-scrollable-area__message-container')
  })
})

describe('intersectsHorizontally', () => {
  it('accepts overlapping columns and rejects distant decoys', () => {
    expect(
      intersectsHorizontally(
        { left: 900, right: 1240, width: 340, height: 700 },
        { left: 910, right: 1230, width: 320, height: 40 },
      ),
    ).toBe(true)
    expect(
      intersectsHorizontally(
        { left: 900, right: 1240, width: 340, height: 700 },
        { left: 40, right: 200, width: 160, height: 40 },
      ),
    ).toBe(false)
  })
})

describe('stabilizeSidebarSnapLayout', () => {
  const sample = {
    column: { top: 50, left: 900, width: 340, height: 700, right: 1240, bottom: 750 },
    header: { top: 50, left: 900, width: 340, height: 40, right: 1240, bottom: 90 },
    headerTabs: { top: 50, left: 900, width: 340, height: 40, right: 1240, bottom: 90 },
    panel: { top: 90, left: 900, width: 340, height: 500, right: 1240, bottom: 590 },
  }

  it('keeps the last valid layout during a short replacement window', () => {
    expect(
      stabilizeSidebarSnapLayout(null, {
        lastValid: sample,
        lastValidAt: 1000,
        now: 1000 + SNAP_LAYOUT_HOLD_MS - 1,
        holdMs: SNAP_LAYOUT_HOLD_MS,
      }),
    ).toBe(sample)
  })

  it('clears after the hold expires so genuine chat closure hides Pulse', () => {
    expect(
      stabilizeSidebarSnapLayout(null, {
        lastValid: sample,
        lastValidAt: 1000,
        now: 1000 + SNAP_LAYOUT_HOLD_MS + 1,
        holdMs: SNAP_LAYOUT_HOLD_MS,
      }),
    ).toBeNull()
  })
})

describe('header anchor ownership', () => {
  it('ignores matching player/ad controls outside the chat column', () => {
    const chatViewers = {
      getBoundingClientRect: () => ({
        top: 56,
        left: 920,
        width: 28,
        height: 28,
        bottom: 84,
        right: 948,
      }),
    }
    const playerDecoy = {
      getBoundingClientRect: () => ({
        top: 56,
        left: 40,
        width: 28,
        height: 28,
        bottom: 84,
        right: 68,
      }),
    }
    const columnEl = {
      contains: (el: unknown) => el === chatViewers,
      querySelectorAll: (selector: string) => {
        if (selector.includes('chat-viewers') || selector.includes('chatters')) {
          return [chatViewers] as unknown as NodeListOf<Element>
        }
        return [] as unknown as NodeListOf<Element>
      },
    }
    const doc = {
      querySelectorAll: () => [playerDecoy, chatViewers] as unknown as NodeListOf<Element>,
    } as unknown as Document

    const anchors = collectHeaderAnchorRects(doc, {
      element: columnEl as unknown as Element,
      rect: {
        top: 50,
        left: 900,
        width: 340,
        height: 700,
        bottom: 750,
        right: 1240,
        x: 900,
        y: 50,
        toJSON: () => ({}),
      } as DOMRect,
    })

    expect(anchors).toHaveLength(1)
    expect(anchors[0]?.left).toBe(920)
  })
})

describe('snap layout attribute observation', () => {
  it('watches class/style/hidden toggles used by ad-preview chrome', () => {
    expect(SNAP_LAYOUT_ATTRIBUTE_FILTER).toEqual(['class', 'style', 'hidden', 'aria-hidden'])
  })
})
