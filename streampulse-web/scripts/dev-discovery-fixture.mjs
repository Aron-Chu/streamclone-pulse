#!/usr/bin/env node
/**
 * Dev-only backend shim so the stored-day analytics UI is browsable locally.
 *
 * The hosted API answers `503 {"error":"discovery_unavailable"}` for
 * `/v1/public/discovery`, which leaves the activity calendar with no day cells
 * and hides the broadcast-grouped stored day entirely. This server serves those
 * two endpoints from the shared fixture and **passes everything else straight
 * through to the hosted API**, so the hub, Live Wire, newsroom and channel
 * analytics keep showing real data.
 *
 * Usage (two terminals):
 *   npm run dev:fixtures
 *   VITE_ALLOW_LOCAL_BACKEND=1 npm run dev
 * then once in the browser console:
 *   sessionStorage.setItem('sp.backendUrlOverride','http://127.0.0.1:8099')
 *
 * `getBackendUrlOverride()` returns null in PROD and is gated on
 * VITE_ALLOW_LOCAL_BACKEND, so none of this can reach a production build.
 */

import { createServer } from 'node:http'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { discoveryFixtureResponse } from './fixtures/discoveryFixture.mjs'

const PORT = Number(process.env.SP_FIXTURE_PORT || 8099)
const HOST = '127.0.0.1'
const UPSTREAM = process.env.SP_FIXTURE_UPSTREAM?.trim() || 'https://api.streampulse.stream'
const UPSTREAM_ORIGIN = new URL(UPSTREAM).origin
// Only the portal's own dev origins. Not a wildcard.
const ALLOWED_ORIGINS = new Set([
  'http://127.0.0.1:5173',
  'http://localhost:5173',
  'http://127.0.0.1:4173',
  'http://127.0.0.1:5174',
])

function applyCors(request, response) {
  const origin = request.headers.origin
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin)
    response.setHeader('Vary', 'Origin')
  }
  response.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', 'Accept,Content-Type,X-Streamclone-Beta-Key,Idempotency-Key')
  response.setHeader('Access-Control-Max-Age', '600')
}

/**
 * UI mockups live in the control-plane artifacts directory, not in this repo, so
 * they never ship with the app. Served here purely so they can be clicked
 * through at a URL instead of over `file://`. Read-only, and path-escape is
 * rejected rather than normalised away.
 */
const MOCKUP_ROOT = resolve(
  process.env.SP_MOCKUP_DIR?.trim() ||
    'C:/Users/Aron/streampulse-sdlc/artifacts/ui-audit-2026-09-11/mockups',
)
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
}

function serveMockup(response, pathname) {
  const relative = pathname.replace(/^\/mockups\/?/, '') || 'index.html'
  const target = resolve(join(MOCKUP_ROOT, normalize(relative)))
  // Refuse anything that resolves outside the mockup directory.
  if (target !== MOCKUP_ROOT && !target.startsWith(MOCKUP_ROOT + sep)) {
    sendJson(response, 403, { error: 'fixture_mockup_path_rejected' })
    return
  }
  const file = existsSync(target) && statSync(target).isDirectory() ? join(target, 'index.html') : target
  if (!existsSync(file)) {
    sendJson(response, 404, { error: 'fixture_mockup_not_found', relative })
    return
  }
  const body = readFileSync(file)
  console.log(`[fixture] MOCKUP  200 ${logSafe(pathname)}`)
  response.writeHead(200, {
    'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': body.byteLength,
    'Cache-Control': 'no-store',
  })
  response.end(body)
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

/** Request-derived text in logs: drop line breaks so a path cannot forge log lines. */
function logSafe(value) {
  return String(value).replace(/\n|\r/g, '')
}

async function passThrough(request, response, url) {
  // Keep the upstream origin fixed: a path such as `//host/x` must not become the host.
  const target = new URL(UPSTREAM)
  target.pathname = url.pathname
  target.search = url.search
  if (target.origin !== UPSTREAM_ORIGIN) {
    sendJson(response, 400, { error: 'fixture_bad_upstream_path' })
    return
  }
  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers: { accept: request.headers.accept ?? 'application/json' },
      redirect: 'follow',
    })
    const body = Buffer.from(await upstream.arrayBuffer())
    const type = upstream.headers.get('content-type') ?? 'application/octet-stream'
    console.log(`[fixture]  → upstream ${upstream.status} ${logSafe(url.pathname)}`)
    response.writeHead(upstream.status, {
      'Content-Type': type,
      'Content-Length': body.byteLength,
      'Cache-Control': 'no-store',
    })
    response.end(body)
  } catch (error) {
    console.error(`[fixture]  → upstream FAILED ${logSafe(url.pathname)}: ${logSafe(error.message)}`)
    sendJson(response, 502, { error: 'fixture_upstream_unreachable' })
  }
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${HOST}:${PORT}`)
  applyCors(request, response)

  if (request.method === 'OPTIONS') {
    response.writeHead(204)
    response.end()
    return
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendJson(response, 405, { error: 'fixture_read_only' })
    return
  }

  if (url.pathname === '/mockups' || url.pathname.startsWith('/mockups/')) {
    serveMockup(response, url.pathname)
    return
  }

  const fixture = discoveryFixtureResponse(url.pathname, url.searchParams)
  if (fixture) {
    const day = url.searchParams.get('day')
    const items = Array.isArray(fixture.items) ? fixture.items.length : 0
    console.log(`[fixture] FIXTURE 200 ${logSafe(url.pathname)}${day ? ` day=${logSafe(day)}` : ''} items=${items}`)
    sendJson(response, 200, fixture)
    return
  }

  void passThrough(request, response, url)
})

server.listen(PORT, HOST, () => {
  console.log(`[fixture] listening on http://${HOST}:${PORT}`)
  console.log(`[fixture] serving  /v1/public/discovery  and  /v1/public/discovery/activity`)
  console.log(`[fixture] proxying everything else to ${UPSTREAM}`)
  console.log(`[fixture] mockups at http://${HOST}:${PORT}/mockups/`)
  console.log('[fixture] in the portal console, once per session:')
  console.log(`[fixture]   sessionStorage.setItem('sp.backendUrlOverride','http://${HOST}:${PORT}')`)
})

server.on('error', error => {
  if (error.code === 'EADDRINUSE') {
    console.error(`[fixture] port ${PORT} is already in use. Set SP_FIXTURE_PORT to pick another.`)
    process.exit(1)
  }
  console.error(`[fixture] ${error.message}`)
  process.exit(1)
})
