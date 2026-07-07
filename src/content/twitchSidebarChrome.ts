/** Non-destructive Twitch DOM tweaks while Pulse sidebar snap is active. */

export const TWITCH_SIDEBAR_HIDE_STYLE_ID = 'streamclone-pulse-sidebar-hide'

const HIDE_RULES = `
  [data-a-target="chat-room-header"] h2,
  [data-test-selector="chat-room-header"] h2,
  [data-a-target="chat-room-header"] [class*="stream-chat-header"] {
    visibility: hidden !important;
  }
  [data-a-target="right-column__toggle-collapse-btn"],
  [data-a-target="collapse-chat"],
  [data-a-target="chat-viewers"],
  [data-a-target="community-tab"],
  [data-test-selector="chat-viewer-list"],
  button[aria-label*="Collapse" i][data-a-target="right-column__toggle-collapse-btn"],
  button[aria-label*="Expand" i][data-a-target="right-column__toggle-collapse-btn"],
  button[aria-label*="Community" i],
  button[aria-label*="Users in chat" i],
  button[aria-label*="Go back to Chat" i] {
    visibility: hidden !important;
    pointer-events: none !important;
  }
  [data-a-target="chat-scrollable-area__scroll-button"],
  button[aria-label*="Scroll to bottom" i],
  button[aria-label*="scroll to recent" i],
  button[aria-label*="New messages" i] {
    display: none !important;
    pointer-events: none !important;
  }
  [data-a-target="chat-scrollable-area"],
  [data-test-selector="chat-scrollable-area"],
  .chat-scrollable-area__message-container,
  [data-a-target="chat-scrollable-area"] [role="log"] {
    scrollbar-width: none !important;
    -ms-overflow-style: none !important;
  }
  [data-a-target="chat-scrollable-area"]::-webkit-scrollbar,
  [data-test-selector="chat-scrollable-area"]::-webkit-scrollbar,
  .chat-scrollable-area__message-container::-webkit-scrollbar,
  [data-a-target="chat-scrollable-area"] [role="log"]::-webkit-scrollbar {
    display: none !important;
    height: 0 !important;
    width: 0 !important;
  }
`

export function applyTwitchSidebarChromeHides(active: boolean): void {
  if (typeof document === 'undefined') return
  const existing = document.getElementById(TWITCH_SIDEBAR_HIDE_STYLE_ID)
  if (!active) {
    existing?.remove()
    return
  }
  if (existing) return
  const style = document.createElement('style')
  style.id = TWITCH_SIDEBAR_HIDE_STYLE_ID
  style.textContent = HIDE_RULES
  document.head.appendChild(style)
}
