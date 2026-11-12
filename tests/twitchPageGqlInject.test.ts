import { afterEach, describe, expect, it, vi } from 'vitest'
import { gqlDiscoverVodInPage, scrapePageVodState } from '../src/background/twitchPageInject.ts'
import { mainWorldExecuteScriptOptions } from '../src/background/twitchPageGql.ts'

describe('mainWorldExecuteScriptOptions', () => {
  it('passes the module function by reference with explicit args (no closure wrapper)', () => {
    const options = mainWorldExecuteScriptOptions(42, gqlDiscoverVodInPage, ['fixturechan'])
    expect(options.world).toBe('MAIN')
    expect(options.target).toEqual({ tabId: 42 })
    expect(options.func).toBe(gqlDiscoverVodInPage)
    expect(options.args).toEqual(['fixturechan'])
  })

  it('passes scrapePageVodState with an empty args array', () => {
    const options = mainWorldExecuteScriptOptions(7, scrapePageVodState, [])
    expect(options.func).toBe(scrapePageVodState)
    expect(options.args).toEqual([])
  })

  it('rejects the broken closure pattern that minifies to a free MAIN-world binding', () => {
    // Document the anti-pattern: () => gqlDiscoverVodInPage(login) closes over a
    // module binding that becomes an undefined free var (e.g. "I") after minify.
    const login = 'fixturechan'
    const bad = () => gqlDiscoverVodInPage(login)
    const options = mainWorldExecuteScriptOptions(1, gqlDiscoverVodInPage, [login])
    expect(options.func).not.toBe(bad)
    expect(options.func).toBe(gqlDiscoverVodInPage)
  })
})

describe('gqlDiscoverVodInPage', () => {
  afterEach(() => vi.unstubAllGlobals())

  it("sends Twitch's public web Client-ID on both queries", async () => {
    // A wrong id gets HTTP 400 "The Client-ID header is invalid." and the lookup never finds a VOD.
    const sent: Array<{ clientId: string | null, body: { query: string, variables: { login: string } } }> = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      sent.push({ clientId: new Headers(init?.headers).get('Client-ID'), body: JSON.parse(String(init?.body)) })
      return Response.json({ data: { user: null } })
    }))

    const result = await gqlDiscoverVodInPage(' Forsen ')

    expect(sent.map(request => request.clientId)).toEqual(['kimne78kx3ncx6brgo4mv6wki5h1ko', 'kimne78kx3ncx6brgo4mv6wki5h1ko'])
    expect(sent.map(request => request.body.variables.login)).toEqual(['forsen', 'forsen'])
    expect(sent[0].body.query).toContain('PulseLiveArchiveVod')
    expect(sent[1].body.query).toContain('PulseArchiveVod')
    expect(result.live.status).toBe(200)
    expect(result.list.status).toBe(200)
  })
})
