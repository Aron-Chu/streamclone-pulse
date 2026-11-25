// Types only: the SDK itself loads lazily (loadSdk below), so it stays out of every page's entry.
import type * as Sentry from '@sentry/react'
import { isPrivateSupporterRoute } from './accountRestore'
import { portalRelease, sanitizePortalPath } from './portalRelease'

export { portalRelease, portalReleaseShort, sanitizePortalPath } from './portalRelease'

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
])

const SENSITIVE_KEY =
  /authorization|cookie|token|secret|password|passwd|credential|signature|beta|body|message|login|username|email|ip|channel|raw_/i

const PRODUCTION_HOSTS = new Set(['streampulse.stream', 'www.streampulse.stream'])

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
  return platformMessages.has(value) ? value : 'Diagnostic text omitted'
}

function scrubRecord(input: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!input) return out
  for (const [k, v] of Object.entries(input)) {
    if (!ALLOWED_TAGS.has(k) || SENSITIVE_KEY.test(k)) continue
    if (v == null) continue
    if (k === 'route') out[k] = sanitizePortalPath(String(v))
    else if (/^[\w.:@/-]{1,128}$/.test(String(v)) && !String(v).includes('://')) out[k] = String(v)
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
  if (typeof window !== 'undefined' && isPrivateSupporterRoute(window.location.pathname)) return null
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
  // Global onerror/unhandledrejection events carry no route of their own; name
  // the page they happened on so /feedback and /terms issues stay apart.
  if (!tags.route && typeof window !== 'undefined') tags.route = sanitizePortalPath(window.location.pathname)
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
    transaction: event.transaction ? sanitizePortalPath(event.transaction) : tags.route,
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

/** The SDK parts the portal uses. loadSdk names each one, so the build bundles only these. */
type SentrySdk = Pick<typeof Sentry, 'init' | 'setTag' | 'captureException' | 'inboundFiltersIntegration'
  | 'functionToStringIntegration' | 'browserApiErrorsIntegration' | 'globalHandlersIntegration'>

/**
 * Reports raised before the SDK has loaded, oldest first. Each keeps the page
 * it happened on; the SDK sends them through the same beforeSend scrubbing as
 * any later report.
 */
type EarlyReport = { error: unknown; route: string; errorType?: string; mechanism?: string }
const EARLY_REPORT_LIMIT = 10
const SDK_IDLE_TIMEOUT_MS = 3_000

let enabled = false
let sdk: SentrySdk | null = null
let sdkLoad: Promise<void> | null = null
let earlyReports: EarlyReport[] = []
let stopEarlyListeners: (() => void) | null = null

function queueEarlyReport(report: Omit<EarlyReport, 'route'>): void {
  // Account pages get no diagnostics, as scrubPortalEvent drops theirs; never hold one in memory.
  if (isPrivateSupporterRoute(window.location.pathname)) return
  if (earlyReports.length >= EARLY_REPORT_LIMIT) return
  earlyReports.push({ ...report, route: sanitizePortalPath(window.location.pathname) })
}

/** Until the SDK's own global handlers are in, uncaught errors and rejections wait here. */
function listenForEarlyErrors(): () => void {
  const onError = (event: ErrorEvent) => {
    queueEarlyReport({ error: event.error ?? event.message, mechanism: 'auto.browser.global_handlers.onerror' })
  }
  const onRejection = (event: PromiseRejectionEvent) => {
    queueEarlyReport({ error: event.reason, mechanism: 'auto.browser.global_handlers.onunhandledrejection' })
  }
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  return () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
  }
}

function sendReport(client: SentrySdk, report: EarlyReport): void {
  const tags: Record<string, string> = { route: report.route }
  if (report.errorType) tags.error_type = report.errorType
  client.captureException(report.error, {
    captureContext: { tags },
    ...(report.mechanism ? { mechanism: { type: report.mechanism, handled: false } } : {}),
  })
}

function startSdk(client: SentrySdk, dsn: string): void {
  const release = portalRelease()
  client.init({
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
      client.inboundFiltersIntegration(),
      client.functionToStringIntegration(),
      client.browserApiErrorsIntegration(),
      client.globalHandlersIntegration({ onerror: true, onunhandledrejection: true }),
    ],
  })

  client.setTag('service', 'portal')
  client.setTag('role', 'portal')
  client.setTag('release', release)
  client.setTag('artifact_version', release)
}

/** Loads and starts the SDK once, then sends what waited for it. */
function loadSdk(dsn: string): Promise<void> {
  // Destructured right here (not passed on whole) so the build can drop the
  // SDK parts the portal never calls, as it did when the import was static.
  sdkLoad ??= import('@sentry/react')
    .then(({
      init, setTag, captureException, inboundFiltersIntegration,
      functionToStringIntegration, browserApiErrorsIntegration, globalHandlersIntegration,
    }) => {
      const client: SentrySdk = {
        init, setTag, captureException, inboundFiltersIntegration,
        functionToStringIntegration, browserApiErrorsIntegration, globalHandlersIntegration,
      }
      startSdk(client, dsn)
      // init ran synchronously, so the SDK's global handlers are already in:
      // nothing is reported twice and nothing falls between the two.
      stopEarlyListeners?.()
      stopEarlyListeners = null
      sdk = client
      const waiting = earlyReports
      earlyReports = []
      for (const report of waiting) sendReport(client, report)
    })
    .catch(() => {
      // No SDK (offline, blocked): stop collecting reports nothing will send.
      enabled = false
      stopEarlyListeners?.()
      stopEarlyListeners = null
      earlyReports = []
    })
  return sdkLoad
}

/** After the page has loaded, in the first idle moment (or after a few seconds at most). */
function whenIdleAfterLoad(run: () => void): void {
  const idle = () => {
    const requestIdle = (window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
    }).requestIdleCallback
    if (typeof requestIdle === 'function') requestIdle(run, { timeout: SDK_IDLE_TIMEOUT_MS })
    else window.setTimeout(run, 1)
  }
  if (document.readyState === 'complete') idle()
  else window.addEventListener('load', idle, { once: true })
}

/**
 * Set up error reporting when VITE_SENTRY_DSN is set; a no-op otherwise. The
 * SDK loads once the page is idle after load, so it is not part of any page's
 * first load. Errors and rejections before that wait (up to
 * EARLY_REPORT_LIMIT) and are sent once it starts.
 */
export function initPortalSentry(): void {
  const dsn = (import.meta.env.VITE_SENTRY_DSN as string | undefined)?.trim()
  if (!dsn || enabled || typeof window === 'undefined') return
  enabled = true
  stopEarlyListeners = listenForEarlyErrors()
  whenIdleAfterLoad(() => { void loadSdk(dsn) })
}

/**
 * Report an error a boundary caught, under the page it happened on. Before
 * the SDK has loaded the report waits and the load starts at once; with
 * reporting off (no DSN, or a load on an account page) it does nothing.
 */
export function reportPortalError(error: unknown): void {
  if (!enabled || typeof window === 'undefined') return
  const errorType = error instanceof Error && error.name ? error.name : 'Error'
  if (sdk) {
    sendReport(sdk, { error, route: sanitizePortalPath(window.location.pathname), errorType })
    return
  }
  // Reached in the app from a public page: account pages send nothing (the
  // queue drops their reports), so they do not start the SDK download either.
  if (isPrivateSupporterRoute(window.location.pathname)) return
  queueEarlyReport({ error, errorType })
  const dsn = (import.meta.env.VITE_SENTRY_DSN as string | undefined)?.trim()
  if (dsn) void loadSdk(dsn)
}
