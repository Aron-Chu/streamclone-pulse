import * as Sentry from '@sentry/react'

const ALLOWED_TAGS = new Set([
  'service',
  'role',
  'release',
  'environment',
  'artifact_version',
  'correlation_id',
  'http_method',
  'route',
  'http_status',
  'error_type',
  'error_code',
  'account_surface',
])

/**
 * Account and billing pages report errors (Supporter launch spec 2026-10-10,
 * section 5.5), but only with a fixed error code and page name. Each tag value
 * must come from its own enum; anything else is dropped.
 */
export const ACCOUNT_ERROR_CODES = [
  'offer_read_failed', 'offer_price_mismatch', 'offer_stage_mismatch', 'billing_read_failed',
  'checkout_open_failed', 'portal_open_failed', 'checkout_confirm_slow', 'twitch_flow_failed',
] as const
export type AccountErrorCode = typeof ACCOUNT_ERROR_CODES[number]
export const ACCOUNT_SURFACES = ['billing', 'billing_return', 'settings', 'sign_in', 'moments', 'thanks'] as const
export type AccountSurface = typeof ACCOUNT_SURFACES[number]
const TAG_ENUMS: Record<string, ReadonlySet<string>> = {
  error_code: new Set(ACCOUNT_ERROR_CODES),
  account_surface: new Set(ACCOUNT_SURFACES),
}

/** Account pages where error monitoring runs; every other /account/* page is treated as secret-bearing. */
const ACCOUNT_SENTRY_ROUTES: Record<string, AccountSurface> = {
  '/account/billing': 'billing',
  '/account/billing/return': 'billing_return',
  '/account/settings': 'settings',
  '/account/sign-in': 'sign_in',
  '/account/moments': 'moments',
  '/supporter/thanks': 'thanks',
}

function routePath(pathname: string): string {
  const path = pathname.split(/[?#]/)[0] || '/'
  return path.length > 1 ? path.replace(/\/+$/, '') : path
}

/**
 * Pages that carry a one-time secret or a sign-in proof in their address or
 * storage: the Twitch callback, email confirm, device link and restore, plus
 * any other /account/* page not named above. Sentry never starts there, and an
 * event raised after navigating to one is dropped at send time.
 */
export function isSecretBearingRoute(pathname: string): boolean {
  const path = routePath(pathname)
  if (path in ACCOUNT_SENTRY_ROUTES) return false
  return path === '/account' || path.startsWith('/account/')
}

/** The account page name for a path, or undefined outside the account pages. */
export function accountSurfaceFor(pathname: string): AccountSurface | undefined {
  return ACCOUNT_SENTRY_ROUTES[routePath(pathname)]
}

/** The one message account captures use; it survives scrubDiagnosticText verbatim. */
export const ACCOUNT_ISSUE_MESSAGE = 'StreamPulse account issue'
const KNOWN_APP_MESSAGES = new Set([ACCOUNT_ISSUE_MESSAGE])
const capturedAccountIssues = new Set<string>()

/**
 * Reports one fixed account error code, at most once per code per page load.
 * Never sends a user, context, extra, URL query or any value from the page.
 */
export function captureAccountIssue(code: AccountErrorCode): void {
  if (capturedAccountIssues.has(code)) return
  capturedAccountIssues.add(code)
  try {
    const surface = typeof window === 'undefined' ? undefined : accountSurfaceFor(window.location.pathname)
    Sentry.captureMessage(ACCOUNT_ISSUE_MESSAGE, { level: 'warning', tags: { error_code: code, ...(surface ? { account_surface: surface } : {}) } })
  } catch { /* Diagnostics must never break the page. */ }
}

export function resetAccountIssuesForTests(): void {
  capturedAccountIssues.clear()
}

const SENSITIVE_KEY =
  /authorization|cookie|token|secret|password|passwd|credential|signature|beta|body|message|login|username|email|ip|channel|raw_/i

const PRODUCTION_HOSTS = new Set(['streampulse.stream', 'www.streampulse.stream'])

export function portalRelease(): string {
  return (import.meta.env.VITE_PORTAL_VERSION as string | undefined)?.trim() || 'dev'
}

/** Short form for status UI — full SHA remains in VITE_PORTAL_VERSION / Sentry release. */
export function portalReleaseShort(): string {
  const full = portalRelease()
  const m = /^streampulse-portal@([0-9a-f]{40})$/i.exec(full)
  if (!m) return full
  return `streampulse-portal@${m[1].slice(0, 7)}`
}

const SUPPORTER_ROUTE_NAMES = new Set([
  '/supporter', '/supporter/thanks', '/terms', '/refunds',
  '/account/sign-in', '/account/settings', '/account/billing', '/account/billing/return', '/account/moments',
])

export function sanitizePortalPath(pathname: string): string {
  let path = pathname.split(/[?#]/)[0] || '/'
  if (/^https?:\/\//i.test(path)) {
    try { path = new URL(path).pathname } catch { return '/:unknown' }
  }
  if (path === '/analytics' || path === '/analytics/streams') return path
  if (/^\/analytics\/[^/]+\/s\/[^/]+\/?$/.test(path)) return '/analytics/:login/s/:streamId'
  if (/^\/analytics\/[^/]+\/[^/]+\/?$/.test(path)) return '/analytics/:login/:streamId'
  if (/^\/analytics\/[^/]+\/?$/.test(path)) return '/analytics/:login'
  if (/^\/s\/[^/]+\/[^/]+\/?$/.test(path)) return '/s/:login/:streamId'
  if (['/', '/docs', '/status', '/privacy', '/support', '/dashboard', '/dashboard/clips'].includes(path)) return path
  // Supporter and account pages that report errors (spec 2026-10-10 §5.5). Query
  // and hash are already gone, so ?attempt= and ?intent= never leave the page.
  if (SUPPORTER_ROUTE_NAMES.has(routePath(path))) return routePath(path)
  return '/:unknown'
}

/** Free-form runtime/provider text is untrusted, even without a recognizable key. */
export function scrubDiagnosticText(value: string): string {
  // Preserve only exact, non-interpolated platform messages. Extending a secret
  // key blacklist cannot protect opaque tokens or future provider error shapes.
  const platformMessages = new Set([
    'Failed to fetch', 'Load failed', 'Script error.',
    'NetworkError when attempting to fetch resource.',
    'ResizeObserver loop limit exceeded',
    'ResizeObserver loop completed with undelivered notifications.',
  ])
  return platformMessages.has(value) || KNOWN_APP_MESSAGES.has(value) ? value : 'Diagnostic text omitted'
}

/**
 * A free-form tag value that looks like a person, an account or a payment is
 * dropped: email addresses, UUIDs (account and attempt IDs), JWT-shaped tokens
 * and Stripe object IDs (spec 2026-10-10 §5.5).
 */
const IDENTIFYING_VALUE = /@|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|eyJ|\b(?:acct|cs|cus|sub|si|pi|pm|in|ch|re|dp|evt|seti|bps|price|prod)_[A-Za-z0-9]/i

function scrubRecord(input: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!input) return out
  for (const [k, v] of Object.entries(input)) {
    if (!ALLOWED_TAGS.has(k) || SENSITIVE_KEY.test(k)) continue
    if (v == null) continue
    if (k === 'route') out[k] = sanitizePortalPath(String(v))
    else if (k in TAG_ENUMS) { if (TAG_ENUMS[k]!.has(String(v))) out[k] = String(v) }
    else if (/^[\w.:@/-]{1,128}$/.test(String(v)) && !String(v).includes('://') && !IDENTIFYING_VALUE.test(String(v))) out[k] = String(v)
  }
  return out
}

function scrubAssetFilename(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2048) return undefined
  return value.match(/(?:^|\/)(assets\/[\w.-]{1,128}\.js)(?:[?#].*)?$/)?.[1]
}

function scrubSourceMapMetadata(
  metadata: Sentry.ErrorEvent['debug_meta'],
  frameFilenames: Set<string>,
): Sentry.ErrorEvent['debug_meta'] {
  if (!Array.isArray(metadata?.images)) return undefined
  const images: Array<{ type: 'sourcemap'; code_file: string; debug_id: string }> = []
  const seenAssets = new Set<string>()
  for (const image of metadata.images.slice(0, 50)) {
    if (image?.type !== 'sourcemap' || typeof image.debug_id !== 'string'
      || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(image.debug_id)) continue
    const codeFile = scrubAssetFilename(image.code_file)
    if (!codeFile || !frameFilenames.has(codeFile) || seenAssets.has(codeFile)) continue
    seenAssets.add(codeFile)
    images.push({ type: 'sourcemap', code_file: codeFile, debug_id: image.debug_id.toLowerCase() })
  }
  return images.length ? { images } : undefined
}

export function scrubPortalEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent | null {
  if (typeof window !== 'undefined' && isSecretBearingRoute(window.location.pathname)) return null
  if (typeof window !== 'undefined' && import.meta.env.PROD) {
    const host = window.location.hostname
    if (host && !PRODUCTION_HOSTS.has(host) && host !== 'localhost' && host !== '127.0.0.1') {
      return null
    }
  }

  const tags = scrubRecord(event.tags as Record<string, unknown> | undefined)
  tags.service = 'portal'
  tags.role = 'portal'
  tags.release = portalRelease()
  const safeNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
  const exception: Sentry.ErrorEvent['exception'] = event.exception?.values ? {
    values: event.exception.values.slice(0, 5).map(ex => ({
      type: /^(?:Error|TypeError|RangeError|ReferenceError|SyntaxError|URIError|EvalError|AggregateError)$/.test(ex.type ?? '') ? ex.type : 'Error',
      value: ex.value ? scrubDiagnosticText(ex.value) : undefined,
      stacktrace: ex.stacktrace?.frames ? { frames: ex.stacktrace.frames.slice(-50).map(frame => ({
        // Asset/line/column plus Debug IDs retain debugging value without
        // accepting dynamic function names as another free-text sink.
        filename: scrubAssetFilename(frame.filename),
        lineno: safeNumber(frame.lineno), colno: safeNumber(frame.colno),
        in_app: typeof frame.in_app === 'boolean' ? frame.in_app : undefined,
      })) } : undefined,
      mechanism: ex.mechanism ? { type: 'generic', handled: typeof ex.mechanism.handled === 'boolean' ? ex.mechanism.handled : undefined } : undefined,
    })),
  } : undefined
  const frameFilenames = new Set<string>()
  for (const ex of exception?.values ?? []) {
    for (const frame of ex.stacktrace?.frames ?? []) {
      if (frame.filename) frameFilenames.add(frame.filename)
    }
  }
  // Construct an allowlist rather than mutating the SDK event: future SDK
  // fields, raw_stacktrace and arbitrary exception extras must not silently
  // become a second diagnostics upload path. Only matching source-map Debug
  // IDs survive; beforeSend runs after the SDK's Debug ID enrichment.
  return {
    type: undefined,
    event_id: /^[a-f0-9]{32}$/i.test(event.event_id ?? '') ? event.event_id : undefined,
    timestamp: safeNumber(event.timestamp),
    platform: 'javascript',
    level: event.level && ['fatal', 'error', 'warning', 'log', 'info', 'debug'].includes(event.level) ? event.level : undefined,
    release: portalRelease(),
    environment: import.meta.env.MODE,
    tags,
    transaction: event.transaction ? sanitizePortalPath(event.transaction) : undefined,
    message: event.message ? scrubDiagnosticText(event.message) : undefined,
    exception,
    debug_meta: scrubSourceMapMetadata(event.debug_meta, frameFilenames),
  }
}

function beforeBreadcrumb(breadcrumb: Sentry.Breadcrumb): Sentry.Breadcrumb | null {
  if (!breadcrumb) return null
  if (breadcrumb.category === 'console') return null
  if (breadcrumb.category === 'xhr' || breadcrumb.category === 'fetch') return null
  if (breadcrumb.category === 'navigation') {
    const from = typeof breadcrumb.data?.from === 'string' ? sanitizePortalPath(breadcrumb.data.from) : undefined
    const to = typeof breadcrumb.data?.to === 'string' ? sanitizePortalPath(breadcrumb.data.to) : undefined
    return {
      ...breadcrumb,
      data: { ...(from ? { from } : {}), ...(to ? { to } : {}) },
      message: undefined,
    }
  }
  if (breadcrumb.category === 'ui.click') {
    return {
      category: 'ui.click',
      level: breadcrumb.level,
      timestamp: breadcrumb.timestamp,
      type: breadcrumb.type,
    }
  }
  return null
}

/** Initialize Sentry when VITE_SENTRY_DSN is set. No-op otherwise. */
export function initPortalSentry(): void {
  const dsn = (import.meta.env.VITE_SENTRY_DSN as string | undefined)?.trim()
  if (!dsn) return

  const release = portalRelease()
  Sentry.init({
    dsn,
    release,
    environment: (import.meta.env.MODE as string) || 'production',
    sampleRate: 1.0,
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend: scrubPortalEvent,
    beforeBreadcrumb,
    defaultIntegrations: false,
    integrations: [
      Sentry.inboundFiltersIntegration(),
      Sentry.functionToStringIntegration(),
      Sentry.browserApiErrorsIntegration(),
      Sentry.globalHandlersIntegration({ onerror: true, onunhandledrejection: true }),
    ],
  })

  Sentry.setTag('service', 'portal')
  Sentry.setTag('role', 'portal')
  Sentry.setTag('release', release)
  Sentry.setTag('artifact_version', release)
}

export { Sentry }
