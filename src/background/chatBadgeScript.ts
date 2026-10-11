/** Built by vite.chatBadges.config.ts; never part of content/twitch.js. */
export const CHAT_BADGES_SCRIPT_FILE = 'content/chat-badges.js'
export const CHAT_BADGES_SCRIPT_ID = 'pulse-chat-badges'
export const CHAT_BADGES_TAB_PATTERN = 'https://www.twitch.tv/*'

type Registered = { id: string }
export type ChatBadgeScripting = {
  getRegisteredContentScripts: (filter?: { ids?: string[] }) => Promise<Registered[]>
  registerContentScripts: (scripts: chrome.scripting.RegisteredContentScript[]) => Promise<void>
  unregisterContentScripts: (filter?: { ids?: string[] }) => Promise<void>
  executeScript: (injection: chrome.scripting.ScriptInjection<unknown[], unknown>) => Promise<unknown>
}
export type ChatBadgeTabs = {
  query: (query: { url: string | string[] }) => Promise<Array<{ id?: number }>>
  sendMessage: (tabId: number, message: unknown) => Promise<unknown>
}

/**
 * Registers the chat decorator for Twitch pages only while it has something
 * to show (the viewer setting is on and a valid list, or your own entry, is
 * cached), and unregisters it otherwise. Registering also injects it into
 * Twitch tabs that are already open; the decorator is idempotent, so a second
 * injection does nothing.
 *
 * Top frame, isolated world, the extension's existing `scripting` permission
 * and Twitch host access: no new permission and no manifest change.
 */
export async function reconcileChatBadgeScript(scripting: ChatBadgeScripting, tabs: ChatBadgeTabs, want: boolean): Promise<'registered' | 'unregistered' | 'unchanged'> {
  let registered = false
  try {
    registered = (await scripting.getRegisteredContentScripts({ ids: [CHAT_BADGES_SCRIPT_ID] })).some(script => script.id === CHAT_BADGES_SCRIPT_ID)
  } catch {
    registered = false
  }
  if (want && !registered) {
    try {
      await scripting.registerContentScripts([{
        id: CHAT_BADGES_SCRIPT_ID,
        matches: [CHAT_BADGES_TAB_PATTERN],
        js: [CHAT_BADGES_SCRIPT_FILE],
        runAt: 'document_idle',
        allFrames: false,
        world: 'ISOLATED',
        persistAcrossSessions: true,
      }])
    } catch {
      return 'unchanged'
    }
    const open = await tabs.query({ url: CHAT_BADGES_TAB_PATTERN }).catch(() => [])
    await Promise.all(open.map(tab => typeof tab.id === 'number'
      ? scripting.executeScript({ target: { tabId: tab.id }, world: 'ISOLATED', files: [CHAT_BADGES_SCRIPT_FILE] }).catch(() => undefined)
      : undefined))
    return 'registered'
  }
  if (!want && registered) {
    await scripting.unregisterContentScripts({ ids: [CHAT_BADGES_SCRIPT_ID] }).catch(() => undefined)
    return 'unregistered'
  }
  return 'unchanged'
}

/** Tells decorating tabs to ask again now (the list, your own entry or a setting changed). */
export async function notifyChatBadgeTabs(tabs: ChatBadgeTabs): Promise<void> {
  const open = await tabs.query({ url: CHAT_BADGES_TAB_PATTERN }).catch(() => [])
  for (const tab of open) {
    if (typeof tab.id === 'number') void tabs.sendMessage(tab.id, { type: 'CHAT_BADGES_CHANGED' }).catch(() => undefined)
  }
}
