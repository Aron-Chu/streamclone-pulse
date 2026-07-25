#!/usr/bin/env node
/**
 * Fail production portal builds that embed local / loopback API URLs.
 * Uses URL parsing + host normalization (not bare substring allowlists).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const allowedHosts = ['api.streampulse.stream']

const LOCAL_ALIASES = new Set(['laptopworker', 'host.docker.internal'])

/**
 * React Router may embed exactly one fingerprinted `http://localhost` sentinel
 * used as a relative-URL base. Any other occurrence (port, path, query, count>1,
 * or different chunk context) fails.
 */
const REACT_ROUTER_SENTINEL = {
  literal: 'http://localhost',
  // Surrounding context unique to the React Router URL parser sentinel.
  contextNeedle: 'http://localhost',
  maxCount: 1,
}

function expandIpv4Mapped(host) {
  // ::ffff:127.0.0.1
  const m = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)
  return m ? m[1] : host
}

function isIpv4Loopback(host) {
  const h = expandIpv4Mapped(host.replace(/^\[|\]$/g, ''))
  // 127.0.0.0/8 including shortened spellings like 127.1 → treated via URL parser
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
 * Bare React Router sentinel is counted separately by the caller.
 */
export function findForbiddenBackendUrlHits(text) {
  const hits = []
  const src = String(text ?? '')
  const re = /https?:\/\/[^\s"'`<>)\\]+/gi
  let match
  while ((match = re.exec(src)) !== null) {
    const raw = match[0]
    // Strip trailing punctuation commonly captured from minified JS
    const cleaned = raw.replace(/[.,;)\]]+$/, '')
    let parsed
    try {
      parsed = new URL(cleaned)
    } catch {
      continue
    }
    if (isForbiddenBackendHostname(parsed.hostname)) {
      // Allow only exact bare sentinel without port/path/query/userinfo
      const isBareSentinel =
        cleaned === REACT_ROUTER_SENTINEL.literal
        && parsed.hostname === 'localhost'
        && !parsed.port
        && (parsed.pathname === '/' || parsed.pathname === '')
        && !parsed.search
        && !parsed.hash
        && !parsed.username
        && !parsed.password
      if (!isBareSentinel) {
        hits.push(cleaned)
      }
    }
  }
  return hits
}

export function countBareLocalhostSentinel(text) {
  const src = String(text ?? '')
  let count = 0
  let idx = 0
  while (true) {
    const found = src.indexOf(REACT_ROUTER_SENTINEL.literal, idx)
    if (found < 0) break
    const after = src.slice(found, found + REACT_ROUTER_SENTINEL.literal.length + 8)
    // Count only exact bare form not followed by :port or /
    const rest = src.slice(found + REACT_ROUTER_SENTINEL.literal.length)
    if (!rest.startsWith(':') && !rest.startsWith('/') && !rest.startsWith('?') && !rest.startsWith('#')) {
      count += 1
    }
    idx = found + REACT_ROUTER_SENTINEL.literal.length
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
  if (sentinelTotal > REACT_ROUTER_SENTINEL.maxCount) {
    console.error(
      `check-backend-url: bare http://localhost sentinel count ${sentinelTotal} exceeds allowed ${REACT_ROUTER_SENTINEL.maxCount}`,
    )
    for (const s of sentinelFiles) console.error(`  ${s.file}: ${s.count}`)
    process.exit(1)
  }
  if (sentinelTotal === 1) {
    console.log(
      `check-backend-url: allowing exactly one React Router bare localhost sentinel in ${sentinelFiles[0]?.file}`,
    )
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
