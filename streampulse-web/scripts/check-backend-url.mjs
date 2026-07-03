#!/usr/bin/env node
/**
 * Fail production builds that embed localhost / non-hosted API URLs.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const allowedHosts = ['api.streampulse.stream']
// laptopworker is a dev-only tailnet hub; it must never appear in a prod bundle
// (JS or the index.html CSP). localhost/127.0.0.1 dev backends are likewise
// forbidden in production output.
const forbidden = ['localhost:8090', '127.0.0.1:8090', 'laptopworker']

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
    for (const needle of forbidden) {
      if (text.includes(needle)) hits.push({ file, needle })
    }
  }
  if (hits.length > 0) {
    console.error('check-backend-url: forbidden API host in production bundle:')
    for (const hit of hits) console.error(`  ${hit.file}: ${hit.needle}`)
    process.exit(1)
  }
  const indexHtml = readFileSync(join(dist, 'index.html'), 'utf8')
  const hasHosted = allowedHosts.some((host) => indexHtml.includes(host) || files.some((f) => readFileSync(f, 'utf8').includes(host)))
  if (!hasHosted) {
    console.warn('check-backend-url: warning — bundle does not reference api.streampulse.stream (VITE_BACKEND_URL may be custom)')
  }
  console.log('check-backend-url: ok')
}

main()
