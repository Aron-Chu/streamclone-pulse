#!/usr/bin/env node
/**
 * Fail production builds that embed localhost / loopback API URLs.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const allowedHosts = ['api.streampulse.stream']

/**
 * Reject localhost / loopback URLs on every port (including 8081) and with a path.
 * Bare `http://localhost` without port/path is allowed — React Router embeds that
 * sentinel as a relative-URL base and is not a Pulse BFF origin.
 */
const FORBIDDEN_PATTERNS = [
  /https?:\/\/localhost:\d+\b/i,
  /https?:\/\/127\.0\.0\.1:\d+\b/i,
  /https?:\/\/\[::1\]:\d+\b/i,
  /https?:\/\/0\.0\.0\.0:\d+\b/i,
  /https?:\/\/localhost\//i,
  /https?:\/\/127\.0\.0\.1\//i,
  /https?:\/\/\[::1\]\//i,
  /https?:\/\/0\.0\.0\.0\//i,
  /laptopworker/i,
]

export function findForbiddenBackendHosts(text, patterns = FORBIDDEN_PATTERNS) {
  const hits = []
  for (const pattern of patterns) {
    const match = String(text ?? '').match(pattern)
    if (match) hits.push(match[0])
  }
  return hits
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

function main() {
  const files = walk(dist)
  const hits = []
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    for (const needle of findForbiddenBackendHosts(text)) {
      hits.push({ file, needle })
    }
  }
  if (hits.length > 0) {
    console.error('check-backend-url: forbidden API host in production bundle:')
    for (const hit of hits) console.error(`  ${hit.file}: ${hit.needle}`)
    process.exit(1)
  }
  const indexHtml = readFileSync(join(dist, 'index.html'), 'utf8')
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
