// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  CHAT_BADGE_BACKOFF_MS,
  CHAT_BADGE_NOT_FOUND_MS,
  CHAT_BADGE_OWN_TTL_MS,
  CHAT_BADGE_REFRESH_MS,
  ChatBadgeList,
  type StoredChatBadgeList,
} from '../src/background/chatBadgeList.ts'
import { CHAT_BADGE_LIST_PATH, tenureCode, verifyChatBadgeList, waveCode, type ChatBadgeKey } from '../src/shared/chatBadges.ts'
import { STORE_CHAT_BADGE_KEYS, chatBadgeEnvironments, pinnedChatBadgeKeys } from '../src/shared/chatBadgeKeys.ts'
import { E2E_CHAT_BADGE_KEY, resolveChatBadgeDevKeys } from '../scripts/chat-badge-keys.mjs'
import { makeDoc, publicKeyFor, signList, syntheticEntries, TEST_KID, type Entry } from './helpers/chatBadgeSigner.ts'

const fixtures = resolve(__dirname, 'fixtures/chat-badges')
const KEYS: ChatBadgeKey[] = [{ kid: TEST_KID, key: publicKeyFor() }]
const NOW_S = 1_800_000_000
const subtle = globalThis.crypto.subtle

const verify = (body: string | Uint8Array, overrides: Partial<Parameters<typeof verifyChatBadgeList>[1]> = {}) => verifyChatBadgeList(body, {
  keys: KEYS, environments: ['live', 'sandbox'], minSeq: () => 0, nowS: NOW_S, subtle, ...overrides,
})

const ENTRIES: Entry[] = [['12345678', 'somelogin', 3, 2, 0], ['98765432', 'other_user', 0, 0, 0]]
const list = (entries: Entry[] = ENTRIES, doc: Parameters<typeof makeDoc>[1] = {}) => signList(makeDoc(entries, { iat: NOW_S - 60, ...doc }))

describe('Seen in chat list format v1', () => {
  it('verifies the cross-repo golden vector byte for byte (the backend signs the same bytes)', async () => {
    // Copied verbatim from streampulse-backend internal/billing/testdata/chat-badges/:
    // the Go signer's output for the fixed test seed (32 bytes of 0x07) under kid
    // spb-live-1. The public key file is hex, as the backend writes it.
    const body = readFileSync(resolve(fixtures, 'golden-v1.txt'), 'utf8')
    const hex = readFileSync(resolve(fixtures, 'golden-v1.pub'), 'utf8').trim()
    const key = Buffer.from(hex, 'hex').toString('base64url')
    expect(key).toBe(publicKeyFor())
    const keys = [{ kid: 'spb-live-1', key }]
    // The golden list expired in 2025; verify it at its own issue time.
    const result = await verifyChatBadgeList(body, { keys, environments: ['live'], minSeq: () => 0, nowS: 1760054400, subtle })
    expect(result).toMatchObject({ ok: true, kid: 'spb-live-1', doc: { v: 1, env: 'live', seq: 1760054400, n: 2, u: [['12345678', 'somelogin', 3, 2, 0], ['98765432', 'other_user', 0, 0, 0]] } })
    // One flipped byte anywhere in the document fails.
    const flipped = body.replace('somelogin', 'somelogim')
    expect(await verifyChatBadgeList(flipped, { keys, environments: ['live'], minSeq: () => 0, nowS: 1760054400, subtle })).toEqual({ ok: false, reason: 'signature' })
    // A build that honours only sandbox lists refuses it.
    expect(await verifyChatBadgeList(body, { keys, environments: ['sandbox'], minSeq: () => 0, nowS: 1760054400, subtle })).toEqual({ ok: false, reason: 'unknown_kid' })
  })

  it('signs the domain-prefixed bytes, not the bare document', async () => {
    const { createPrivateKey, sign } = await import('node:crypto')
    const doc = makeDoc(ENTRIES, { iat: NOW_S })
    const key = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.alloc(32, 7)]), format: 'der', type: 'pkcs8' })
    const bare = sign(null, Buffer.from(doc), key).toString('base64url')
    expect(await verify(`SPB1 ${TEST_KID} ${bare}\n${doc}`)).toEqual({ ok: false, reason: 'signature' })
    expect((await verify(signList(doc))).ok).toBe(true)
  })

  it('rejects every malformed or untrusted list as a whole', async () => {
    const doc = (fields: Record<string, unknown>) => JSON.stringify({ v: 1, env: 'sandbox', seq: NOW_S, iat: NOW_S - 60, exp: NOW_S + 3600, n: ENTRIES.length, u: ENTRIES, ...fields })
    const cases: Array<[string, string | Uint8Array, string, Partial<Parameters<typeof verifyChatBadgeList>[1]>?]> = [
      ['unknown kid', signList(makeDoc(ENTRIES, { iat: NOW_S }), { kid: 'spb-sandbox-8' }), 'unknown_kid'],
      ['kid of an environment this build does not honour', list(), 'unknown_kid', { environments: ['live'] }],
      ['store build with no pinned keys', list(), 'unknown_kid', { keys: [] }],
      ['another key', signList(makeDoc(ENTRIES, { iat: NOW_S }), { seed: Buffer.alloc(32, 9) }), 'signature'],
      ['environment mismatch', signList(doc({ env: 'live' })), 'environment'],
      ['seq rollback', list(ENTRIES, { seq: 5 }), 'seq', { minSeq: () => 6 }],
      ['expired', signList(doc({ exp: NOW_S - 1 })), 'time'],
      ['issued in the future', signList(doc({ iat: NOW_S + 3600, exp: NOW_S + 7200 })), 'time'],
      ['lifetime over 7 days', signList(doc({ exp: NOW_S - 60 + 8 * 86_400 })), 'time'],
      ['count mismatch', signList(doc({ n: 3 })), 'count'],
      ['bad id', signList(doc({ u: [['0123', 'x', 0, 0, 0]], n: 1 })), 'entry'],
      ['bad login', signList(doc({ u: [['123', 'Bad Login', 0, 0, 0]], n: 1 })), 'entry'],
      ['tier out of range', signList(doc({ u: [['123', 'ok', 5, 0, 0]], n: 1 })), 'entry'],
      ['extra field in an entry', signList(doc({ u: [['123', 'ok', 0, 0, 0, 'x']], n: 1 })), 'entry'],
      ['duplicate id', signList(doc({ u: [['123', 'a', 0, 0, 0], ['123', 'b', 0, 0, 0]], n: 2 })), 'entry'],
      ['wrong version', signList(doc({ v: 2 })), 'version'],
      ['not JSON', signList('{not json'), 'json'],
      ['malformed header', `SPB2 ${TEST_KID} x\n{}`, 'header'],
      ['no header line', '{"v":1}', 'header'],
      ['oversize', new Uint8Array(4 * 1024 * 1024 + 1), 'too_large'],
    ]
    for (const [name, body, reason, overrides] of cases) {
      expect(await verify(body, overrides), name).toEqual({ ok: false, reason })
    }
  })

  it('reports a browser without Ed25519 instead of guessing', async () => {
    expect(await verify(list(), { subtle: undefined })).toEqual({ ok: false, reason: 'no_ed25519' })
  })

  it('maps tenure and wave to the same codes the server publishes', () => {
    expect([0, 2, 3, 5, 6, 11, 12, 23, 24, 100].map(tenureCode)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4])
    expect(['smooth', 'ripple', 'chrome', 'aurora'].map(wave => waveCode(wave as 'smooth'))).toEqual([0, 1, 2, 3])
  })
})

describe('Seen in chat keys', () => {
  it('store builds pin only the production keys and never the e2e test key', () => {
    expect(resolveChatBadgeDevKeys('cws', JSON.stringify([{ kid: 'spb-sandbox-1', key: publicKeyFor(Buffer.alloc(32, 1)) }]))).toEqual([])
    expect(resolveChatBadgeDevKeys('edge')).toEqual([])
    expect(resolveChatBadgeDevKeys('firefox')).toEqual([])
    expect(pinnedChatBadgeKeys(true, [E2E_CHAT_BADGE_KEY])).toEqual([...STORE_CHAT_BADGE_KEYS])
    expect(pinnedChatBadgeKeys(true, [E2E_CHAT_BADGE_KEY]).some(key => key.kid === E2E_CHAT_BADGE_KEY.kid)).toBe(false)
    expect(chatBadgeEnvironments(true)).toEqual(['live'])
  })

  it('until the owner hands over spb-live-1/2, no key is pinned and store builds accept no list', async () => {
    expect(STORE_CHAT_BADGE_KEYS).toEqual([])
    expect(await verify(list(), { keys: pinnedChatBadgeKeys(true, [E2E_CHAT_BADGE_KEY]), environments: chatBadgeEnvironments(true) })).toEqual({ ok: false, reason: 'unknown_kid' })
  })

  it('development builds pin the e2e key (the backend golden seed) plus valid keys from the environment', () => {
    expect(E2E_CHAT_BADGE_KEY).toEqual({ kid: TEST_KID, key: publicKeyFor() })
    const sandbox = { kid: 'spb-sandbox-1', key: publicKeyFor(Buffer.alloc(32, 1)) }
    expect(resolveChatBadgeDevKeys('development', JSON.stringify([sandbox]))).toEqual([E2E_CHAT_BADGE_KEY, sandbox])
    expect(() => resolveChatBadgeDevKeys('development', JSON.stringify([{ kid: 'evil', key: 'x' }]))).toThrow(/invalid key entry/)
    expect(pinnedChatBadgeKeys(false, [E2E_CHAT_BADGE_KEY])).toEqual([E2E_CHAT_BADGE_KEY])
  })
})

type Responder = (init: RequestInit) => { status: number; body?: string | Uint8Array; headers?: Record<string, string> } | Promise<never>

function harness(options: { enabled?: boolean; stored?: unknown; respond?: Responder; now?: number; random?: number } = {}) {
  let now = options.now ?? NOW_S * 1000
  let enabled = options.enabled ?? true
  let stored: unknown = options.stored
  let respond: Responder = options.respond ?? (() => ({ status: 200, body: list(), headers: { ETag: '"spb1-sandbox-1"' } }))
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const answer = await respond(init ?? {})
    const headers = new Headers(answer.headers)
    return new Response(answer.status === 304 ? null : answer.body ?? '', { status: answer.status, headers })
  })
  const changed = vi.fn()
  const rejected = vi.fn()
  const make = () => new ChatBadgeList({
    fetch: fetch as unknown as typeof globalThis.fetch,
    origin: 'https://api.streampulse.stream',
    keys: () => KEYS,
    environments: ['live', 'sandbox'],
    subtle,
    now: () => now,
    random: () => options.random ?? 0.5,
    read: async () => stored,
    write: async value => { stored = JSON.parse(JSON.stringify(value)) },
    enabled: async () => enabled,
    changed,
    rejected,
  })
  return {
    make, fetch, changed, rejected,
    get stored() { return stored as StoredChatBadgeList },
    advance: (ms: number) => { now += ms },
    setEnabled: (value: boolean) => { enabled = value },
    setRespond: (next: Responder) => { respond = next },
  }
}

describe('Seen in chat list scheduling', () => {
  it('downloads once with no credentials, channel or query, then serves tabs from the cache', async () => {
    const h = harness()
    const store = h.make()
    const reply = await store.ask()
    expect(reply).toMatchObject({ type: 'CHAT_BADGES', u: ENTRIES })
    expect(h.fetch).toHaveBeenCalledTimes(1)
    const [url, init] = h.fetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`https://api.streampulse.stream${CHAT_BADGE_LIST_PATH}`)
    expect(init).toMatchObject({ method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer' })
    expect(init.headers).toEqual({})
    // Same version: the tab keeps what it has, and nothing is fetched.
    const ver = 'ver' in reply ? reply.ver : ''
    expect(await store.ask(ver)).toEqual({ type: 'CHAT_BADGES', unchanged: true })
    h.advance(30 * 60_000)
    await store.ask(ver)
    expect(h.fetch).toHaveBeenCalledTimes(1)
    expect(h.stored).toMatchObject({ etag: '"spb1-sandbox-1"', received: true, failures: 0, floor: { sandbox: NOW_S - 60 } })
    expect(h.changed).toHaveBeenCalled()
  })

  it('refreshes about hourly with ±10% jitter and sends If-None-Match; 304 keeps the list', async () => {
    for (const [random, expected] of [[0, 0.9], [1, 1.1], [0.5, 1]] as const) {
      const h = harness({ random })
      await h.make().ask()
      expect(h.stored.nextAt - NOW_S * 1000).toBe(Math.round(CHAT_BADGE_REFRESH_MS * expected))
    }
    const h = harness()
    const store = h.make()
    await store.ask()
    h.advance(CHAT_BADGE_REFRESH_MS + 1)
    h.setRespond(() => ({ status: 304 }))
    await store.ask()
    await vi.waitFor(() => expect(h.fetch).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(h.stored.nextAt).toBeGreaterThan(NOW_S * 1000 + CHAT_BADGE_REFRESH_MS))
    expect((h.fetch.mock.calls[1][1] as RequestInit).headers).toEqual({ 'If-None-Match': '"spb1-sandbox-1"' })
    expect(await store.ask()).toMatchObject({ u: ENTRIES })
  })

  it('404 is the kill switch: clear, tell tabs, and ask again only after 6 hours', async () => {
    const h = harness()
    const store = h.make()
    await store.ask()
    h.advance(CHAT_BADGE_REFRESH_MS * 2)
    h.setRespond(() => ({ status: 404, body: '{"error":"not_found"}' }))
    await store.refresh()
    expect(await store.ask()).toEqual({ type: 'CHAT_BADGES', off: true })
    expect(await store.wanted()).toBe(false)
    expect(h.stored.text).toBeUndefined()
    expect(h.stored.nextAt).toBe(NOW_S * 1000 + CHAT_BADGE_REFRESH_MS * 2 + CHAT_BADGE_NOT_FOUND_MS)
    // The rollback floor survives the 404.
    expect(h.stored.floor.sandbox).toBe(NOW_S - 60)
    await store.ask()
    expect(h.fetch).toHaveBeenCalledTimes(2)
  })

  it('backs off 15 → 30 → 60 minutes on 5xx, 429 and network errors, keeping the last good list', async () => {
    const h = harness()
    const store = h.make()
    await store.ask()
    let at = NOW_S * 1000
    for (const [respond, wait] of [
      [() => ({ status: 503 }), CHAT_BADGE_BACKOFF_MS[0]],
      [() => ({ status: 429, headers: { 'Retry-After': '60' } }), CHAT_BADGE_BACKOFF_MS[1]],
      [() => Promise.reject(new TypeError('offline')), CHAT_BADGE_BACKOFF_MS[2]],
      [() => ({ status: 500 }), CHAT_BADGE_BACKOFF_MS[2]],
    ] as Array<[Responder, number]>) {
      h.setRespond(respond)
      h.advance(CHAT_BADGE_REFRESH_MS * 2)
      at += CHAT_BADGE_REFRESH_MS * 2
      await store.refresh()
      expect(h.stored.nextAt).toBe(at + wait)
      expect(await store.ask()).toMatchObject({ u: ENTRIES })
    }
  })

  it('a bad signature keeps the previous list and reports only the reason', async () => {
    const h = harness()
    const store = h.make()
    await store.ask()
    h.advance(CHAT_BADGE_REFRESH_MS * 2)
    h.setRespond(() => ({ status: 200, body: signList(makeDoc([['1', 'evil', 4, 3, 3]], { iat: NOW_S }), { seed: Buffer.alloc(32, 9) }) }))
    await store.refresh()
    expect(h.rejected).toHaveBeenCalledWith('signature')
    expect(await store.ask()).toMatchObject({ u: ENTRIES })
  })

  it('downloads nothing and serves nothing while the viewer setting is off', async () => {
    const h = harness({ enabled: false })
    const store = h.make()
    expect(await store.ask()).toEqual({ type: 'CHAT_BADGES', off: true })
    await store.bootstrap()
    expect(await store.wanted()).toBe(false)
    expect(h.fetch).not.toHaveBeenCalled()
  })

  it('without a tab asking, only a Twitch page load (bootstrap) fetches, and only when due', async () => {
    const h = harness()
    const store = h.make()
    await store.bootstrap()
    await store.bootstrap()
    expect(h.fetch).toHaveBeenCalledTimes(1)
  })

  it('re-verifies the cached list when the worker wakes, and drops it once expired', async () => {
    const h = harness()
    await h.make().ask()
    // A new worker: the stored text is verified again before use.
    const woken = h.make()
    expect(await woken.ask()).toMatchObject({ u: ENTRIES })
    expect(h.fetch).toHaveBeenCalledTimes(1)
    // A tampered cache is refused (never trusted because it came from storage).
    const tampered = harness({ stored: { ...h.stored, text: h.stored.text!.replace('somelogin', 'someoneelse') } })
    expect(await tampered.make().wanted()).toBe(false)
    // Past exp (iat + 36 h) every crest goes, even with no successful refresh.
    h.setRespond(() => ({ status: 503 }))
    h.advance(37 * 3600_000)
    const late = h.make()
    expect(await late.ask()).toEqual({ type: 'CHAT_BADGES', off: true })
  })

  it('your own opt-in shows at once, your opt-out hides you at once, and both expire after the list catches up', async () => {
    const h = harness()
    const store = h.make()
    await store.ask()
    await store.patchOwn({ kind: 'on', entry: ['55555555', 'me_myself', 1, 1, 2], at: NOW_S * 1000 })
    const on = await store.ask()
    expect('u' in on && on.u.map(entry => entry[1])).toEqual(['somelogin', 'other_user', 'me_myself'])
    await store.patchOwn({ kind: 'off', id: '12345678', login: 'somelogin', at: NOW_S * 1000 })
    const off = await store.ask()
    expect('u' in off && off.u.map(entry => entry[1])).toEqual(['other_user'])
    h.advance(CHAT_BADGE_OWN_TTL_MS + 10)
    h.setRespond(() => ({ status: 304 }))
    const later = await store.ask()
    expect('u' in later && later.u.map(entry => entry[1])).toEqual(['somelogin', 'other_user'])
  })

  it('an empty list registers nothing; your own entry alone still shows to you', async () => {
    const h = harness({ respond: () => ({ status: 200, body: list([]) }) })
    const store = h.make()
    expect(await store.ask()).toEqual({ type: 'CHAT_BADGES', off: true })
    expect(await store.status()).toEqual({ listReceived: true })
    await store.patchOwn({ kind: 'on', entry: ['55555555', 'me_myself', 1, 1, 2], at: NOW_S * 1000 })
    expect(await store.wanted()).toBe(true)
  })

  it('10k entries verify and serve quickly', async () => {
    const entries = syntheticEntries(10_000)
    const h = harness({ respond: () => ({ status: 200, body: list(entries) }) })
    const started = performance.now()
    const reply = await h.make().ask()
    expect('u' in reply && reply.u.length).toBe(10_000)
    expect(performance.now() - started).toBeLessThan(1_000)
  })
})
