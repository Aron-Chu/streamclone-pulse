import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
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

  // replaceState cannot remove the original callback URL (fragment included)
  // from the profile's browsing history or from the page load's Navigation
  // Timing entry. Nothing in the portal may read performance entries or ship a
  // real-user-monitoring collector, so that URL never leaves the device.
  it('never reads Navigation Timing or loads a real-user monitoring collector', () => {
    const readers: Array<[string, RegExp]> = [
      ['performance entry read', /\bperformance\s*\.\s*getEntries(?:ByType|ByName)?\s*\(/],
      ['PerformanceObserver', /\bPerformanceObserver\b/],
      ['Navigation Timing type', /\bPerformanceNavigationTiming\b/],
      ['legacy timing API', /\bperformance\s*\.\s*(?:timing|navigation)\b/],
      ['web-vitals import', /(?:from\s*|import\s*\(\s*)['"]web-vitals/],
      ['Sentry tracing, profiling or replay', /\b(?:browserTracingIntegration|browserProfilingIntegration|replayIntegration|replayCanvasIntegration|BrowserTracing)\b/],
      ['Cloudflare Web Analytics beacon', /cloudflareinsights/i],
      ['PostHog SDK', /(?:from\s*|import\s*\(\s*)['"]posthog-js/],
    ]
    const files: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) walk(path)
        else if (/\.(?:[cm]?[jt]sx?)$/.test(entry.name) && !/\.test\.[jt]sx?$/.test(entry.name)) files.push(path)
      }
    }
    walk(src)
    files.push(resolve(src, '../index.html'))
    const hits = files.flatMap(file => {
      const text = readFileSync(file, 'utf8')
      return readers.filter(([, pattern]) => pattern.test(text)).map(([name]) => `${relative(resolve(src, '..'), file)}: ${name}`)
    })
    expect(hits).toEqual([])

    const pkg = JSON.parse(readFileSync(resolve(src, '../package.json'), 'utf8')) as Record<string, Record<string, string> | undefined>
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
    expect(deps.filter(name => /^(?:web-vitals|posthog-js|@vercel\/(?:analytics|speed-insights)|@datadog\/browser-rum.*|@newrelic\/.*|@sentry\/(?:tracing|replay))$/.test(name))).toEqual([])

    // Sentry is error-only: no performance tracing and no default integrations.
    const sentry = readFileSync(resolve(src, 'lib/sentry.ts'), 'utf8')
    expect(sentry).toMatch(/tracesSampleRate:\s*0,/)
    expect(sentry).toMatch(/defaultIntegrations:\s*false,/)

    // A collector injected outside the bundle (for example a host-added
    // analytics beacon) cannot load or report: both policies allow scripts
    // only from this origin and Turnstile.
    const policies = [
      readFileSync(resolve(src, '../index.html'), 'utf8').match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)?.[1],
      readFileSync(resolve(src, '../public/_headers'), 'utf8').match(/Content-Security-Policy:\s*(.+)/)?.[1],
    ]
    for (const policy of policies) {
      expect(policy).toBeTruthy()
      const scriptSrc = policy!.split(';').map(part => part.trim()).find(part => part.startsWith('script-src '))
      expect(scriptSrc?.split(/\s+/).slice(1).sort()).toEqual(["'self'", 'https://challenges.cloudflare.com'])
    }
  })
})
