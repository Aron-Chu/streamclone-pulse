/**
 * Single source of truth for which API origins the extension may talk to.
 *
 * The backend URL is the highest-privilege value in `chrome.storage.sync`: it is
 * the prefix of every outbound request and it propagates to every profile signed
 * into the same Google account. Anything not on this allowlist fails closed to
 * the hosted API — enforced on read as well as write so a poisoned synced value
 * cannot stay active.
 */

export const HOSTED_BACKEND_ORIGIN = 'https://api.streampulse.stream'

export type BackendUrlKind = 'hosted' | 'local'

export type BackendUrlRejectReason =
  | 'empty'
  | 'malformed'
  | 'credentials'
  | 'query'
  | 'fragment'
  | 'path'
  | 'scheme'
  | 'host'
  | 'port'

interface AllowedOrigin {
  kind: BackendUrlKind
  protocol: string
  hostname: string
  /** Empty string means the scheme's default port. */
  port: string
}

const ALLOWED_ORIGINS: readonly AllowedOrigin[] = [
  { kind: 'hosted', protocol: 'https:', hostname: 'api.streampulse.stream', port: '' },
  { kind: 'local', protocol: 'http:', hostname: 'localhost', port: '8081' },
  { kind: 'local', protocol: 'http:', hostname: '127.0.0.1', port: '8081' },
]

export type BackendUrlValidation =
  | { ok: true; url: string; kind: BackendUrlKind }
  | { ok: false; url: string; kind: null; reason: BackendUrlRejectReason }

function reject(reason: BackendUrlRejectReason): BackendUrlValidation {
  return { ok: false, url: HOSTED_BACKEND_ORIGIN, kind: null, reason }
}

function canonicalOrigin(entry: AllowedOrigin): string {
  return entry.port
    ? `${entry.protocol}//${entry.hostname}:${entry.port}`
    : `${entry.protocol}//${entry.hostname}`
}

/**
 * Parse and allowlist a candidate backend URL.
 *
 * On success `url` is the canonical origin (no trailing slash). On failure `url`
 * is the hosted default, so callers can use the result unconditionally.
 */
export function validateBackendUrl(raw: unknown): BackendUrlValidation {
  if (typeof raw !== 'string') return reject('malformed')
  const trimmed = raw.trim()
  if (!trimmed) return reject('empty')

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return reject('malformed')
  }

  if (parsed.username || parsed.password) return reject('credentials')
  if (parsed.search) return reject('query')
  if (parsed.hash) return reject('fragment')
  if (parsed.pathname !== '/' && parsed.pathname !== '') return reject('path')

  const hostname = parsed.hostname.toLowerCase()
  const byHost = ALLOWED_ORIGINS.filter(entry => entry.hostname === hostname)
  if (byHost.length === 0) return reject('host')

  const byScheme = byHost.filter(entry => entry.protocol === parsed.protocol)
  if (byScheme.length === 0) return reject('scheme')

  const match = byScheme.find(entry => entry.port === parsed.port)
  if (!match) return reject('port')

  return { ok: true, url: canonicalOrigin(match), kind: match.kind }
}

/** Canonical origin for a candidate, falling back to hosted when disallowed. */
export function normalizeBackendUrl(raw: unknown): string {
  return validateBackendUrl(raw).url
}

export function isAllowedBackendUrl(raw: unknown): boolean {
  return validateBackendUrl(raw).ok
}

export function backendUrlRejectMessage(reason: BackendUrlRejectReason): string {
  switch (reason) {
    case 'empty':
      return 'Enter a backend URL.'
    case 'malformed':
      return 'Not a valid URL. Include the scheme, e.g. https://api.streampulse.stream'
    case 'credentials':
      return 'Backend URLs cannot embed a username or password.'
    case 'query':
      return 'Backend URLs cannot include a query string.'
    case 'fragment':
      return 'Backend URLs cannot include a fragment.'
    case 'path':
      return 'Use the origin only — no path segments.'
    case 'scheme':
      return 'Hosted must use https; the local stack must use http.'
    case 'host':
      return 'Only api.streampulse.stream, localhost, and 127.0.0.1 are allowed.'
    case 'port':
      return 'The local StreamPulse backend runs on port 8081.'
  }
}

export const ALLOWED_BACKEND_URLS: readonly string[] =
  ALLOWED_ORIGINS.map(canonicalOrigin)
