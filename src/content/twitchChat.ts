// Non-destructive chat-column locator + snap engine.
//
// We never mutate or restructure Twitch's own DOM. We only read the bounding
// rect of the chat column so the shadow-DOM Pulse panel can be laid over it.
// When no usable chat column is found (popout chat, theater, layout change,
// zero-width), the caller falls back to the floating right dock.

import { isTwitchVodPath } from './twitch.ts'

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

/** Composer controls whose own transitions can change the panel bottom clamp. */
export const CHAT_COMPOSER_SELECTORS: readonly string[] = [
  '[data-a-target="chat-input"]',
  '[data-test-selector="chat-input"]',
  '[data-a-target="chat-input-grid"]',
  '[data-a-target="chat-room-submit-button"]',
  'textarea[data-a-target="chat-input"]',
  'textarea[placeholder*="Send a message" i]',
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

/** Fixed gift / bits / sub progress row under the Stream Chat title. */
export const CHAT_GIFT_ROW_SELECTORS: readonly string[] = [
  '[data-a-target="gift-card-upsell"]',
  '[data-a-target="community-sub-gift-progress"]',
  '[data-a-target="chat-room-hero-card"]',
  '[data-a-target="chat-subscription-gift-progress"]',
  '[data-a-target="top-n-bitties-area"]',
  '[data-a-target="bits-card"]',
  '[data-a-target="chat-room-buy-button"]',
]

/** In-chat notices / pinned highlights below the header row. */
export const CHAT_TOP_NOTICE_SELECTORS: readonly string[] = [
  '[data-a-target="community-highlight-stack"]',
  '[data-a-target="user-notice-message"]',
  '[data-test-selector="user-notice-line"]',
  '.user-notice-line',
  '[data-a-target="pinned-chat-messages-list"]',
  '[data-a-target="chat-notification"]',
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
 */
export function resolveChatColumn(doc: Document = document): ChatColumnCandidate | null {
  return pickChatColumn(collectCandidates(doc))
}

/**
 * Measure the chat column rect, or null when it is missing / too small.
 */
export function measureChatRect(doc: Document = document): DOMRect | null {
  return resolveChatColumn(doc)?.rect ?? null
}

function queryFirstRect(doc: Document, selectors: readonly string[]): DOMRect | null {
  for (const selector of selectors) {
    let nodes: NodeListOf<Element>
    try {
      nodes = doc.querySelectorAll(selector)
    } catch {
      continue
    }
    for (const element of Array.from(nodes)) {
      const rect = element.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) return rect
    }
  }
  return null
}

/**
 * Resolve the scrollable chat messages area, or null when not found.
 */
export function resolveChatMessagesRect(doc: Document = document): DOMRect | null {
  const column = measureChatRect(doc)
  const bottomBound = resolveChatBottomBound(doc, column)

  const direct = queryFirstRect(doc, CHAT_MESSAGES_SELECTORS)
  if (direct) return clampDomRectBottom(direct, bottomBound)

  const chatColumn = resolveChatColumn(doc)
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
 * Top Y of the Twitch composer/input chrome. Used to keep the Pulse panel from
 * covering the interactive chat controls; transient body banners do not move
 * this bound.
 */
export function resolveChatBottomBound(
  doc: Document = document,
  columnRect?: DOMRect | null,
): number | null {
  const column = columnRect ?? measureChatRect(doc)
  if (!column) return null

  const lowerStart = column.top + column.height * 0.4
  let bound: number | null = null

  for (const selector of CHAT_COMPOSER_SELECTORS) {
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
  const direct = queryFirstRect(doc, CHAT_HEADER_SELECTORS)
  if (direct) {
    const height = Math.min(direct.height, DEFAULT_CHAT_HEADER_HEIGHT + 8)
    return toChatRectSnapshot({ top: direct.top, left: direct.left, width: direct.width, height })
  }

  const column = measureChatRect(doc)
  if (!column) return null
  const height = resolveChatHeaderHeight(doc)
  return toChatRectSnapshot({ top: column.top, left: column.left, width: column.width, height })
}

function collectHeaderAnchorRects(doc: Document): DOMRect[] {
  const anchors: DOMRect[] = []
  const pushAnchor = (rect: DOMRect, maxHeight = 48) => {
    if (rect.width <= 0 || rect.height <= 0 || rect.height > maxHeight) return
    anchors.push(rect)
  }

  for (const selector of CHAT_HEADER_COLLAPSE_SELECTORS) {
    let nodes: NodeListOf<Element>
    try {
      nodes = doc.querySelectorAll(selector)
    } catch {
      continue
    }
    for (const element of Array.from(nodes)) {
      pushAnchor(element.getBoundingClientRect(), 40)
    }
  }

  for (const selector of [...CHAT_VIEWERS_SELECTORS, ...CHAT_COMMUNITY_SELECTORS]) {
    let nodes: NodeListOf<Element>
    try {
      nodes = doc.querySelectorAll(selector)
    } catch {
      continue
    }
    for (const element of Array.from(nodes)) {
      pushAnchor(element.getBoundingClientRect(), 40)
    }
  }

  for (const selector of CHAT_HEADER_TITLE_SELECTORS) {
    let nodes: NodeListOf<Element>
    try {
      nodes = doc.querySelectorAll(selector)
    } catch {
      continue
    }
    for (const element of Array.from(nodes)) {
      pushAnchor(element.getBoundingClientRect(), 36)
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
  const columnRect = column ?? (() => {
    const measured = measureChatRect(doc)
    return measured ? toChatRectSnapshot(measured) : null
  })()
  if (!columnRect) return null

  const anchors = collectHeaderAnchorRects(doc)
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
    top = fallback.top
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

/**
 * Bottom edge of in-chat notices / pinned highlights below the header.
 *
 * Measurement helper only — deliberately NOT part of resolveChatContentTop.
 * Everything matched by CHAT_TOP_NOTICE_SELECTORS is transient popup chrome
 * (chat notifications, user notices, pinned/community highlights) that pops in
 * and out while chat runs; using it for panel placement shifted the
 * position:fixed Pulse host downward with no clean recovery.
 */
export function resolveChatTopNoticeBottom(
  doc: Document,
  headerBottom: number,
  column: { readonly top: number; readonly bottom: number; readonly left: number; readonly width: number },
): number {
  return resolveChatTopBannerBottom(doc, headerBottom, column, CHAT_TOP_NOTICE_SELECTORS, 220)
}

/**
 * Top of the Pulse panel body — the measured chat-header bar bottom only.
 *
 * Promo/gift rows, notices, and the live message list are transient body
 * content. They must never raise panel.top: Twitch inserts/removes them while
 * chat runs, and the Pulse hosts are position:fixed (mount.tsx BASE_STYLE).
 * Following those rects made the host jump downward and wait for a lucky
 * reflow before recovering. The lower edge is still clamped separately by the
 * composer/bottom-chrome measurement in resolveChatPanelRect.
 */
export function resolveChatContentTop(
  doc: Document,
  headerBottom: number,
  column: ChatRectSnapshot,
): number {
  void doc
  void column
  return headerBottom
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

/** Panel body below the stable chat header, above the composer clamp. */
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

const PERIODIC_REMEASURE_MS = 2000

/** Chat message subtrees whose ordinary child churn cannot change snap geometry. */
export const CHAT_MESSAGE_LIST_IGNORE_SELECTORS: readonly string[] = [
  ...CHAT_MESSAGES_SELECTORS,
  '[role="log"]',
]

/** Stable geometry targets; transient promo/notice/message rects are excluded. */
export const CHAT_GEOMETRY_SELECTORS: readonly string[] = [
  ...CHAT_COLUMN_SELECTORS,
  ...CHAT_HEADER_SELECTORS,
  ...CHAT_HEADER_TITLE_SELECTORS,
  ...CHAT_HEADER_COLLAPSE_SELECTORS,
  ...CHAT_HEADER_TRAILING_SELECTORS,
  ...CHAT_COMPOSER_SELECTORS,
]

/** Mutation triggers only; never use these rects to place or size Pulse. */
const CHAT_TRANSIENT_CHROME_SELECTORS: readonly string[] = [
  '[data-a-target="chat-banner"]',
  '[data-a-target="chat-room-banner"]',
  '[data-a-target="chat-room-promo"]',
  '[data-test-selector="chat-banner"]',
  ...CHAT_GIFT_ROW_SELECTORS,
  ...CHAT_TOP_NOTICE_SELECTORS,
]

/** Stable chrome plus bottom clamp elements whose transitions can change height. */
const CHAT_LAYOUT_MUTATION_SELECTORS: readonly string[] = [
  ...CHAT_HEADER_SELECTORS,
  ...CHAT_HEADER_TITLE_SELECTORS,
  ...CHAT_HEADER_COLLAPSE_SELECTORS,
  ...CHAT_HEADER_TRAILING_SELECTORS,
  ...CHAT_COMPOSER_SELECTORS,
  ...CHAT_BOTTOM_CLAMP_SELECTORS,
]

/** Attribute changes that can reveal, hide, or reposition Twitch chat chrome. */
export const CHAT_GEOMETRY_ATTRIBUTE_FILTER = [
  'class',
  'style',
  'hidden',
  'aria-hidden',
  'aria-expanded',
] as const

/** rAF remeasure burst stops rescheduling after this long since the trigger. */
export const CHAT_SNAP_REMEASURE_WINDOW_MS = 600
/** One trailing measurement after the window so late CSS transitions still land. */
export const CHAT_SNAP_FINAL_MEASURE_DELAY_MS = 650

export interface BoundedRemeasureSchedulerHooks {
  now: () => number
  requestAnimationFrame: (callback: () => void) => number
  cancelAnimationFrame: (id: number) => void
  setTimeout: (callback: () => void, ms: number) => number
  clearTimeout: (id: number) => void
}

/** Testable ancestry check used by the mutation filter and focused tests. */
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

function mutationTargetElement(node: Node | null): Element | null {
  if (!node) return null
  if (node.nodeType === 1) return node as Element
  return node.parentElement
}

function matchesAnySelector(element: Element, selectors: readonly string[]): boolean {
  for (const selector of selectors) {
    try {
      if (element.matches(selector)) return true
    } catch {
      continue
    }
  }
  return false
}

function matchesAnySelectorAncestry(element: Element, selectors: readonly string[]): boolean {
  for (const selector of selectors) {
    try {
      if (element.closest(selector)) return true
    } catch {
      continue
    }
  }
  return false
}

function containsAnySelector(element: Element, selectors: readonly string[]): boolean {
  for (const selector of selectors) {
    try {
      if (element.querySelector(selector)) return true
    } catch {
      continue
    }
  }
  return false
}

function nodeContainsAnySelector(node: Node | null, selectors: readonly string[]): boolean {
  const element = mutationTargetElement(node)
  if (!element) return false
  return matchesAnySelector(element, selectors) || containsAnySelector(element, selectors)
}

type ChatGeometryMutation = Pick<MutationRecord, 'target'> & Partial<
  Pick<MutationRecord, 'type' | 'addedNodes' | 'removedNodes'>
>

function mutationNodes(mutation: ChatGeometryMutation): Node[] {
  return [
    ...(mutation.addedNodes ? Array.from(mutation.addedNodes) : []),
    ...(mutation.removedNodes ? Array.from(mutation.removedNodes) : []),
  ]
}

function allMutationNodesMatch(
  nodes: readonly Node[],
  selectors: readonly string[],
): boolean {
  return nodes.length > 0 && nodes.every(node => nodeContainsAnySelector(node, selectors))
}

/**
 * Ignore ordinary message insertion/removal and message-node attribute churn.
 * Structural mutations in the chat column, header, composer, or route shell
 * remain relevant. This keeps the observer useful for real transitions without
 * letting a busy chat log extend or restart a remeasurement burst.
 */
export function shouldScheduleChatGeometryFromMutations(
  mutations: ReadonlyArray<ChatGeometryMutation>,
): boolean {
  return mutations.some(mutation => {
    const element = mutationTargetElement(mutation.target)
    if (!element) return true

    const type = mutation.type ?? 'childList'
    const inMessageList = matchesChatMessageListAncestry(selector => element.closest(selector))
    const transientElement = matchesAnySelectorAncestry(element, CHAT_TRANSIENT_CHROME_SELECTORS)

    if (type === 'attributes') {
      if (transientElement) return false
      if (inMessageList) {
        // A class/style change on the list root can change the chat layout; a
        // class/style change on an individual message cannot.
        return matchesAnySelector(element, CHAT_MESSAGE_LIST_IGNORE_SELECTORS)
      }
      return (
        matchesAnySelector(element, CHAT_COLUMN_SELECTORS)
        || matchesAnySelectorAncestry(element, CHAT_LAYOUT_MUTATION_SELECTORS)
        || containsAnySelector(element, CHAT_COLUMN_SELECTORS)
      )
    }

    const nodes = mutationNodes(mutation)
    // A top promo/gift/notice may be inserted directly into the column. It is
    // intentionally not a snap anchor, so do not start a transition burst for
    // a mutation made up only of that transient chrome.
    if (transientElement || allMutationNodesMatch(nodes, CHAT_TRANSIENT_CHROME_SELECTORS)) {
      return false
    }

    // Child churn inside the live log is intentionally ignored, including
    // ordinary message nodes and their emote/image subtrees.
    if (inMessageList) return false

    if (
      matchesAnySelector(element, CHAT_COLUMN_SELECTORS)
      || matchesAnySelectorAncestry(element, CHAT_LAYOUT_MUTATION_SELECTORS)
    ) {
      return true
    }

    return nodes.some(node => (
      nodeContainsAnySelector(node, CHAT_COLUMN_SELECTORS)
      || nodeContainsAnySelector(node, CHAT_LAYOUT_MUTATION_SELECTORS)
    ))
  })
}

/**
 * Measure on every animation frame for a bounded ELAPSED-TIME window after a
 * trigger, then run exactly one trailing measurement.
 *
 * Frame-count bursts stop too early on low-refresh-rate displays while Twitch's
 * sidebar CSS transitions are still settling; bounding by elapsed time gives
 * the same settle window at any refresh rate, and the final timeout guarantees
 * one stable measurement even if animation frames stop firing entirely.
 * Re-triggers during an active burst are ignored instead of extending it —
 * chat message churn fires mutations continuously, so extending would keep the
 * loop alive forever.
 */
export function createBoundedRemeasureScheduler(
  measure: () => void,
  hooks: BoundedRemeasureSchedulerHooks,
): { schedule: () => void; dispose: () => void } {
  let disposed = false
  let rafId: number | null = null
  let finalTimeoutId: number | null = null
  let windowDeadline = 0

  function measureFrame(): void {
    rafId = null
    if (disposed) return
    measure()
    if (!disposed && hooks.now() < windowDeadline) {
      let callbackRanSynchronously = false
      const nextRafId = hooks.requestAnimationFrame(() => {
        callbackRanSynchronously = true
        measureFrame()
      })
      if (!callbackRanSynchronously) rafId = nextRafId
    }
  }

  function finalMeasure(): void {
    finalTimeoutId = null
    if (rafId !== null) {
      hooks.cancelAnimationFrame(rafId)
      rafId = null
    }
    if (disposed) return
    measure()
  }

  function schedule(): void {
    if (disposed || rafId !== null || finalTimeoutId !== null) return
    windowDeadline = hooks.now() + CHAT_SNAP_REMEASURE_WINDOW_MS
    let callbackRanSynchronously = false
    const nextRafId = hooks.requestAnimationFrame(() => {
      callbackRanSynchronously = true
      measureFrame()
    })
    if (!callbackRanSynchronously) rafId = nextRafId
    finalTimeoutId = hooks.setTimeout(finalMeasure, CHAT_SNAP_FINAL_MEASURE_DELAY_MS)
  }

  function dispose(): void {
    disposed = true
    if (rafId !== null) hooks.cancelAnimationFrame(rafId)
    rafId = null
    if (finalTimeoutId !== null) hooks.clearTimeout(finalTimeoutId)
    finalTimeoutId = null
  }

  return { schedule, dispose }
}

function chatGeometryObservationTargets(
  doc: Document,
  column: Element | null,
): Element[] {
  const targets = new Set<Element>()
  if (column) targets.add(column)
  const scope: ParentNode = column ?? doc
  for (const selector of CHAT_GEOMETRY_SELECTORS) {
    try {
      for (const element of Array.from(scope.querySelectorAll(selector))) targets.add(element)
    } catch {
      continue
    }
  }
  return Array.from(targets)
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
  let observedTargets: Element[] = []
  let singleRafId: number | null = null
  let disposed = false

  function syncObservedTargets(column: Element | null): void {
    const nextTargets = chatGeometryObservationTargets(document, column)
    if (
      nextTargets.length === observedTargets.length
      && nextTargets.every((element, index) => element === observedTargets[index])
    ) {
      return
    }
    resizeObserver?.disconnect()
    observedTargets = nextTargets
    for (const element of observedTargets) resizeObserver?.observe(element)
  }

  function measure(): void {
    if (disposed) return
    const resolved = resolveChatColumn()
    const rect = resolved?.rect ?? null
    syncObservedTargets(resolved?.element ?? null)

    const key = rectKey(rect)
    if (key !== lastKey) {
      lastKey = key
      cb(rect)
    }
  }

  const remeasurer = createBoundedRemeasureScheduler(measure, {
    now: () => Date.now(),
    requestAnimationFrame: callback => window.requestAnimationFrame(callback),
    cancelAnimationFrame: id => window.cancelAnimationFrame(id),
    setTimeout: (callback, ms) => window.setTimeout(callback, ms),
    clearTimeout: id => window.clearTimeout(id),
  })
  const scheduleMeasure = () => remeasurer.schedule()
  const scheduleSingleMeasure = () => {
    if (disposed || singleRafId !== null) return
    singleRafId = window.requestAnimationFrame(() => {
      singleRafId = null
      measure()
    })
  }

  const resizeObserver =
    typeof ResizeObserver !== 'undefined' ? new ResizeObserver(scheduleMeasure) : null

  const mutationObserver = new MutationObserver(mutations => {
    if (shouldScheduleChatGeometryFromMutations(mutations)) scheduleMeasure()
  })
  if (document.body) {
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [...CHAT_GEOMETRY_ATTRIBUTE_FILTER],
    })
  }

  window.addEventListener('resize', scheduleMeasure, { passive: true })
  window.addEventListener('scroll', scheduleSingleMeasure, { passive: true, capture: true })
  const intervalId = window.setInterval(measure, PERIODIC_REMEASURE_MS)

  measure()

  return () => {
    disposed = true
    remeasurer.dispose()
    if (singleRafId !== null) window.cancelAnimationFrame(singleRafId)
    singleRafId = null
    window.clearInterval(intervalId)
    window.removeEventListener('resize', scheduleMeasure)
    window.removeEventListener('scroll', scheduleSingleMeasure, { capture: true } as EventListenerOptions)
    mutationObserver.disconnect()
    resizeObserver?.disconnect()
  }
}

/**
 * Observe chat column + header height for sidebar snap layout.
 *
 * Remeasures run on every animation frame across a bounded elapsed-time window
 * (~600ms) after each trigger, followed by one final measurement (~650ms), so
 * Twitch's CSS transitions still produce a stable snapshot on any refresh rate.
 */
export function observeChatSnapLayout(cb: (layout: SidebarSnapLayout | null) => void): () => void {
  let lastKey: string | null = null
  let observedTargets: Element[] = []
  let singleRafId: number | null = null
  let disposed = false

  function syncObservedTargets(column: Element | null): void {
    const nextTargets = chatGeometryObservationTargets(document, column)
    if (
      nextTargets.length === observedTargets.length
      && nextTargets.every((element, index) => element === observedTargets[index])
    ) {
      return
    }
    resizeObserver?.disconnect()
    observedTargets = nextTargets
    for (const element of observedTargets) resizeObserver?.observe(element)
  }

  function measure(): void {
    if (disposed) return
    const resolved = resolveChatColumn()
    syncObservedTargets(resolved?.element ?? null)
    const layout = measureSidebarSnapLayout()
    const key = layoutKey(layout)
    if (key !== lastKey) {
      lastKey = key
      cb(layout)
    }
  }

  // Bounded burst: rAF measurements until ~600ms since the trigger, then one
  // final measurement at ~650ms. Re-triggers never extend the window.
  const remeasurer = createBoundedRemeasureScheduler(measure, {
    now: () => Date.now(),
    requestAnimationFrame: callback => window.requestAnimationFrame(callback),
    cancelAnimationFrame: id => window.cancelAnimationFrame(id),
    setTimeout: (callback, ms) => window.setTimeout(callback, ms),
    clearTimeout: id => window.clearTimeout(id),
  })
  const scheduleMeasure = () => remeasurer.schedule()
  const scheduleSingleMeasure = () => {
    if (disposed || singleRafId !== null) return
    singleRafId = window.requestAnimationFrame(() => {
      singleRafId = null
      measure()
    })
  }

  const resizeObserver =
    typeof ResizeObserver !== 'undefined' ? new ResizeObserver(scheduleMeasure) : null

  const mutationObserver = new MutationObserver(mutations => {
    if (shouldScheduleChatGeometryFromMutations(mutations)) scheduleMeasure()
  })
  if (document.body) {
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [...CHAT_GEOMETRY_ATTRIBUTE_FILTER],
    })
  }

  window.addEventListener('resize', scheduleMeasure, { passive: true })
  window.addEventListener('scroll', scheduleSingleMeasure, { passive: true, capture: true })
  const intervalId = window.setInterval(measure, PERIODIC_REMEASURE_MS)

  measure()

  return () => {
    disposed = true
    remeasurer.dispose()
    if (singleRafId !== null) window.cancelAnimationFrame(singleRafId)
    singleRafId = null
    window.clearInterval(intervalId)
    window.removeEventListener('resize', scheduleMeasure)
    window.removeEventListener('scroll', scheduleSingleMeasure, { capture: true } as EventListenerOptions)
    mutationObserver.disconnect()
    resizeObserver?.disconnect()
  }
}
