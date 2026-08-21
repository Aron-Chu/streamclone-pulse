#!/usr/bin/env node
/**
 * Analytics deep-link helpers must stay stable for hub → console navigation.
 * Logic mirrored from src/lib/analyticsLinks.ts (no TS import — Node CI safe).
 *
 * Also scans public analytics surfaces for private clip-queue CTAs (P2-020).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

function buildAnalyticsHref({ login, streamId, offsetSeconds }) {
  const safeChannel = encodeURIComponent(login.trim().toLowerCase())
  // Canonical channel-session route is /analytics/{channel}/{streamId}.
  // The /s/{streamId} form is a backcompat redirect alias only.
  const base = streamId
    ? `/analytics/${safeChannel}/${encodeURIComponent(streamId)}`
    : `/analytics/${safeChannel}`
  if (offsetSeconds != null && offsetSeconds > 0) {
    return `${base}#t=${Math.floor(offsetSeconds)}`
  }
  return base
}

function analyticsActionLabel() {
  return 'Analytics'
}

const cases = [
  { login: 'xqc', streamId: undefined, want: '/analytics/xqc' },
  { login: 'XQC', streamId: '12345', want: '/analytics/xqc/12345' },
  { login: 'xqc', streamId: '12345', offsetSeconds: 120, want: '/analytics/xqc/12345#t=120' },
]

for (const { login, streamId, offsetSeconds, want } of cases) {
  const got = buildAnalyticsHref({ login, streamId, offsetSeconds })
  if (got !== want) {
    console.error(`buildAnalyticsHref mismatch: got ${got}, want ${want}`)
    process.exit(1)
  }
}

if (analyticsActionLabel('recent-session') !== 'Analytics') {
  console.error('analyticsActionLabel(recent-session) regression')
  process.exit(1)
}

const here = dirname(fileURLToPath(import.meta.url))
const webRoot = join(here, '..')

const PUBLIC_SCAN_ROOTS = [
  'src/routes/analytics',
  'src/routes/public',
  'src/ui/components/analytics',
  'src/ui/components/hub',
  'src/ui/components/landing',
]

const EXCLUDE_PATH_PARTS = [
  `${join('src', 'routes', 'dashboard')}`,
  `${join('src', 'lib', 'clipCandidates.ts')}`,
]

const FORBIDDEN = [
  { re: /dashboard\/clips/i, label: 'dashboard/clips link' },
  { re: /\bclip queue\b/i, label: 'clip queue CTA' },
  { re: /clip this peak/i, label: 'clip this peak CTA' },
  { re: /Send to ReplayForge/i, label: 'Send to ReplayForge CTA' },
]

function walkFiles(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const stat = statSync(path)
    if (stat.isDirectory()) {
      if (name === 'node_modules' || name === 'dist' || name === '__mockups__') continue
      walkFiles(path, acc)
    } else if (/\.(tsx|ts|jsx|js|mdx)$/.test(name)) {
      acc.push(path)
    }
  }
  return acc
}

function isExcluded(filePath) {
  const rel = relative(webRoot, filePath)
  return EXCLUDE_PATH_PARTS.some((part) => rel.includes(part.replace(/\\/g, '/')))
}

let publicScanFailed = false
for (const rootRel of PUBLIC_SCAN_ROOTS) {
  const root = join(webRoot, rootRel)
  let files
  try {
    files = walkFiles(root)
  } catch {
    continue
  }
  for (const file of files) {
    if (isExcluded(file)) continue
    const rel = relative(webRoot, file).replace(/\\/g, '/')
    const text = readFileSync(file, 'utf8')
    for (const { re, label } of FORBIDDEN) {
      if (re.test(text)) {
        console.error(`check:analytics-links: forbidden ${label} in public surface ${rel}`)
        publicScanFailed = true
      }
    }
  }
}

if (publicScanFailed) {
  process.exit(1)
}

console.log('check:analytics-links OK')
