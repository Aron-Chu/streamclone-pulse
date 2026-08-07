/** Non-destructive Twitch DOM tweaks while Pulse sidebar snap is active. */

export const TWITCH_SIDEBAR_HIDE_STYLE_ID = 'streamclone-pulse-sidebar-hide'
export const PULSE_CHAT_COLUMN_ATTR = 'data-pulse-chat-column'
export const PULSE_EXTENSION_OWNED_ATTR = 'data-pulse-extension-owned'

const CHAT_SCOPE = `[${PULSE_CHAT_COLUMN_ATTR}="1"]`

function scoped(selectors: readonly string[]): string {
  return selectors.map(selector => `${CHAT_SCOPE} ${selector}`).join(',\n  ')
}

/**
 * Base chrome hides while Pulse is sidebar-snapped.
 * Scoped to the marked chat column only — never page-global matches.
 * Do NOT hide Twitch's message list, scroll area, or composer.
 * Do NOT hide Twitch's "scroll to bottom" / "new messages" chip — that control
 * owns chat pause/resume-follow. Destroying it causes auto-scroll fights.
 *
 * Native messages stay mounted and visible. The opaque Pulse panel host covers
 * them when the Pulse tab is selected; Chat tab only removes the Pulse surface.
 */
export const HIDE_RULES = `
  ${scoped([
    '[data-a-target="chat-room-header"] h2',
    '[data-test-selector="chat-room-header"] h2',
    '[data-a-target="chat-room-header"] [class*="stream-chat-header"]',
    '[data-a-target="right-column__toggle-collapse-btn"]',
    '[data-a-target="collapse-chat"]',
    '[data-a-target="chat-viewers"]',
    '[data-a-target="community-tab"]',
    '[data-test-selector="chat-viewer-list"]',
    'button[aria-label*="Collapse" i][data-a-target="right-column__toggle-collapse-btn"]',
    'button[aria-label*="Expand" i][data-a-target="right-column__toggle-collapse-btn"]',
    'button[aria-label*="Community" i]',
    'button[aria-label*="Users in chat" i]',
    'button[aria-label*="Go back to Chat" i]',
  ])} {
    visibility: hidden !important;
    pointer-events: none !important;
  }
`

/**
 * Compatibility shim only. Historical builds injected message-list hide rules.
 * This constant must never again contain selectors that hide Twitch's native
 * message log, scrollable area, or `[role="log"]` content.
 */
export const MESSAGES_HIDE_RULES = ''

/** Selectors previously used to blank native chat — kept for orphan recovery scans. */
export const LEGACY_MESSAGE_HIDE_SELECTOR_FRAGMENTS = [
  'chat-scrollable-area',
  'chat-scrollable-area__message-container',
  '[role="log"]',
] as const

function sidebarHideStyleContent(): string {
  return HIDE_RULES
}

export function clearPulseChatColumnMarkers(doc: Document = document): void {
  for (const el of Array.from(doc.querySelectorAll(`[${PULSE_CHAT_COLUMN_ATTR}]`))) {
    el.removeAttribute(PULSE_CHAT_COLUMN_ATTR)
  }
}

export function markPulseChatColumn(element: Element, doc: Document = document): void {
  clearPulseChatColumnMarkers(doc)
  element.setAttribute(PULSE_CHAT_COLUMN_ATTR, '1')
}

/**
 * Idempotent fail-open recovery for orphaned extension DOM/styles left behind by
 * a content-script reload or aborted lifecycle. Safe to run before every mount.
 */
export function recoverStaleTwitchSidebarChrome(doc: Document = document): void {
  const staleStyle = doc.getElementById(TWITCH_SIDEBAR_HIDE_STYLE_ID)
  if (staleStyle) {
    const text = staleStyle.textContent ?? ''
    const looksLikeLegacyMessageHide = LEGACY_MESSAGE_HIDE_SELECTOR_FRAGMENTS.some(fragment =>
      text.includes(fragment) && (text.includes('visibility: hidden') || text.includes('pointer-events: none')),
    )
    // Always remove orphans; a later apply will reinject the safe chrome-only rules.
    if (looksLikeLegacyMessageHide || text.trim().length > 0) {
      staleStyle.remove()
    }
  }
  clearPulseChatColumnMarkers(doc)
}

/**
 * Apply non-destructive header/community chrome hides while Pulse owns the sidebar.
 * `hideMessages` is retained for call-site compatibility and is intentionally ignored —
 * Pulse must never change native message-list visibility.
 */
export function applyTwitchSidebarChromeHides(
  active: boolean,
  _hideMessages = false,
  doc: Document = typeof document !== 'undefined' ? document : (undefined as unknown as Document),
): void {
  if (!doc) return
  const existing = doc.getElementById(TWITCH_SIDEBAR_HIDE_STYLE_ID)
  if (!active) {
    existing?.remove()
    clearPulseChatColumnMarkers(doc)
    return
  }
  const styleContent = sidebarHideStyleContent()
  if (existing) {
    if (existing.textContent === styleContent) return
    existing.textContent = styleContent
    return
  }
  const style = doc.createElement('style')
  style.id = TWITCH_SIDEBAR_HIDE_STYLE_ID
  style.textContent = styleContent
  doc.head.appendChild(style)
}
