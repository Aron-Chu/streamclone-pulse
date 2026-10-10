import { CHAT_CRESTS_KEY, CHAT_PAINT_MOTION_KEY, DEFAULT_CHAT_CRESTS, DEFAULT_CHAT_PAINT_MOTION, type ChatBadgeEntry, type ChatBadgesReply } from '../shared/chatBadges.ts'
import { CHAT_BADGES_STYLE_ID, ChatBadgeDecorator } from './chatBadgeDom.ts'

/**
 * content/chat-badges.js: the Seen in chat decorator, built on its own by
 * vite.chatBadges.config.ts so it never counts against content/twitch.js's
 * size budget. The worker registers it for Twitch pages only while there is a
 * list to show and the viewer setting is on.
 *
 * It gets the list from the worker by message (content scripts cannot read the
 * worker's storage) and asks again every 10 minutes while the tab is visible,
 * or when the worker says something changed. It only reads Twitch's chat DOM
 * and adds its own nodes: no Twitch GQL, cookies or storage, and nothing is
 * ever sent to Twitch.
 */

const ASK_EVERY_MS = 10 * 60_000
/** A decorator left behind by a reloaded extension notices within this and removes itself. */
const ALIVE_CHECK_MS = 5_000

interface ChatBadgesInstance {
  alive(): boolean
  refresh(): void
  teardown(): void
}

declare global {
  // eslint-disable-next-line no-var
  var __pulseChatBadges: ChatBadgesInstance | undefined
}

function runtimeAlive(): boolean {
  try { return Boolean(chrome.runtime?.id) } catch { return false }
}

function start(): ChatBadgesInstance {
  const decorator = new ChatBadgeDecorator(document)
  // An orphaned decorator from before an extension reload may still be on the
  // page; once it has removed itself, match the chat again.
  const orphan = document.getElementById(CHAT_BADGES_STYLE_ID) !== null
  let latest: readonly ChatBadgeEntry[] | null = null
  let have: string | undefined
  let lastAsk = 0
  let asking = false
  let expiry: ReturnType<typeof setTimeout> | null = null
  let dead = false

  const off = () => {
    have = undefined
    if (expiry !== null) clearTimeout(expiry)
    expiry = null
    decorator.stop()
  }

  const ask = async () => {
    if (dead || asking) return
    if (!runtimeAlive()) { teardown(); return }
    asking = true
    lastAsk = Date.now()
    try {
      const reply = await chrome.runtime.sendMessage({ type: 'CHAT_BADGES', ...(have ? { have } : {}) }) as ChatBadgesReply | undefined
      if (!reply || reply.type !== 'CHAT_BADGES' || 'off' in reply) { off(); return }
      if ('unchanged' in reply) return
      have = reply.ver
      latest = reply.u
      decorator.setList(reply.u)
      decorator.start()
      if (expiry !== null) clearTimeout(expiry)
      // Past the list's own expiry every crest goes, even without a reply.
      const left = reply.exp * 1000 - Date.now()
      if (left <= 0) off()
      else expiry = setTimeout(() => { void ask() }, Math.min(left + 1_000, 2 ** 31 - 1))
    } catch {
      if (!runtimeAlive()) teardown()
    } finally {
      asking = false
    }
  }

  const visible = () => {
    if (!runtimeAlive()) { teardown(); return }
    if (!document.hidden && Date.now() - lastAsk >= ASK_EVERY_MS) void ask()
  }
  const timer = setInterval(visible, ALIVE_CHECK_MS)
  if (orphan) setTimeout(() => { if (!dead && latest) decorator.setList(latest) }, ALIVE_CHECK_MS + 1_000)
  const onMessage = (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => {
    if (sender.id !== chrome.runtime.id || !message || typeof message !== 'object') return undefined
    const type = (message as { type?: unknown }).type
    if (type === 'CHAT_BADGES_CHANGED') void ask()
    // The worker (never the page) may read the decorator's own counters, for the e2e CPU budget.
    if (type === 'CHAT_BADGES_STATS') { sendResponse(decorator.snapshot()); return undefined }
    return undefined
  }
  const onStorage = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'sync') return
    if (CHAT_PAINT_MOTION_KEY in changes) decorator.setMotion(changes[CHAT_PAINT_MOTION_KEY].newValue === true)
    if (CHAT_CRESTS_KEY in changes) {
      if (changes[CHAT_CRESTS_KEY].newValue === false) off()
      else void ask()
    }
  }

  function teardown() {
    dead = true
    off()
    clearInterval(timer)
    document.removeEventListener('visibilitychange', visible)
    try { chrome.runtime.onMessage.removeListener(onMessage) } catch { /* context gone */ }
    try { chrome.storage.onChanged.removeListener(onStorage) } catch { /* context gone */ }
    if (globalThis.__pulseChatBadges === instance) globalThis.__pulseChatBadges = undefined
  }

  document.addEventListener('visibilitychange', visible)
  chrome.runtime.onMessage.addListener(onMessage)
  chrome.storage.onChanged.addListener(onStorage)

  const instance: ChatBadgesInstance = { alive: () => !dead && runtimeAlive(), refresh: () => { void ask() }, teardown }

  void chrome.storage.sync.get([CHAT_CRESTS_KEY, CHAT_PAINT_MOTION_KEY]).then(settings => {
    decorator.setMotion((settings[CHAT_PAINT_MOTION_KEY] ?? DEFAULT_CHAT_PAINT_MOTION) === true)
    if ((settings[CHAT_CRESTS_KEY] ?? DEFAULT_CHAT_CRESTS) !== false) void ask()
  }).catch(() => { void ask() })
  return instance
}

// Idempotent across re-injection: the worker injects into open tabs when it
// registers, and a registered script also runs on the next load. An instance
// left behind by a reloaded extension is torn down and replaced.
const existing = globalThis.__pulseChatBadges
if (existing?.alive()) existing.refresh()
else {
  existing?.teardown()
  globalThis.__pulseChatBadges = start()
}

export {}
