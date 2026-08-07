#!/usr/bin/env node
/**
 * SPA route smoke: ensure analytics paths are registered (not caught by catch-all redirect).
 * Used by npm run check:analytics-routes-spa in CI and deploy prep.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(fileURLToPath(import.meta.url))
const routesPath = join(root, '../src/routes/index.tsx')
const source = readFileSync(routesPath, 'utf8')

const required = [
  '/',
  '/docs',
  '/status',
  '/privacy',
  '/support',
  '/changelog',
  '/analytics',
  '/analytics/:login',
  '/analytics/:login/:streamId',
  '/analytics/:login/s/:streamId',
]

const missing = required.filter((fragment) => !source.includes(`path="${fragment}"`))
if (missing.length > 0) {
  console.error('Missing required public SPA routes in src/routes/index.tsx:')
  for (const route of missing) console.error(`  - ${route}`)
  process.exit(1)
}

if (!source.includes('RequireAuth')) {
  console.error('Expected RequireAuth wrapper for beta-gated dashboard routes')
  process.exit(1)
}

if (!source.includes('<Route path="*" element={<NotFound />}')) {
  console.error('Expected a real public 404 route instead of a catch-all redirect')
  process.exit(1)
}

console.log('check:analytics-routes-spa OK —', required.join(', '))
