/**
 * Production URL/method builders for extension Pulse HTTP — used by api.ts paths
 * and exact request-matrix tests with injected fetch.
 */

export type PulseHttpWindow = 'recent' | 'full'

export type RecordedHttpCall = {
  method: string
  url: string
  login?: string
  window?: PulseHttpWindow
}

export function normalizeExtensionLogin(login: string): string {
  return login.trim().toLowerCase()
}

export function buildPulseChannelRequest(
  baseUrl: string,
  login: string,
  window: PulseHttpWindow = 'recent',
): RecordedHttpCall {
  const root = baseUrl.replace(/\/$/, '')
  const normalized = normalizeExtensionLogin(login)
  const qs = window === 'full' ? '?window=full' : ''
  return {
    method: 'GET',
    url: `${root}/v1/extension/pulse/channels/${encodeURIComponent(normalized)}${qs}`,
    login: normalized,
    window,
  }
}

export function buildWatchChannelRequest(baseUrl: string, login: string): RecordedHttpCall {
  const root = baseUrl.replace(/\/$/, '')
  const normalized = normalizeExtensionLogin(login)
  return {
    method: 'POST',
    url: `${root}/v1/analytics/channels/${encodeURIComponent(normalized)}/watch`,
    login: normalized,
  }
}

export function buildCoverageRequest(baseUrl: string, login: string): RecordedHttpCall {
  const root = baseUrl.replace(/\/$/, '')
  const normalized = normalizeExtensionLogin(login)
  return {
    method: 'GET',
    url: `${root}/v1/extension/coverage/channels/${encodeURIComponent(normalized)}`,
    login: normalized,
  }
}

/** Parse login + window from a recorded pulse channel URL. */
export function parsePulseChannelUrl(url: string): { login: string; window: PulseHttpWindow } | null {
  const match = url.match(/\/v1\/extension\/pulse\/channels\/([^/?]+)(\?window=full)?/)
  if (!match) return null
  return {
    login: decodeURIComponent(match[1]).toLowerCase(),
    window: match[2] ? 'full' : 'recent',
  }
}

export type InjectedHttpRouter = {
  calls: RecordedHttpCall[]
  fetchPulse: (
    login: string,
    window: PulseHttpWindow,
    _forceCoverage: boolean,
  ) => Promise<{
    payload: {
      login: string
      streamId: string
      tracking: boolean
      currentOffsetSeconds: number
      rollups: unknown[]
    } | null
    coverageTier: null
    error?: string
  }>
  postWatch: (login: string) => Promise<void>
}

/**
 * Injected HTTP router driving production URL builders + fake clock payloads.
 */
export function createInjectedPulseHttpRouter(options: {
  baseUrl: string
  now?: () => number
  pulseOk?: boolean
  watchOk?: boolean
}): InjectedHttpRouter {
  const calls: RecordedHttpCall[] = []
  const pulseOk = options.pulseOk !== false
  const watchOk = options.watchOk !== false

  return {
    calls,
    async fetchPulse(login, window) {
      const req = buildPulseChannelRequest(options.baseUrl, login, window)
      calls.push(req)
      if (!pulseOk) {
        return { payload: null, coverageTier: null, error: 'pulse_failed' }
      }
      return {
        payload: {
          login: normalizeExtensionLogin(login),
          streamId: 's1',
          tracking: true,
          currentOffsetSeconds: 600,
          rollups: [],
        },
        coverageTier: null,
      }
    },
    async postWatch(login) {
      const req = buildWatchChannelRequest(options.baseUrl, login)
      calls.push(req)
      if (!watchOk) throw new Error('watch_failed')
    },
  }
}
