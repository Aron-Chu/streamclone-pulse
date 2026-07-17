/**
 * Post-build prerender: emit static HTML shells for public routes (WEB-002).
 * Dashboard/admin remain SPA-only chunks.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const dist = join(root, 'dist')
const indexHtml = readFileSync(join(dist, 'index.html'), 'utf8')

const publicRoutes = ['setup', 'docs', 'status', 'login', 'privacy']

for (const route of publicRoutes) {
  const dir = join(dist, route)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'index.html'), indexHtml)
}

mkdirSync(join(dist, 'docs', 'getting-started'), { recursive: true })
copyFileSync(join(dist, 'docs', 'index.html'), join(dist, 'docs', 'getting-started', 'index.html'))

console.log('prerender: wrote public route shells for /, /setup, /docs, /status, /login, /privacy')
