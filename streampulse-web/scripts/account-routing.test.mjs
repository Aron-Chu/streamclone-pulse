import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { once } from 'node:events'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer, resolveConfig } from 'vite'

test('account SPA and same-origin API use the actual Vite routing configuration', { timeout: 30_000 }, async (t) => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const config = await resolveConfig({ root, envFile: false }, 'serve')
  assert.equal(config.server.proxy['/v1'].target, 'http://localhost:8081')
  assert.equal(config.server.proxy['/v1'].changeOrigin, false)
  const cookies = [
    '__Host-pulse_session=fixture; Path=/; Secure; HttpOnly; SameSite=Lax',
    '__Host-pulse_csrf=fixture; Path=/; Secure; SameSite=Lax',
  ]
  const requests = []
  const upstream = createHttpServer(async (request, response) => {
    let body = ''
    for await (const part of request) body += part
    requests.push({ url: request.url, method: request.method, headers: request.headers, body })
    response.setHeader('Content-Type', 'application/json')
    response.setHeader('Cache-Control', 'private, no-store')
    response.setHeader('Set-Cookie', cookies)
    response.statusCode = request.url.startsWith('/v1/account/me?') ? 401 : 503
    response.end(JSON.stringify({ error: response.statusCode === 401 ? 'unauthorized' : 'delivery_unavailable' }))
  })
  let vite
  let testServer
  // Cleanup also runs when node:test times out before the async body finishes.
  t.after(async () => {
    testServer?.closeAllConnections()
    upstream.closeAllConnections()
    await Promise.all([
      testServer && new Promise(resolve => testServer.close(resolve)),
      new Promise(resolve => upstream.close(resolve)),
      vite?.close(),
    ])
  })
  upstream.listen(0, '127.0.0.1')
  await once(upstream, 'listening')
  {
    vite = await createServer({
      root,
      envFile: false,
      // This checks HTML/proxy routing, not browser dependency execution.
      // Prevent a cold CI optimizer scan from outliving the test server.
      plugins: [{
        name: 'routing-test-no-optimizer', enforce: 'post',
        config(config) { config.optimizeDeps = { noDiscovery: true, include: [], entries: [] } },
      }],
      server: {
        host: '127.0.0.1', middlewareMode: true,
        // Only replace the destination; retain the real proxy's routing/header policy.
        proxy: { '/v1': { target: `http://127.0.0.1:${upstream.address().port}` } },
      },
    })
    assert.equal(vite.config.server.proxy['/v1'].changeOrigin, false)
    assert.equal(vite.config.optimizeDeps.noDiscovery, true)
    assert.deepEqual(vite.config.optimizeDeps.include, [])
    testServer = createHttpServer(vite.middlewares)
    testServer.listen(0, '127.0.0.1')
    await once(testServer, 'listening')
    const origin = `http://127.0.0.1:${testServer.address().port}`
    for (const path of ['/account/sign-in', '/account/settings', '/account/confirm', '/account/link-device', '/account/billing', '/account/billing/return']) {
      const page = await fetch(origin + path, { signal: AbortSignal.timeout(5000) })
      assert.equal(page.status, 200)
      assert.match(page.headers.get('content-type'), /text\/html/)
      assert.match(await page.text(), /src="\/src\/main.tsx"/)
    }
    const me = await fetch(origin + '/v1/account/me?check=1', { signal: AbortSignal.timeout(5000) })
    assert.equal(me.status, 401)
    assert.deepEqual(await me.json(), { error: 'unauthorized' })
    const body = JSON.stringify({ email: 'fixture@example.invalid' })
    const reply = await fetch(origin + '/v1/account/auth/start', {
      method: 'POST', body, signal: AbortSignal.timeout(5000),
      headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: 'fixture=session', 'X-Pulse-CSRF': 'a'.repeat(64) },
    })
    assert.equal(reply.status, 503)
    assert.equal(reply.headers.get('cache-control'), 'private, no-store')
    assert.deepEqual(reply.headers.getSetCookie(), cookies)
    assert.deepEqual(await reply.json(), { error: 'delivery_unavailable' })
    assert.equal(requests.length, 2)
    assert.equal(requests[0].url, '/v1/account/me?check=1')
    assert.equal(requests[1].url, '/v1/account/auth/start')
    assert.equal(requests[1].method, 'POST')
    assert.equal(requests[1].headers.host, new URL(origin).host)
    assert.equal(requests[1].headers.origin, origin)
    assert.equal(requests[1].headers.cookie, 'fixture=session')
    assert.equal(requests[1].headers['x-pulse-csrf'], 'a'.repeat(64))
    assert.equal(requests[1].body, body)
  }
})
