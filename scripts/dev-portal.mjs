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
import { resolveViteArgs } from './dev-portal-config.mjs'

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../streampulse-web')
const viteBin = resolve(webRoot, 'node_modules/vite/bin/vite.js')
const watchConfig = !process.argv.includes('--no-watch-config')

const viteArgs = resolveViteArgs(process.argv.slice(2))

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
  const apiMode = env.VITE_BACKEND_URL?.trim() || 'https://api.streampulse.stream (hosted default)'
  console.log(`[dev-portal] worktree ${webRoot}`)
  console.log(`[dev-portal] API ${apiMode}`)
  console.log(`[dev-portal] starting vite ${viteArgs.join(' ')}`)
  console.log('[dev-portal] loopback is the default; pass --lan for explicit LAN exposure')
  vite = spawn(process.execPath, [viteBin, ...viteArgs], {
    cwd: webRoot,
    stdio: 'inherit',
    env,
  })
  vite.on('exit', (code, signal) => {
    if (restarting) return
    console.error(`[dev-portal] Vite exited (code ${code ?? 'none'}, signal ${signal ?? 'none'}). Portal is no longer serving.`)
    process.exit(code ?? 1)
  })
  vite.on('error', error => {
    console.error(`[dev-portal] unable to start Vite: ${error.message}`)
    process.exit(1)
  })
}

function scheduleRestart(reason) {
  if (restartTimer) clearTimeout(restartTimer)
  restartTimer = setTimeout(() => {
    console.log(`[dev-portal] restarting (${reason})`)
    if (restarting) return
    restarting = true
    const previous = vite
    const startReplacement = () => {
      vite = null
      restarting = false
      startVite()
    }
    // killed only means a signal was sent; wait for actual exit before binding again.
    if (!previous || previous.exitCode != null || previous.signalCode != null) {
      startReplacement()
      return
    }
    const hardStopTimer = setTimeout(() => {
      if (previous.exitCode == null) previous.kill('SIGKILL')
    }, 3_000)
    const failTimer = setTimeout(() => {
      if (previous.exitCode == null) {
        console.error('[dev-portal] previous Vite process did not exit; refusing to start a second server')
        process.exit(1)
      }
    }, 5_000)
    previous.once('exit', () => {
      clearTimeout(hardStopTimer)
      clearTimeout(failTimer)
      startReplacement()
    })
    if (!previous.kill('SIGTERM')) {
      clearTimeout(hardStopTimer)
      clearTimeout(failTimer)
      console.error('[dev-portal] could not stop the previous Vite process; refusing to restart')
      process.exit(1)
    }
  }, 250)
}

function watchFile(relativePath) {
  const path = resolve(webRoot, relativePath)
  if (!existsSync(path)) return
  watch(path, { persistent: true }, () => scheduleRestart(relativePath))
  console.log(`[dev-portal] watching ${relativePath}`)
}

function watchWebConfig() {
  const watchedNames = new Set([
    '.env',
    '.env.local',
    '.env.development',
    '.env.development.local',
    'vite.config.ts',
  ])
  watch(webRoot, { persistent: true }, (_eventType, filename) => {
    const name = filename?.toString()
    if (name && watchedNames.has(name)) scheduleRestart(name)
  })
  console.log(`[dev-portal] watching ${[...watchedNames].join(', ')}`)
}

startVite()

if (watchConfig) {
  watchWebConfig()
  for (const name of [
    '../packages/pulse-core/package.json',
    '../packages/pulse-charts/package.json',
    '../packages/analytics-console/package.json',
  ]) {
    watchFile(name)
  }
} else {
  console.log('[dev-portal] config/env watch disabled by --no-watch-config')
}

function shutdown() {
  if (vite && !vite.killed) vite.kill('SIGTERM')
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
