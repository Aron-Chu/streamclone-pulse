import { mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, createHmac } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Miniflare } from 'miniflare'
import worker, { handleRequest } from '../public/_worker.js'
import { assertEdgeFreeze } from './check-edge-freeze.mjs'

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const portal = 'https://streampulse.stream'
const api = 'https://api.streampulse.stream'
const id = '12345678-1234-1234-1234-123456789abc'
// Test-only HMAC key (not a real secret) and documentation-range addresses.
const edgeKey = 'pulse-edge-unit-test-key-not-real-0123'
const visitor = '203.0.113.7'
const spoofed = '198.51.100.9'
const HEX32 = /^[0-9a-f]{32}$/
const noFetch = () => { throw new Error('unexpected upstream call') }
const assets = { fetch: request => new Response(`asset:${new URL(request.url).pathname}`) }
const env = { PULSE_EDGE_SECRET: edgeKey, ASSETS: assets }
// The Worker logs one line per API request; keep test output clean and inspect it.
const logs = mock.method(console, 'log', () => {})
const ok = () => new Response('{}', { headers: { 'Content-Type': 'application/json' } })

function get(path, headers = {}) {
  return new Request(portal + path, { headers: { 'CF-Connecting-IP': visitor, ...headers } })
}

function post(path, options = {}) {
  return new Request(portal + path, {
    method: 'POST',
    headers: { Origin: portal, 'Content-Type': 'application/json', 'CF-Connecting-IP': visitor, ...options.headers },
    body: options.body ?? '{}',
  })
}

function expectedMac(t, ip, method, pathname, key = edgeKey) {
  return createHmac('sha256', Buffer.from(key, 'utf8'))
    .update(`pulse-edge-v1\n${t}\n${ip}\n${method}\n${pathname}`)
    .digest('hex')
}

function assertEdgeHeaders(headers, { method, pathname, ip = visitor, key = edgeKey }) {
  assert.equal(headers.get('x-pulse-client-ip'), ip)
  const match = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(headers.get('x-pulse-edge-signature') ?? '')
  assert.ok(match, `signature header format: ${headers.get('x-pulse-edge-signature')}`)
  assert.ok(Math.abs(Number(match[1]) - Date.now() / 1000) <= 5, 'signature timestamp is current unix seconds')
  assert.equal(match[2], expectedMac(match[1], ip, method, pathname, key))
}

function lastLog() {
  const calls = logs.mock.calls
  return calls.length ? calls[calls.length - 1].arguments.join(' ') : null
}

test('only the exact account and billing browser routes reach the fixed API host', async () => {
  const getPaths = [
    '/v1/account/me', '/v1/account/devices', `/v1/account/devices?cursor=${id}`,
    '/v1/billing/supporter', `/v1/billing/checkout/${id}`,
  ]
  const postPaths = [
    '/v1/account/auth/start', '/v1/account/auth/complete', '/v1/account/auth/logout',
    '/v1/account/device-links/inspect', '/v1/account/device-links/approve',
    '/v1/account/devices/revoke', '/v1/billing/checkout', '/v1/billing/portal',
  ]
  const seen = []
  const upstream = request => {
    seen.push([request.method, request.url])
    return ok()
  }
  for (const path of getPaths) assert.equal((await handleRequest(get(path), env, upstream)).status, 200, path)
  for (const path of postPaths) assert.equal((await handleRequest(post(path), env, upstream)).status, 200, path)
  assert.deepEqual(seen, [
    ...getPaths.map(path => ['GET', api + path]),
    ...postPaths.map(path => ['POST', api + path]),
  ])
})

test('unknown, encoded, broad, webhook, entitlement, native device, and malformed ID paths stay local', async () => {
  for (const path of [
    '/v1', '/v1/public/hub', '/v1/extension/health', '/v1/portal/analytics/x', '/v1/admin/health',
    '/v1/billing/stripe/webhook', '/v1/billing/entitlement', '/v1/account/device-links/poll',
    '/v1/account/me/extra', '/v1/account/%6de', '/v1/account%2fme',
    '/v%31/account/me', '/%76%31/account/me', '/%2fv1/account/me',
    '/v1%5caccount/me',
    '/v1/billing/checkout/12345678-1234-1234-1234-123456789abz',
    '/v1/billing/checkout/12345678123412341234123456789abc',
  ]) {
    const result = await handleRequest(get(path), env, noFetch)
    assert.equal(result.status, 404, path)
    assert.equal(result.headers.get('cache-control'), 'private, no-store')
    assert.equal(result.headers.get('cdn-cache-control'), 'no-store')
    assert.match(result.headers.get('x-correlation-id'), HEX32)
  }
  for (const path of ['/v1/billing/stripe/webhook', '/v1/billing/entitlement', '/v1/public/hub']) {
    const result = await handleRequest(post(path, { headers: { 'Stripe-Signature': 't=1,v1=00' } }), env, noFetch)
    assert.equal(result.status, 404, `POST ${path}`)
  }
  assert.equal((await handleRequest(new Request('https://evil.invalid/v1/account/me'), env, noFetch)).status, 403)
  assert.equal((await handleRequest(new Request('https://streampulse.stream:444/v1/account/me'), env, noFetch)).status, 403)
  assert.equal(await (await handleRequest(new Request(portal + '/assets/%76%31.svg'), env, noFetch)).text(),
    'asset:/assets/%76%31.svg')
})

test('workerd observes normalized dot segments, signs with WebCrypto, and only the canonical route reaches the API', async t => {
  const workerSource = readFileSync(join(webRoot, 'public/_worker.js'), 'utf8')
  const entrySource = `
        import { handleRequest } from './worker.mjs';
        export default { fetch(request) {
          const env = { PULSE_EDGE_SECRET: ${JSON.stringify(edgeKey)}, ASSETS: { fetch: () => new Response('asset') } };
          return handleRequest(request, env, remote => new Response(JSON.stringify({
            incoming: request.url,
            upstream: remote.url,
            clientIp: remote.headers.get('x-pulse-client-ip'),
            signature: remote.headers.get('x-pulse-edge-signature'),
            correlationId: remote.headers.get('x-correlation-id'),
          }), { headers: { 'Content-Type': 'application/json' } }));
        } };
      `
  const structuredLogs = []
  const runtime = new Miniflare({
    handleStructuredLogs: log => structuredLogs.push(log.message),
    workers: [{ config: {
      name: 'account-proxy-test', type: 'worker', compatibilityDate: '2026-09-18',
      manifest: { mainModule: 'entry.mjs', modules: {
        'entry.mjs': { type: 'esm', contents: entrySource },
        'worker.mjs': { type: 'esm', contents: workerSource },
      } },
    } }],
  })
  t.after(() => runtime.dispose())

  for (const path of ['/v1/account/../account/me', '/v1/account/%2e%2e/account/me', '/v1\\account/me']) {
    const response = await runtime.dispatchFetch(portal + path, { headers: { 'CF-Connecting-IP': visitor } })
    assert.equal(response.status, 200, path)
    const body = await response.json()
    assert.equal(body.incoming, portal + '/v1/account/me')
    assert.equal(body.upstream, api + '/v1/account/me')
    assert.match(body.correlationId, HEX32)
    assertEdgeHeaders(new Headers({ 'x-pulse-client-ip': body.clientIp, 'x-pulse-edge-signature': body.signature }),
      { method: 'GET', pathname: '/v1/account/me' })
  }
  const encoded = await runtime.dispatchFetch(portal + '/v%31/account/me', { headers: { 'CF-Connecting-IP': visitor } })
  assert.equal(encoded.status, 404)
  assert.equal(encoded.headers.get('cdn-cache-control'), 'no-store')
  const edgeLines = structuredLogs.filter(line => line.includes('pulse_edge'))
  assert.ok(edgeLines.some(line => /"route":"account\.me","status":200,"cid":"[0-9a-f]{32}"/.test(line)), edgeLines.join('\n'))
  assert.ok(edgeLines.every(line => !line.includes(visitor)))
})

test('method and query constraints reject aliases, duplicates, and unexpected parameters', async () => {
  assert.equal((await handleRequest(post('/v1/account/me'), env, noFetch)).status, 405)
  assert.equal((await handleRequest(get('/v1/billing/checkout'), env, noFetch)).status, 405)
  assert.equal((await handleRequest(new Request(portal + '/v1/billing/portal', { method: 'PUT' }), env, noFetch)).status, 405)
  for (const path of [
    '/v1/account/me?', '/v1/account/me?x=1', `/v1/account/devices?cursor=${id}&cursor=${id}`,
    `/v1/account/devices?%63ursor=${id}`, `/v1/account/devices?CURSOR=${id}`, `/v1/account/devices?cursor=${id}&x=1`,
    '/v1/account/devices?cursor=bad', `/v1/billing/checkout/${id}?x=1`,
  ]) assert.equal((await handleRequest(get(path), env, noFetch)).status, 400, path)
})

test('cursor and checkout attempt UUIDs match case-insensitively and are forwarded unchanged', async () => {
  const seen = []
  const upstream = request => {
    seen.push(request.url)
    assertEdgeHeaders(request.headers, { method: 'GET', pathname: new URL(request.url).pathname })
    return ok()
  }
  const upper = id.toUpperCase()
  const mixed = '12345678-ABCD-abcd-1234-123456789ABC'
  for (const path of [`/v1/account/devices?cursor=${upper}`, `/v1/account/devices?cursor=${mixed}`,
    `/v1/billing/checkout/${upper}`, `/v1/billing/checkout/${mixed}`]) {
    assert.equal((await handleRequest(get(path), env, upstream)).status, 200, path)
  }
  assert.deepEqual(seen, [
    `${api}/v1/account/devices?cursor=${upper}`, `${api}/v1/account/devices?cursor=${mixed}`,
    `${api}/v1/billing/checkout/${upper}`, `${api}/v1/billing/checkout/${mixed}`,
  ])
})

test('POST requires exact apex Origin, JSON content type, and at most 4 KiB of body', async () => {
  for (const headers of [
    { Origin: 'https://evil.invalid' }, { Origin: portal + '/' }, { Origin: '' },
  ]) assert.equal((await handleRequest(post('/v1/account/auth/start', { headers }), env, noFetch)).status, 403)
  const noOrigin = new Request(portal + '/v1/account/auth/start', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': visitor }, body: '{}',
  })
  assert.equal((await handleRequest(noOrigin, env, noFetch)).status, 403)
  for (const contentType of ['text/plain', 'application/json; profile=x', 'application/x-www-form-urlencoded']) {
    const result = await handleRequest(post('/v1/account/auth/start', { headers: { 'Content-Type': contentType } }), env, noFetch)
    assert.equal(result.status, 415, contentType)
  }
  assert.equal((await handleRequest(post('/v1/account/auth/start', { body: 'x'.repeat(4097) }), env, noFetch)).status, 413)
  assert.equal((await handleRequest(post('/v1/account/auth/start', { body: 'x'.repeat(4096) }), env, ok)).status, 200)
})

test('upstream request forwards selected cookies and CSRF but no caller credentials, forwarding, or edge headers', async () => {
  const request = post('/v1/account/auth/logout', {
    headers: {
      Cookie: 'other=secret; __Host-pulse_account=a; __Host-pulse_csrf=b; __Host-pulse_login=c',
      'X-Pulse-CSRF': 'b', Authorization: 'Bearer private', 'X-Forwarded-For': spoofed,
      'X-Forwarded-Host': 'evil.invalid', 'X-Real-IP': spoofed, 'True-Client-IP': spoofed, Forwarded: `for=${spoofed}`,
      'X-Pulse-Client-IP': spoofed, 'X-Pulse-Edge-Signature': `t=1,v1=${'0'.repeat(64)}`,
      'X-Correlation-ID': 'f'.repeat(32),
    },
  })
  const result = await handleRequest(request, env, async remote => {
    assert.equal(remote.url, api + '/v1/account/auth/logout')
    assert.equal(remote.redirect, 'manual')
    assert.deepEqual([...remote.headers.keys()].sort(), [
      'accept', 'cache-control', 'content-type', 'cookie', 'origin',
      'x-correlation-id', 'x-pulse-client-ip', 'x-pulse-csrf', 'x-pulse-edge-signature',
    ])
    assert.equal(remote.headers.get('cookie'), '__Host-pulse_account=a; __Host-pulse_csrf=b; __Host-pulse_login=c')
    assert.equal(remote.headers.get('x-pulse-csrf'), 'b')
    assert.equal(remote.headers.get('origin'), portal)
    assert.equal(remote.headers.get('accept'), 'application/json')
    assert.equal(remote.headers.get('cache-control'), 'no-store')
    assert.notEqual(remote.headers.get('x-correlation-id'), 'f'.repeat(32))
    assertEdgeHeaders(remote.headers, { method: 'POST', pathname: '/v1/account/auth/logout' })
    return new Response(null, { status: 204 })
  })
  assert.equal(result.status, 204)
  const duplicate = post('/v1/account/auth/logout', { headers: { Cookie: '__Host-pulse_account=a; __Host-pulse_account=b' } })
  assert.equal((await handleRequest(duplicate, env, noFetch)).status, 400)
})

test('edge signature follows pulse-edge-v1 exactly: UTF-8 key, unix seconds, IP, uppercase method, path without query', async () => {
  const before = Math.floor(Date.now() / 1000)
  let captured
  await handleRequest(get(`/v1/account/devices?cursor=${id}`), env, remote => { captured = remote.headers; return ok() })
  const after = Math.floor(Date.now() / 1000)
  const [, t, mac] = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(captured.get('x-pulse-edge-signature'))
  assert.ok(Number(t) >= before && Number(t) <= after)
  assert.equal(mac, createHmac('sha256', Buffer.from(edgeKey, 'utf8'))
    .update(`pulse-edge-v1\n${t}\n${visitor}\nGET\n/v1/account/devices`).digest('hex'))
  assert.notEqual(mac, expectedMac(t, visitor, 'GET', `/v1/account/devices?cursor=${id}`))
  assert.notEqual(mac, expectedMac(t, visitor, 'get', '/v1/account/devices'))

  await handleRequest(post('/v1/billing/checkout', { headers: { 'CF-Connecting-IP': '2001:db8::7' } }), env,
    remote => { captured = remote.headers; return ok() })
  assertEdgeHeaders(captured, { method: 'POST', pathname: '/v1/billing/checkout', ip: '2001:db8::7' })

  // 16 two-byte characters are 32 UTF-8 bytes: long enough, and the key is the UTF-8 encoding.
  const multibyte = 'é'.repeat(16)
  await handleRequest(get('/v1/account/me'), { ...env, PULSE_EDGE_SECRET: multibyte },
    remote => { captured = remote.headers; return ok() })
  assertEdgeHeaders(captured, { method: 'GET', pathname: '/v1/account/me', key: multibyte })
})

test('a missing or short edge secret, or a missing or malformed visitor IP, fails closed with a generic 503', async () => {
  const cases = [
    [get('/v1/account/me'), { ASSETS: assets }],
    [get('/v1/account/me'), { ...env, PULSE_EDGE_SECRET: '' }],
    [get('/v1/account/me'), { ...env, PULSE_EDGE_SECRET: 'x'.repeat(31) }],
    [get('/v1/account/me'), { ...env, PULSE_EDGE_SECRET: `${'é'.repeat(15)}x` }],
    [get('/v1/account/me'), { ...env, PULSE_EDGE_SECRET: 12345678901234567890123456789012345 }],
    [post('/v1/billing/checkout'), { ASSETS: assets }],
    [new Request(portal + '/v1/account/me'), env],
  ]
  for (const ip of ['', 'not-an-ip', `${visitor}, ${spoofed}`, '256.1.1.1', '01.2.3.4', '203.0.113',
    '[2001:db8::7]', '2001:db8::7%eth0', '2001:db8:::7', 'fe80::1:2:3:4:5:6:7:8']) {
    cases.push([get('/v1/account/me', { 'CF-Connecting-IP': ip }), env])
  }
  for (const [request, caseEnv] of cases) {
    const result = await handleRequest(request, caseEnv, noFetch)
    assert.equal(result.status, 503, `${request.headers.get('cf-connecting-ip')} ${typeof caseEnv.PULSE_EDGE_SECRET}`)
    assert.equal(await result.text(), '')
    assert.equal(result.headers.get('cdn-cache-control'), 'no-store')
  }
})

test('billing POSTs time out at 30 s and every other relayed request at 12 s', async t => {
  const timeouts = mock.method(AbortSignal, 'timeout')
  t.after(() => timeouts.mock.restore())
  await handleRequest(post('/v1/billing/checkout'), env, ok)
  await handleRequest(post('/v1/billing/portal'), env, ok)
  await handleRequest(get('/v1/billing/supporter'), env, ok)
  await handleRequest(get(`/v1/billing/checkout/${id}`), env, ok)
  await handleRequest(post('/v1/account/auth/start'), env, ok)
  await handleRequest(get('/v1/account/me'), env, ok)
  assert.deepEqual(timeouts.mock.calls.map(call => call.arguments[0]), [30_000, 30_000, 12_000, 12_000, 12_000, 12_000])
})

test('correlation ID is generated at the edge, forwarded upstream, and the API value is passed back', async () => {
  const apiId = '0123456789abcdef0123456789abcdef'
  let sent
  logs.mock.resetCalls()
  const echoed = await handleRequest(get('/v1/account/me', { 'X-Correlation-ID': 'f'.repeat(32), Cookie: '__Host-pulse_account=cookie-value' }), env,
    remote => { sent = remote.headers.get('x-correlation-id'); return new Response('{"email":"body-value"}', { headers: { 'X-Correlation-ID': apiId } }) })
  assert.match(sent, HEX32)
  assert.notEqual(sent, 'f'.repeat(32))
  assert.equal(echoed.headers.get('x-correlation-id'), apiId)
  const line = lastLog()
  assert.deepEqual(JSON.parse(line), { event: 'pulse_edge', route: 'account.me', status: 200, cid: apiId })
  for (const leaked of [visitor, 'cookie-value', 'body-value', '/v1/account/me']) assert.ok(!line.includes(leaked), leaked)

  for (const bad of [null, 'NOT-A-CORRELATION-ID', 'ABCDEF0123456789ABCDEF0123456789']) {
    const response = await handleRequest(get('/v1/billing/supporter'), env, remote => {
      sent = remote.headers.get('x-correlation-id')
      return new Response('{}', { headers: bad ? { 'X-Correlation-ID': bad } : {} })
    })
    assert.equal(response.headers.get('x-correlation-id'), sent, String(bad))
  }

  const redirected = await handleRequest(get('/v1/account/me'), env,
    () => new Response(null, { status: 302, headers: { Location: 'https://evil.invalid', 'X-Correlation-ID': apiId } }))
  assert.equal(redirected.headers.get('x-correlation-id'), apiId)

  const first = await handleRequest(get('/v1/public/hub'), env, noFetch)
  const second = await handleRequest(get('/v1/public/hub'), env, noFetch)
  assert.match(first.headers.get('x-correlation-id'), HEX32)
  assert.notEqual(first.headers.get('x-correlation-id'), second.headers.get('x-correlation-id'))
  assert.deepEqual(JSON.parse(lastLog()), { event: 'pulse_edge', route: 'unmatched', status: 404, cid: second.headers.get('x-correlation-id') })

  const calls = logs.mock.calls.length
  await handleRequest(new Request(portal + '/supporter'), env, noFetch)
  assert.equal(logs.mock.calls.length, calls, 'static asset requests are not logged')
})

test('multiple Set-Cookie headers survive individually; unrelated headers and cookies are dropped', async () => {
  const cookies = [
    '__Host-pulse_account=a; Path=/; Secure; HttpOnly; SameSite=Lax',
    '__Host-pulse_csrf=b; Path=/; Secure; SameSite=Lax',
  ]
  const headers = new Headers({ 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*',
    'X-Debug-Token': 'private', 'Retry-After': '5', 'X-Request-Id': 'legacy' })
  for (const cookie of [...cookies, 'third_party=secret; Path=/']) headers.append('Set-Cookie', cookie)
  const response = await handleRequest(get('/v1/account/me'), env, () => new Response('{}', { headers }))
  assert.deepEqual(response.headers.getSetCookie(), cookies)
  assert.equal(response.headers.get('access-control-allow-origin'), null)
  assert.equal(response.headers.get('x-debug-token'), null)
  assert.equal(response.headers.get('x-request-id'), null)
  assert.equal(response.headers.get('retry-after'), '5')
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.equal(response.headers.get('cdn-cache-control'), 'no-store')

  const logout = new Headers()
  for (const cookie of cookies.map(value => value.replace(/=[ab];/, '=; Max-Age=0;'))) logout.append('Set-Cookie', cookie)
  const cleared = await handleRequest(post('/v1/account/auth/logout'), env,
    () => new Response(null, { status: 204, headers: logout }))
  assert.equal(cleared.headers.getSetCookie().length, 2)
  assert.ok(cleared.headers.getSetCookie().every(cookie => cookie.includes('Max-Age=0')))

  const wrongDomain = new Headers({ 'Set-Cookie': '__Host-pulse_account=a; Path=/; Secure; Domain=api.streampulse.stream' })
  assert.equal((await handleRequest(get('/v1/account/me'), env,
    () => new Response('{}', { headers: wrongDomain }))).status, 502)
})

test('compressed JSON keeps its encoding while identity JSON stays unencoded', async () => {
  const json = '{"ok":true}'
  const compressed = gzipSync(json)
  const gzipResponse = await handleRequest(get('/v1/account/me'), env,
    () => new Response(compressed, { headers: {
      'Content-Type': 'application/json',
      'Content-Encoding': 'gzip',
      'Content-Length': String(compressed.byteLength),
    } }))
  assert.equal(gzipResponse.headers.get('content-encoding'), 'gzip')
  assert.equal(gzipResponse.headers.get('content-length'), null)
  assert.deepEqual(Buffer.from(await gzipResponse.arrayBuffer()), compressed)

  const identityResponse = await handleRequest(get('/v1/account/me'), env,
    () => new Response(json, { headers: { 'Content-Type': 'application/json' } }))
  assert.equal(identityResponse.headers.get('content-encoding'), null)
  assert.equal(await identityResponse.text(), json)
})

test('redirects, network failures, and timeouts return generic no-store errors', async () => {
  const redirect = await handleRequest(get('/v1/account/me'), env,
    () => new Response(null, { status: 302, headers: { Location: 'https://evil.invalid' } }))
  assert.equal(redirect.status, 502)
  assert.equal(redirect.headers.get('location'), null)
  assert.equal(redirect.headers.get('cdn-cache-control'), 'no-store')
  const unavailable = await handleRequest(get('/v1/account/me'), env,
    () => { throw new Error('sensitive upstream detail') })
  assert.equal(unavailable.status, 503)
  assert.equal(await unavailable.text(), '')
  const timedOut = await handleRequest(get('/v1/account/me'), env,
    () => { throw new DOMException('The operation timed out.', 'TimeoutError') })
  assert.equal(timedOut.status, 503)
  assert.equal(timedOut.headers.get('cache-control'), 'private, no-store')
})

test('hosted negative probes: wrong method 405, encoded alias 404, extra query 400, large body 413, no-store account route', async () => {
  assert.equal((await handleRequest(get('/v1/account/auth/start'), env, noFetch)).status, 405)
  assert.equal((await handleRequest(get('/v1/account/%6de'), env, noFetch)).status, 404)
  assert.equal((await handleRequest(get('/v1/account/me?debug=1'), env, noFetch)).status, 400)
  assert.equal((await handleRequest(post('/v1/account/auth/start', { body: `{"pad":"${'x'.repeat(4096)}"}` }), env, noFetch)).status, 413)
  const declared = post('/v1/billing/checkout', { headers: { 'Content-Length': '4097' }, body: '{}' })
  assert.equal((await handleRequest(declared, env, noFetch)).status, 413)
  const me = await handleRequest(get('/v1/account/me'), env,
    () => new Response('{"error":"unauthorized"}', { status: 401, headers: { 'Content-Type': 'application/json' } }))
  assert.equal(me.status, 401)
  assert.equal(me.headers.get('cache-control'), 'private, no-store')
  assert.equal(me.headers.get('cdn-cache-control'), 'no-store')
})

test('_routes.json invokes the Worker only for account and billing paths', () => {
  const raw = readFileSync(join(webRoot, 'public/_routes.json'), 'utf8')
  assert.equal(raw, '{"version":1,"include":["/v1/account/*","/v1/billing/*"],"exclude":[]}\n')
  assert.deepEqual(JSON.parse(raw), { version: 1, include: ['/v1/account/*', '/v1/billing/*'], exclude: [] })
})

test('static routes fall through to Pages assets and the committed pin admits exactly this Worker', async () => {
  assert.equal(await (await worker.fetch(new Request(portal + '/supporter'), env)).text(), 'asset:/supporter')
  const digest = createHash('sha256').update(readFileSync(join(webRoot, 'public/_worker.js'))).digest('hex')
  const result = assertEdgeFreeze(webRoot, { sourceOnly: true, now: new Date('2026-09-25T12:00:00Z') })
  assert.equal(result.admitted.sha256, digest)
})
