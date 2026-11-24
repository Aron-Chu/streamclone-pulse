/**
 * Sentry loads after the page, not with it: the entry never imports the SDK,
 * and errors raised before it loads wait in a small queue that the SDK sends,
 * once each and scrubbed, when it starts.
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { ErrorEvent as SentryErrorEvent } from '@sentry/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const src = resolve(import.meta.dirname, '../src')
type SentryModule = typeof import('../src/lib/sentry')
type Envelope = [unknown, Array<[{ type: string }, unknown]>]

/** The real SDK, sending into an array instead of the network. */
async function realSdkWithFakeTransport(envelopes: Envelope[]) {
  const actual = await vi.importActual<typeof import('@sentry/react')>('@sentry/react')
  const init = vi.fn((options: Parameters<typeof actual.init>[0]) => actual.init({
    ...options,
    transport: () => ({
      send: async (envelope: unknown) => { envelopes.push(envelope as Envelope); return { statusCode: 200 } },
      flush: async () => true,
    }),
  }))
  vi.doMock('@sentry/react', () => ({ ...actual, init }))
  return { actual, init }
}

function sentEvents(envelopes: Envelope[]): SentryErrorEvent[] {
  return envelopes.flatMap(([, items]) => items.filter(([header]) => header.type === 'event').map(([, event]) => event as SentryErrorEvent))
}

async function loadSentryModule(): Promise<SentryModule> {
  return await import('../src/lib/sentry')
}

function throwBeforeLoad(error: unknown) {
  window.dispatchEvent(new ErrorEvent('error', { error, message: error instanceof Error ? error.message : String(error) }))
}

/** These tests raise errors on purpose; a listener of their own keeps the runner from counting them as uncaught. */
const expectedError = (event: Event) => event.preventDefault()

beforeEach(() => {
  window.addEventListener('error', expectedError)
  vi.resetModules()
  vi.stubEnv('VITE_SENTRY_DSN', 'https://public@example.invalid/1')
  window.history.replaceState(null, '', '/help')
})

afterEach(async () => {
  const sdk = await vi.importActual<typeof import('@sentry/react')>('@sentry/react')
  await sdk.close(100).catch(() => undefined)
  vi.doUnmock('@sentry/react')
  vi.unstubAllEnvs()
  window.history.replaceState(null, '', '/')
  window.removeEventListener('error', expectedError)
})

describe('lazy Sentry', () => {
  it('sends an error raised before the SDK loaded exactly once, scrubbed and under the page it happened on', async () => {
    const envelopes: Envelope[] = []
    const { actual, init } = await realSdkWithFakeTransport(envelopes)
    const { initPortalSentry } = await loadSentryModule()
    initPortalSentry()
    // Nothing loads during first load: the SDK starts once the page is idle.
    expect(init).not.toHaveBeenCalled()
    throwBeforeLoad(new TypeError('private detail for user@example.com'))
    // The reader moves on before the SDK arrives; the report keeps the page it came from.
    window.history.replaceState(null, '', '/status')
    await vi.waitFor(() => expect(init).toHaveBeenCalledOnce())
    expect(init.mock.calls[0]![0]!.beforeSend).toBe((await loadSentryModule()).scrubPortalEvent)
    await actual.flush(1000)

    const events = sentEvents(envelopes)
    expect(events).toHaveLength(1)
    const [event] = events
    expect(event!.tags).toMatchObject({ route: '/help', service: 'portal', role: 'portal' })
    expect(event!.exception?.values?.[0]).toMatchObject({ type: 'TypeError', value: 'Diagnostic text omitted', mechanism: { type: 'generic', handled: false } })
    expect(JSON.stringify(event)).not.toContain('user@example.com')
    expect(JSON.stringify(event)).not.toContain('private detail')

    // Once the SDK is in, its own handlers report; the early queue does not report again.
    throwBeforeLoad(new Error('after load'))
    await actual.flush(1000)
    expect(sentEvents(envelopes).length).toBeLessThanOrEqual(2)
    expect(sentEvents(envelopes).filter(sent => sent.tags?.route === '/help')).toHaveLength(1)
  })

  it('holds at most ten early reports, and none raised on an account page', async () => {
    const captureException = vi.fn()
    vi.doMock('@sentry/react', () => ({
      init: vi.fn(), setTag: vi.fn(), captureException,
      inboundFiltersIntegration: vi.fn(), functionToStringIntegration: vi.fn(),
      browserApiErrorsIntegration: vi.fn(), globalHandlersIntegration: vi.fn(),
    }))
    const { initPortalSentry } = await loadSentryModule()
    initPortalSentry()
    window.history.replaceState(null, '', '/account/settings')
    throwBeforeLoad(new Error('account page'))
    window.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: new Error('account rejection') }))
    window.history.replaceState(null, '', '/help')
    for (let i = 0; i < 15; i += 1) throwBeforeLoad(new Error(`public ${i}`))
    await vi.waitFor(() => expect(captureException).toHaveBeenCalledTimes(10))
    expect(captureException.mock.calls.map(([error]) => (error as Error).message)).toEqual(
      Array.from({ length: 10 }, (_, i) => `public ${i}`))
    expect(captureException.mock.calls[0]![1]).toEqual({
      captureContext: { tags: { route: '/help' } },
      mechanism: { type: 'auto.browser.global_handlers.onerror', handled: false },
    })
  })

  it('a boundary report before the SDK loaded starts the load and is sent once with its route and error type', async () => {
    const captureException = vi.fn()
    const init = vi.fn()
    vi.doMock('@sentry/react', () => ({
      init, setTag: vi.fn(), captureException,
      inboundFiltersIntegration: vi.fn(), functionToStringIntegration: vi.fn(),
      browserApiErrorsIntegration: vi.fn(), globalHandlersIntegration: vi.fn(),
    }))
    const { initPortalSentry, reportPortalError } = await loadSentryModule()
    initPortalSentry()
    const crash = new RangeError('render crash')
    reportPortalError(crash)
    await vi.waitFor(() => expect(captureException).toHaveBeenCalledOnce())
    expect(init).toHaveBeenCalledOnce()
    expect(captureException).toHaveBeenCalledWith(crash, { captureContext: { tags: { route: '/help', error_type: 'RangeError' } } })
    // After the SDK is in, a report goes straight out.
    reportPortalError(new Error('later'))
    expect(captureException).toHaveBeenCalledTimes(2)
  })

  it('a boundary report on an account page, reached from a public page, does not start the SDK load', async () => {
    const captureException = vi.fn()
    const init = vi.fn()
    let imported = 0
    vi.doMock('@sentry/react', () => {
      imported += 1
      return {
        init, setTag: vi.fn(), captureException,
        inboundFiltersIntegration: vi.fn(), functionToStringIntegration: vi.fn(),
        browserApiErrorsIntegration: vi.fn(), globalHandlersIntegration: vi.fn(),
      }
    })
    // Hold the idle-time load, so only a boundary report could start the SDK.
    const idle = window as unknown as { requestIdleCallback?: unknown }
    const hadIdle = Reflect.has(idle, 'requestIdleCallback')
    const ownIdle = idle.requestIdleCallback
    idle.requestIdleCallback = () => 0
    try {
      const { initPortalSentry, reportPortalError } = await loadSentryModule()
      // The first load was a public page, so reporting is on.
      initPortalSentry()
      window.history.replaceState(null, '', '/account/settings')
      reportPortalError(new Error('account page crash'))
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(imported).toBe(0)
      expect(init).not.toHaveBeenCalled()
      // Back on a public page, a report still loads the SDK, and only it is sent.
      window.history.replaceState(null, '', '/help')
      const crash = new Error('public page crash')
      reportPortalError(crash)
      await vi.waitFor(() => expect(captureException).toHaveBeenCalledOnce())
      expect(imported).toBe(1)
      expect(captureException).toHaveBeenCalledWith(crash, { captureContext: { tags: { route: '/help', error_type: 'Error' } } })
    } finally {
      if (hadIdle) idle.requestIdleCallback = ownIdle
      else delete idle.requestIdleCallback
    }
  })

  it('does nothing without a DSN, or when never started (account pages)', async () => {
    const captureException = vi.fn()
    const init = vi.fn()
    vi.doMock('@sentry/react', () => ({ init, captureException }))
    const { reportPortalError, initPortalSentry } = await loadSentryModule()
    reportPortalError(new Error('not started'))
    vi.stubEnv('VITE_SENTRY_DSN', '')
    initPortalSentry()
    throwBeforeLoad(new Error('no dsn'))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(init).not.toHaveBeenCalled()
    expect(captureException).not.toHaveBeenCalled()
  })
})

describe('entry stays free of the SDK', () => {
  /** Every module main.tsx reaches through static (non-type) imports, inside src/. */
  function staticGraph(entry: string): Map<string, string[]> {
    const graph = new Map<string, string[]>()
    const pending = [entry]
    const specifier = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/g
    while (pending.length) {
      const file = pending.pop()!
      if (graph.has(file)) continue
      const text = readFileSync(file, 'utf8')
      const specifiers: string[] = []
      for (const match of text.matchAll(specifier)) {
        if (match[1]) continue
        specifiers.push(match[2]!)
        const target = resolveLocal(file, match[2]!)
        if (target) pending.push(target)
      }
      graph.set(file, specifiers)
    }
    return graph
  }
  function resolveLocal(from: string, spec: string): string | null {
    const base = spec.startsWith('@/') ? resolve(src, spec.slice(2)) : spec.startsWith('.') ? resolve(dirname(from), spec) : null
    if (!base) return null
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts'), resolve(base, 'index.tsx')]) {
      if (/\.(?:tsx?|mjs|js)$/.test(candidate) && existsSync(candidate)) return candidate
    }
    return null
  }

  it('main.tsx reaches no static import of @sentry/* (the SDK is a dynamic import in sentry.ts)', () => {
    const graph = staticGraph(resolve(src, 'main.tsx'))
    expect(graph.has(resolve(src, 'lib/sentry.ts'))).toBe(true)
    expect(graph.has(resolve(src, 'ui/PortalErrorBoundary.tsx'))).toBe(true)
    const offenders = [...graph].filter(([, specs]) => specs.some(spec => spec.startsWith('@sentry/'))).map(([file]) => file)
    expect(offenders).toEqual([])
    expect(readFileSync(resolve(src, 'lib/sentry.ts'), 'utf8')).toMatch(/import\('@sentry\/react'\)/)
  })

  it('the lazy import names the SDK parts it uses, so the build drops the rest', () => {
    // Passing the whole module on keeps all of it (about 156 kB gzip instead of
    // about 28 kB, Spotlight's localhost URL included, which check-backend-url rejects).
    const text = readFileSync(resolve(src, 'lib/sentry.ts'), 'utf8')
    expect(text).toMatch(/import\('@sentry\/react'\)\s*\.then\(\(\{/)
    expect(text.match(/import\('@sentry\/react'\)/g)).toHaveLength(1)
  })

  it('the status page and the boundary read release and route names without the SDK', () => {
    expect(readFileSync(resolve(src, 'routes/public/Status.tsx'), 'utf8')).toMatch(/from '\.\.\/\.\.\/lib\/portalRelease'/)
    expect(readFileSync(resolve(src, 'lib/portalRelease.ts'), 'utf8')).not.toMatch(/^\s*import\b/m)
    expect(readFileSync(resolve(src, 'ui/PortalErrorBoundary.tsx'), 'utf8')).not.toMatch(/\bSentry\./)
  })
})
