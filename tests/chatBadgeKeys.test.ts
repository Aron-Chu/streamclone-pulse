import { afterEach, describe, expect, it, vi } from 'vitest'
import { E2E_CHAT_BADGE_KEY, resolveChatBadgeDevKeys } from '../scripts/chat-badge-keys.mjs'
import { chatBadgeEnvironments, pinnedChatBadgeKeys, STORE_CHAT_BADGE_KEYS } from '../src/shared/chatBadgeKeys.ts'

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

describe('chat badge signing key isolation', () => {
  it('never adds test or environment keys to a store build', () => {
    const supplied = JSON.stringify([{ kid: 'spb-live-9', key: E2E_CHAT_BADGE_KEY.key }])
    for (const target of ['cws', 'edge', 'firefox']) expect(resolveChatBadgeDevKeys(target, supplied)).toEqual([])
    expect(pinnedChatBadgeKeys(true, [E2E_CHAT_BADGE_KEY])).toEqual([...STORE_CHAT_BADGE_KEYS])
    expect(STORE_CHAT_BADGE_KEYS).not.toContainEqual(E2E_CHAT_BADGE_KEY)
    expect(chatBadgeEnvironments(true)).toEqual(['live'])
    expect(chatBadgeEnvironments(false)).toEqual(['live', 'sandbox'])
  })

  it('rejects malformed development keys rather than silently pinning them', () => {
    expect(() => resolveChatBadgeDevKeys('development', '[{"kid":"anything","key":"bad"}]')).toThrow()
  })

  it('does not fetch or register a list when no verification key is pinned', async () => {
    const fetchList = vi.fn()
    const read = vi.fn()
    vi.stubGlobal('fetch', fetchList)
    vi.stubGlobal('chrome', { storage: { sync: { get: read } } })
    const { chatBadgeList } = await import('../src/background/chatBadgeRuntime.ts')
    expect(chatBadgeList.keysPinned()).toBe(false)
    await chatBadgeList.bootstrap()
    expect(await chatBadgeList.ask()).toEqual({ type: 'CHAT_BADGES', off: true })
    expect(await chatBadgeList.wanted()).toBe(false)
    expect(fetchList).not.toHaveBeenCalled()
    expect(read).not.toHaveBeenCalled()
  })
})
