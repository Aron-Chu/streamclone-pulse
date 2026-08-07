#!/usr/bin/env node
/**
 * StreamPulse portal dev server with automatic restart when env or Vite config changes.
 * Vite HMR handles src/ edits; this wrapper restarts the process for .env* and vite.config.ts.
 */

import { spawn } from 'node:child_process'
import { watch } from 'node:fs'
import { existsSync, rmSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../streampulse-web')
const viteBin = resolve(webRoot, 'node_modules/vite/bin/vite.js')
const watchConfig = !process.argv.includes('--no-watch-config')
const packageCohortFiles = [
  '../config/local-package-overrides.json',
  '../package.json',
  '../package-lock.json',
  'package.json',
  'package-lock.json',
]

const viteArgs = process.argv
  .filter(arg => arg !== '--watch-config' && arg !== '--no-watch-config')
  .slice(2)
if (viteArgs.length === 0) {
  // Reserve 5174 for the portal UI. A collision must fail loudly instead of
  // silently moving this checkout to another port and showing the wrong build.
  viteArgs.push('--host', '127.0.0.1', '--port', '5174', '--strictPort')
}

/** @type {import('node:child_process').ChildProcess | null} */
let vite = null
let restarting = false
let stopping = false
/** @type {ReturnType<typeof setTimeout> | null} */
let restartTimer = null

function startVite() {
  if (stopping) return
  const env = { ...process.env }
  const viteBackend = env.VITE_BACKEND_URL?.trim()
  if (viteBackend && /localhost|127\.0\.0\.1|laptopworker|:8081|:8090/i.test(viteBackend)) {
    delete env.VITE_BACKEND_URL
    console.log('[dev-portal] ignoring localhost VITE_BACKEND_URL — portal dev uses hosted API')
  }
  console.log(`[dev-portal] starting vite ${viteArgs.join(' ')}`)
  console.log('[dev-portal] prefer http://127.0.0.1:5174/analytics — strict port prevents stale-server fallback')
  vite = spawn(process.execPath, [viteBin, ...viteArgs], {
    cwd: webRoot,
    stdio: 'inherit',
    env,
    windowsHide: true,
  })
  vite.on('exit', (code, signal) => {
    vite = null
    if (restarting) return
    if (stopping) return
    if (signal === 'SIGTERM' || signal === 'SIGKILL') return
    process.exit(code ?? 0)
  })
}

function stopVite() {
  const child = vite
  if (!child || child.exitCode !== null) {
    vite = null
    return Promise.resolve()
  }
  return new Promise((resolveStop) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      vite = null
      resolveStop()
    }
    child.once('exit', finish)
    try {
      child.kill('SIGTERM')
    } catch {
      finish()
      return
    }
    // Windows can leave the npm/Vite descendant alive after ChildProcess.kill.
    // Escalate only to this exact PID and its descendants, never to a port or
    // a process name that could belong to another checkout.
    setTimeout(() => {
      if (settled || child.exitCode !== null) return
      if (process.platform === 'win32') {
        spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        })
      } else {
        child.kill('SIGKILL')
      }
      setTimeout(finish, 250)
    }, 2000).unref()
  })
}

function clearViteDependencyCache() {
  const cache = resolve(webRoot, 'node_modules/.vite')
  if (!existsSync(cache)) return
  rmSync(cache, { recursive: true, force: true })
  console.log('[dev-portal] cleared Vite dependency cache after package/config change')
}

function scheduleRestart(reason) {
  if (restartTimer) clearTimeout(restartTimer)
  restartTimer = setTimeout(() => {
    restartTimer = null
    if (restarting || stopping) return
    void (async () => {
      console.log(`[dev-portal] restarting (${reason})`)
      restarting = true
      await stopVite()
      if (reason.includes('package') || reason.includes('override') || reason.includes('lock') || reason.includes('vite.config')) {
        clearViteDependencyCache()
      }
      restarting = false
      startVite()
    })()
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
    ...packageCohortFiles,
  ]) {
    watchFile(name)
  }
} else {
  console.log('[dev-portal] config/env watch disabled (pass --no-watch-config only for a deliberate one-shot config session)')
}

async function shutdown() {
  if (stopping) return
  stopping = true
  if (restartTimer) clearTimeout(restartTimer)
  await stopVite()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
