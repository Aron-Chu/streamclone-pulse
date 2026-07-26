import type { OverlayMode, SidebarTab } from '../shared/storage.ts'
import {
  DEFAULT_CHAT_HEADER_HEIGHT,
  isUsableChatRect,
  measureChatRect,
  resolveChatColumn,
  resolveChatHeaderHeight,
  resolveChatMessagesRect as resolveChatMessagesRectDirect,
} from './twitchChat.ts'

export const CHROME_BAR_HEIGHT = 40
export const CHROME_OFFSET = 8
export const GLOBAL_NAV_MIN_TOP = 56
export const FALLBACK_CHAT_HEADER_HEIGHT = DEFAULT_CHAT_HEADER_HEIGHT
export const SIDEBAR_MINI_PANEL_HEIGHT = 72
export const SIDEBAR_COLLAPSED_PILL_HEIGHT = 52

export const CHROME_ANCHOR_SELECTORS: readonly string[] = [
  '.channel-info-content',
  '[data-a-target="channel-header-subscribe-button"]',
]

export { CHAT_HEADER_SELECTORS, CHAT_MESSAGES_SELECTORS } from './twitchChat.ts'

export interface BoxRect {
  readonly top: number
  readonly left: number
  readonly width: number
  readonly height: number
  readonly right: number
  readonly bottom: number
}

/** Viewport-relative snapshot for sidebar snap layout. */
export interface SidebarLayoutSnapshot {
  readonly chatColumn: BoxRect
  readonly messagesArea: BoxRect
  readonly chromeBar: BoxRect
}

export interface SidebarHostRectPlan {
  readonly chrome: BoxRect
  readonly panel: BoxRect | null
  readonly chromeVisible: boolean
  readonly panelVisible: boolean
}

export function toBoxRect(
  rect: { readonly top: number; readonly left: number; readonly width: number; readonly height: number },
): BoxRect {
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
  }
}

export function makeRect(left: number, top: number, width: number, height: number): BoxRect {
  return toBoxRect({ left, top, width, height })
}

/** @deprecated alias */
export const deriveMessagesAreaFromColumn = computeMessagesAreaRect

export function computeMessagesAreaRect(
  chatColumn: { readonly top: number; readonly left: number; readonly width: number; readonly height: number },
  headerHeight: number,
): BoxRect {
  const top = chatColumn.top + headerHeight
  const height = Math.max(0, chatColumn.height - headerHeight)
  return makeRect(chatColumn.left, top, chatColumn.width, height)
}

/** @deprecated alias */
export const deriveChromeBarRect = computeChromeBarRect

export function computeChromeBarRect(
  chatColumn: { readonly left: number; readonly width: number },
  anchorTop: number,
): BoxRect {
  const top = Math.max(GLOBAL_NAV_MIN_TOP, anchorTop)
  return makeRect(chatColumn.left, top, chatColumn.width, CHROME_BAR_HEIGHT)
}

export function resolveChromeAnchorTop(
  doc: Document = document,
  chatColumnRect?: DOMRect | null,
): number {
  for (const selector of CHROME_ANCHOR_SELECTORS) {
    let node: Element | null
    try {
      node = doc.querySelector(selector)
    } catch {
      continue
    }
    if (!node) continue
    const rect = node.getBoundingClientRect()
    if (rect.height > 0) return rect.top
    let parent = node.parentElement
    for (let depth = 0; parent && depth < 4; depth += 1) {
      const parentRect = parent.getBoundingClientRect()
      if (parentRect.height > 0) return parentRect.top
      parent = parent.parentElement
    }
  }

  const column = chatColumnRect ?? measureChatRect(doc)
  if (column) {
    return Math.max(GLOBAL_NAV_MIN_TOP, column.top - CHROME_OFFSET)
  }
  return GLOBAL_NAV_MIN_TOP
}

export function resolveChatMessagesRect(
  doc: Document = document,
  chatColumnRect?: DOMRect | null,
): BoxRect | null {
  const direct = resolveChatMessagesRectDirect(doc)
  if (direct && direct.width >= 80 && direct.height >= 80) return toBoxRect(direct)

  const column = chatColumnRect ?? measureChatRect(doc)
  if (!column || !isUsableChatRect(column)) return null

  const chatLayout = resolveChatColumn(doc)?.element ?? null
  const headerHeight = resolveChatHeaderHeight(doc, chatLayout)
  return computeMessagesAreaRect(toBoxRect(column), headerHeight)
}

export function buildSidebarLayoutSnapshot(doc: Document = document): SidebarLayoutSnapshot | null {
  const chatColumnEl = measureChatRect(doc)
  if (!chatColumnEl || !isUsableChatRect(chatColumnEl)) return null

  const chatColumn = toBoxRect(chatColumnEl)
  const messagesArea = resolveChatMessagesRect(doc, chatColumnEl)
  if (!messagesArea) return null

  const anchorTop = resolveChromeAnchorTop(doc, chatColumnEl)
  const chromeBar = computeChromeBarRect(chatColumn, anchorTop)

  return { chatColumn, messagesArea, chromeBar }
}

export function planSidebarHostRects(
  snapshot: SidebarLayoutSnapshot,
  mode: OverlayMode,
  sidebarTab: SidebarTab,
): SidebarHostRectPlan {
  const { chromeBar, messagesArea } = snapshot

  if (mode === 'collapsed') {
    const panel = makeRect(
      messagesArea.left,
      messagesArea.bottom - SIDEBAR_COLLAPSED_PILL_HEIGHT,
      messagesArea.width,
      SIDEBAR_COLLAPSED_PILL_HEIGHT,
    )
    return {
      chrome: chromeBar,
      panel,
      chromeVisible: true,
      panelVisible: true,
    }
  }

  if (sidebarTab === 'chat') {
    return {
      chrome: chromeBar,
      panel: null,
      chromeVisible: true,
      panelVisible: false,
    }
  }

  if (mode === 'mini') {
    const panel = makeRect(
      messagesArea.left,
      messagesArea.bottom - SIDEBAR_MINI_PANEL_HEIGHT,
      messagesArea.width,
      SIDEBAR_MINI_PANEL_HEIGHT,
    )
    return {
      chrome: chromeBar,
      panel,
      chromeVisible: true,
      panelVisible: true,
    }
  }

  return {
    chrome: chromeBar,
    panel: messagesArea,
    chromeVisible: true,
    panelVisible: true,
  }
}

export function applyBoxRectToElement(
  el: HTMLElement | null,
  rect: BoxRect | null,
  visible: boolean,
): void {
  if (!el) return
  if (!visible || !rect) {
    el.style.display = 'none'
    return
  }
  el.style.display = 'block'
  el.style.transform = 'none'
  el.style.top = `${rect.top}px`
  el.style.left = `${rect.left}px`
  el.style.width = `${rect.width}px`
  el.style.height = `${rect.height}px`
}

const PERIODIC_REMEASURE_MS = 2000

function snapshotKey(snapshot: SidebarLayoutSnapshot | null): string {
  if (!snapshot) return 'null'
  return [snapshot.chatColumn, snapshot.messagesArea, snapshot.chromeBar]
    .map(rect =>
      [Math.round(rect.left), Math.round(rect.top), Math.round(rect.width), Math.round(rect.height)].join(':'),
    )
    .join('|')
}

export function observeSidebarLayout(
  cb: (snapshot: SidebarLayoutSnapshot | null) => void,
): () => void {
  let lastKey: string | null = null
  let rafId = 0
  let observedEl: Element | null = null
  let disposed = false

  const resizeObserver =
    typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => scheduleMeasure()) : null

  function measure(): void {
    if (disposed) return
    const resolved = resolveChatColumn()
    const element = resolved?.element ?? null

    if (element !== observedEl) {
      if (resizeObserver && observedEl) resizeObserver.unobserve(observedEl)
      observedEl = element
      if (resizeObserver && element) resizeObserver.observe(element)
    }

    const snapshot = buildSidebarLayoutSnapshot()
    const key = snapshotKey(snapshot)
    if (key !== lastKey) {
      lastKey = key
      cb(snapshot)
    }
  }

  function scheduleMeasure(): void {
    if (disposed || rafId) return
    rafId = requestAnimationFrame(() => {
      rafId = 0
      measure()
    })
  }

  const mutationObserver = new MutationObserver(() => scheduleMeasure())
  if (document.body) {
    mutationObserver.observe(document.body, { childList: true, subtree: true })
  }

  window.addEventListener('resize', scheduleMeasure, { passive: true })
  window.addEventListener('scroll', scheduleMeasure, { passive: true, capture: true })
  const intervalId = window.setInterval(measure, PERIODIC_REMEASURE_MS)

  measure()

  return () => {
    disposed = true
    if (rafId) cancelAnimationFrame(rafId)
    window.clearInterval(intervalId)
    window.removeEventListener('resize', scheduleMeasure)
    window.removeEventListener('scroll', scheduleMeasure, { capture: true } as EventListenerOptions)
    mutationObserver.disconnect()
    resizeObserver?.disconnect()
  }
}
