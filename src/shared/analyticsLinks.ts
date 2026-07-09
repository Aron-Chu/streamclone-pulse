/** User-facing StreamPulse web analytics origin (portal), not the API/BFF origin. */
export const DEFAULT_WEB_ANALYTICS_BASE_URL = 'https://streampulse.stream'

export type ExtensionConfig = {
  apiBaseUrl: string
  webAnalyticsBaseUrl: string
}

/** Derive portal origin from API origin when no explicit override is stored. */
export function defaultWebAnalyticsBaseUrlForApi(apiBaseUrl: string): string {
  const normalized = apiBaseUrl.trim().replace(/\/+$/, '')
  if (!normalized) return DEFAULT_WEB_ANALYTICS_BASE_URL

  try {
    const parsed = new URL(normalized)
    const host = parsed.hostname.toLowerCase()
    const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80')
    const localBackendPort = '8081'
    const localPortalPort = '5173'
    if ((host === 'localhost' || host === '127.0.0.1') && port === localBackendPort) {
      return `http://${host}:${localPortalPort}`
    }
  } catch {
    // fall through
  }

  if (normalized.includes('api.streampulse.stream')) {
    return DEFAULT_WEB_ANALYTICS_BASE_URL
  }

  try {
    const url = new URL(normalized)
    if (url.hostname.startsWith('api.')) {
      url.hostname = url.hostname.slice(4)
      return url.origin
    }
  } catch {
    // fall through
  }

  return DEFAULT_WEB_ANALYTICS_BASE_URL
}

export function buildHubAnalyticsUrl(webAnalyticsBaseUrl: string): string | null {
  const base = webAnalyticsBaseUrl.trim().replace(/\/+$/, '')
  if (!base) return null
  return `${base}/analytics`
}

export function buildAnalyticsUrl(args: {
  webAnalyticsBaseUrl: string
  channelLogin?: string
  streamId?: string
  offsetSeconds?: number
}): string | null {
  const base = args.webAnalyticsBaseUrl.trim().replace(/\/+$/, '')
  if (!base) return null

  const login = args.channelLogin?.trim().toLowerCase()
  const streamId = args.streamId?.trim()

  if (!login) return null

  let path: string
  if (streamId) {
    path = `/analytics/${encodeURIComponent(login)}/${encodeURIComponent(streamId)}`
  } else {
    path = `/analytics/${encodeURIComponent(login)}`
  }

  const offset = args.offsetSeconds
  if (Number.isFinite(offset) && (offset ?? 0) > 0) {
    return `${base}${path}#t=${Math.trunc(offset!)}`
  }

  return `${base}${path}`
}

/** Resolve a relative analytics path from the API against the web portal origin. */
export function resolveWebAnalyticsHref(
  webAnalyticsBaseUrl: string,
  relativePath?: string | null,
): string | null {
  const path = relativePath?.trim()
  if (!path || !path.startsWith('/analytics/')) return null
  const base = webAnalyticsBaseUrl.trim().replace(/\/+$/, '')
  if (!base) return null
  return `${base}${path}`
}

export function openAnalyticsHref(href: string | null | undefined): void {
  if (!href?.trim()) return
  window.open(href, '_blank', 'noopener,noreferrer')
}

export function resolveStreamAnalyticsHref(args: {
  apiBaseUrl: string
  channelLogin?: string
  streamId?: string
  offsetSeconds?: number
}): string | null {
  const webAnalyticsBaseUrl = defaultWebAnalyticsBaseUrlForApi(args.apiBaseUrl)
  return buildAnalyticsUrl({
    webAnalyticsBaseUrl,
    channelLogin: args.channelLogin,
    streamId: args.streamId,
    offsetSeconds: args.offsetSeconds,
  })
}

/** Open StreamPulse portal analytics — never the API/BFF origin. */
export function openStreamAnalytics(args: {
  apiBaseUrl: string
  channelLogin?: string
  streamId?: string
  offsetSeconds?: number
}): void {
  openAnalyticsHref(resolveStreamAnalyticsHref(args))
}

export function openHubAnalytics(apiBaseUrl: string): void {
  const webAnalyticsBaseUrl = defaultWebAnalyticsBaseUrlForApi(apiBaseUrl)
  openAnalyticsHref(buildHubAnalyticsUrl(webAnalyticsBaseUrl))
}
