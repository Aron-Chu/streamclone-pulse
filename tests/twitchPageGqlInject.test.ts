import { describe, expect, it } from 'vitest'
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
