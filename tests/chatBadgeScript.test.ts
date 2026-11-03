import { describe, expect, it, vi } from 'vitest'
import { CHAT_BADGES_SCRIPT_FILE, CHAT_BADGES_SCRIPT_ID, notifyChatBadgeTabs, reconcileChatBadgeScript, type ChatBadgeScripting } from '../src/background/chatBadgeScript.ts'

describe('Seen in chat script registration', () => {
  function scripting(registered = false) {
    let ids = registered ? [CHAT_BADGES_SCRIPT_ID] : []
    const api = {
      getRegisteredContentScripts: vi.fn(async () => ids.map(id => ({ id }))),
      registerContentScripts: vi.fn(async (scripts: chrome.scripting.RegisteredContentScript[]) => { ids = scripts.map(script => script.id) }),
      unregisterContentScripts: vi.fn(async () => { ids = [] }),
      executeScript: vi.fn(async () => [{ result: undefined }]),
    }
    return api as typeof api & ChatBadgeScripting
  }
  const tabs = { query: vi.fn(async () => [{ id: 4 }, { id: 9 }, {}]), sendMessage: vi.fn(async () => undefined) }

  it('registers the decorator for Twitch top frames only when wanted, and injects it into open tabs once', async () => {
    const api = scripting()
    expect(await reconcileChatBadgeScript(api, tabs, true)).toBe('registered')
    expect(api.registerContentScripts).toHaveBeenCalledWith([{ id: CHAT_BADGES_SCRIPT_ID, matches: ['https://www.twitch.tv/*'], js: [CHAT_BADGES_SCRIPT_FILE], runAt: 'document_idle', allFrames: false, world: 'ISOLATED', persistAcrossSessions: true }])
    expect(api.executeScript.mock.calls.map(([injection]) => injection)).toEqual([
      { target: { tabId: 4 }, world: 'ISOLATED', files: ['content/chat-badges.js'] },
      { target: { tabId: 9 }, world: 'ISOLATED', files: ['content/chat-badges.js'] },
    ])
    expect(await reconcileChatBadgeScript(api, tabs, true)).toBe('unchanged')
    expect(api.executeScript).toHaveBeenCalledTimes(2)
    expect(await reconcileChatBadgeScript(api, tabs, false)).toBe('unregistered')
    expect(api.unregisterContentScripts).toHaveBeenCalledWith({ ids: [CHAT_BADGES_SCRIPT_ID] })
    expect(await reconcileChatBadgeScript(api, tabs, false)).toBe('unchanged')
  })

  it('tells decorating tabs to ask again, with no data in the message', async () => {
    await notifyChatBadgeTabs(tabs)
    expect(tabs.sendMessage.mock.calls).toEqual([[4, { type: 'CHAT_BADGES_CHANGED' }], [9, { type: 'CHAT_BADGES_CHANGED' }]])
  })

  it('reports an error if registration state cannot be read', async () => {
    const api = scripting()
    api.getRegisteredContentScripts.mockRejectedValueOnce(new Error('browser unavailable'))
    expect(await reconcileChatBadgeScript(api, tabs, false)).toBe('error')
    expect(api.registerContentScripts).not.toHaveBeenCalled()
    expect(api.unregisterContentScripts).not.toHaveBeenCalled()
  })

  it('does not report a successful unregister when the browser rejects it', async () => {
    const api = scripting(true)
    api.unregisterContentScripts.mockRejectedValueOnce(new Error('browser unavailable'))
    expect(await reconcileChatBadgeScript(api, tabs, false)).toBe('error')
    expect(await reconcileChatBadgeScript(api, tabs, false)).toBe('unregistered')
  })

  it('does not inject into open tabs when registration fails', async () => {
    const api = scripting()
    api.registerContentScripts.mockRejectedValueOnce(new Error('browser unavailable'))
    expect(await reconcileChatBadgeScript(api, tabs, true)).toBe('error')
    expect(api.executeScript).not.toHaveBeenCalled()
  })
})
