import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NOT_SWITCHES, SWITCHES, checkSwitchRoutes, relayPaths, switchesOn } from './check-switch-routes.mjs'

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const worker = readFileSync(join(webRoot, 'public/_worker.js'), 'utf8')

/** A fake backend: status by path (default 200), recording every request. */
function fakeFetch(statuses = {}, requests = []) {
  return async (url, init) => {
    requests.push({ url: String(url), method: init?.method })
    const status = statuses[new URL(url).pathname] ?? 200
    if (status === 'throw') throw new TypeError('fetch failed')
    return new Response(null, { status })
  }
}

test('with every switch off it passes without a single request', async () => {
  const requests = []
  const result = await checkSwitchRoutes({ env: {}, fetch: fakeFetch({}, requests), workerText: worker })
  assert.deepEqual(result.on, [])
  assert.deepEqual(result.failures, [])
  assert.equal(requests.length, 0)
})

test('only the spelling each flag reads turns a switch on', () => {
  const on = (env) => switchesOn(env).map((s) => s.name)
  assert.deepEqual(on({ VITE_PUBLIC_NATIVE_CLIPS: 'on', VITE_PUBLIC_MOMENTS_FEED: '1' }), ['VITE_PUBLIC_MOMENTS_FEED', 'VITE_PUBLIC_NATIVE_CLIPS'])
  // The account flags read exactly "1", like src/lib/twitchSignInFlag.ts.
  assert.deepEqual(on({ VITE_TWITCH_SIGNIN: 'on', VITE_ACCOUNT_MOMENTS: 'true', VITE_ACCOUNT_HEADER: ' 1' }), [])
  assert.deepEqual(on({ VITE_PUBLIC_NATIVE_CLIPS: 'ON', VITE_PUBLIC_MOMENTS_FEED: 'off', VITE_SUPPORTER_CHAT_BADGES: '' }), [])
})

test('a switch whose route answers 404 fails', async () => {
  const requests = []
  const result = await checkSwitchRoutes({
    env: { VITE_PUBLIC_NATIVE_CLIPS: 'on' }, backendUrl: 'https://api.example.test/', fetch: fakeFetch({ '/v1/public/clips': 404 }, requests), workerText: worker,
  })
  assert.deepEqual(requests, [{ url: 'https://api.example.test/v1/public/clips', method: 'GET' }])
  assert.equal(result.failures.length, 1)
  assert.deepEqual(result.failures[0], { switch: 'VITE_PUBLIC_NATIVE_CLIPS', path: '/v1/public/clips', status: 404, problem: 'route missing (404)' })
})

test('any answer other than 404 means the route is there', async () => {
  for (const status of [200, 400, 401, 403, 405, 503]) {
    const result = await checkSwitchRoutes({ env: { VITE_PUBLIC_MOMENTS_FEED: 'on' }, fetch: fakeFetch({ '/v1/public/moments': status }), workerText: worker })
    assert.deepEqual(result.failures, [], `status ${status}`)
    assert.equal(result.results[0].status, status)
  }
})

test('a backend that does not answer fails rather than passing unchecked', async () => {
  const result = await checkSwitchRoutes({ env: { VITE_PUBLIC_MOMENTS_FEED: '1' }, fetch: fakeFetch({ '/v1/public/moments': 'throw' }), workerText: worker })
  assert.equal(result.failures.length, 1)
  assert.equal(result.failures[0].problem, 'backend no answer')
})

test('relay routes must be live on the backend and listed in the edge relay', async () => {
  // POST-only account routes answer a GET with 405 when they exist.
  const live = Object.fromEntries(SWITCHES.find((s) => s.name === 'VITE_ACCOUNT_MOMENTS').routes.map((p) => [p, 405]))
  const moments = await checkSwitchRoutes({ env: { VITE_ACCOUNT_MOMENTS: '1' }, fetch: fakeFetch(live), workerText: worker })
  // Today's relay has none of the My Moments routes.
  assert.equal(moments.failures.length, 5)
  assert.ok(moments.failures.every((f) => f.problem === 'not in the edge relay (public/_worker.js)'))

  const header = await checkSwitchRoutes({ env: { VITE_ACCOUNT_HEADER: '1' }, fetch: fakeFetch({ '/v1/account/me': 401 }), workerText: worker })
  assert.deepEqual(header.failures, [])

  const noWorker = await checkSwitchRoutes({ env: { VITE_ACCOUNT_HEADER: '1' }, fetch: fakeFetch({ '/v1/account/me': 401 }), workerText: '' })
  assert.equal(noWorker.failures.length, 1)

  const missing = await checkSwitchRoutes({ env: { VITE_TWITCH_SIGNIN: '1' }, fetch: fakeFetch({ '/v1/account/auth/twitch/start': 404 }), workerText: worker })
  assert.equal(missing.failures.find((f) => f.path === '/v1/account/auth/twitch/start').problem, 'route missing (404)')
})

test('a switch with no route to check passes with a note', async () => {
  const result = await checkSwitchRoutes({ env: { VITE_SUPPORTER_CHAT_BADGES: 'on' }, fetch: fakeFetch(), workerText: worker })
  assert.deepEqual(result.results, [])
  assert.equal(result.notes.length, 1)
})

test('relayPaths reads the ROUTES keys of the real worker', () => {
  const paths = relayPaths(worker)
  assert.ok(paths.has('/v1/account/me'))
  assert.ok(paths.has('/v1/billing/checkout'))
  assert.ok(!paths.has('/v1/account/history/list'))
})

test('every VITE_ name the portal reads is either a checked switch or listed as not a switch', () => {
  const known = new Set([...SWITCHES.map((s) => s.name), ...NOT_SWITCHES])
  const seen = new Set()
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
        for (const m of readFileSync(path, 'utf8').matchAll(/import\.meta\.env\.(VITE_[A-Z0-9_]+)/g)) seen.add(m[1])
      }
    }
  }
  walk(join(webRoot, 'src'))
  const unknown = [...seen].filter((name) => !known.has(name))
  assert.deepEqual(unknown, [], 'a new VITE_ switch needs its routes in scripts/check-switch-routes.mjs (or a NOT_SWITCHES entry)')
  for (const s of SWITCHES) assert.ok(seen.has(s.name), `${s.name} is no longer read by the portal`)
})

test('every checked route is one the portal actually calls', () => {
  const sources = (s) => s.source.split(', ').map((file) => readFileSync(join(webRoot, file), 'utf8')).join('\n')
  for (const s of SWITCHES) {
    const text = sources(s)
    // Account routes are called by their path under /v1/account.
    for (const path of s.routes) assert.ok(text.includes(path) || text.includes(`'${path.replace('/v1/account', '')}'`), `${s.name}: ${path} not found in ${s.source}`)
  }
})

// A local .env file that turns a switch on would make this a live check, so skip then.
const localSwitchOn = readdirSync(webRoot).some((name) => /^\.env(\..+)?$/.test(name) && !name.endsWith('.example') &&
  SWITCHES.some((s) => new RegExp(`^${s.name}=`, 'm').test(readFileSync(join(webRoot, name), 'utf8'))))
test('the CLI passes with every switch off', { skip: localSwitchOn && 'a local .env file sets a switch' }, () => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('VITE_')))
  const run = spawnSync(process.execPath, ['scripts/check-switch-routes.mjs', '--mode', 'switch-routes-test'], { cwd: webRoot, env, encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  assert.match(run.stdout, /no switches on/)
})
