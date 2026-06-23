import {
  CHAT_COMMUNITY_SELECTORS,
  CHAT_HEADER_COLLAPSE_SELECTORS,
  CHAT_VIEWERS_SELECTORS,
} from './twitchChat.ts'

const CHATTERS_PANEL_SELECTORS: readonly string[] = [
  '[data-a-target="chat-viewers-ribbon"]',
  '[data-a-target="users-in-chat-list"]',
  '[data-a-target="viewer-list"]',
  '[data-a-target="community-panel"]',
  '[data-a-target="chat-viewers-list"]',
]

const CHATTERS_CLOSE_SELECTORS: readonly string[] = [
  '[data-a-target="content-overlay-back-button"]',
  'button[aria-label*="Back" i][data-a-target]',
  'button[aria-label*="Close" i][data-a-target]',
]

function queryVisibleControl(selectors: readonly string[]): HTMLElement | null {
  if (typeof document === 'undefined') return null
  for (const selector of selectors) {
    let nodes: NodeListOf<Element>
    try {
      nodes = document.querySelectorAll(selector)
    } catch {
      continue
    }
    for (const node of Array.from(nodes)) {
      const el = node as HTMLElement
      const rect = el.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) continue
      return el
    }
  }
  return null
}

function clickControl(el: HTMLElement | null): boolean {
  if (!el) return false
  el.click()
  return true
}

function clickFirstControl(selectors: readonly string[]): boolean {
  return clickControl(queryVisibleControl(selectors))
}

function controlExpanded(el: HTMLElement): boolean {
  return el.getAttribute('aria-expanded') === 'true' || el.getAttribute('aria-pressed') === 'true'
}

export function readTwitchCollapseLabel(doc: Document = document): string {
  const el = queryVisibleControl(CHAT_HEADER_COLLAPSE_SELECTORS)
  const label = el?.getAttribute('aria-label')?.trim()
  if (label) return label
  return 'Hide chat panel'
}

export function isTwitchChattersOpen(doc: Document = document): boolean {
  for (const selector of CHAT_VIEWERS_SELECTORS) {
    const el = doc.querySelector(selector)
    if (el && controlExpanded(el as HTMLElement)) return true
  }
  for (const selector of CHAT_COMMUNITY_SELECTORS) {
    const el = doc.querySelector(selector)
    if (el && controlExpanded(el as HTMLElement)) return true
  }
  for (const selector of CHATTERS_PANEL_SELECTORS) {
    const el = doc.querySelector(selector)
    if (!el) continue
    const rect = el.getBoundingClientRect()
    if (rect.width > 40 && rect.height > 40) return true
  }
  return false
}

/** Proxy to Twitch's collapse / expand chat column control. */
export function clickTwitchCollapseChat(): boolean {
  return clickFirstControl(CHAT_HEADER_COLLAPSE_SELECTORS)
}

/** Toggle Twitch community / chatters drawer (open and close). */
export function toggleTwitchChatters(doc: Document = document): boolean {
  if (isTwitchChattersOpen(doc)) {
    if (clickFirstControl(CHAT_VIEWERS_SELECTORS)) return true
    if (clickFirstControl(CHAT_COMMUNITY_SELECTORS)) return true
    return clickFirstControl(CHATTERS_CLOSE_SELECTORS)
  }
  return clickFirstControl(CHAT_VIEWERS_SELECTORS) || clickFirstControl(CHAT_COMMUNITY_SELECTORS)
}

/** @deprecated use toggleTwitchChatters */
export function clickTwitchChatters(): boolean {
  return toggleTwitchChatters()
}
