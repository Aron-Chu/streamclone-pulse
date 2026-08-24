import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BrowserContext, Request, Route } from '@playwright/test'

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/api')

function readJson(name: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, name), 'utf8'))
}

export type ApiScenario =
  | 'live-ready'
  | 'live-emote-picker'
  | 'live-partial'
  | 'helix-off'
  | 'offline'
  | 'vod-ready'
  | 'vod-syncing'
  | 'api-500'
  | 'timeout'
  | 'malformed'

export interface MockApiController {
  setScenario: (scenario: ApiScenario) => void
  requests: () => Request[]
  pulseChannelRequestCount: () => number
  resetRequestLog: () => void
  dispose: () => Promise<void>
}

interface ScenarioFiles {
  health: string
  pulse: string
  coverage: string
  vod: string
}

const SCENARIOS: Record<Exclude<ApiScenario, 'api-500' | 'timeout' | 'malformed'>, ScenarioFiles> = {
  'live-ready': {
    health: 'health-ok.json',
    pulse: 'pulse-live-ready.json',
    coverage: 'coverage-active.json',
    vod: 'vod-ready.json',
  },
  'live-emote-picker': {
    health: 'health-ok.json',
    pulse: 'pulse-live-emote-picker.json',
    coverage: 'coverage-active.json',
    vod: 'vod-ready.json',
  },
  'live-partial': {
    health: 'health-ok.json',
    pulse: 'pulse-live-partial.json',
    coverage: 'coverage-warming.json',
    vod: 'vod-syncing.json',
  },
  'helix-off': {
    health: 'health-helix-off.json',
    pulse: 'pulse-helix-off.json',
    coverage: 'coverage-active.json',
    vod: 'vod-ready.json',
  },
  offline: {
    health: 'health-ok.json',
    pulse: 'pulse-offline.json',
    coverage: 'coverage-active.json',
    vod: 'vod-ready.json',
  },
  'vod-ready': {
    health: 'health-ok.json',
    pulse: 'pulse-offline.json',
    coverage: 'coverage-active.json',
    vod: 'vod-ready.json',
  },
  'vod-syncing': {
    health: 'health-ok.json',
    pulse: 'pulse-offline.json',
    coverage: 'coverage-active.json',
    vod: 'vod-syncing.json',
  },
}

async function json(route: Route, status: number, body: unknown): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

/**
 * Fixture-driven StreamPulse BFF mock for extension service-worker fetches.
 * Matches https://api.streampulse.stream (default hosted backend).
 */
export async function installMockApi(
  context: BrowserContext,
  initial: ApiScenario = 'live-ready',
): Promise<MockApiController> {
  let scenario: ApiScenario = initial
  const requestLog: Request[] = []

  const handler = async (route: Route) => {
    const request = route.request()
    requestLog.push(request)
    const url = new URL(request.url())
    const pathname = url.pathname

    if (scenario === 'timeout') {
      // Abort after hanging long enough that fetch rejects; Playwright route
      // delay alone does not reject. Abort simulates network timeout for the SW.
      await new Promise(r => setTimeout(r, 100))
      await route.abort('timedout')
      return
    }

    if (scenario === 'api-500') {
      await json(route, 500, { error: 'internal_fixture_error' })
      return
    }

    if (scenario === 'malformed') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{not-json',
      })
      return
    }

    const files = SCENARIOS[scenario]

    if (pathname === '/v1/extension/health') {
      await json(route, 200, readJson(files.health))
      return
    }

    if (/^\/v1\/extension\/pulse\/channels\/[^/]+$/.test(pathname)) {
      await json(route, 200, readJson(files.pulse))
      return
    }

    if (/^\/v1\/extension\/pulse\/channels\/[^/]+\/coverage$/.test(pathname)) {
      await json(route, 200, readJson(files.coverage))
      return
    }

    if (/^\/v1\/extension\/pulse\/vods\/[^/]+$/.test(pathname)) {
      await json(route, 200, readJson(files.vod))
      return
    }

    if (pathname === '/v1/analytics/always-tracked') {
      await json(route, 200, readJson('always-tracked.json'))
      return
    }

    if (/^\/v1\/analytics\/channels\/[^/]+\/streams$/.test(pathname)) {
      await json(route, 200, readJson('streams-empty.json'))
      return
    }

    if (/\/vod-hint$/.test(pathname)) {
      await json(route, 200, { vodId: null })
      return
    }

    // Default: empty OK so unexpected BFF calls do not hard-fail the page.
    await json(route, 200, {})
  }

  const pattern = 'https://api.streampulse.stream/**'
  await context.route(pattern, handler)

  return {
    setScenario(next) {
      scenario = next
    },
    requests: () => [...requestLog],
    pulseChannelRequestCount: () =>
      requestLog.filter(r => /\/v1\/extension\/pulse\/channels\/[^/]+(?:\?|$)/.test(r.url())).length,
    resetRequestLog: () => {
      requestLog.length = 0
    },
    dispose: async () => {
      await context.unroute(pattern, handler)
    },
  }
}
