// Review candidate only. Not a Pages entrypoint and not copied into dist.
// Promotion requires an explicit exception to the private-beta edge freeze.
const origin = 'https://streampulse.stream'
const routes = new Map([
  ['/v1/account/me', 'GET'], ['/v1/account/devices', 'GET'],
  ['/v1/account/auth/start', 'POST'], ['/v1/account/auth/complete', 'POST'], ['/v1/account/auth/logout', 'POST'],
  ['/v1/account/device-links/inspect', 'POST'], ['/v1/account/device-links/approve', 'POST'], ['/v1/account/devices/revoke', 'POST'],
  ['/v1/billing/supporter', 'GET'], ['/v1/billing/entitlement', 'GET'],
  ['/v1/billing/checkout', 'POST'], ['/v1/billing/portal', 'POST'],
])
const fail = status => new Response(null, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } })

export async function accountProxyCandidate(request, upstream = fetch) {
  const url = new URL(request.url)
  if (url.origin !== origin) return fail(403)
  const method = routes.get(url.pathname) ?? (/^\/v1\/billing\/checkout\/[a-f0-9-]{36}$/.test(url.pathname) ? 'GET' : null)
  if (!method) return fail(404)
  if (request.method !== method) return fail(405)
  if (url.search && !(url.pathname === '/v1/account/devices' && [...url.searchParams.keys()].length === 1 && /^[a-f0-9-]{36}$/.test(url.searchParams.get('cursor') ?? ''))) return fail(400)
  if (method === 'POST' && request.headers.get('origin') !== origin) return fail(403)
  let body
  if (method === 'POST') {
    if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') ?? '')) return fail(415)
    const reader = request.body?.getReader()
    const chunks = []; let length = 0
    if (reader) {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        length += value.byteLength
        if (length > 4096) { await reader.cancel(); return fail(413) }
        chunks.push(value)
      }
    }
    body = new Uint8Array(length); let offset = 0
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength }
  }
  const headers = new Headers({ Accept: 'application/json' })
  for (const name of ['content-type', 'origin', 'x-pulse-csrf']) {
    const value = request.headers.get(name); if (value) headers.set(name, value)
  }
  const cookies = (request.headers.get('cookie') ?? '').split(';').map(v => v.trim()).filter(v => /^__Host-pulse_(account|csrf|login)=/.test(v))
  if (cookies.length) headers.set('Cookie', cookies.join('; '))
  try {
    const response = await upstream(new Request('https://api.streampulse.stream'+url.pathname+url.search, {
      method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(12_000),
    }))
    if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); return fail(502) }
    const output = new Headers(response.headers)
    output.set('Cache-Control', 'private, no-store')
    output.set('CDN-Cache-Control', 'no-store')
    output.set('Referrer-Policy', 'no-referrer')
    output.set('X-Content-Type-Options', 'nosniff')
    output.delete('Access-Control-Allow-Origin')
    output.delete('Access-Control-Allow-Credentials')
    return new Response(response.body, { status: response.status, headers: output })
  } catch { return fail(503) }
}
