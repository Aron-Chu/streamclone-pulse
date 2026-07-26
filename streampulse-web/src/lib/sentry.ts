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
  const path = pathname.split('?')[0] || '/'
  if (path === '/analytics' || path === '/analytics/streams') return path
  if (/^\/analytics\/[^/]+\/s\/[^/]+\/?$/.test(path)) return '/analytics/:login/s/:streamId'
  if (/^\/analytics\/[^/]+\/[^/]+\/?$/.test(path)) return '/analytics/:login/:streamId'
  if (/^\/analytics\/[^/]+\/?$/.test(path)) return '/analytics/:login'
  if (/^\/s\/[^/]+\/[^/]+\/?$/.test(path)) return '/s/:login/:streamId'
  return path.replace(/\/[0-9a-f]{8,}\b/gi, '/:id')
}

function scrubRecord(input: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!input) return out
  for (const [k, v] of Object.entries(input)) {
    if (!ALLOWED_TAGS.has(k) || SENSITIVE_KEY.test(k)) continue
    if (v == null) continue
    out[k] = String(v)
  }
  return out
}

function beforeSend(event: Sentry.ErrorEvent): Sentry.ErrorEvent | null {
  if (typeof window !== 'undefined' && import.meta.env.PROD) {
    const host = window.location.hostname
    if (host && !PRODUCTION_HOSTS.has(host) && host !== 'localhost' && host !== '127.0.0.1') {
      return null
    }
  }

  event.user = undefined
  event.request = undefined
  event.breadcrumbs = undefined
  event.extra = undefined
  event.contexts = undefined

  const tags = scrubRecord(event.tags as Record<string, unknown> | undefined)
  tags.service = 'portal'
  tags.role = 'portal'
  tags.release = portalRelease()
  event.tags = tags

  if (event.transaction) {
    event.transaction = sanitizePortalPath(event.transaction)
  }
  if (event.message) {
    event.message = event.message.replace(/Bearer\s+\S+/gi, '[redacted]')
  }
  if (event.exception?.values) {
    for (const ex of event.exception.values) {
      if (ex.value) {
        ex.value = ex.value.replace(/Bearer\s+\S+/gi, '[redacted]')
      }
    }
  }
  return event
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
    beforeSend,
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
