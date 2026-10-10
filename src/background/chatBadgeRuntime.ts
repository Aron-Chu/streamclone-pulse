import { CHAT_CRESTS_KEY, DEFAULT_CHAT_CRESTS } from '../shared/chatBadges.ts'
import { chatBadgeEnvironments, pinnedChatBadgeKeys } from '../shared/chatBadgeKeys.ts'
import { SUPPORTER_PAINT_KEY, normalizeSupporterPaintStyle } from '../shared/supporterPaint.ts'
import { getSupporterPaintStyle } from '../shared/storage.ts'
import { ChatBadgeList } from './chatBadgeList.ts'
import { ChatBadgeOptIn } from './chatBadgeOptIn.ts'
import { CHAT_BADGES_TAB_PATTERN, notifyChatBadgeTabs, reconcileChatBadgeScript } from './chatBadgeScript.ts'
import { ACCOUNT_BACKEND_URL, accountRequest, supporterAccount } from './supporterAccountRuntime.ts'
import { twitchSignIn } from './twitchSignInRuntime.ts'

/**
 * Seen in chat, wired to the browser. The list lives in chrome.storage.local,
 * which only trusted extension contexts can read; tabs get it by message.
 */
const LIST_KEY = 'pulseChatBadgeList'
const store = typeof __EXTENSION_STORE_BUILD__ !== 'undefined' && __EXTENSION_STORE_BUILD__

async function viewerSettingOn(): Promise<boolean> {
  try {
    const stored = await chrome.storage.sync.get(CHAT_CRESTS_KEY)
    return (stored[CHAT_CRESTS_KEY] ?? DEFAULT_CHAT_CRESTS) !== false
  } catch {
    return DEFAULT_CHAT_CRESTS
  }
}

let reconcileQueued: Promise<void> | null = null
/** Register or unregister the decorator to match the list, then tell open tabs. */
export function reconcileChatBadges(): Promise<void> {
  if (!reconcileQueued) {
    reconcileQueued = (async () => {
      try {
        const want = await chatBadgeList.wanted()
        if (typeof chrome.scripting?.registerContentScripts === 'function') await reconcileChatBadgeScript(chrome.scripting, chrome.tabs, want)
        await notifyChatBadgeTabs(chrome.tabs)
      } catch { /* the next change reconciles again */ }
    })().finally(() => { reconcileQueued = null })
  }
  return reconcileQueued
}

export const chatBadgeList = new ChatBadgeList({
  fetch: (input, init) => fetch(input, init),
  // The same origin as the account service: production in every store build.
  origin: ACCOUNT_BACKEND_URL,
  keys: () => pinnedChatBadgeKeys(),
  environments: chatBadgeEnvironments(store),
  subtle: globalThis.crypto?.subtle,
  read: async () => (await chrome.storage.local.get(LIST_KEY))[LIST_KEY],
  write: async value => { await chrome.storage.local.set({ [LIST_KEY]: value }) },
  enabled: viewerSettingOn,
  changed: () => { void reconcileChatBadges() },
})

export const chatBadgeOptIn = new ChatBadgeOptIn({
  confirm: badge => twitchSignIn.confirmForBadge(badge),
  request: body => supporterAccount.withCredential(token => accountRequest('/v1/billing/badge', body, token)),
  list: chatBadgeList,
  invalidate: () => supporterAccount.invalidateEntitlement(),
  wave: async () => (await getSupporterPaintStyle()).wave,
  snapshot: async () => {
    const entitlement = await supporterAccount.cachedEntitlement()
    return entitlement.state === 'ready' ? entitlement.chatBadge : undefined
  },
})

/** Listeners; called once from the service worker. */
export function installChatBadges(): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return
    if (CHAT_CRESTS_KEY in changes) {
      void (async () => {
        // Turning crests back on with a Twitch tab open fetches a list if none is cached.
        if (changes[CHAT_CRESTS_KEY].newValue !== false) {
          const open = await chrome.tabs.query({ url: CHAT_BADGES_TAB_PATTERN }).catch(() => [])
          if (open.length) await chatBadgeList.bootstrap()
        }
        await reconcileChatBadges()
      })()
    }
    if (SUPPORTER_PAINT_KEY in changes) chatBadgeOptIn.waveChanged(normalizeSupporterPaintStyle(changes[SUPPORTER_PAINT_KEY].newValue).wave)
  })
  // Before any list exists, the first Twitch page load fetches one (bounded by the refresh schedule).
  chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete' || !tab.url?.startsWith('https://www.twitch.tv/')) return
    void chatBadgeList.bootstrap().catch(() => undefined)
  })
  chrome.runtime.onStartup.addListener(() => { void reconcileChatBadges() })
  chrome.runtime.onInstalled.addListener(() => { void reconcileChatBadges() })
}
