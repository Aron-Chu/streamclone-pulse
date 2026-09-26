// Narrow same-origin relay for the portal's account and Supporter browser flows.
// scripts/check-edge-freeze.mjs admits this file only while its SHA-256 matches
// the pin in edge-freeze-exception.json, so any byte change needs a new pin and
// a new edge-freeze approval. The Go API owns sessions, CSRF, billing,
// entitlements, and Stripe processing; this Worker only relays the exact routes
// below and signs the visitor IP (edge contract pulse-edge-v1).
const PORTAL_ORIGIN = 'https://streampulse.stream'
const API_ORIGIN = 'https://api.streampulse.stream'
const MAX_BODY_BYTES = 4096
const MAX_COOKIE_BYTES = 8192
const DEFAULT_TIMEOUT_MS = 12_000
const BILLING_POST_TIMEOUT_MS = 30_000
const EDGE_SECRET_MIN_BYTES = 32
const EDGE_SIGNATURE_CONTEXT = 'pulse-edge-v1'
// Case-insensitive UUID digits only; the rest of each pattern stays exact.
const HEX = '[0-9a-fA-F]'
const UUID = `${HEX}{8}-${HEX}{4}-${HEX}{4}-${HEX}{4}-${HEX}{12}`
const CHECKOUT_ATTEMPT = new RegExp(`^/v1/billing/checkout/${UUID}$`)
const DEVICE_CURSOR = new RegExp(`^\\?cursor=${UUID}$`)
const CORRELATION_ID = /^[0-9a-f]{32}$/
const IPV4 = /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/

function route(method, name, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return { method, name, timeoutMs }
}

const ROUTES = new Map([
  ['/v1/account/me', route('GET', 'account.me')],
  ['/v1/account/devices', route('GET', 'account.devices')],
  ['/v1/account/auth/start', route('POST', 'account.auth.start')],
  ['/v1/account/auth/complete', route('POST', 'account.auth.complete')],
  ['/v1/account/auth/logout', route('POST', 'account.auth.logout')],
  ['/v1/account/device-links/inspect', route('POST', 'account.device_link.inspect')],
  ['/v1/account/device-links/approve', route('POST', 'account.device_link.approve')],
  ['/v1/account/devices/revoke', route('POST', 'account.device.revoke')],
  ['/v1/billing/supporter', route('GET', 'billing.supporter')],
  ['/v1/billing/checkout', route('POST', 'billing.checkout', BILLING_POST_TIMEOUT_MS)],
  ['/v1/billing/portal', route('POST', 'billing.portal', BILLING_POST_TIMEOUT_MS)],
])
const CHECKOUT_ATTEMPT_ROUTE = route('GET', 'billing.checkout_attempt')
const ALLOWED_COOKIE = /^(__Host-pulse_(?:account|csrf|login))=([^;\r\n]*)$/
const ALLOWED_SET_COOKIE = /^__Host-pulse_(?:account|csrf|login)=/

function hex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

function newCorrelationId() {
  return hex(crypto.getRandomValues(new Uint8Array(16)))
}

function edgeHeaders(correlationId) {
  return new Headers({
    'Cache-Control': 'private, no-store',
    'CDN-Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Correlation-ID': correlationId,
  })
}

function reject(status, correlationId) {
  return new Response(null, { status, headers: edgeHeaders(correlationId) })
}

function matchRoute(pathname) {
  return ROUTES.get(pathname) ?? (CHECKOUT_ATTEMPT.test(pathname) ? CHECKOUT_ATTEMPT_ROUTE : null)
}

function isApiPathOrVisibleAlias(pathname) {
  if (pathname === '/v1' || pathname.startsWith('/v1/')) return true
  if (!pathname.includes('%') && !pathname.includes('\\')) return false
  // Classify ASCII escapes before asset fallthrough. The decoded value is
  // never forwarded; only the exact, unescaped allowlist below can reach Go.
  const decoded = pathname.replace(/%([0-9a-f]{2})/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replaceAll('\\', '/').replace(/^\/+/, '/')
  return decoded === '/v1' || decoded.startsWith('/v1/')
}

function selectedCookies(raw) {
  if (raw.length > MAX_COOKIE_BYTES) return null
  const selected = []
  const seen = new Set()
  for (const part of raw.split(';')) {
    const match = ALLOWED_COOKIE.exec(part.trim())
    if (!match) continue
    if (seen.has(match[1])) return null
    seen.add(match[1])
    selected.push(`${match[1]}=${match[2]}`)
  }
  return selected.join('; ')
}

// Cloudflare sets CF-Connecting-IP on the visitor request; a malformed or
// missing value means the visitor cannot be identified, so the relay refuses.
function visitorIp(headers) {
  const value = headers.get('cf-connecting-ip')
  if (!value || value.length > 45) return null
  if (IPV4.test(value)) return value
  if (!value.includes(':') || !/^[0-9A-Fa-f:.]+$/.test(value)) return null
  try {
    new URL(`http://[${value}]/`)
  } catch {
    return null
  }
  return value
}

function edgeSecret(env) {
  const secret = env?.PULSE_EDGE_SECRET
  if (typeof secret !== 'string') return null
  const bytes = new TextEncoder().encode(secret)
  return bytes.byteLength >= EDGE_SECRET_MIN_BYTES ? bytes : null
}

// X-Pulse-Edge-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256> over
// "pulse-edge-v1\n" + t + "\n" + ip + "\n" + METHOD + "\n" + pathname.
async function edgeSignature(secret, ip, method, pathname) {
  const t = Math.floor(Date.now() / 1000)
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const message = `${EDGE_SIGNATURE_CONTEXT}\n${t}\n${ip}\n${method.toUpperCase()}\n${pathname}`
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return `t=${t},v1=${hex(new Uint8Array(mac))}`
}

async function boundedJsonBody(request) {
  const contentType = request.headers.get('content-type') ?? ''
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType)) return { error: 415 }
  const declaredLength = request.headers.get('content-length')
  if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_BODY_BYTES)) return { error: 413 }

  const reader = request.body?.getReader()
  if (!reader) return { body: new Uint8Array(0) }
  const chunks = []
  let length = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {})
      return { error: 413 }
    }
    chunks.push(value)
  }
  const body = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { body }
}

function upstreamSetCookies(headers) {
  if (typeof headers.getAll === 'function') return headers.getAll('Set-Cookie')
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie()
  // Failing closed avoids merging multiple Set-Cookie headers into one value.
  if (headers.has('Set-Cookie')) return null
  return []
}

async function relay(request, env, upstream, url, matched, correlationId) {
  if (url.origin !== PORTAL_ORIGIN || url.username || url.password || url.hash) return reject(403, correlationId)
  // Percent escapes and backslashes are never part of the reviewed API paths.
  if (url.pathname.includes('%') || url.pathname.includes('\\')) return reject(404, correlationId)
  if (!matched) return reject(404, correlationId)
  if (request.method !== matched.method) return reject(405, correlationId)

  const prefix = PORTAL_ORIGIN + url.pathname
  if (!request.url.startsWith(prefix)) return reject(400, correlationId)
  const query = request.url.slice(prefix.length)
  if (query && !(url.pathname === '/v1/account/devices' && DEVICE_CURSOR.test(query))) return reject(400, correlationId)
  if (matched.method === 'POST' && request.headers.get('origin') !== PORTAL_ORIGIN) return reject(403, correlationId)

  const cookies = selectedCookies(request.headers.get('cookie') ?? '')
  if (cookies === null) return reject(400, correlationId)

  // Fail closed: without the edge secret or a visitor IP, the API could not
  // tell visitors apart, so nothing is relayed.
  const secret = edgeSecret(env)
  const ip = visitorIp(request.headers)
  if (!secret || !ip) return reject(503, correlationId)

  const bodyResult = matched.method === 'POST' ? await boundedJsonBody(request) : { body: undefined }
  if (bodyResult.error) return reject(bodyResult.error, correlationId)

  // Built from scratch: no caller header (Authorization, forwarding headers,
  // X-Pulse-*, X-Correlation-ID) reaches the API unless set here.
  const headers = new Headers({ Accept: 'application/json', 'Cache-Control': 'no-store' })
  if (matched.method === 'POST') {
    headers.set('Content-Type', request.headers.get('content-type'))
    headers.set('Origin', PORTAL_ORIGIN)
  }
  const csrf = request.headers.get('x-pulse-csrf')
  if (csrf) headers.set('X-Pulse-CSRF', csrf)
  if (cookies) headers.set('Cookie', cookies)
  headers.set('X-Correlation-ID', correlationId)
  headers.set('X-Pulse-Client-IP', ip)
  headers.set('X-Pulse-Edge-Signature', await edgeSignature(secret, ip, matched.method, url.pathname))

  const response = await upstream(new Request(`${API_ORIGIN}${url.pathname}${url.search}`, {
    method: matched.method,
    headers,
    body: bodyResult.body,
    redirect: 'manual',
    signal: AbortSignal.timeout(matched.timeoutMs),
  }))
  const upstreamCorrelationId = response.headers.get('x-correlation-id')
  const responseCorrelationId = upstreamCorrelationId && CORRELATION_ID.test(upstreamCorrelationId)
    ? upstreamCorrelationId
    : correlationId
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel()
    return reject(502, responseCorrelationId)
  }

  const setCookies = upstreamSetCookies(response.headers)
  if (setCookies === null) return reject(502, responseCorrelationId)
  if (setCookies.some(cookie => ALLOWED_SET_COOKIE.test(cookie) && /(?:^|;)\s*domain\s*=/i.test(cookie))) {
    return reject(502, responseCorrelationId)
  }
  const output = edgeHeaders(responseCorrelationId)
  // The unread body can stay compressed in Workers; retain its encoding,
  // while leaving Content-Length for the runtime to recalculate if needed.
  for (const name of ['Content-Type', 'Content-Encoding', 'Retry-After']) {
    const value = response.headers.get(name)
    if (value) output.set(name, value)
  }
  for (const cookie of setCookies) {
    if (ALLOWED_SET_COOKIE.test(cookie)) output.append('Set-Cookie', cookie)
  }
  return new Response(response.body, { status: response.status, headers: output })
}

// One line per API request: route class, status, and correlation ID only.
// Never log IPs, paths, cookies, headers, or bodies.
function logRequest(routeClass, status, correlationId) {
  console.log(JSON.stringify({ event: 'pulse_edge', route: routeClass, status, cid: correlationId }))
}

export async function handleRequest(request, env, upstream = fetch) {
  let url = null
  try { url = new URL(request.url) } catch { /* handled below as a local 400 */ }
  if (url && !isApiPathOrVisibleAlias(url.pathname)) return env.ASSETS.fetch(request)

  const correlationId = newCorrelationId()
  const matched = url ? matchRoute(url.pathname) : null
  let response
  try {
    response = url ? await relay(request, env, upstream, url, matched, correlationId) : reject(400, correlationId)
  } catch {
    // Never expose network, provider, cookie, or body details in an edge error.
    response = reject(503, correlationId)
  }
  logRequest(matched?.name ?? 'unmatched', response.status, response.headers.get('x-correlation-id'))
  return response
}

export default {
  fetch(request, env) {
    return handleRequest(request, env)
  },
}
