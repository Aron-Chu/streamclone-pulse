import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ErrorEvent } from '@sentry/react'
import { sanitizePortalPath, scrubPortalEvent } from '../src/lib/sentry'
import { publicPageCategory } from '../src/lib/productAnalytics'
import { isPrivateSupporterRoute } from '../src/lib/accountRestore'

const STATE = 'a'.repeat(32)
const TOKEN = /* A stand-in, built at runtime so secret scanners see no token literal. */ [{ alg: 'RS256' }, { sub: 'PRIVATE' }].map(part => btoa(JSON.stringify(part))).concat(btoa('PRIVATE')).map(part => part.replace(/=+$/, '')).join('.')
const src = resolve(import.meta.dirname, '../src')

afterEach(() => {
  window.history.replaceState(null, '', '/')
  vi.resetModules()
})

describe('Twitch callback privacy', () => {
  it('strips the token at module evaluation, before any module imported after the boot module runs', async () => {
    window.history.replaceState(null, '', `/account/twitch/callback#id_token=${TOKEN}&state=${STATE}`)
    vi.resetModules()
    const seenBySentry: string[] = []
    vi.doMock('../src/lib/sentry', () => {
      // Stands in for any later module that reads location while it evaluates.
      seenBySentry.push(window.location.href)
      return { initPortalSentry: () => seenBySentry.push(window.location.href) }
    })
    await import('../src/lib/twitchCallbackBoot')
    const sentry = await import('../src/lib/sentry')
    sentry.initPortalSentry()
    expect(window.location.href).toBe(`${window.location.origin}/account/twitch/callback`)
    expect(seenBySentry.join(' ')).not.toContain(TOKEN)
    expect(seenBySentry.join(' ')).not.toContain(STATE)
    const { takeTwitchCallback } = await import('../src/lib/twitchCallback')
    expect(takeTwitchCallback()).toEqual({ kind: 'token', idToken: TOKEN, state: STATE })
    vi.doUnmock('../src/lib/sentry')
  })

  it('keeps the boot import first in main.tsx and the capture module free of imports', () => {
    const main = readFileSync(resolve(src, 'main.tsx'), 'utf8')
    const firstImport = main.split('\n').find(line => /^import\b/.test(line))
    expect(firstImport).toBe("import './lib/twitchCallbackBoot'")
    // Sentry is never initialised on account pages, including the callback.
    expect(main).toMatch(/if \(!isPrivateSupporterRoute\(window\.location\.pathname\)\) initPortalSentry\(\)/)
    expect(isPrivateSupporterRoute('/account/twitch/callback')).toBe(true)
    const capture = readFileSync(resolve(src, 'lib/twitchCallback.ts'), 'utf8')
    expect(capture).not.toMatch(/^\s*import\b/m)
  })

  it('reports the callback route to Sentry only as an unknown path, without fragment or query', () => {
    for (const path of [`/account/twitch/callback#id_token=${TOKEN}&state=${STATE}`, `/account/twitch/callback?error=access_denied&state=${STATE}`,
      `https://streampulse.stream/account/twitch/callback#id_token=${TOKEN}`]) {
      expect(sanitizePortalPath(path)).toBe('/:unknown')
    }
    const event = {
      type: undefined,
      transaction: `/account/twitch/callback#id_token=${TOKEN}`,
      request: { url: `https://streampulse.stream/account/twitch/callback#id_token=${TOKEN}&state=${STATE}` },
      tags: { route: `/account/twitch/callback#id_token=${TOKEN}` },
      breadcrumbs: [{ category: 'navigation', data: { to: `/account/twitch/callback#id_token=${TOKEN}` } }],
      message: `id_token=${TOKEN}`,
    } as unknown as ErrorEvent
    const clean = JSON.stringify(scrubPortalEvent(event))
    expect(clean).not.toContain(TOKEN)
    expect(clean).not.toContain(STATE)
    expect(clean).toContain('/:unknown')
  })

  it('gives product analytics no page category for the callback', () => {
    expect(publicPageCategory('/account/twitch/callback')).toBeNull()
    expect(publicPageCategory('/account/twitch/callback/')).toBeNull()
  })
})
