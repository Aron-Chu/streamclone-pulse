import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { destinationOrigin, directFetch, verifyDestinationPreview, verifyDestinationPreviewWithRetry } from './destination-pages-smoke.mjs'
import { handleRequest } from '../public/_worker.js'

const fakeOrigin = () => `https://${randomUUID()}.invalid`
function setup() {
  const projectSubdomain = `streampulse-main-${randomBytes(3).toString('hex')}.pages.dev`
  const shortId = randomBytes(4).toString('hex')
  const projectId = randomUUID()
  const expected = {
    accountId: randomBytes(16).toString('hex'),
    projectName: 'streampulse-main',
    projectSubdomain,
    deploymentId: randomUUID(),
    deploymentUrl: `https://${shortId}.${projectSubdomain}`,
    canonicalOrigin: fakeOrigin(),
  }
  return {
    expected,
    evidence: {
      accountId: expected.accountId,
      projectName: expected.projectName,
      project: { id: projectId, name: expected.projectName, subdomain: projectSubdomain },
      deployment: { id: expected.deploymentId, short_id: shortId, project_id: projectId, project_name: expected.projectName, url: expected.deploymentUrl, environment: 'production', latest_stage: { name: 'deploy', status: 'success' } },
    },
  }
}
function goodFetch(requests) {
  return async (url, init) => {
    requests.push({ url: String(url), init })
    if (url.pathname === '/v1/account/me') return new Response(null, { status: 403, headers: { 'x-correlation-id': randomBytes(16).toString('hex'), 'cache-control': 'private, no-store' } })
    return new Response('<html><title>StreamPulse</title><div id="root"></div><script type="module"></script></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } })
  }
}

function retryClock() {
  let elapsed = 0
  const waits = []
  return {
    waits,
    now: () => elapsed,
    advance: milliseconds => { elapsed += milliseconds },
    waitImpl: async milliseconds => { waits.push(milliseconds); elapsed += milliseconds },
  }
}

test('post-upload smoke waits briefly and recovers from a temporary invalid document', async () => {
  const fixture = setup()
  const clock = retryClock()
  const requests = []
  const retries = []
  const healthy = goodFetch(requests)
  let calls = 0
  const result = await verifyDestinationPreviewWithRetry({ ...fixture, ...clock, onRetry: value => retries.push(value), fetchImpl: async (...args) => {
    if (calls++ === 0) return new Response('not ready', { status: 503 })
    return healthy(...args)
  } })
  assert.deepEqual(result, { previewRoutes: 3, relayRefusedOnPreview: true, signedRelayVerified: false, attempts: 2 })
  assert.deepEqual(clock.waits, [2000, 2000])
  assert.deepEqual(retries, [{ nextAttempt: 2, reason: 'preview-document-invalid' }])
  assert.equal(calls, 5)
  assert.equal(requests.length, 4)
})

test('post-upload smoke can recover while the relay route is still propagating', async () => {
  const fixture = setup()
  const requests = []
  const healthy = goodFetch(requests)
  let relayCalls = 0
  const result = await verifyDestinationPreviewWithRetry({ ...fixture, ...retryClock(), fetchImpl: async (url, init) => {
    if (url.pathname === '/v1/account/me' && relayCalls++ === 0) return new Response('not routed yet')
    return healthy(url, init)
  } })
  assert.equal(result.attempts, 2)
  assert.equal(result.signedRelayVerified, false)
  assert.equal(relayCalls, 2)
})

test('post-upload smoke stops after four unsuccessful attempts', async () => {
  const fixture = setup()
  const clock = retryClock()
  let calls = 0
  await assert.rejects(verifyDestinationPreviewWithRetry({ ...fixture, ...clock, fetchImpl: async () => {
    calls++
    return new Response(null, { status: 503 })
  } }), /preview-document-invalid/)
  assert.equal(calls, 4)
  assert.deepEqual(clock.waits, [2000, 2000, 4000, 8000])
})

test('post-upload smoke rejects incorrect identity before waiting or requesting anything', async () => {
  const fixture = setup()
  const clock = retryClock()
  let calls = 0
  fixture.expected.accountId = randomBytes(16).toString('hex')
  await assert.rejects(verifyDestinationPreviewWithRetry({ ...fixture, ...clock, fetchImpl: async () => { calls++ } }), /account-mismatch/)
  assert.equal(calls, 0)
  assert.deepEqual(clock.waits, [])
})

test('post-upload smoke does not retry redirects and cancels their response bodies', async () => {
  const fixture = setup()
  const clock = retryClock()
  let calls = 0
  let cancelled = false
  await assert.rejects(verifyDestinationPreviewWithRetry({ ...fixture, ...clock, fetchImpl: async () => {
    calls++
    return new Response(new ReadableStream({ cancel() { cancelled = true } }), { status: 302, headers: { location: fakeOrigin() } })
  } }), /unexpected-redirect/)
  assert.equal(calls, 1)
  assert.equal(cancelled, true)
  assert.deepEqual(clock.waits, [2000])
})

test('post-upload smoke stops at its overall budget instead of starting another retry', async () => {
  const fixture = setup()
  const clock = retryClock()
  let calls = 0
  await assert.rejects(verifyDestinationPreviewWithRetry({ ...fixture, ...clock, fetchImpl: async (_url, init) => {
    calls++
    assert.ok(init.signal instanceof AbortSignal)
    clock.advance(43000)
    throw new Error('network failure containing private details')
  } }), /preview-propagation-timeout/)
  assert.equal(calls, 1)
  assert.deepEqual(clock.waits, [2000])
})

test('post-upload smoke never accepts a successful check that completes after its budget', async () => {
  const fixture = setup()
  const clock = retryClock()
  const healthy = goodFetch([])
  await assert.rejects(verifyDestinationPreviewWithRetry({ ...fixture, ...clock, fetchImpl: async (url, init) => {
    if (url.pathname === '/v1/account/me') clock.advance(43000)
    return healthy(url, init)
  } }), /preview-propagation-timeout/)
})

test('checks the intended preview without credentials or redirects and does not claim signature proof', async () => {
  const { evidence, expected } = setup()
  const requests = []
  const result = await verifyDestinationPreview({ evidence, expected, fetchImpl: goodFetch(requests) })
  assert.deepEqual(result, { previewRoutes: 3, relayRefusedOnPreview: true, signedRelayVerified: false })
  assert.equal(requests.length, 4)
  for (const request of requests) {
    assert.equal(new URL(request.url).origin, expected.deploymentUrl)
    assert.equal(request.init.redirect, 'manual')
    assert.equal(request.init.method, 'GET')
    assert.equal(request.init.headers, undefined)
  }
})

test('rejects a mismatched account, project, deployment, origin or unready deployment before any request', async () => {
  const { evidence, expected } = setup()
  const cases = [
    [{ ...evidence, accountId: randomBytes(16).toString('hex') }, expected, 'account-mismatch'],
    [{ ...evidence, projectName: 'other-project' }, expected, 'project-mismatch'],
    [{ ...evidence, project: { ...evidence.project, subdomain: fakeOrigin().slice(8) } }, expected, 'project-mismatch'],
    [{ ...evidence, deployment: { ...evidence.deployment, project_id: randomUUID() } }, expected, 'project-mismatch'],
    [{ ...evidence, deployment: { ...evidence.deployment, project_name: 'other-project' } }, expected, 'deployment-mismatch'],
    [{ ...evidence, deployment: { ...evidence.deployment, id: randomUUID() } }, expected, 'deployment-mismatch'],
    [{ ...evidence, deployment: { ...evidence.deployment, short_id: 'too-long-for-short-id' } }, expected, 'deployment-mismatch'],
    [{ ...evidence, deployment: { ...evidence.deployment, environment: 'preview' } }, expected, 'deployment-not-ready'],
    [{ ...evidence, deployment: { ...evidence.deployment, latest_stage: { name: 'build', status: 'success' } } }, expected, 'deployment-not-ready'],
    [{ ...evidence, deployment: { ...evidence.deployment, latest_stage: { name: 'deploy', status: 'failure' } } }, expected, 'deployment-not-ready'],
    [{ ...evidence, deployment: { ...evidence.deployment, url: fakeOrigin() } }, expected, 'deployment-url-mismatch'],
    [{ ...evidence, deployment: { ...evidence.deployment, url: `https://${evidence.project.subdomain}` } }, { ...expected, deploymentUrl: `https://${evidence.project.subdomain}` }, 'deployment-url-mismatch'],
    [{ ...evidence, deployment: { ...evidence.deployment, url: `https://release.${evidence.project.subdomain}` } }, { ...expected, deploymentUrl: `https://release.${evidence.project.subdomain}` }, 'deployment-url-mismatch'],
    [evidence, { ...expected, canonicalOrigin: expected.deploymentUrl }, 'canonical-origin-is-not-preview'],
    [{ ...evidence, deployment: { ...evidence.deployment, url: `${expected.deploymentUrl}/nested` } }, expected, 'invalid-deployment-url'],
    [{ ...evidence, deployment: { ...evidence.deployment, url: expected.deploymentUrl.replace('https://', 'https://user:password@') } }, expected, 'invalid-deployment-url'],
  ]
  for (const [item, options, message] of cases) assert.throws(() => destinationOrigin(item, options), new RegExp(message))
})

test('rejects redirects, errors, unexpected documents and oversize pages', async () => {
  const { evidence, expected } = setup()
  for (const response of [
    new Response(null, { status: 302, headers: { location: fakeOrigin() } }),
    new Response(null, { status: 404 }),
    new Response('not an application', { headers: { 'content-type': 'text/html' } }),
    new Response('<html>StreamPulse maintenance</html>', { headers: { 'content-type': 'text/html' } }),
    new Response('x'.repeat(1048577), { headers: { 'content-type': 'text/html' } }),
  ]) {
    await assert.rejects(verifyDestinationPreview({ evidence, expected, fetchImpl: async () => response }))
  }
})

test('the direct HTTPS request uses its own agent and supplies no credentials', async () => {
  const origin = fakeOrigin()
  const signal = AbortSignal.timeout(1000)
  let options
  const response = await directFetch(new URL('/', origin), { signal }, (url, opts, callback) => {
    options = opts
    const outgoing = new EventEmitter()
    outgoing.end = () => {
      const incoming = Readable.from([Buffer.from('ok')])
      incoming.statusCode = 200
      incoming.rawHeaders = ['content-type', 'text/plain']
      callback(incoming)
    }
    return outgoing
  })
  assert.equal(options.method, 'GET')
  assert.equal(options.headers, undefined)
  assert.equal(options.signal, signal)
  assert.ok(options.agent)
  assert.equal(options.agent.options.proxyEnv, undefined)
  assert.equal(await response.text(), 'ok')
})

test('the pinned relay refuses the preview origin before reading either a present or missing secret', async () => {
  const origin = fakeOrigin()
  let calls = 0
  const originalLog = console.log
  console.log = () => {}
  try {
    for (const secret of [undefined, 'x'.repeat(40)]) {
      const response = await handleRequest(new Request(new URL('/v1/account/me', origin)), { PULSE_EDGE_SECRET: secret }, async () => { calls++; return new Response() })
      assert.equal(response.status, 403)
    }
  } finally {
    console.log = originalLog
  }
  assert.equal(calls, 0)
})

test('a 401, unsigned-looking refusal or cookie cannot pass the preview relay check', async () => {
  const { evidence, expected } = setup()
  for (const relay of [
    new Response(null, { status: 401 }),
    new Response(null, { status: 403 }),
    new Response(null, { status: 403, headers: { 'x-correlation-id': randomBytes(16).toString('hex'), 'cache-control': 'no-store', 'set-cookie': 'x=y' } }),
  ]) {
    const good = goodFetch([])
    await assert.rejects(verifyDestinationPreview({ evidence, expected, fetchImpl: (url, init) => url.pathname === '/v1/account/me' ? relay : good(url, init) }), /preview-relay-refusal-invalid/)
  }
})

test('the CLI refuses to perform network requests unless explicitly enabled', () => {
  const script = fileURLToPath(new URL('./destination-pages-smoke.mjs', import.meta.url))
  const result = spawnSync(process.execPath, [script], { input: '{}', env: { ...process.env, PAGES_SMOKE_ALLOW_NETWORK: '' }, encoding: 'utf8' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /network-not-enabled/)
})
