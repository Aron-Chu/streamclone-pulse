#!/usr/bin/env node
/**
 * StreamPulse portal dev server with automatic restart when env or Vite config changes.
 * Vite HMR handles src/ edits; this wrapper restarts the process for .env* and vite.config.ts.
 */

import { spawn, spawnSync } from 'node:child_process'
import { watch } from 'node:fs'
import { existsSync, rmSync } from 'node:fs'
import net from 'node:net'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../streampulse-web')
const viteBin = resolve(webRoot, 'node_modules/vite/bin/vite.js')
const watchConfig = !process.argv.includes('--no-watch-config')
const PORTAL_HOST = '127.0.0.1'
const PORTAL_PORT = 5174
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
  viteArgs.push('--host', PORTAL_HOST, '--port', String(PORTAL_PORT), '--strictPort')
}

const WILDCARD_HOSTS = new Set(['::', '0.0.0.0', 'true', ''])

/**
 * A wildcard bind and a loopback bind can hold the same port at once, and
 * loopback wins for 127.0.0.1 traffic. Allowing `--host ::` therefore lets a
 * different checkout silently serve the page while this server looks healthy.
 */
function assertLoopbackHost() {
  const hostIndex = viteArgs.indexOf('--host')
  if (hostIndex === -1) return
  const value = (viteArgs[hostIndex + 1] ?? '').trim()
  const wildcard = WILDCARD_HOSTS.has(value) || value.startsWith('--')
  if (!wildcard && value !== PORTAL_HOST && value !== 'localhost') {
    console.error(`[dev-portal] refusing --host ${value}: the portal dev server must bind ${PORTAL_HOST}.`)
    process.exit(1)
  }
  if (wildcard) {
    console.error('[dev-portal] refusing a wildcard --host (:: / 0.0.0.0).')
    console.error('[dev-portal] A wildcard bind does not own 127.0.0.1:5174 — another checkout can')
    console.error('[dev-portal] answer the browser while this process reports success. Drop the flag.')
    process.exit(1)
  }
}

function describePortOwner(port) {
  if (process.platform !== 'win32') {
    const res = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' })
    return res.stdout?.trim() || 'unknown process'
  }
  const script = `Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue |` +
    ' ForEach-Object { $p = Get-CimInstance Win32_Process -Filter "ProcessId=$($_.OwningProcess)"' +
    ' -ErrorAction SilentlyContinue; "  $($_.LocalAddress):$($_.LocalPort) pid=$($_.OwningProcess) $($p.CommandLine)" }'
  const res = spawnSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' })
  return res.stdout?.trim() || 'unknown process'
}

function requestedPort() {
  const index = viteArgs.indexOf('--port')
  if (index === -1) return PORTAL_PORT
  const value = Number.parseInt(viteArgs[index + 1] ?? '', 10)
  return Number.isFinite(value) && value > 0 ? value : PORTAL_PORT
}

/** Fail with the squatter's identity instead of Vite's bare "port in use". */
function assertPortFree() {
  const port = requestedPort()
  return new Promise((done) => {
    const probe = net.connect({ host: PORTAL_HOST, port })
    const finish = (inUse) => {
      probe.destroy()
      if (!inUse) return done()
      console.error(`[dev-portal] ${PORTAL_HOST}:${port} is already serving. Owner:`)
      console.error(describePortOwner(port))
      console.error('[dev-portal] Stop that process (often a stale `vite preview` or another worktree)')
      console.error('[dev-portal] before starting dev, or you will review someone else\'s build.')
      process.exit(1)
    }
    probe.setTimeout(1000)
    probe.once('connect', () => finish(true))
    probe.once('timeout', () => finish(false))
    probe.once('error', () => finish(false))
  })
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

assertLoopbackHost()
await assertPortFree()
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
