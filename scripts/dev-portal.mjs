#!/usr/bin/env node
/**
 * StreamPulse portal dev server with automatic restart when env or Vite config changes.
 * Vite HMR handles src/ edits; this wrapper restarts the process for .env* and vite.config.ts.
 */

import { spawn } from 'node:child_process'
import { watch } from 'node:fs'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../streampulse-web')
const viteBin = resolve(webRoot, 'node_modules/vite/bin/vite.js')
const watchConfig = process.argv.includes('--watch-config')

const viteArgs = process.argv.filter(arg => arg !== '--watch-config').slice(2)
if (viteArgs.length === 0) {
  viteArgs.push('--host', '--port', '5173')
}

/** @type {import('node:child_process').ChildProcess | null} */
let vite = null
let restarting = false
/** @type {ReturnType<typeof setTimeout> | null} */
let restartTimer = null

function startVite() {
  const env = { ...process.env }
  const viteBackend = env.VITE_BACKEND_URL?.trim()
  if (viteBackend && /localhost|127\.0\.0\.1|laptopworker|:8081|:8090/i.test(viteBackend)) {
    delete env.VITE_BACKEND_URL
    console.log('[dev-portal] ignoring localhost VITE_BACKEND_URL — portal dev uses hosted API')
  }
  console.log(`[dev-portal] starting vite ${viteArgs.join(' ')}`)
  console.log('[dev-portal] prefer http://127.0.0.1:5173/analytics — localhost can stall on IPv6')
  vite = spawn(process.execPath, [viteBin, ...viteArgs], {
    cwd: webRoot,
    stdio: 'inherit',
    env,
  })
  vite.on('exit', (code, signal) => {
    if (restarting) return
    if (signal === 'SIGTERM' || signal === 'SIGKILL') return
    process.exit(code ?? 0)
  })
}

function scheduleRestart(reason) {
  if (restartTimer) clearTimeout(restartTimer)
  restartTimer = setTimeout(() => {
    console.log(`[dev-portal] restarting (${reason})`)
    restarting = true
    if (vite && !vite.killed) vite.kill('SIGTERM')
    setTimeout(() => {
      restarting = false
      startVite()
    }, 400)
  }, 250)
}

function watchFile(relativePath) {
  const path = resolve(webRoot, relativePath)
  if (!existsSync(path)) return
  watch(path, { persistent: true }, () => scheduleRestart(relativePath))
  console.log(`[dev-portal] watching ${relativePath}`)
}

startVite()

if (watchConfig) {
  for (const name of [
    '.env',
    '.env.local',
    '.env.development',
    '.env.development.local',
    'vite.config.ts',
  ]) {
    watchFile(name)
  }
} else {
  console.log('[dev-portal] config/env watch disabled (pass --watch-config to enable auto-restart)')
}

function shutdown() {
  if (vite && !vite.killed) vite.kill('SIGTERM')
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
