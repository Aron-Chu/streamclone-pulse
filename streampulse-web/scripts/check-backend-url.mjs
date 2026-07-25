#!/usr/bin/env node
/**
 * Fail production portal builds that embed local / loopback API URLs.
 * Uses URL parsing + host normalization (not bare substring allowlists).
 *
 * Production builds rewrite React Router's relative-URL base to
 * `https://invalid.invalid` (see rewriteReactRouterLocalhost plugin).
 * Bare `http://localhost` is never allowed in shipped portal assets.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const allowedHosts = ['api.streampulse.stream']

const LOCAL_ALIASES = new Set(['laptopworker', 'host.docker.internal'])

/** Reserved non-local base used after React Router rewrite (not an API origin). */
export const REACT_ROUTER_URL_BASE = 'https://invalid.invalid'

const BARE_LOCALHOST = 'http://localhost'

function expandIpv4Mapped(host) {
  const bare = host.replace(/^\[|\]$/g, '')
  // ::ffff:127.0.0.1
  const dotted = bare.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)
  if (dotted) return dotted[1]
  // Node URL may normalize to ::ffff:7f00:1
  const hex = bare.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i)
  if (hex) {
    const hi = Number.parseInt(hex[1], 16)
    const lo = Number.parseInt(hex[2], 16)
    if (Number.isFinite(hi) && Number.isFinite(lo)) {
      return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`
    }
  }
  return bare
}

function isIpv4Loopback(host) {
  const h = expandIpv4Mapped(host)
  if (/^127\.\d+\.\d+\.\d+$/.test(h)) return true
  if (h === '127.1' || h === '127.0.1') return true
  return false
}

function isIpv6Loopback(host) {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase()
  return h === '::1' || h === '0:0:0:0:0:0:0:1'
}

function isUnspecified(host) {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase()
  return h === '0.0.0.0' || h === '::' || h === '0:0:0:0:0:0:0:0'
}

/**
 * Returns true when a hostname is a local/loopback/dev alias that must not
 * appear as an app-authored backend origin in production portal assets.
 */
export function isForbiddenBackendHostname(hostname) {
  const host = String(hostname ?? '')
    .trim()
    .toLowerCase()
    .replace(/\.$/, '')
  if (!host) return false
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (isIpv4Loopback(host) || isIpv6Loopback(host) || isUnspecified(host)) return true
  if (LOCAL_ALIASES.has(host)) return true
  for (const alias of LOCAL_ALIASES) {
    if (host === alias || host.endsWith(`.${alias}`) || host.includes(`${alias}.`)) return true
  }
  return false
}

/** @deprecated Use findForbiddenBackendUrlHits — kept for older tests. */
export function findForbiddenBackendHosts(text) {
  return findForbiddenBackendUrlHits(text)
}

/**
 * Scan text for absolute http(s) URLs whose host is local/loopback.
 * Every bare `http://localhost` occurrence is forbidden (no React Router exemption).
 */
export function findForbiddenBackendUrlHits(text) {
  const hits = []
  const src = String(text ?? '')
  const re = /https?:\/\/[^\s"'`<>)\\]+/gi
  let match
  while ((match = re.exec(src)) !== null) {
    const raw = match[0]
    const cleaned = raw.replace(/[.,;)\]]+$/, '')
    let parsed
    try {
      parsed = new URL(cleaned)
    } catch {
      continue
    }
    if (cleaned === REACT_ROUTER_URL_BASE) continue
    if (isForbiddenBackendHostname(parsed.hostname)) {
      hits.push(cleaned)
    }
  }
  return hits
}

/** Count exact bare `http://localhost` literals (not port/path/query variants). */
export function countBareLocalhostSentinel(text) {
  const src = String(text ?? '')
  let count = 0
  let idx = 0
  while (true) {
    const found = src.indexOf(BARE_LOCALHOST, idx)
    if (found < 0) break
    const rest = src.slice(found + BARE_LOCALHOST.length)
    if (!rest.startsWith(':') && !rest.startsWith('/') && !rest.startsWith('?') && !rest.startsWith('#')) {
      count += 1
    }
    idx = found + BARE_LOCALHOST.length
  }
  return count
}

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const stat = statSync(path)
    if (stat.isDirectory()) walk(path, files)
    else if (/\.(js|html)$/i.test(name)) files.push(path)
  }
  return files
}

export function analyzePortalDistForLocalOrigins(distDir = dist) {
  const files = walk(distDir)
  const forbidden = []
  let sentinelTotal = 0
  const sentinelFiles = []
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    for (const needle of findForbiddenBackendUrlHits(text)) {
      forbidden.push({ file: relative(distDir, file), needle })
    }
    const n = countBareLocalhostSentinel(text)
    if (n > 0) {
      sentinelTotal += n
      sentinelFiles.push({ file: relative(distDir, file), count: n })
    }
  }
  return { forbidden, sentinelTotal, sentinelFiles, files }
}

function main() {
  const { forbidden, sentinelTotal, sentinelFiles } = analyzePortalDistForLocalOrigins(dist)
  if (forbidden.length > 0) {
    console.error('check-backend-url: forbidden API host in production bundle:')
    for (const hit of forbidden) console.error(`  ${hit.file}: ${hit.needle}`)
    process.exit(1)
  }
  if (sentinelTotal > 0) {
    console.error(
      `check-backend-url: bare http://localhost sentinel count ${sentinelTotal} must be 0 (React Router base rewritten to ${REACT_ROUTER_URL_BASE})`,
    )
    for (const s of sentinelFiles) console.error(`  ${s.file}: ${s.count}`)
    process.exit(1)
  }
  const indexHtml = readFileSync(join(dist, 'index.html'), 'utf8')
  const files = walk(dist)
  const hasHosted = allowedHosts.some(
    (host) => indexHtml.includes(host) || files.some((f) => readFileSync(f, 'utf8').includes(host)),
  )
  if (!hasHosted) {
    console.warn(
      'check-backend-url: warning — bundle does not reference api.streampulse.stream (VITE_BACKEND_URL may be custom)',
    )
  }
  console.log('check-backend-url: ok')
}

const entry = process.argv[1] ? process.argv[1].replace(/\\/g, '/') : ''
if (entry.endsWith('check-backend-url.mjs')) {
  main()
}
