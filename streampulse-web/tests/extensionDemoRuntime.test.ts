import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFakeChrome, installFakeChrome } from '../src/demo/fakeChrome'
import { createDemoResponder, DEMO_MESSAGE_TYPES, type DemoVodPulse } from '../src/demo/demoResponder'
import { DEMO_CHANNEL, demoLeaveNote, isDemoExitUrl, toSiteUrl } from '../src/demo/demoLinks'
import tape from '../src/demo/demoTape.json'
// @ts-expect-error: a plain .mjs script with no types.
import { buildDemoTape, DEMO_CHANNEL_LOGIN, DEMO_CHANNEL_NAME, DEMO_STREAM_ID, DEMO_VOD_ID } from '../scripts/generate-demo-tape.mjs'

const extensionRoot = resolve(import.meta.dirname, '../..')
const vodPulse = tape as unknown as DemoVodPulse

/** The text of one declaration, from its first line to the first blank line or closing brace at column 0. */
function declaration(source: string, start: RegExp): string | null {
  const match = start.exec(source)
  if (!match) return null
  const rest = source.slice(match.index)
  const end = rest.search(/\n(?:\}|\s*\n)/)
  return end < 0 ? rest : rest.slice(0, end + 2)
}

const literalTypes = (text: string) => [...text.matchAll(/\btype:\s*'([A-Z_]+)'/g)].map(m => m[1])

/**
 * Every `type` the extension's BackgroundRequest union names, read from its
 * source (src/shared/messages.ts and the files it imports from), so a message
 * added in a later release shows up here without anyone updating a list.
 */
function backgroundRequestTypes(): string[] {
  const messagesPath = resolve(extensionRoot, 'src/shared/messages.ts')
  const messages = readFileSync(messagesPath, 'utf8')
  const union = declaration(messages, /export type BackgroundRequest =/)
  if (!union) throw new Error('BackgroundRequest not found in src/shared/messages.ts')
  const types = new Set(literalTypes(union))
  for (const [, file, name] of union.matchAll(/import\('(\.\/[^']+)'\)\.(\w+)/g)) {
    const source = readFileSync(resolve(dirname(messagesPath), file), 'utf8')
    const decl = declaration(source, new RegExp(`export type ${name} =`))
    if (!decl) throw new Error(`${name} not found in ${file}`)
    literalTypes(decl).forEach(type => types.add(type))
  }
  for (const [, name] of union.matchAll(/^\s*\|\s*([A-Z]\w+)\s*$/gm)) {
    const decl = declaration(messages, new RegExp(`export (?:interface ${name}\\b|type ${name} =)`))
    if (!decl) throw new Error(`${name} not found in src/shared/messages.ts`)
    const found = literalTypes(decl)
    if (found.length === 0) throw new Error(`${name} has no literal type`)
    found.forEach(type => types.add(type))
  }
  return [...types].sort()
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('demo responder', () => {
  it('lists every message type the extension panel can send', () => {
    const sent = backgroundRequestTypes()
    expect(sent.length).toBeGreaterThan(40)
    expect([...DEMO_MESSAGE_TYPES].sort()).toEqual(sent)
  })

  it('answers every one of them, with no network request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { answer } = createDemoResponder({ vodPulse, version: '0.0.0-test', strict: true })
    for (const type of DEMO_MESSAGE_TYPES) {
      const reply = await answer({ type, login: DEMO_CHANNEL.login, vodId: DEMO_CHANNEL.vodId, action: 'status' })
      expect(reply, type).toBeDefined()
    }
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('fails on a message it has no answer for', async () => {
    const { answer } = createDemoResponder({ vodPulse, version: '0.0.0-test', strict: true })
    await expect(async () => answer({ type: 'SOMETHING_NEW' })).rejects.toThrow(/SOMETHING_NEW/)
  })

  it('hands the page the extension-only actions', async () => {
    const onOpenSettings = vi.fn()
    const onCommunityLink = vi.fn()
    const { answer } = createDemoResponder({ vodPulse, version: '0.0.0-test', strict: true, onOpenSettings, onCommunityLink })
    await answer({ type: 'OPEN_SETTINGS_HOST', section: 'moments' })
    await answer({ type: 'OPEN_COMMUNITY_LINK', link: 'discord' })
    expect(onOpenSettings).toHaveBeenCalledWith('moments')
    expect(onCommunityLink).toHaveBeenCalledWith('discord')
  })
})

describe('fake chrome', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'chrome')
  afterEach(() => {
    if (original) Object.defineProperty(globalThis, 'chrome', original)
    else delete (globalThis as { chrome?: unknown }).chrome
  })

  it('replaces a chrome global that is already there, as in Chromium', () => {
    Object.defineProperty(globalThis, 'chrome', { value: { runtime: undefined }, configurable: true, writable: true })
    const fake = installFakeChrome(createFakeChrome({ responder: () => ({}), version: '1.2.3' }))
    expect((globalThis as { chrome?: unknown }).chrome).toBe(fake)
    expect(fake.runtime.getManifest().version).toBe('1.2.3')
  })

  it('keeps storage in memory and reports changes with their area', async () => {
    const fake = createFakeChrome({ responder: () => ({}), version: '1.2.3', sync: { theme: 'aurora' } })
    const changes = vi.fn()
    fake.storage.onChanged.addListener(changes)
    expect(await fake.storage.sync.get('theme')).toEqual({ theme: 'aurora' })
    await fake.storage.sync.set({ theme: 'volt' })
    expect(await fake.storage.sync.get(['theme'])).toEqual({ theme: 'volt' })
    expect(changes).toHaveBeenCalledWith({ theme: { oldValue: 'aurora', newValue: 'volt' } }, 'sync')
    await fake.storage.local.set({ seen: true })
    expect(await fake.storage.local.get(null)).toEqual({ seen: true })
    expect(await fake.storage.sync.get('seen')).toEqual({})
  })

  it('answers messages in promise and callback form, with lastError on failure', async () => {
    const fake = createFakeChrome({
      responder: message => {
        if ((message as { type: string }).type === 'BAD') throw new Error('nope')
        return { ok: true }
      },
      version: '1.2.3',
    })
    expect(await fake.runtime.sendMessage({ type: 'GOOD' })).toEqual({ ok: true })
    const seen = await new Promise<{ response: unknown; lastError: unknown }>(done => {
      void fake.runtime.sendMessage({ type: 'BAD' }, (response: unknown) => done({ response, lastError: fake.runtime.lastError }))
    })
    expect(seen).toEqual({ response: undefined, lastError: { message: 'nope' } })
    expect(fake.runtime.lastError).toBeUndefined()
  })
})

describe('demo tape', () => {
  it('is what the script makes, so it can be regenerated', () => {
    expect(tape).toEqual(buildDemoTape())
  })

  it('names only the made-up channel and Twitch global emotes', () => {
    expect(tape.login).toBe(DEMO_CHANNEL_LOGIN)
    expect(tape.channelLogin).toBe(DEMO_CHANNEL_LOGIN)
    expect(tape.channelDisplayName).toBe(DEMO_CHANNEL_NAME)
    expect(tape.vodId).toBe(DEMO_VOD_ID)
    expect(tape.streamId).toBe(DEMO_STREAM_ID)
    expect(tape.title).toMatch(/^Sample stream/)
    const globalEmotes = new Set(['25', '33', '41', '86', '245', '354', '28087', '30259', '58765', '64138', '425618', '305954156'])
    const emotes = JSON.stringify(tape).match(/"providerEmoteId":"[^"]+"/g) ?? []
    expect(emotes.length).toBeGreaterThan(0)
    for (const entry of emotes) expect(globalEmotes.has(entry.split('"')[3]), entry).toBe(true)
    expect(JSON.stringify(tape)).not.toMatch(/"provider":"(?:7tv|bttv|ffz|channel)"/i)
  })
})

describe('demo links', () => {
  it('keeps Twitch and this stream’s pages from leaving the demo', () => {
    expect(isDemoExitUrl('https://www.twitch.tv/videos/900000000000000001?t=1h2m3s')).toBe(true)
    expect(isDemoExitUrl(`https://streampulse.stream/analytics/${DEMO_CHANNEL.login}/${DEMO_CHANNEL.streamId}`)).toBe(true)
    expect(isDemoExitUrl('https://streampulse.stream/analytics')).toBe(false)
    expect(isDemoExitUrl('/discord')).toBe(false)
    expect(demoLeaveNote('https://www.twitch.tv/x')).toMatch(/on Twitch/)
    expect(demoLeaveNote('https://streampulse.stream/analytics/x')).toMatch(/Analytics/)
  })

  it('opens the site’s own pages on the origin the visitor is on', () => {
    expect(toSiteUrl('https://streampulse.stream/analytics?x=1#y')).toBe(`${location.origin}/analytics?x=1#y`)
    expect(toSiteUrl('https://chromewebstore.google.com/detail/x')).toBe('https://chromewebstore.google.com/detail/x')
  })
})
