#!/usr/bin/env node
/**
 * Dev-only stand-in for Twitch, so "Show my Twitch follows" on the hub can be
 * tried end to end without a Twitch account or a registered redirect URI.
 *
 * It plays both Twitch origins the portal talks to: id.twitch.tv (the sign-in
 * page and the token cancel) and api.twitch.tv (the account and its follows).
 * The sign-in page offers scenarios: many follows live, a few, one, none, an
 * account that follows nobody, 3,200 follows (the portal reads the 3,000 most
 * recent), a slow Twitch, Twitch failing mid-read, a refused token, a missing
 * permission and a sign-in another tab started. Followed channels mix logins
 * live on the hosted hub right now with made-up ones, so the row has tiles.
 *
 * Usage (two terminals):
 *   npm run dev:fake-twitch
 *   VITE_DEV_FAKE_TWITCH=http://127.0.0.1:8098 npm run dev
 *
 * src/lib/twitchFollows.ts reads VITE_DEV_FAKE_TWITCH in dev builds only, and
 * only as an http origin on this machine; a production build always talks to Twitch.
 */

import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'

const PORT = Number(process.env.SP_FAKE_TWITCH_PORT || 8098)
const HOST = '127.0.0.1'
const HUB_URL = process.env.SP_FAKE_TWITCH_HUB?.trim() || 'https://api.streampulse.stream/v1/public/hub?activityWindow=24h'
const HUB_TTL_MS = 60_000
const SCOPE = 'user:read:follows'
const CALLBACK_PATH = '/account/twitch/callback'
const VIEWER = { id: '90000001', login: 'devviewer', display_name: 'DevViewer' }

/** What the sign-in page offers. `follows` builds the account's list, most recent first. */
const SCENARIOS = {
  many: { label: 'Many follows, lots of them live (half the live hub + 160 others)' },
  few: { label: 'A few live: 4 of 45 follows' },
  one: { label: 'Exactly one live: 1 of 21 follows' },
  none: { label: 'None live: 57 follows, all offline' },
  zero: { label: 'Follows nobody' },
  huge: { label: '3,200 follows: 40 live in the newest 3,000, 5 more past them' },
  slow: { label: 'Slow Twitch: like Many, 1 s per request' },
  down: { label: 'Twitch stops answering on page 2 (503)' },
  reject: { label: 'Twitch refuses the token (401)' },
  scope: { label: 'Comes back without the follows permission' },
  state: { label: 'Comes back for a sign-in another tab started' },
}

/** Tokens this server minted and then saw cancelled. */
const revoked = new Set()
/** Each token's list, built on first read so its pages stay put. */
const lists = new Map()
let hubCache = { at: 0, logins: [] }

/* ---------- http helpers ---------- */

function applyCors(response) {
  // Twitch answers any origin; so does this, and it holds nothing real.
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', 'Authorization,Client-Id,Content-Type')
  response.setHeader('Access-Control-Max-Age', '600')
}

function sendJson(response, status, body) {
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  })
  response.end(payload)
}

function sendHtml(response, status, html) {
  response.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
  })
  response.end(html)
}

function redirect(response, location) {
  response.writeHead(302, { Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' })
  response.end()
}

/** Request-derived text in logs: drop line breaks so a path cannot forge log lines. */
function logSafe(value) {
  return String(value).replace(/\n|\r/g, '')
}

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

/* ---------- the sign-in ---------- */

/** Only the portal's own callback on this machine, as Twitch only sends back to a registered URI. */
function callbackOf(raw) {
  try {
    const url = new URL(raw)
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
    return url.protocol === 'http:' && local && url.pathname === CALLBACK_PATH && !url.search && !url.hash ? url : null
  } catch {
    return null
  }
}

function mintToken(scenario) {
  return `fake${scenario}x${randomBytes(10).toString('hex')}`
}

function scenarioOf(token) {
  const match = /^fake([a-z]+)x[0-9a-f]{20}$/.exec(token ?? '')
  return match && Object.hasOwn(SCENARIOS, match[1]) ? match[1] : null
}

function authorizeProblem(query) {
  if (query.get('response_type') !== 'token') return 'response_type must be token (the implicit grant).'
  if (!query.get('client_id')) return 'client_id is missing.'
  if (!callbackOf(query.get('redirect_uri'))) return `redirect_uri must be http://localhost:<port>${CALLBACK_PATH} or http://127.0.0.1:<port>${CALLBACK_PATH}.`
  if (!(query.get('scope') ?? '').split(' ').includes(SCOPE)) return `scope must include ${SCOPE}.`
  if (!query.get('state')) return 'state is missing.'
  return null
}

function page(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0e0e10; color: #efeff1; font: 14px/1.45 system-ui, sans-serif; }
  main { width: min(460px, calc(100vw - 32px)); background: #18181b; border: 1px solid #2f2f35; border-radius: 8px; padding: 20px 22px; }
  h1 { font-size: 17px; margin: 0 0 4px; }
  .dev { color: #f5c044; font-size: 12px; margin: 0 0 14px; }
  .who { color: #adadb8; margin: 0 0 12px; }
  fieldset { border: 1px solid #2f2f35; border-radius: 6px; margin: 0 0 16px; padding: 8px 12px 10px; }
  legend { color: #adadb8; padding: 0 4px; }
  label { display: flex; gap: 8px; padding: 4px 0; cursor: pointer; }
  .row { display: flex; gap: 10px; justify-content: flex-end; }
  button { font: inherit; font-weight: 600; border-radius: 6px; padding: 8px 16px; cursor: pointer; border: 1px solid #3f3f46; background: #26262c; color: #efeff1; }
  button[value="allow"] { background: #9147ff; border-color: #9147ff; color: #fff; }
  code { color: #bf94ff; }
  .warn { color: #f5c044; }
</style>
</head>
<body><main>${body}</main></body>
</html>`
}

async function authorizePage(response, query) {
  const problem = authorizeProblem(query)
  if (problem) {
    console.log(`[fake-twitch] AUTHORIZE 400 ${logSafe(problem)}`)
    sendHtml(response, 400, page('Fake Twitch: bad sign-in request', `<h1>Bad sign-in request</h1><p class="dev">Dev stand-in for Twitch</p><p>${escapeHtml(problem)}</p>`))
    return
  }
  const live = (await hubLogins()).length
  const keep = ['response_type', 'client_id', 'redirect_uri', 'scope', 'state']
    .map((key) => `<input type="hidden" name="${key}" value="${escapeHtml(query.get(key))}">`)
    .join('')
  const options = Object.entries(SCENARIOS)
    .map(([key, s], i) => `<label><input type="radio" name="scenario" value="${key}"${i === 0 ? ' checked' : ''}> ${escapeHtml(s.label)}</label>`)
    .join('')
  console.log('[fake-twitch] AUTHORIZE page')
  sendHtml(response, 200, page('Fake Twitch: authorize', `
<h1>Authorize StreamPulse</h1>
<p class="dev">Dev stand-in for Twitch. Nothing here talks to Twitch.</p>
<p class="who">Signed in as <b>${VIEWER.display_name}</b>. StreamPulse wants to view your follows (<code>${SCOPE}</code>).</p>
${live ? '' : '<p class="warn">The live hub could not be read, so none of these follows will be live.</p>'}
<form method="get" action="/oauth2/authorize/decide">
  ${keep}
  <fieldset><legend>Scenario</legend>${options}</fieldset>
  <div class="row">
    <button type="submit" name="decision" value="deny">Cancel</button>
    <button type="submit" name="decision" value="allow">Authorize</button>
  </div>
</form>`))
}

function decide(response, query) {
  const problem = authorizeProblem(query)
  const callback = callbackOf(query.get('redirect_uri'))
  if (problem || !callback) {
    sendHtml(response, 400, page('Fake Twitch: bad sign-in request', `<h1>Bad sign-in request</h1><p>${escapeHtml(problem ?? 'redirect_uri')}</p>`))
    return
  }
  const state = query.get('state')
  const scenario = Object.hasOwn(SCENARIOS, query.get('scenario') ?? '') ? query.get('scenario') : 'many'
  if (query.get('decision') !== 'allow') {
    // Twitch answers a "no" in the query, not the fragment.
    callback.search = new URLSearchParams({ error: 'access_denied', error_description: 'The user denied you access', state }).toString()
    console.log(`[fake-twitch] AUTHORIZE deny → ${logSafe(callback.host)}`)
    redirect(response, callback.href)
    return
  }
  const fragment = new URLSearchParams({
    access_token: mintToken(scenario),
    scope: scenario === 'scope' ? 'user:read:email' : SCOPE,
    state: scenario === 'state' ? `f.${randomBytes(16).toString('hex')}` : state,
    token_type: 'bearer',
  })
  callback.hash = fragment.toString()
  console.log(`[fake-twitch] AUTHORIZE allow scenario=${logSafe(scenario)} → ${logSafe(callback.host)}`)
  redirect(response, callback.href)
}

async function readBody(request, limit = 4096) {
  let body = ''
  for await (const chunk of request) {
    body += chunk
    if (body.length > limit) throw new Error('body too large')
  }
  return body
}

async function revoke(request, response) {
  let form
  try {
    form = new URLSearchParams(await readBody(request))
  } catch {
    sendJson(response, 413, { status: 413, message: 'body too large' })
    return
  }
  const token = form.get('token')
  if (!form.get('client_id') || !scenarioOf(token)) {
    sendJson(response, 400, { status: 400, message: 'Invalid token' })
    return
  }
  revoked.add(token)
  lists.delete(token)
  console.log(`[fake-twitch] REVOKE scenario=${scenarioOf(token)}`)
  response.writeHead(200, { 'Content-Length': 0, 'Cache-Control': 'no-store' })
  response.end()
}

/* ---------- the account's follows ---------- */

/** Logins live on the hub right now, busiest first; empty when the hub is out of reach. */
async function hubLogins() {
  if (Date.now() - hubCache.at < HUB_TTL_MS) return hubCache.logins
  try {
    const response = await fetch(HUB_URL, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20_000) })
    if (!response.ok) throw new Error(`hub answered ${response.status}`)
    const hub = await response.json()
    const logins = (Array.isArray(hub?.liveChannels) ? hub.liveChannels : [])
      .map((c) => (typeof c?.login === 'string' ? c.login.toLowerCase() : ''))
      .filter((login) => /^[a-z0-9_]{1,25}$/.test(login))
    hubCache = { at: Date.now(), logins }
    console.log(`[fake-twitch] hub has ${logins.length} live channels`)
  } catch (error) {
    console.error(`[fake-twitch] hub read FAILED: ${logSafe(error.message)}; follows will be offline only`)
    hubCache = { at: Date.now(), logins: [] }
  }
  return hubCache.logins
}

const filler = (n, from = 0) => Array.from({ length: n }, (_, i) => `zz_devfollow_${String(from + i + 1).padStart(4, '0')}`)

/** Two lists merged a, b, a, b… so live channels spread across pages. */
function interleave(a, b) {
  const out = []
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i < a.length) out.push(a[i])
    if (i < b.length) out.push(b[i])
  }
  return out
}

async function buildList(scenario) {
  const live = await hubLogins()
  const pick = (indexes) => [...new Set(indexes.filter((i) => i >= 0 && i < live.length).map((i) => live[i]))]
  switch (scenario) {
    case 'zero':
      return []
    case 'none':
      return filler(57)
    case 'one':
      return interleave(pick([1]), filler(20))
    case 'few': {
      const mine = pick([0, Math.floor(live.length / 3), Math.floor((2 * live.length) / 3), live.length - 1])
      return interleave(mine, filler(45 - mine.length))
    }
    case 'huge': {
      const newest = pick(Array.from({ length: 40 }, (_, i) => i * 3))
      const older = pick(Array.from({ length: 5 }, (_, i) => 200 + i))
      const list = filler(3_000 - newest.length)
      newest.forEach((login, i) => list.splice(i * 75, 0, login))
      return [...list, ...interleave(older, filler(200 - older.length, 3_000))]
    }
    default:
      return interleave(live.filter((_, i) => i % 2 === 0), filler(160))
  }
}

/** The bearer token, if this server minted it and it is still good. */
function authorized(request) {
  const match = /^Bearer (\S+)$/.exec(request.headers.authorization ?? '')
  const token = match?.[1]
  const scenario = scenarioOf(token)
  if (!scenario || revoked.has(token) || !request.headers['client-id']) return null
  return { token, scenario }
}

function unauthorized(response, message = 'Invalid OAuth token') {
  sendJson(response, 401, { error: 'Unauthorized', status: 401, message })
}

async function helix(request, response, url) {
  const auth = authorized(request)
  if (!auth) return unauthorized(response)
  if (auth.scenario === 'slow') await sleep(1_000)
  if (url.pathname === '/helix/users') {
    if (auth.scenario === 'reject') {
      console.log('[fake-twitch] HELIX 401 /helix/users scenario=reject')
      return unauthorized(response)
    }
    console.log(`[fake-twitch] HELIX 200 /helix/users scenario=${auth.scenario}`)
    return sendJson(response, 200, { data: [{ ...VIEWER, type: '', broadcaster_type: '', description: '', profile_image_url: '', offline_image_url: '', created_at: '2020-01-01T00:00:00Z' }] })
  }
  // /helix/channels/followed
  if (url.searchParams.get('user_id') !== VIEWER.id) return unauthorized(response, 'The ID in user_id must match the user ID in the access token.')
  const first = Math.max(1, Math.min(100, Number(url.searchParams.get('first')) || 20))
  const after = url.searchParams.get('after')
  const offset = after ? Number(Buffer.from(after, 'base64url').toString()) : 0
  if (!Number.isInteger(offset) || offset < 0) return sendJson(response, 400, { error: 'Bad Request', status: 400, message: 'Invalid cursor' })
  if (auth.scenario === 'down' && offset > 0) {
    console.log('[fake-twitch] HELIX 503 /helix/channels/followed scenario=down')
    return sendJson(response, 503, { error: 'Service Unavailable', status: 503, message: '' })
  }
  if (!lists.has(auth.token)) lists.set(auth.token, await buildList(auth.scenario))
  const list = lists.get(auth.token)
  const now = Date.now()
  const data = list.slice(offset, offset + first).map((login, i) => ({
    broadcaster_id: String(70000000 + offset + i),
    broadcaster_login: login,
    broadcaster_name: login,
    followed_at: new Date(now - (offset + i + 1) * 3_600_000).toISOString(),
  }))
  const next = offset + first < list.length ? Buffer.from(String(offset + first)).toString('base64url') : null
  console.log(`[fake-twitch] HELIX 200 /helix/channels/followed ${data.length ? `${offset + 1}–${offset + data.length}` : 'none'} of ${list.length} scenario=${auth.scenario}`)
  return sendJson(response, 200, { total: list.length, data, pagination: next ? { cursor: next } : {} })
}

/* ---------- server ---------- */

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${HOST}:${PORT}`)
  applyCors(response)

  if (request.method === 'OPTIONS') {
    response.writeHead(204)
    response.end()
    return
  }
  const route = `${request.method} ${url.pathname}`
  const done = (error) => {
    console.error(`[fake-twitch] ${logSafe(route)} FAILED: ${logSafe(error?.message)}`)
    if (!response.headersSent) sendJson(response, 500, { status: 500, message: 'fake twitch failed' })
  }
  switch (route) {
    case 'GET /':
      sendHtml(response, 200, page('Fake Twitch (dev)', `<h1>Fake Twitch (dev)</h1><p class="dev">Stands in for id.twitch.tv and api.twitch.tv.</p><p>GET /oauth2/authorize, POST /oauth2/revoke, GET /helix/users, GET /helix/channels/followed</p>`))
      return
    case 'GET /oauth2/authorize':
      authorizePage(response, url.searchParams).catch(done)
      return
    case 'GET /oauth2/authorize/decide':
      decide(response, url.searchParams)
      return
    case 'POST /oauth2/revoke':
      revoke(request, response).catch(done)
      return
    case 'GET /helix/users':
    case 'GET /helix/channels/followed':
      helix(request, response, url).catch(done)
      return
    default:
      sendJson(response, 404, { error: 'Not Found', status: 404, message: '' })
  }
})

server.listen(PORT, HOST, () => {
  console.log(`[fake-twitch] listening on http://${HOST}:${PORT}`)
  console.log(`[fake-twitch] live channels from ${HUB_URL}`)
  console.log(`[fake-twitch] run the portal with VITE_DEV_FAKE_TWITCH=http://${HOST}:${PORT}`)
  void hubLogins()
})

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`[fake-twitch] port ${PORT} is already in use. Set SP_FAKE_TWITCH_PORT to pick another.`)
    process.exit(1)
  }
  console.error(`[fake-twitch] ${error.message}`)
  process.exit(1)
})
