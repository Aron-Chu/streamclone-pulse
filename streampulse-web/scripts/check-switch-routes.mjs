#!/usr/bin/env node
/**
 * Release preflight: no switch without a live route.
 *
 * Several features ship in the bundle behind build-time VITE_ switches that
 * stay off until their backend route is live. Turning one on before then gives
 * visitors a page that can only fail. For every switch that is on in the build
 * env (the shell plus any .env.<mode> file, as Vite reads them), this GETs each
 * route the switch needs on the backend and fails when one answers 404 or does
 * not answer at all. Any other status (200, 400, 401, 405...) means the route
 * is there. Routes the browser reaches through the same-origin account relay
 * must also be listed in public/_worker.js, which is read here, never changed.
 *
 * Read-only: GET requests without credentials, and only status codes are read.
 * With every switch off it prints "no switches on" and passes without a request.
 *
 *   npm run check:switch-routes                      # production mode env
 *   node scripts/check-switch-routes.mjs --mode staging --backend-url https://...
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
export const DEFAULT_BACKEND_URL = 'https://api.streampulse.stream'
const TIMEOUT_MS = 8000

// "on" spellings mirror each flag's read in src/lib/*Flag.ts exactly.
const ON_OR_ONE = Object.freeze(['on', '1'])
const ONE = Object.freeze(['1'])

/**
 * Every VITE_ switch that gates a backend feature, with the routes it calls
 * (from the source named in `source`). `relay` routes are called same-origin
 * and go through the edge relay in public/_worker.js.
 */
export const SWITCHES = Object.freeze([
  { name: 'VITE_PUBLIC_MOMENTS_FEED', on: ON_OR_ONE, source: 'src/lib/momentsFeed.ts', routes: ['/v1/public/moments'] },
  { name: 'VITE_PUBLIC_NATIVE_CLIPS', on: ON_OR_ONE, source: 'src/lib/nativeClips.ts', routes: ['/v1/public/clips'] },
  {
    name: 'VITE_TWITCH_SIGNIN', on: ONE, relay: true, source: 'src/lib/twitchSignIn.ts, src/lib/accountSession.ts',
    routes: ['/v1/account/auth/twitch/start', '/v1/account/auth/twitch/complete', '/v1/account/identities/twitch/link', '/v1/account/sessions/revoke-all'],
  },
  {
    name: 'VITE_ACCOUNT_MOMENTS', on: ONE, relay: true, source: 'src/lib/accountMoments.ts, src/lib/accountSaves.ts, src/routes/account/AccountHome.tsx',
    // AccountHome (only in this build) also offers Download your data and Delete account.
    routes: ['/v1/account/history/list', '/v1/account/history/forget', '/v1/account/history/settings', '/v1/account/saves/list', '/v1/account/saves/update', '/v1/account/export', '/v1/account/delete'],
  },
  { name: 'VITE_ACCOUNT_HEADER', on: ONE, relay: true, source: 'src/lib/accountSession.ts', routes: ['/v1/account/me'] },
  // No route the site calls; the backend flag has to be checked by hand.
  { name: 'VITE_SUPPORTER_CHAT_BADGES', on: ON_OR_ONE, source: 'src/lib/supporterChatBadgesFlag.ts', routes: [], note: 'no route to check: confirm the backend PULSE_SUPPORTER_CHAT_BADGES_ENABLED and the extension release by hand' },
])

/** Build-time VITE_ inputs that are not feature switches (config, keys, dev only). */
export const NOT_SWITCHES = Object.freeze([
  'VITE_ALLOW_LOCAL_BACKEND', 'VITE_BACKEND_URL', 'VITE_DEV_FAKE_TWITCH', 'VITE_PORTAL_VERSION', 'VITE_POSTHOG_PROJECT_TOKEN',
  'VITE_PUBLIC_DISCORD_INVITE_URL', 'VITE_PUBLIC_HUB_POLL_MS', 'VITE_SANDBOX_SITE', 'VITE_SENTRY_DSN', 'VITE_STREAMCLONE_WATCH_ORIGIN',
  'VITE_TURNSTILE_SITE_KEY', 'VITE_TWITCH_AUTHORIZE_URL',
])

export function switchesOn(env, switches = SWITCHES) {
  return switches.filter((s) => s.on.includes(env[s.name]))
}

/** The exact paths the edge relay forwards: the keys of its ROUTES map. */
export function relayPaths(workerText) {
  const paths = new Set()
  for (const match of String(workerText ?? '').matchAll(/^\s*\['(\/v1\/[^']+)',\s*route\(/gm)) paths.add(match[1])
  return paths
}

async function probe(fetchImpl, url) {
  try {
    const response = await fetchImpl(url, { method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) })
    try { await response.body?.cancel?.() } catch { /* status is all we read */ }
    return { status: response.status }
  } catch (error) {
    return { status: 0, error: error?.name === 'TimeoutError' ? 'timed out' : 'no answer' }
  }
}

/**
 * Checks every switch that is on. Returns { on, results, failures, notes };
 * a result is { switch, path, status, problem? } and failures are the results
 * with a problem.
 */
export async function checkSwitchRoutes({ env, backendUrl = DEFAULT_BACKEND_URL, fetch: fetchImpl = globalThis.fetch, workerText = null, switches = SWITCHES } = {}) {
  const on = switchesOn(env, switches)
  const base = String(backendUrl).replace(/\/+$/, '')
  const relayed = relayPaths(workerText)
  const results = []
  const notes = []
  for (const flag of on) {
    if (flag.note) notes.push({ switch: flag.name, note: flag.note })
    for (const path of flag.routes) {
      const { status, error } = await probe(fetchImpl, base + path)
      let problem
      if (status === 404) problem = 'route missing (404)'
      else if (status === 0) problem = `backend ${error}`
      else if (flag.relay && !relayed.has(path)) problem = 'not in the edge relay (public/_worker.js)'
      results.push({ switch: flag.name, path, status, ...(problem ? { problem } : {}) })
    }
  }
  return { on: on.map((s) => s.name), results, failures: results.filter((r) => r.problem), notes }
}

function argValue(argv, name) {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}

async function main(argv) {
  const mode = argValue(argv, '--mode') || 'production'
  const { loadEnv } = await import('vite')
  // The same view pages:deploy:prod builds with: .env.<mode> files under the shell.
  const env = { ...process.env, ...loadEnv(mode, webRoot, ['VITE_']) }
  const backendFlag = argValue(argv, '--backend-url')
  const envBackend = env.VITE_BACKEND_URL?.trim()
  const backendUrl = backendFlag || envBackend || DEFAULT_BACKEND_URL
  // Say where the backend came from, never an env value, so nothing set in the env is printed.
  const backendFrom = backendFlag ? 'from --backend-url' : envBackend ? 'from VITE_BACKEND_URL (set)' : `${DEFAULT_BACKEND_URL} (default)`
  const workerPath = join(webRoot, 'public', '_worker.js')
  const workerText = existsSync(workerPath) ? readFileSync(workerPath, 'utf8') : ''
  const { on, results, failures, notes } = await checkSwitchRoutes({ env, backendUrl, workerText })
  if (on.length === 0) {
    console.log(`check-switch-routes: no switches on (${mode} env)`)
    return 0
  }
  console.log(`check-switch-routes: ${on.join(', ')} on (${mode} env); backend ${backendFrom}`)
  for (const r of results) console.log(`  ${r.problem ? 'FAIL' : 'ok  '} ${r.switch}: GET ${r.path} -> ${r.status || '-'}${r.problem ? ` (${r.problem})` : ''}`)
  for (const n of notes) console.warn(`  note ${n.switch}: ${n.note}`)
  if (failures.length > 0) {
    console.error(`check-switch-routes: ${failures.length} route(s) not live; turn the switch off or ship the route first`)
    return 1
  }
  console.log('check-switch-routes: ok')
  return 0
}

const entry = process.argv[1] ? process.argv[1].replace(/\\/g, '/') : ''
if (entry.endsWith('check-switch-routes.mjs')) {
  process.exitCode = await main(process.argv.slice(2))
}
