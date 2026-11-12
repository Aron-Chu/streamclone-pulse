// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CHAT_CRESTS_KEY } from '../src/shared/chatBadges.ts'
import { chatContainer, chatLine, FIXTURE_LIST, FIXTURE_PEOPLE } from './fixtures/chat-badges/chatMarkup.ts'

const NOW = 1_800_000_000_000
const reply = (expiry = NOW / 1000 + 300) => ({ type: 'CHAT_BADGES', ver: '1', exp: expiry, u: [FIXTURE_LIST[0]] })
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }

describe('chat badge content script', () => {
  let settingChanged: (changes: Record<string, { newValue: unknown }>, area: string) => void
  let messageReceived: (message: unknown, sender: { id: string }) => void
  const sendMessage = vi.fn()
  const getSettings = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    sendMessage.mockReset()
    getSettings.mockReset().mockResolvedValue({})
    document.body.innerHTML = chatContainer('native', chatLine('native', FIXTURE_PEOPLE[0]))
    vi.stubGlobal('chrome', {
      runtime: {
        id: 'fixture-extension', sendMessage,
        onMessage: { addListener: (listener: typeof messageReceived) => { messageReceived = listener }, removeListener: vi.fn() },
      },
      storage: {
        sync: { get: getSettings },
        onChanged: { addListener: (listener: typeof settingChanged) => { settingChanged = listener }, removeListener: vi.fn() },
      },
    })
  })

  afterEach(() => {
    globalThis.__pulseChatBadges?.teardown()
    vi.unstubAllGlobals()
    vi.useRealTimers()
    document.body.innerHTML = ''
    document.head.innerHTML = ''
  })

  it('removes an expired badge even while the worker does not respond', async () => {
    sendMessage.mockResolvedValueOnce(reply(NOW / 1000 + 5)).mockImplementation(() => new Promise(() => {}))
    await import('../src/content/chatBadges.ts')
    await flush()
    expect(document.querySelector('.sp-cb-crest')).not.toBeNull()

    await vi.advanceTimersByTimeAsync(5_001)
    expect(document.querySelector('.sp-cb-crest')).toBeNull()
    expect(document.querySelector('[data-sp-paint]')).toBeNull()
  })

  it('keeps badges hidden when an earlier request completes after the viewer switches them off', async () => {
    let respond!: (value: ReturnType<typeof reply>) => void
    sendMessage.mockImplementationOnce(() => new Promise(resolve => { respond = resolve }))
    await import('../src/content/chatBadges.ts')
    await flush()
    settingChanged({ [CHAT_CRESTS_KEY]: { newValue: false } }, 'sync')
    respond(reply())
    await flush()
    expect(document.querySelector('.sp-cb-crest')).toBeNull()
    expect(document.querySelector('[data-sp-paint]')).toBeNull()
  })

  it('does not let a slow initial settings read override a later hide', async () => {
    let finishRead!: (value: Record<string, boolean>) => void
    getSettings.mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve }))
    await import('../src/content/chatBadges.ts')
    settingChanged({ [CHAT_CRESTS_KEY]: { newValue: false } }, 'sync')
    finishRead({ [CHAT_CRESTS_KEY]: true })
    await flush()
    expect(sendMessage).not.toHaveBeenCalled()
    expect(document.querySelector('.sp-cb-crest')).toBeNull()
  })

  it('ignores a delayed reply issued before expiry and asks again', async () => {
    let respond!: (value: ReturnType<typeof reply>) => void
    sendMessage.mockResolvedValueOnce(reply(NOW / 1000 + 5))
      .mockImplementationOnce(() => new Promise(resolve => { respond = resolve }))
      .mockResolvedValue({ type: 'CHAT_BADGES', off: true })
    await import('../src/content/chatBadges.ts')
    await flush()
    messageReceived({ type: 'CHAT_BADGES_CHANGED' }, { id: 'fixture-extension' })
    await vi.advanceTimersByTimeAsync(5_001)
    expect(document.querySelector('.sp-cb-crest')).toBeNull()
    respond(reply())
    await flush()
    expect(sendMessage).toHaveBeenCalledTimes(3)
    expect(document.querySelector('.sp-cb-crest')).toBeNull()
  })

  it('refreshes after re-enabling while the previous request is still in flight', async () => {
    let respond!: (value: ReturnType<typeof reply>) => void
    sendMessage.mockImplementationOnce(() => new Promise(resolve => { respond = resolve })).mockResolvedValue(reply())
    await import('../src/content/chatBadges.ts')
    await flush()
    settingChanged({ [CHAT_CRESTS_KEY]: { newValue: false } }, 'sync')
    settingChanged({ [CHAT_CRESTS_KEY]: { newValue: true } }, 'sync')
    respond(reply())
    await flush()
    expect(sendMessage).toHaveBeenCalledTimes(2)
    expect(document.querySelector('.sp-cb-crest')).not.toBeNull()
  })
})
