import {
  CHAT_COMMUNITY_SELECTORS,
  CHAT_HEADER_COLLAPSE_SELECTORS,
  CHAT_VIEWERS_SELECTORS,
} from './twitchChat.ts'

/** Unified Twitch control — same element toggles Community / Users in chat open and closed. */
const CHATTERS_TOGGLE_SELECTORS: readonly string[] = [
  '[data-test-selector="chat-viewer-list"]',
  '[data-a-target="chat-viewers"]',
  '[data-a-target="community-tab"]',
]

const CHATTERS_CLOSE_SELECTORS: readonly string[] = [
  '[data-test-selector="close-viewer-list"]',
  // Channel pages reuse the toggle without ARIA state. Its return-to-chat icon
  // identifies list mode even when Twitch keeps the composer behind an error.
  '[data-test-selector="chat-viewer-list"] path[d="M9 10h2v2H9v-2Zm6 0h-2v2h2v-2Z"]',
  'button[aria-label*="Go back to Chat" i]',
  'button[aria-label*="Go back" i]',
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

function queryVisibleInDoc(doc: Document, selectors: readonly string[]): HTMLElement | null {
  for (const selector of selectors) {
    let nodes: NodeListOf<Element>
    try {
      nodes = doc.querySelectorAll(selector)
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

function clickFirstControlInDoc(doc: Document, selectors: readonly string[]): boolean {
  return clickControl(queryVisibleInDoc(doc, selectors))
}

function controlExpanded(el: HTMLElement): boolean {
  return el.getAttribute('aria-expanded') === 'true' || el.getAttribute('aria-pressed') === 'true'
}

export function readTwitchCollapseLabel(doc: Document = document): string {
  const el = queryVisibleInDoc(doc, CHAT_HEADER_COLLAPSE_SELECTORS)
  const label = el?.getAttribute('aria-label')?.trim()
  if (label) return label
  return 'Hide chat panel'
}

export function isTwitchChattersOpen(doc: Document = document): boolean {
  if (queryVisibleInDoc(doc, CHATTERS_CLOSE_SELECTORS)) return true

  for (const selector of CHAT_VIEWERS_SELECTORS) {
    const el = doc.querySelector(selector)
    if (el && controlExpanded(el as HTMLElement)) return true
  }
  for (const selector of CHAT_COMMUNITY_SELECTORS) {
    const el = doc.querySelector(selector)
    if (el && controlExpanded(el as HTMLElement)) return true
  }

  return false
}

/** Proxy to Twitch's collapse / expand chat column control. */
export function clickTwitchCollapseChat(): boolean {
  return clickFirstControl(CHAT_HEADER_COLLAPSE_SELECTORS)
}

/** Toggle Twitch community / chatters drawer (open and close). */
export function toggleTwitchChatters(doc: Document = document): boolean {
  // Twitch uses one header button for both states (Community ↔ Go back to Chat).
  if (clickFirstControlInDoc(doc, CHATTERS_TOGGLE_SELECTORS)) return true
  if (isTwitchChattersOpen(doc)) {
    return clickFirstControlInDoc(doc, CHATTERS_CLOSE_SELECTORS)
  }
  return (
    clickFirstControlInDoc(doc, CHAT_VIEWERS_SELECTORS) ||
    clickFirstControlInDoc(doc, CHAT_COMMUNITY_SELECTORS)
  )
}

/** @deprecated use toggleTwitchChatters */
export function clickTwitchChatters(): boolean {
  return toggleTwitchChatters()
}
