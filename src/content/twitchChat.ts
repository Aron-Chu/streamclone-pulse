// Non-destructive chat-column locator + snap engine.
//
// We never mutate or restructure Twitch's own DOM. We only read the bounding
// rect of the chat column so the shadow-DOM Pulse panel can be laid over it.
// When no usable chat column is found (popout chat, theater, layout change,
// zero-width), the caller falls back to the floating right dock.

import { isTwitchVodPath } from './twitch.ts'
import {
  markPulseChatColumn,
} from './twitchSidebarChrome.ts'

export interface RectLike {
  readonly width: number
  readonly height: number
}

/** Viewport-relative snapshot of the chat column, emitted to snap consumers. */
export interface ChatRectSnapshot {
  readonly top: number
  readonly left: number
  readonly width: number
  readonly height: number
  readonly right: number
  readonly bottom: number
}

export interface ChatColumnCandidate<E extends Element = Element> {
  readonly element: E
  readonly rect: DOMRect
}

// A chat column narrower/shorter than this is treated as missing (theater mode,
// collapsed chat, or a stray match) so we fall back instead of snapping to a
// sliver.
export const MIN_CHAT_WIDTH = 160
export const MIN_CHAT_HEIGHT = 160

// Ordered by specificity / stability. The first candidate whose rect is large
// enough wins, so newer Twitch markup can be added to the front without
// breaking older fallbacks.
export const CHAT_COLUMN_SELECTORS: readonly string[] = [
  '[data-test-selector="chat-room-component-layout"]',
  'section[data-test-selector="chat-room-component-layout"]',
  '.channel-root__right-column',
  '[data-a-target="right-column-chat-bar"]',
  '.right-column',
  'section[aria-label*="Chat" i]',
  'div[aria-label*="Chat" i]',
]

/** Scrollable Twitch chat message list — ordered by specificity. */
export const CHAT_MESSAGES_SELECTORS: readonly string[] = [
  '[data-test-selector="chat-scrollable-area"]',
  '.chat-scrollable-area__message-container',
  '[data-a-target="chat-scrollable-area"]',
]

/** Bottom chrome to keep clear (input, bits row, reward banners). */
export const CHAT_BOTTOM_CLAMP_SELECTORS: readonly string[] = [
  '[data-a-target="chat-input"]',
  '[data-test-selector="chat-input"]',
  '[data-a-target="chat-input-grid"]',
  '[data-a-target="chat-room-submit-button"]',
  'textarea[data-a-target="chat-input"]',
  'textarea[placeholder*="Send a message" i]',
  '[data-a-target="community-highlight-summary"]',
  '[data-a-target="community-highlight-conversation"]',
  '[data-a-target="channel-leaderboard-header"]',
  '[data-a-target="video-chat"]',
  '[data-a-target="video-chat-input"]',
]

/** Stream Chat title text inside the header row. */
export const CHAT_HEADER_TITLE_SELECTORS: readonly string[] = [
  '[data-a-target="chat-room-header"] h2',
  '[data-test-selector="chat-room-header"] h2',
  '[data-a-target="chat-room-header-line"]',
]

/** Twitch chat room header container (fallback when controls are missing). */
export const CHAT_HEADER_SELECTORS: readonly string[] = [
  '[data-a-target="chat-room-header"]',
  '[data-test-selector="chat-room-header"]',
  'header[data-a-target="chat-room-header"]',
]

/** Collapse / expand chat column control on the header left. */
export const CHAT_HEADER_COLLAPSE_SELECTORS: readonly string[] = [
  '[data-a-target="right-column__toggle-collapse-btn"]',
  '[data-a-target="collapse-chat"]',
  'button[aria-label*="Collapse" i]',
]

/** Community / chatters control on the header right. */
export const CHAT_VIEWERS_SELECTORS: readonly string[] = [
  '[data-a-target="chat-viewers"]',
  'button[aria-label*="Users in chat" i]',
]

export const CHAT_COMMUNITY_SELECTORS: readonly string[] = [
  '[data-a-target="community-tab"]',
  'button[aria-label*="Community" i]',
]

/** @deprecated use CHAT_VIEWERS_SELECTORS */
export const CHAT_HEADER_TRAILING_SELECTORS: readonly string[] = [
  ...CHAT_VIEWERS_SELECTORS,
  ...CHAT_COMMUNITY_SELECTORS,
]

/** Fixed gift / bits / sub progress row under the Stream Chat title.
 * Durable strip only — hero cards, upsells, and buy CTAs are ephemeral and must
 * not resize the Pulse host (see CHAT_EPHEMERAL_MID_CHROME_SELECTORS).
 */
export const CHAT_GIFT_ROW_SELECTORS: readonly string[] = [
  '[data-a-target="community-sub-gift-progress"]',
  '[data-a-target="chat-subscription-gift-progress"]',
  '[data-a-target="top-n-bitties-area"]',
  '[data-a-target="bits-card"]',
]

/**
 * Twitch mid-chat chrome that appears under bits (hype train, drops/hero, upsells,
 * pins, notices). When the Pulse tab owns the sidebar these must be hidden and must
 * not drive snap geometry — otherwise the Pulse host jumps whenever they mount.
 */
export const CHAT_EPHEMERAL_MID_CHROME_SELECTORS: readonly string[] = [
  '[data-a-target="gift-card-upsell"]',
  '[data-a-target="chat-room-hero-card"]',
  '[data-a-target="chat-room-buy-button"]',
  '[data-a-target="community-highlight-stack"]',
  '[data-a-target="community-highlight-summary"]',
  '[data-a-target="community-highlight-conversation"]',
  '[data-a-target="user-notice-message"]',
  '[data-test-selector="user-notice-line"]',
  '.user-notice-line',
  '[data-a-target="pinned-chat-messages-list"]',
  '[data-a-target="chat-notification"]',
  '[data-a-target="hype-train"]',
  '[data-test-selector="hype-train"]',
  '[class*="hype-train" i]',
  '[class*="HypeTrain" i]',
]

/** In-chat notices / pinned highlights below the header row. */
export const CHAT_TOP_NOTICE_SELECTORS: readonly string[] = [
  ...CHAT_EPHEMERAL_MID_CHROME_SELECTORS,
]

export const DEFAULT_CHAT_HEADER_HEIGHT = 52
export const HEADER_TABS_FALLBACK_INSET = 36
export const SIDEBAR_MINI_PANEL_HEIGHT = 72
export const SIDEBAR_COLLAPSED_PILL_HEIGHT = 52
/** Reserve space when Twitch input selectors are not found. */
export const CHAT_BOTTOM_RESERVE_PX = 150
/** Tighter reserve on VOD watch pages where input chrome is shorter. */
export const VOD_CHAT_BOTTOM_RESERVE_PX = 48
export const MIN_PANEL_HEIGHT = 80

/**
 * A chat rect is usable only when it is wide and tall enough to host the panel.
 * Zero/near-zero width (theater collapse) or short remnants (popout) are
 * rejected so the caller falls back to the floating dock.
 */
export function isUsableChatRect(rect: RectLike | null | undefined): boolean {
  return !!rect && rect.width >= MIN_CHAT_WIDTH && rect.height >= MIN_CHAT_HEIGHT
}

/** Reject Twitch columns parked wholly/partly beyond the CSS viewport. */
export function isChatRectOnscreen(
  rect: Pick<DOMRect, 'top' | 'left' | 'right' | 'bottom'>,
  viewport: { width: number; height: number },
): boolean {
  return (
    rect.left >= -1
    && rect.right <= viewport.width + 1
    && rect.bottom > 0
    && rect.top < viewport.height
  )
}

/**
 * Pure selection helper: given candidates in priority order, return the first
 * one whose rect is large enough to host the panel, or null when none qualify
 * (e.g. all zero-width because chat is popped out or in theater mode).
 *
 * Kept free of direct DOM access so it can be unit-tested in a node env.
 */
export function pickChatColumn<T extends { rect: RectLike }>(
  candidates: ReadonlyArray<T | null | undefined>,
): T | null {
  for (const candidate of candidates) {
    if (candidate && isUsableChatRect(candidate.rect)) {
      return candidate
    }
  }
  return null
}

function collectCandidates(doc: Document): ChatColumnCandidate[] {
  const seen = new Set<Element>()
  const candidates: ChatColumnCandidate[] = []
  for (const selector of CHAT_COLUMN_SELECTORS) {
    let nodes: NodeListOf<Element>
    try {
      nodes = doc.querySelectorAll(selector)
    } catch {
      continue
    }
    for (const element of Array.from(nodes)) {
      if (seen.has(element)) continue
      seen.add(element)
      candidates.push({ element, rect: element.getBoundingClientRect() })
    }
  }
  return candidates
}

/**
 * Resolve the current chat column element + rect, or null when none is usable.
 * Marks the chosen column so hide rules / descendant queries stay scoped.
 */
export function resolveChatColumn(doc: Document = document): ChatColumnCandidate | null {
  const viewport = doc.defaultView
    ? { width: doc.defaultView.innerWidth, height: doc.defaultView.innerHeight }
    : null
  const candidates = collectCandidates(doc).filter(candidate => (
    !viewport || isChatRectOnscreen(candidate.rect, viewport)
  ))
  const picked = pickChatColumn(candidates)
  if (!picked) return null
  markPulseChatColumn(picked.element, doc)
  return picked
}

/** True when two rects overlap on the X axis (shared horizontal span). */
export function intersectsHorizontally(a: RectLike & { left?: number; right?: number }, b: RectLike & { left?: number; right?: number }): boolean {
  const aLeft = 'left' in a && typeof a.left === 'number' ? a.left : 0
  const bLeft = 'left' in b && typeof b.left === 'number' ? b.left : 0
  const aRight = 'right' in a && typeof a.right === 'number' ? a.right : aLeft + a.width
  const bRight = 'right' in b && typeof b.right === 'number' ? b.right : bLeft + b.width
  return aRight > bLeft + 4 && bRight > aLeft + 4
}

function elementInOrIntersectingColumn(
  element: Element,
  column: ChatColumnCandidate | null,
): boolean {
  if (!column) return false
  if (column.element === element || column.element.contains(element)) return true
  return intersectsHorizontally(element.getBoundingClientRect(), column.rect)
}

function queryFirstRect(
  doc: Document,
  selectors: readonly string[],
  column: ChatColumnCandidate | null = null,
): DOMRect | null {
  const scope: ParentNode = column?.element ?? doc
  for (const selector of selectors) {
    let nodes: NodeListOf<Element>
    try {
      nodes = scope.querySelectorAll(selector)
    } catch {
      continue
    }
    for (const element of Array.from(nodes)) {
      if (column && !elementInOrIntersectingColumn(element, column)) continue
      const rect = element.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) return rect
    }
  }
  // Fallback: document-wide search filtered by intersection with the column.
  if (column && scope !== doc) {
    for (const selector of selectors) {
      let nodes: NodeListOf<Element>
      try {
        nodes = doc.querySelectorAll(selector)
      } catch {
        continue
      }
      for (const element of Array.from(nodes)) {
        if (!elementInOrIntersectingColumn(element, column)) continue
        const rect = element.getBoundingClientRect()
        if (rect.width > 0 && rect.height > 0) return rect
      }
    }
  }
  return null
}

/**
 * Measure the chat column rect, or null when it is missing / too small.
 */
export function measureChatRect(doc: Document = document): DOMRect | null {
  return resolveChatColumn(doc)?.rect ?? null
}

/**
 * Resolve the scrollable chat messages area, or null when not found.
 */
export function resolveChatMessagesRect(doc: Document = document): DOMRect | null {
  const chatColumn = resolveChatColumn(doc)
  const column = chatColumn?.rect ?? null
  const bottomBound = resolveChatBottomBound(doc, column)

  const direct = queryFirstRect(doc, CHAT_MESSAGES_SELECTORS, chatColumn)
  if (direct) return clampDomRectBottom(direct, bottomBound)

  if (!chatColumn) return null

  const roleLog = chatColumn.element.querySelector('[role="log"]')
  if (roleLog) {
    const rect = roleLog.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) {
      return clampDomRectBottom(rect, bottomBound ?? resolveChatBottomBound(doc, chatColumn.rect))
    }
  }

  return null
}

function clampDomRectBottom(rect: DOMRect, bottomBound: number | null): DOMRect {
  if (bottomBound == null || bottomBound >= rect.bottom) return rect
  const height = Math.max(0, bottomBound - rect.top - 2)
  return new DOMRect(rect.left, rect.top, rect.width, height)
}

/**
 * Top Y of the lowest Twitch chat chrome (input row, bits, reward banners).
 * Used to keep the Pulse panel from covering interactive chat controls.
 */
export function resolveChatBottomBound(
  doc: Document = document,
  columnRect?: DOMRect | null,
): number | null {
  const column = columnRect ?? measureChatRect(doc)
  if (!column) return null

  const lowerStart = column.top + column.height * 0.4
  let bound: number | null = null

  for (const selector of CHAT_BOTTOM_CLAMP_SELECTORS) {
    let nodes: NodeListOf<Element>
    try {
      nodes = doc.querySelectorAll(selector)
    } catch {
      continue
    }
    for (const element of Array.from(nodes)) {
      const rect = element.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) continue
      if (column && !intersectsHorizontally(rect, column)) continue
      if (rect.top < lowerStart) continue
      if (rect.bottom > column.bottom + 4) continue
      if (bound == null || rect.top < bound) bound = rect.top
    }
  }

  return bound
}

/** Keep mini/collapsed docks above Twitch bottom banners (subs, highlights, scroll chip). */
export function resolveChatDockBottomY(
  doc: Document,
  panelBottom: number,
  column: ChatRectSnapshot,
): number {
  let bottom = panelBottom
  const lowerStart = column.top + column.height * 0.35
  const dockClearSelectors = [
    ...CHAT_BOTTOM_CLAMP_SELECTORS,
    '[data-a-target="chat-scrollable-area__scroll-button"]',
    'button[aria-label*="Scroll to bottom" i]',
    'button[aria-label*="scroll to recent" i]',
    'button[aria-label*="New messages" i]',
  ] as const

  for (const selector of dockClearSelectors) {
    let nodes: NodeListOf<Element>
    try {
      nodes = doc.querySelectorAll(selector)
    } catch {
      continue
    }
    for (const element of Array.from(nodes)) {
      const rect = element.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) continue
      if (rect.top < lowerStart) continue
      if (rect.top >= bottom - 4) continue
      if (rect.right < column.left + 8 || rect.left > column.left + column.width - 8) continue
      bottom = Math.min(bottom, rect.top - 4)
    }
  }

  const bottomBound = resolveChatBottomBound(
    doc,
    new DOMRect(column.left, column.top, column.width, column.height),
  )
  if (bottomBound != null) {
    bottom = Math.min(bottom, bottomBound - 2)
  }

  return Math.max(column.top + 28, bottom)
}

/** Clamp a panel snapshot so it ends above chat input / bottom banners. */
export function clampPanelAboveChatChrome(
  panel: ChatRectSnapshot,
  bottomBound: number | null,
  columnBottom: number,
  minHeight = MIN_PANEL_HEIGHT,
): ChatRectSnapshot | null {
  let bottom = panel.bottom
  if (bottomBound != null) bottom = Math.min(bottom, bottomBound - 2)
  else bottom = Math.min(bottom, columnBottom - CHAT_BOTTOM_RESERVE_PX)

  const height = bottom - panel.top
  if (height < minHeight) return null
  return toChatRectSnapshot({ top: panel.top, left: panel.left, width: panel.width, height })
}

/**
 * Measure chat header height inside the chat column. Falls back to ~52px.
 */
export function resolveChatHeaderHeight(
  doc: Document = document,
  chatColumnElement?: Element | null,
): number {
  const scope = chatColumnElement ?? resolveChatColumn(doc)?.element ?? doc
  for (const selector of CHAT_HEADER_SELECTORS) {
    const header = scope.querySelector(selector)
    if (!header) continue
    const rect = header.getBoundingClientRect()
    if (rect.height > 0) return rect.height
  }
  return DEFAULT_CHAT_HEADER_HEIGHT
}

function rectKey(rect: DOMRect | null): string {
  if (!rect) return 'null'
  return [
    Math.round(rect.left),
    Math.round(rect.top),
    Math.round(rect.width),
    Math.round(rect.height),
  ].join(':')
}

export function toChatRectSnapshot(
  rect: { readonly top: number; readonly left: number; readonly width: number; readonly height: number },
): ChatRectSnapshot {
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
  }
}

/** Resolve the Stream Chat header row, or derive from column top + measured height. */
export function resolveChatHeaderRect(doc: Document = document): ChatRectSnapshot | null {
  const chatColumn = resolveChatColumn(doc)
  const direct = queryFirstRect(doc, CHAT_HEADER_SELECTORS, chatColumn)
  if (direct) {
    const height = Math.min(direct.height, DEFAULT_CHAT_HEADER_HEIGHT + 8)
    return toChatRectSnapshot({ top: direct.top, left: direct.left, width: direct.width, height })
  }

  const column = chatColumn?.rect ?? null
  if (!column) return null
  const height = resolveChatHeaderHeight(doc, chatColumn?.element)
  return toChatRectSnapshot({ top: column.top, left: column.left, width: column.width, height })
}

export function collectHeaderAnchorRects(
  doc: Document,
  column: ChatColumnCandidate | null,
): DOMRect[] {
  const anchors: DOMRect[] = []
  const pushAnchor = (element: Element, maxHeight = 48) => {
    if (column && !elementInOrIntersectingColumn(element, column)) return
    // Also require vertical proximity to the column top (player/ad decoys sit elsewhere).
    if (column) {
      const rect = element.getBoundingClientRect()
      if (rect.bottom < column.rect.top - 8 || rect.top > column.rect.top + 120) return
      if (rect.width <= 0 || rect.height <= 0 || rect.height > maxHeight) return
      anchors.push(rect)
      return
    }
    const rect = element.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0 || rect.height > maxHeight) return
    anchors.push(rect)
  }

  const scope: ParentNode = column?.element ?? doc
  for (const selector of CHAT_HEADER_COLLAPSE_SELECTORS) {
    let nodes: NodeListOf<Element>
    try {
      nodes = scope.querySelectorAll(selector)
    } catch {
      continue
    }
    for (const element of Array.from(nodes)) {
      pushAnchor(element, 40)
    }
  }

  for (const selector of [...CHAT_VIEWERS_SELECTORS, ...CHAT_COMMUNITY_SELECTORS]) {
    let nodes: NodeListOf<Element>
    try {
      nodes = scope.querySelectorAll(selector)
    } catch {
      continue
    }
    for (const element of Array.from(nodes)) {
      pushAnchor(element, 40)
    }
  }

  for (const selector of CHAT_HEADER_TITLE_SELECTORS) {
    let nodes: NodeListOf<Element>
    try {
      nodes = scope.querySelectorAll(selector)
    } catch {
      continue
    }
    for (const element of Array.from(nodes)) {
      pushAnchor(element, 36)
    }
  }

  return anchors
}

/**
 * Stream Chat toolbar row — aligned to collapse / title / chatters controls,
 * not the outer chat-room-header container (which can sit lower on Twitch).
 */
export function resolveChatHeaderBarRect(
  doc: Document = document,
  column?: ChatRectSnapshot | null,
): ChatRectSnapshot | null {
  const chatColumn = resolveChatColumn(doc)
  const columnRect = column ?? (chatColumn ? toChatRectSnapshot(chatColumn.rect) : null)
  if (!columnRect) return null

  const anchors = collectHeaderAnchorRects(doc, chatColumn)
  const fallback = resolveChatHeaderRect(doc)

  if (anchors.length === 0) {
    if (!fallback) return null
    return toChatRectSnapshot({
      top: fallback.top,
      left: columnRect.left,
      width: columnRect.width,
      height: Math.min(fallback.height, DEFAULT_CHAT_HEADER_HEIGHT + 8),
    })
  }

  let top = Math.min(...anchors.map(rect => rect.top))
  let bottom = Math.max(...anchors.map(rect => rect.bottom))
  if (fallback && fallback.top < top) {
    top = Math.min(top, fallback.top)
  }

  const height = Math.min(Math.max(bottom - top, 28), DEFAULT_CHAT_HEADER_HEIGHT + 12)
  return toChatRectSnapshot({
    top,
    left: columnRect.left,
    width: columnRect.width,
    height,
  })
}

function resolveChatTopBannerBottom(
  doc: Document,
  headerBottom: number,
  column: { readonly top: number; readonly bottom: number; readonly left: number; readonly width: number },
  selectors: readonly string[],
  maxTopOffset: number,
): number {
  let bottom = headerBottom
  const maxBannerTop = headerBottom + maxTopOffset
  for (const selector of selectors) {
    let nodes: NodeListOf<Element>
    try {
      nodes = doc.querySelectorAll(selector)
    } catch {
      continue
    }
    for (const element of Array.from(nodes)) {
      const rect = element.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) continue
      if (rect.top < headerBottom - 6 || rect.top > maxBannerTop) continue
      if (rect.right < column.left + 8 || rect.left > column.left + column.width - 8) continue
      bottom = Math.max(bottom, rect.bottom)
    }
  }
  return bottom
}

/** Bottom edge of the gift / bits / sub banner row below the title header. */
export function resolveChatGiftRowBottom(
  doc: Document,
  headerBottom: number,
  column: { readonly top: number; readonly bottom: number; readonly left: number; readonly width: number },
): number {
  return resolveChatTopBannerBottom(doc, headerBottom, column, CHAT_GIFT_ROW_SELECTORS, 140)
}

/** Bottom edge of in-chat notices / pinned highlights below the header. */
export function resolveChatTopNoticeBottom(
  doc: Document,
  headerBottom: number,
  column: { readonly top: number; readonly bottom: number; readonly left: number; readonly width: number },
): number {
  return resolveChatTopBannerBottom(doc, headerBottom, column, CHAT_TOP_NOTICE_SELECTORS, 220)
}

/** Top of the Pulse / messages body below durable chat chrome.
 *
 * Uses the gift / bits / sub progress row under the Stream Chat header only.
 * Ephemeral notices (cheers, pins, community highlights) and the live message-list
 * top are intentionally ignored — those nodes appear/disappear constantly and were
 * resizing `#streamclone-pulse-root`, which looked like the Pulse tab "jumping."
 */
export function resolveChatContentTop(
  doc: Document,
  headerBottom: number,
  column: ChatRectSnapshot,
  options?: { includeEphemeralNotices?: boolean },
): number {
  let top = resolveChatGiftRowBottom(doc, headerBottom, column)
  if (options?.includeEphemeralNotices) {
    top = Math.max(top, resolveChatTopNoticeBottom(doc, headerBottom, column))
  }
  return top
}

/**
 * Tab strip slot between collapse and community icons (covers "Stream Chat" label).
 * Pure helper for unit tests.
 */
export function computeHeaderTabsRect(
  header: ChatRectSnapshot,
  collapseRight: number | null,
  trailingLeft: number | null,
  fallbackInset = HEADER_TABS_FALLBACK_INSET,
): ChatRectSnapshot {
  let left = header.left + fallbackInset
  let right = header.right - fallbackInset
  if (collapseRight != null && Number.isFinite(collapseRight)) {
    left = Math.max(left, collapseRight + 4)
  }
  if (trailingLeft != null && Number.isFinite(trailingLeft)) {
    right = Math.min(right, trailingLeft - 4)
  }
  const width = Math.max(72, right - left)
  return toChatRectSnapshot({ top: header.top, left, width, height: header.height })
}

function resolveHeaderEdge(
  doc: Document,
  selectors: readonly string[],
  header: ChatRectSnapshot,
  edge: 'left' | 'right',
): number | null {
  for (const selector of selectors) {
    let nodes: NodeListOf<Element>
    try {
      nodes = doc.querySelectorAll(selector)
    } catch {
      continue
    }
    for (const element of Array.from(nodes)) {
      const rect = element.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) continue
      if (Math.abs(rect.top - header.top) > header.height + 8) continue
      return edge === 'left' ? rect.right : rect.left
    }
  }
  return null
}

export function resolveChatHeaderTabsRect(
  doc: Document = document,
  header?: ChatRectSnapshot | null,
): ChatRectSnapshot | null {
  const headerRect = header ?? resolveChatHeaderBarRect(doc) ?? resolveChatHeaderRect(doc)
  if (!headerRect) return null
  const collapseRight = resolveHeaderEdge(doc, CHAT_HEADER_COLLAPSE_SELECTORS, headerRect, 'left')
  const trailingLeft = resolveHeaderEdge(doc, CHAT_HEADER_TRAILING_SELECTORS, headerRect, 'right')
  return computeHeaderTabsRect(headerRect, collapseRight, trailingLeft)
}

/** Full-width header bar including collapse / community controls on the same row. */
export function expandHeaderBarRect(
  doc: Document,
  column: ChatRectSnapshot,
  header: ChatRectSnapshot,
): ChatRectSnapshot {
  let top = header.top
  let bottom = header.bottom
  const edgeSelectors = [
    ...CHAT_HEADER_COLLAPSE_SELECTORS,
    ...CHAT_HEADER_TRAILING_SELECTORS,
  ] as const
  for (const selector of edgeSelectors) {
    let nodes: NodeListOf<Element>
    try {
      nodes = doc.querySelectorAll(selector)
    } catch {
      continue
    }
    for (const element of Array.from(nodes)) {
      const rect = element.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) continue
      if (Math.abs(rect.top - header.top) > header.height + 16) continue
      top = Math.min(top, rect.top)
      bottom = Math.max(bottom, rect.bottom)
    }
  }
  return toChatRectSnapshot({
    top,
    left: column.left,
    width: column.width,
    height: Math.max(header.height, bottom - top),
  })
}

/** Messages / scroll region below gifts — Pulse panel snaps here, above chat input. */
export function resolveChatPanelRect(doc: Document = document): ChatRectSnapshot | null {
  const column = measureChatRect(doc)
  if (!column || !isUsableChatRect(column)) return null

  const columnSnapshot = toChatRectSnapshot(column)
  const header = resolveChatHeaderRect(doc)
  const headerBar = resolveChatHeaderBarRect(doc, columnSnapshot) ?? header
  const headerBottom = headerBar?.bottom ?? header?.bottom ?? column.top + resolveChatHeaderHeight(doc)
  const bottomBound = resolveChatBottomBound(doc, column)

  const top = resolveChatContentTop(doc, headerBottom, columnSnapshot)

  const pathname = doc.defaultView?.location?.pathname ?? ''
  const isVodPage = isTwitchVodPath(pathname)
  const bottom = resolvePanelBottomY(column.bottom, bottomBound, { isVodPage })

  const height = bottom - top
  if (height < MIN_PANEL_HEIGHT) return null
  return toChatRectSnapshot({ top, left: column.left, width: column.width, height })
}

/** Pure bottom Y for panel body — used by resolveChatPanelRect and unit tests. */
export function resolvePanelBottomY(
  columnBottom: number,
  bottomBound: number | null,
  options?: { isVodPage?: boolean },
): number {
  const reserve = options?.isVodPage ? VOD_CHAT_BOTTOM_RESERVE_PX : CHAT_BOTTOM_RESERVE_PX
  return bottomBound != null ? bottomBound - 2 : columnBottom - reserve
}

/** Sidebar snap: column + header row + inset tab slot + panel body. */
export interface SidebarSnapLayout {
  readonly column: ChatRectSnapshot
  readonly header: ChatRectSnapshot
  readonly headerTabs: ChatRectSnapshot
  readonly panel: ChatRectSnapshot
}

export function computeHeaderTabInsets(
  header: ChatRectSnapshot,
  headerTabs: ChatRectSnapshot,
): { readonly paddingLeft: number; readonly paddingRight: number } {
  return {
    paddingLeft: Math.max(0, Math.round(headerTabs.left - header.left)),
    paddingRight: Math.max(0, Math.round(header.right - headerTabs.right)),
  }
}

/** Full-width body rect: messages area through clamped panel bottom. */
export function buildSidebarBodyRect(layout: SidebarSnapLayout): ChatRectSnapshot {
  return layout.panel
}

export function measureSidebarSnapLayout(doc: Document = document): SidebarSnapLayout | null {
  const resolved = resolveChatColumn(doc)
  if (!resolved || !isUsableChatRect(resolved.rect)) return null

  const column = toChatRectSnapshot(resolved.rect)
  const header = resolveChatHeaderBarRect(doc, column) ?? resolveChatHeaderRect(doc)
  const panel = resolveChatPanelRect(doc)
  if (!header || !panel) return null
  const headerTabs = resolveChatHeaderTabsRect(doc, header)
  if (!headerTabs) return null

  return { column, header, headerTabs, panel }
}

/** @deprecated use measureSidebarSnapLayout */
export type ChatSnapLayout = SidebarSnapLayout

/** @deprecated use measureSidebarSnapLayout */
export function measureChatSnapLayout(doc: Document = document): SidebarSnapLayout | null {
  return measureSidebarSnapLayout(doc)
}

function layoutKey(layout: SidebarSnapLayout | null): string {
  if (!layout) return 'null'
  return [layout.column, layout.header, layout.headerTabs, layout.panel]
    .map(rect => rectKey(rect as DOMRect))
    .join('|')
}

/**
 * Safety-net remasure interval. Kept deliberately slow: ResizeObserver + debounced
 * mutation/resize paths handle real layout changes; this only catches missed cases.
 */
export const PERIODIC_REMEASURE_MS = 4000
/** Trailing debounce for mutation/resize-driven snap measures (rAF still coalesces). */
export const SNAP_DEBOUNCE_MS = 100
/**
 * Hard ceiling so continuous chat/ad mutations cannot starve geometry forever.
 * Must stay well below PERIODIC_REMEASURE_MS.
 */
export const SNAP_MAX_LATENCY_MS = 250
/** Hold last valid snap while Twitch briefly detaches/replaces the chat subtree. */
export const SNAP_LAYOUT_HOLD_MS = 220
export const SNAP_MIN_DELTA_PX = 2

export function stabilizeSidebarSnapLayout(
  next: SidebarSnapLayout | null,
  state: {
    lastValid: SidebarSnapLayout | null
    lastValidAt: number
    now: number
    holdMs: number
  },
): SidebarSnapLayout | null {
  if (next) return next
  if (!state.lastValid) return null
  if (state.now - state.lastValidAt <= state.holdMs) return state.lastValid
  return null
}

export interface BoundedMeasureSchedulerHooks {
  debounceMs: number
  maxLatencyMs: number
  now: () => number
  setTimeout: typeof setTimeout
  clearTimeout: typeof clearTimeout
  requestAnimationFrame: (cb: FrameRequestCallback) => number
  cancelAnimationFrame: (id: number) => void
}

/**
 * Trailing debounce with a max-latency flush. Rapid schedule() calls coalesce,
 * but the first pending schedule always measures within maxLatencyMs.
 */
export function createBoundedMeasureScheduler(
  measure: () => void,
  hooks: BoundedMeasureSchedulerHooks,
): { schedule: () => void; dispose: () => void } {
  let debounceId: ReturnType<typeof setTimeout> | 0 = 0
  let maxWaitId: ReturnType<typeof setTimeout> | 0 = 0
  let rafId = 0
  let pendingSince = 0
  let disposed = false

  function flush(): void {
    if (disposed) return
    if (debounceId) {
      hooks.clearTimeout(debounceId)
      debounceId = 0
    }
    if (maxWaitId) {
      hooks.clearTimeout(maxWaitId)
      maxWaitId = 0
    }
    pendingSince = 0
    if (rafId) return
    rafId = hooks.requestAnimationFrame(() => {
      rafId = 0
      if (!disposed) measure()
    })
  }

  function schedule(): void {
    if (disposed) return
    const now = hooks.now()
    if (!pendingSince) {
      pendingSince = now
      maxWaitId = hooks.setTimeout(() => {
        maxWaitId = 0
        flush()
      }, hooks.maxLatencyMs)
    }
    if (debounceId) hooks.clearTimeout(debounceId)
    debounceId = hooks.setTimeout(() => {
      debounceId = 0
      flush()
    }, hooks.debounceMs)
  }

  function dispose(): void {
    disposed = true
    if (debounceId) hooks.clearTimeout(debounceId)
    if (maxWaitId) hooks.clearTimeout(maxWaitId)
    if (rafId) hooks.cancelAnimationFrame(rafId)
    debounceId = 0
    maxWaitId = 0
    rafId = 0
    pendingSince = 0
  }

  return { schedule, dispose }
}

/**
 * Subtree mutations under these nodes are chat scroll / ephemeral notice traffic
 * and do not move durable sidebar snap geometry (column / header / gift-bits row /
 * input chrome). Ignoring them avoids forced layout on every cheer toast or message.
 */
export const CHAT_MESSAGE_LIST_IGNORE_SELECTORS: readonly string[] = [
  ...CHAT_MESSAGES_SELECTORS,
  ...CHAT_EPHEMERAL_MID_CHROME_SELECTORS,
  '[role="log"]',
]

export function rectDeltaExceedsThreshold(
  a: ChatRectSnapshot,
  b: ChatRectSnapshot,
  minPx: number,
): boolean {
  return (
    Math.abs(a.top - b.top) >= minPx
    || Math.abs(a.left - b.left) >= minPx
    || Math.abs(a.width - b.width) >= minPx
    || Math.abs(a.height - b.height) >= minPx
  )
}

export function snapLayoutChangedSignificantly(
  prev: SidebarSnapLayout | null,
  next: SidebarSnapLayout | null,
  minPx = SNAP_MIN_DELTA_PX,
): boolean {
  if (prev == null || next == null) return prev !== next
  return (
    rectDeltaExceedsThreshold(prev.column, next.column, minPx)
    || rectDeltaExceedsThreshold(prev.header, next.header, minPx)
    || rectDeltaExceedsThreshold(prev.headerTabs, next.headerTabs, minPx)
    || rectDeltaExceedsThreshold(prev.panel, next.panel, minPx)
  )
}

/**
 * Pure helper: React re-render is only required when snap presence or panel width
 * changes. Pure geometry ticks can update host CSS without a full Overlay render.
 */
export function shouldRerenderOverlayForSnapChange(
  prev: SidebarSnapLayout | null,
  next: SidebarSnapLayout | null,
): boolean {
  if ((prev == null) !== (next == null)) return true
  if (prev == null || next == null) return false
  const prevWidth = Math.round(prev.panel.width || prev.column.width)
  const nextWidth = Math.round(next.panel.width || next.column.width)
  return prevWidth !== nextWidth
}

/** Testable ancestry check used by MutationObserver noise filtering. */
export function matchesChatMessageListAncestry(
  closest: (selector: string) => unknown,
): boolean {
  for (const selector of CHAT_MESSAGE_LIST_IGNORE_SELECTORS) {
    try {
      if (closest(selector)) return true
    } catch {
      continue
    }
  }
  return false
}

function elementFromMutationTarget(node: Node | null): Element | null {
  if (!node) return null
  if (typeof Element !== 'undefined' && node instanceof Element) return node
  if (typeof Element !== 'undefined' && node instanceof Text) return node.parentElement
  return null
}

function isIgnoredChatSnapMutationTarget(node: Node | null): boolean {
  const el = elementFromMutationTarget(node)
  if (!el) return false
  return matchesChatMessageListAncestry(sel => el.closest(sel))
}

/** True when at least one mutation is outside the chat message list. */
export function shouldScheduleSnapMeasureFromMutations(
  mutations: ReadonlyArray<{ readonly target: Node }>,
): boolean {
  if (mutations.length === 0) return false
  return mutations.some(mutation => !isIgnoredChatSnapMutationTarget(mutation.target))
}
/**
 * Observe the chat column rect and invoke `cb` with the latest snapshot, or null
 * when the column disappears (popout/theater/layout change). Combines a
 * ResizeObserver on the found element, a MutationObserver on the body, window
 * resize/scroll, a throttled rAF re-measure, and a low-frequency interval as a
 * safety net. Returns a cleanup function.
 */
export function observeChatRect(cb: (rect: DOMRect | null) => void): () => void {
  let lastKey: string | null = null
  let observedEl: Element | null = null
  let disposed = false

  const resizeObserver =
    typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => scheduler.schedule()) : null

  function measure(): void {
    if (disposed) return
    const resolved = resolveChatColumn()
    const element = resolved?.element ?? null
    const rect = resolved?.rect ?? null

    if (element !== observedEl) {
      if (resizeObserver && observedEl) resizeObserver.unobserve(observedEl)
      observedEl = element
      if (resizeObserver && element) resizeObserver.observe(element)
    }

    const key = rectKey(rect)
    if (key !== lastKey) {
      lastKey = key
      cb(rect)
    }
  }

  const scheduler = createBoundedMeasureScheduler(measure, {
    debounceMs: SNAP_DEBOUNCE_MS,
    maxLatencyMs: SNAP_MAX_LATENCY_MS,
    now: () => Date.now(),
    setTimeout: window.setTimeout.bind(window) as typeof setTimeout,
    clearTimeout: window.clearTimeout.bind(window) as typeof clearTimeout,
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  })

  const mutationObserver = new MutationObserver(mutations => {
    if (!shouldScheduleSnapMeasureFromMutations(mutations)) return
    scheduler.schedule()
  })
  if (document.body) {
    mutationObserver.observe(document.body, { childList: true, subtree: true })
  }

  window.addEventListener('resize', scheduler.schedule, { passive: true })
  window.addEventListener('scroll', scheduler.schedule, { passive: true, capture: true })
  const intervalId = window.setInterval(measure, PERIODIC_REMEASURE_MS)

  measure()

  return () => {
    disposed = true
    scheduler.dispose()
    window.clearInterval(intervalId)
    window.removeEventListener('resize', scheduler.schedule)
    window.removeEventListener('scroll', scheduler.schedule, { capture: true } as EventListenerOptions)
    mutationObserver.disconnect()
    resizeObserver?.disconnect()
  }
}

/**
 * Elements whose size/position changes should remasure sidebar snap.
 *
 * Stream Display Ads sit between the player and chat: the chat column often
 * translates without resizing, so ResizeObserver on the column alone is silent.
 * Observing parent + grandparent catches flex/layout reflow from ad slots.
 */
export function sidebarSnapResizeObservationTargets(column: Element | null): Element[] {
  if (!column) return []
  const targets: Element[] = [column]
  const parent = column.parentElement
  if (parent) {
    targets.push(parent)
    if (parent.parentElement) targets.push(parent.parentElement)
  }
  return targets
}

/** Attributes that can reveal/hide/move ad chrome without a childList mutation. */
export const SNAP_LAYOUT_ATTRIBUTE_FILTER = [
  'class',
  'style',
  'hidden',
  'aria-hidden',
] as const

/**
 * Observe chat column + header height for sidebar snap layout.
 */
export function observeChatSnapLayout(cb: (layout: SidebarSnapLayout | null) => void): () => void {
  let lastLayout: SidebarSnapLayout | null = null
  let lastKey: string | null = null
  let lastValidLayout: SidebarSnapLayout | null = null
  let lastValidAt = 0
  let observedTargets: Element[] = []
  let disposed = false

  const resizeObserver =
    typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => scheduler.schedule()) : null
  // IntersectionObserver fires when the column moves in the viewport without a
  // size change (Twitch Stream Display Ads / mirror-c pushing chat sideways).
  const intersectionObserver =
    typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver(() => scheduler.schedule(), {
          threshold: [0, 0.05, 0.25, 0.5, 0.75, 1],
        })
      : null

  function emitIfChanged(layout: SidebarSnapLayout | null): void {
    const key = layoutKey(layout)
    if (key === lastKey) return
    // Compare against last *emitted* layout so sub-threshold chat jitter does not
    // slowly walk the panel, and does not trigger applyFixedRect/renderOverlay.
    if (!snapLayoutChangedSignificantly(lastLayout, layout)) {
      lastKey = key
      return
    }
    lastKey = key
    lastLayout = layout
    cb(layout)
  }

  function syncObservedElements(column: Element | null): void {
    const nextTargets = sidebarSnapResizeObservationTargets(column)
    const same =
      nextTargets.length === observedTargets.length
      && nextTargets.every((el, i) => el === observedTargets[i])
    if (same) return

    for (const el of observedTargets) {
      resizeObserver?.unobserve(el)
      intersectionObserver?.unobserve(el)
    }
    observedTargets = nextTargets
    for (const el of observedTargets) {
      resizeObserver?.observe(el)
      // Track intersection for column + immediate parent (ad flex shifts).
      if (el === column || el === column?.parentElement) {
        intersectionObserver?.observe(el)
      }
    }
  }

  function measure(): void {
    if (disposed) return
    const resolved = resolveChatColumn()
    syncObservedElements(resolved?.element ?? null)
    const next = measureSidebarSnapLayout()
    const stabilized = stabilizeSidebarSnapLayout(next, {
      lastValid: lastValidLayout,
      lastValidAt,
      now: Date.now(),
      holdMs: SNAP_LAYOUT_HOLD_MS,
    })
    if (next) {
      lastValidLayout = next
      lastValidAt = Date.now()
    } else if (!stabilized) {
      lastValidLayout = null
      lastValidAt = 0
    }
    emitIfChanged(stabilized)
  }

  const scheduler = createBoundedMeasureScheduler(measure, {
    debounceMs: SNAP_DEBOUNCE_MS,
    maxLatencyMs: SNAP_MAX_LATENCY_MS,
    now: () => Date.now(),
    setTimeout: window.setTimeout.bind(window) as typeof setTimeout,
    clearTimeout: window.clearTimeout.bind(window) as typeof clearTimeout,
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  })

  const mutationObserver = new MutationObserver(mutations => {
    if (!shouldScheduleSnapMeasureFromMutations(mutations)) return
    scheduler.schedule()
  })
  if (document.body) {
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [...SNAP_LAYOUT_ATTRIBUTE_FILTER],
    })
  }

  window.addEventListener('resize', scheduler.schedule, { passive: true })
  window.addEventListener('scroll', scheduler.schedule, { passive: true, capture: true })
  const intervalId = window.setInterval(measure, PERIODIC_REMEASURE_MS)

  measure()

  return () => {
    disposed = true
    scheduler.dispose()
    window.clearInterval(intervalId)
    window.removeEventListener('resize', scheduler.schedule)
    window.removeEventListener('scroll', scheduler.schedule, { capture: true } as EventListenerOptions)
    mutationObserver.disconnect()
    resizeObserver?.disconnect()
    intersectionObserver?.disconnect()
  }
}
