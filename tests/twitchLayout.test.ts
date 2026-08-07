import { describe, expect, it } from 'vitest'
import {
  CHROME_BAR_HEIGHT,
  deriveChromeBarRect,
  deriveMessagesAreaFromColumn,
  makeRect,
  planSidebarHostRects,
} from '../src/content/twitchLayout.ts'
import { DEFAULT_CHAT_HEADER_HEIGHT } from '../src/content/twitchChat.ts'

function column(top = 100, left = 1200, width = 340, height = 800) {
  return { top, left, width, height }
}

describe('deriveMessagesAreaFromColumn', () => {
  it('subtracts header height from chat column', () => {
    const chat = column()
    const messages = deriveMessagesAreaFromColumn(chat, DEFAULT_CHAT_HEADER_HEIGHT)
    expect(messages.top).toBe(chat.top + DEFAULT_CHAT_HEADER_HEIGHT)
    expect(messages.left).toBe(chat.left)
    expect(messages.width).toBe(chat.width)
    expect(messages.height).toBe(chat.height - DEFAULT_CHAT_HEADER_HEIGHT)
  })

  it('never returns negative height', () => {
    const messages = deriveMessagesAreaFromColumn(column(100, 1200, 340, 20), 52)
    expect(messages.height).toBe(0)
  })
})

describe('deriveChromeBarRect', () => {
  it('aligns to chat column width and fixed bar height', () => {
    const chat = column()
    const chrome = deriveChromeBarRect(chat, 72)
    expect(chrome.left).toBe(chat.left)
    expect(chrome.width).toBe(chat.width)
    expect(chrome.height).toBe(CHROME_BAR_HEIGHT)
    expect(chrome.top).toBe(72)
  })

  it('clamps anchor below global nav minimum', () => {
    const chrome = deriveChromeBarRect(column(), 12)
    expect(chrome.top).toBeGreaterThanOrEqual(56)
  })
})

describe('planSidebarHostRects', () => {
  const snapshot = {
    chatColumn: makeRect(1200, 100, 340, 800),
    messagesArea: deriveMessagesAreaFromColumn(column(), 52),
    chromeBar: deriveChromeBarRect(column(), 72),
  }

  it('shows chrome only on chat tab', () => {
    const plan = planSidebarHostRects(snapshot, 'expanded', 'chat')
    expect(plan.chromeVisible).toBe(true)
    expect(plan.panelVisible).toBe(false)
    expect(plan.panel).toBeNull()
  })

  it('sizes panel to messages area on pulse expanded', () => {
    const plan = planSidebarHostRects(snapshot, 'expanded', 'pulse')
    expect(plan.panelVisible).toBe(true)
    expect(plan.panel?.top).toBe(snapshot.messagesArea.top)
    expect(plan.panel?.height).toBe(snapshot.messagesArea.height)
  })

  it('treats retired mini and collapsed modes as full expanded panel', () => {
    for (const mode of ['mini', 'collapsed'] as const) {
      const plan = planSidebarHostRects(snapshot, mode, 'pulse')
      expect(plan.panelVisible).toBe(true)
      expect(plan.panel?.top).toBe(snapshot.messagesArea.top)
      expect(plan.panel?.height).toBe(snapshot.messagesArea.height)
    }
  })
})
