import { describe, expect, it, vi } from 'vitest'
import { ChatBadgeOptIn, CHAT_BADGE_STYLE_DEBOUNCE_MS } from '../src/background/chatBadgeOptIn.ts'
import { CHAT_BADGES_SCRIPT_FILE, CHAT_BADGES_SCRIPT_ID, notifyChatBadgeTabs, reconcileChatBadgeScript, type ChatBadgeScripting } from '../src/background/chatBadgeScript.ts'
import { MESSAGE_SENDER_SCOPE, isSenderAuthorizedForMessage } from '../src/background/pulseBroadcastTargets.ts'
import { SupporterAccountCoordinator } from '../src/background/supporterAccount.ts'
import { TwitchSignIn, type WebAuthFlowDetails } from '../src/background/twitchSignIn.ts'
import type { ChatBadgeOwnOverlay } from '../src/background/chatBadgeList.ts'
import { CHAT_BADGE_CONSENT_VERSION, parseChatBadgeSnapshot } from '../src/shared/chatBadges.ts'
import { parseBackgroundRequest } from '../src/shared/parseBackgroundRequest.ts'

const API = 'https://api.streampulse.stream'
const REDIRECT = 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/'
const FLOW_ID = '0123456789abcdef0123456789abcdef'
const FLOW_SECRET = 'd'.repeat(64)
const ID_TOKEN = [{ alg: 'RS256' }, { sub: '123' }].map(part => btoa(JSON.stringify(part)).replace(/=+$/, '')).concat(btoa('signature')).join('.')
const ACCOUNT_ID = '22222222-2222-4222-8222-222222222222'
const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString()
const json = (status: number, body: unknown) => new Response(body === null ? '' : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const authorizeUrl = `https://id.twitch.tv/oauth2/authorize?client_id=abc&redirect_uri=${encodeURIComponent(REDIRECT)}&response_type=id_token&scope=openid&nonce=n&state=${FLOW_ID}&force_verify=false`
const linked = { kind: 'linked', state: 'approved', deviceId: '33333333-3333-4333-8333-333333333333', accountId: ACCOUNT_ID, token: 'c'.repeat(64), refreshToken: 'e'.repeat(64), expiresAt: future(30), refreshExpiresAt: future(90) }

type Route = (body: Record<string, unknown>, init: RequestInit) => Response
function twitch(routes: Record<string, Route> = {}, launch?: (details: WebAuthFlowDetails) => Promise<string | undefined>, stored: unknown = linked) {
  let record = stored
  const account = new SupporterAccountCoordinator({ read: async () => record, write: async next => { record = next }, request: async () => ({ status: 204, body: null }) })
  const all: Record<string, Route> = {
    '/v1/account/auth/twitch/start-device': () => json(201, { flowId: FLOW_ID, flowSecret: FLOW_SECRET, authorizeUrl, expiresAt: future(0.002) }),
    '/v1/account/auth/twitch/badge': () => json(200, { status: 'badge_on', stepUpExpiresAt: future(0.007), chatBadge: { available: true, state: 'on', login: 'pulsefan', wave: 'ripple', consentVersion: 1 }, own: ['123', 'pulsefan', 2, 1, 1] }),
    ...routes,
  }
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const route = all[new URL(String(input)).pathname]
    return route ? route(JSON.parse(String(init?.body ?? '{}')), init ?? {}) : json(404, { error: 'not_found' })
  })
  const launchMock = vi.fn(launch ?? (async () => `${REDIRECT}#id_token=${ID_TOKEN}&state=${FLOW_ID}`))
  const signIn = new TwitchSignIn({
    enabled: true, account, fetch: fetchMock as unknown as typeof fetch, launchWebAuthFlow: launchMock, redirectUrl: () => REDIRECT,
    surface: 'chrome', chromium: true, apiOrigin: API, hosted: async () => true,
    meta: { read: async () => null, write: async () => {} }, profile: { read: async () => null, write: async () => {} },
  })
  const calls = (path: string) => fetchMock.mock.calls.filter(([input]) => new URL(String(input)).pathname === path)
  return { signIn, fetchMock, launchMock, calls, bodyOf: (path: string) => JSON.parse(String(calls(path)[0]?.[1]?.body)) }
}

describe('Seen in chat opt-in: the Twitch check and the consent action', () => {
  it('runs a purpose-badge Twitch window bound to this device, then one consent action with the shown version', async () => {
    const f = twitch()
    const result = await f.signIn.confirmForBadge({ consentVersion: CHAT_BADGE_CONSENT_VERSION, wave: 'ripple' })
    expect(result).toEqual({ ok: true, own: ['123', 'pulsefan', 2, 1, 1], chatBadge: { available: true, state: 'on', login: 'pulsefan', wave: 'ripple', consentVersion: 1 } })
    expect(f.bodyOf('/v1/account/auth/twitch/start-device')).toEqual({ surface: 'chrome', purpose: 'badge', mode: 'interactive', forceVerify: false })
    expect(f.launchMock).toHaveBeenCalledWith({ url: authorizeUrl, interactive: true })
    expect(f.bodyOf('/v1/account/auth/twitch/badge')).toEqual({ flowId: FLOW_ID, flowSecret: FLOW_SECRET, idToken: ID_TOKEN, badge: { consentVersion: 1, wave: 'ripple' } })
    for (const path of ['/v1/account/auth/twitch/start-device', '/v1/account/auth/twitch/badge']) {
      const [, init] = f.calls(path)[0]
      expect((init!.headers as Record<string, string>).Authorization).toBe(`Bearer ${'c'.repeat(64)}`)
      expect(init).toMatchObject({ credentials: 'omit', redirect: 'error', cache: 'no-store' })
    }
    // The flow secret and ID token stay in the worker.
    expect(JSON.stringify(result)).not.toContain(FLOW_SECRET)
    expect(JSON.stringify(result)).not.toContain(ID_TOKEN)
  })

  it('maps every refusal to a reason the card can say, and never publishes on a cancel', async () => {
    const cases: Array<[Parameters<typeof twitch>, string]> = [
      [[{ '/v1/account/auth/twitch/badge': () => json(403, { error: 'identity_mismatch' }) }], 'identity_mismatch'],
      [[{ '/v1/account/auth/twitch/badge': () => json(403, { error: 'supporter_required' }) }], 'supporter_required'],
      [[{ '/v1/account/auth/twitch/badge': () => json(400, { error: 'consent_outdated' }) }], 'consent_outdated'],
      [[{ '/v1/account/auth/twitch/badge': () => json(403, { error: 'pilot_only' }) }], 'pilot_only'],
      [[{ '/v1/account/auth/twitch/badge': () => json(409, { error: 'twitch_in_use' }) }], 'twitch_in_use'],
      [[{ '/v1/account/auth/twitch/badge': () => json(429, { error: 'try_later' }) }], 'try_later'],
      // Flag off on the server: start refuses the purpose, or the route is not mounted.
      [[{ '/v1/account/auth/twitch/start-device': () => json(400, { error: 'invalid_request' }) }], 'unavailable'],
      [[{ '/v1/account/auth/twitch/badge': () => json(404, { error: 'not_found' }) }], 'unavailable'],
      [[{}, async () => { throw new Error('The user did not approve access.') }], 'cancelled'],
      [[{}, undefined, null], 'sign_in_required'],
    ]
    for (const [args, error] of cases) {
      const f = twitch(...args)
      expect(await f.signIn.confirmForBadge({ consentVersion: 1, wave: 'smooth' }), error).toMatchObject({ ok: false, error })
    }
    const cancelled = twitch({}, async () => { throw new Error('closed') })
    await cancelled.signIn.confirmForBadge({ consentVersion: 1, wave: 'smooth' })
    expect(cancelled.calls('/v1/account/auth/twitch/badge')).toHaveLength(0)
  })
})

function optIn(options: { send?: (body: Record<string, unknown>) => { status: number; body?: unknown }; confirm?: Awaited<ReturnType<TwitchSignIn['confirmForBadge']>>; snapshot?: ReturnType<typeof parseChatBadgeSnapshot> } = {}) {
  let own: ChatBadgeOwnOverlay | undefined
  const timers: Array<() => void> = []
  const ports = {
    confirm: vi.fn(async () => options.confirm ?? { ok: true as const, own: ['123', 'pulsefan', 2, 1, 1] as [string, string, number, number, number], chatBadge: { available: true, state: 'on' as const, login: 'pulsefan' } }),
    request: vi.fn(async (body: Record<string, unknown>) => { const answer = options.send?.(body) ?? { status: 200 }; return { status: answer.status, body: answer.body ?? null } }),
    list: { patchOwn: vi.fn(async (next: ChatBadgeOwnOverlay | null) => { own = next ?? undefined }), ownOverlay: async () => own, status: async () => ({ listReceived: true }) },
    invalidate: vi.fn(async () => {}),
    wave: async () => 'chrome' as const,
    snapshot: async () => options.snapshot,
    now: () => 1_000,
    setTimer: (run: () => void) => { timers.push(run); return timers.length },
    clearTimer: vi.fn(),
  }
  return { coordinator: new ChatBadgeOptIn(ports), ports, own: () => own, fire: async () => { timers.splice(0).forEach(run => run()); await new Promise(resolve => setTimeout(resolve, 0)) } }
}

describe('Seen in chat opt-in coordinator', () => {
  it('on: consent at the current version with your wave, your own crest shows at once, settings re-read', async () => {
    const f = optIn()
    expect(await f.coordinator.on()).toEqual({ type: 'SUPPORTER_CHAT_BADGE', ok: true, listReceived: true, own: 'on', login: 'pulsefan' })
    expect(f.ports.confirm).toHaveBeenCalledWith({ consentVersion: CHAT_BADGE_CONSENT_VERSION, wave: 'chrome' })
    expect(f.own()).toEqual({ kind: 'on', entry: ['123', 'pulsefan', 2, 1, 1], at: 1_000 })
    expect(f.ports.invalidate).toHaveBeenCalled()
  })

  it('a refused opt-in changes nothing locally', async () => {
    const f = optIn({ confirm: { ok: false, error: 'identity_mismatch' } })
    expect(await f.coordinator.on()).toMatchObject({ ok: false, error: 'identity_mismatch' })
    expect(f.ports.list.patchOwn).not.toHaveBeenCalled()
    expect(f.ports.invalidate).not.toHaveBeenCalled()
  })

  it('off: one request with no Twitch step, and your crest leaves your own chat at once', async () => {
    const f = optIn({ snapshot: { available: true, state: 'on', login: 'pulsefan' } })
    await f.coordinator.on()
    expect(await f.coordinator.off()).toMatchObject({ ok: true, own: 'off' })
    expect(f.ports.request).toHaveBeenCalledWith({ enabled: false })
    expect(f.ports.confirm).toHaveBeenCalledTimes(1)
    expect(f.own()).toEqual({ kind: 'off', id: '123', login: 'pulsefan', at: 1_000 })
    // A failed withdrawal says so; nothing is hidden locally that is still published.
    const failed = optIn({ send: () => ({ status: 503 }) })
    expect(await failed.coordinator.off()).toMatchObject({ ok: false, error: 'unavailable' })
    expect(failed.ports.list.patchOwn).not.toHaveBeenCalled()
  })

  it('style: a wave change in Your look follows in chat 2 s after the last change, only while on', async () => {
    const f = optIn({ snapshot: { available: true, state: 'on', login: 'pulsefan' } })
    await f.coordinator.on()
    f.coordinator.waveChanged('ripple')
    f.coordinator.waveChanged('aurora')
    expect(f.ports.clearTimer).toHaveBeenCalledTimes(1)
    await f.fire()
    expect(f.ports.request).toHaveBeenCalledWith({ enabled: true, wave: 'aurora' })
    expect(f.own()).toMatchObject({ kind: 'on', entry: ['123', 'pulsefan', 2, 1, 3] })
    expect(CHAT_BADGE_STYLE_DEBOUNCE_MS).toBe(2_000)
    const off = optIn({ snapshot: { available: true, state: 'off' } })
    off.coordinator.waveChanged('ripple')
    await off.fire()
    expect(off.ports.request).not.toHaveBeenCalled()
    // A style change with no entry is refused by the server: consent comes only from the Twitch action.
    const none = optIn({ send: () => ({ status: 409, body: { error: 'consent_required' } }) })
    expect(await none.coordinator.style('chrome')).toMatchObject({ ok: false, error: 'consent_required' })
  })
})

describe('Seen in chat messages and sender scopes', () => {
  const extensionId = 'abcdefghijklmnopabcdefghijklmnop'
  it('a Twitch tab may only ask for the public list, naming just the version it has', () => {
    expect(parseBackgroundRequest({ type: 'CHAT_BADGES' })).toEqual({ type: 'CHAT_BADGES' })
    expect(parseBackgroundRequest({ type: 'CHAT_BADGES', have: '1760054400.0' })).toEqual({ type: 'CHAT_BADGES', have: '1760054400.0' })
    for (const extra of [{ login: 'xqc' }, { channel: 'xqc' }, { url: 'https://evil' }, { have: 'x' }, { have: 1 }]) {
      expect(parseBackgroundRequest({ type: 'CHAT_BADGES', ...extra })).toBeNull()
    }
    expect(MESSAGE_SENDER_SCOPE.CHAT_BADGES).toBe('twitch-any')
    expect(isSenderAuthorizedForMessage('CHAT_BADGES', undefined, { id: extensionId, frameId: 0, tab: { url: 'https://www.twitch.tv/popout/xqc/chat' } }, extensionId)).toBe(true)
    expect(isSenderAuthorizedForMessage('CHAT_BADGES', undefined, { id: extensionId, frameId: 3, tab: { url: 'https://www.twitch.tv/xqc' } }, extensionId)).toBe(false)
    expect(isSenderAuthorizedForMessage('CHAT_BADGES', undefined, { id: extensionId, frameId: 0, tab: { url: 'https://example.com/' } }, extensionId)).toBe(false)
  })

  it('opting in or out is for the options page only, in exact shapes', () => {
    for (const action of ['status', 'on', 'off'] as const) expect(parseBackgroundRequest({ type: 'SUPPORTER_CHAT_BADGE', action })).toEqual({ type: 'SUPPORTER_CHAT_BADGE', action })
    expect(parseBackgroundRequest({ type: 'SUPPORTER_CHAT_BADGE', action: 'style', wave: 'chrome' })).toEqual({ type: 'SUPPORTER_CHAT_BADGE', action: 'style', wave: 'chrome' })
    for (const bad of [{ action: 'on', twitchUserId: '1' }, { action: 'style' }, { action: 'style', wave: 'neon' }, { action: 'publish' }]) {
      expect(parseBackgroundRequest({ type: 'SUPPORTER_CHAT_BADGE', ...bad })).toBeNull()
    }
    expect(MESSAGE_SENDER_SCOPE.SUPPORTER_CHAT_BADGE).toBe('extension-page')
    expect(isSenderAuthorizedForMessage('SUPPORTER_CHAT_BADGE', undefined, { id: extensionId, frameId: 0, tab: { url: 'https://www.twitch.tv/xqc' } }, extensionId)).toBe(false)
    expect(isSenderAuthorizedForMessage('SUPPORTER_CHAT_BADGE', undefined, { id: extensionId, url: `chrome-extension://${extensionId}/options/index.html` }, extensionId)).toBe(true)
  })

  it('parses only a well-formed chatBadge snapshot', () => {
    expect(parseChatBadgeSnapshot({ available: true, state: 'waiting', login: 'Bad Login', wave: 'neon', consentVersion: 0 })).toEqual({ available: true, state: 'waiting' })
    expect(parseChatBadgeSnapshot({ available: 'yes' })).toBeUndefined()
    expect(parseChatBadgeSnapshot({ available: false, state: 'weird' })).toEqual({ available: false, state: 'off' })
  })
})

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
})
