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
])

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

export function scrubPortalEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent | null {
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
  // Construct an allowlist rather than mutating the SDK event: future SDK
  // fields, raw_stacktrace, debug metadata and arbitrary exception extras must
  // not silently become a second diagnostics upload path.
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
    exception: event.exception?.values ? {
      values: event.exception.values.slice(0, 5).map(ex => ({
        type: /^(?:Error|TypeError|RangeError|ReferenceError|SyntaxError|URIError|EvalError|AggregateError)$/.test(ex.type ?? '') ? ex.type : 'Error',
        value: ex.value ? scrubDiagnosticText(ex.value) : undefined,
        stacktrace: ex.stacktrace?.frames ? { frames: ex.stacktrace.frames.slice(-50).map(frame => ({
          // Asset/line/column plus release source maps retain debugging value
          // without accepting dynamic function names as another free-text sink.
          filename: frame.filename?.match(/(?:^|\/)(assets\/[\w.-]+\.js)(?:[?#].*)?$/)?.[1],
          lineno: safeNumber(frame.lineno), colno: safeNumber(frame.colno),
          in_app: typeof frame.in_app === 'boolean' ? frame.in_app : undefined,
        })) } : undefined,
        mechanism: ex.mechanism ? { type: 'generic', handled: typeof ex.mechanism.handled === 'boolean' ? ex.mechanism.handled : undefined } : undefined,
      })),
    } : undefined,
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
