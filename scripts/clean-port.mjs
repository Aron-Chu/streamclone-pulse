#!/usr/bin/env node

import { spawnSync } from 'node:child_process'

const port = Number(process.argv[2])

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('Usage: node scripts/clean-port.mjs <port>')
  process.exit(1)
}

function listeningPids() {
  if (process.platform === 'win32') {
    const result = spawnSync('netstat.exe', ['-ano', '-p', 'tcp'], { encoding: 'utf8', windowsHide: true })
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(`netstat failed with status ${result.status}`)
    const pids = new Set()
    for (const line of result.stdout.split(/\r?\n/)) {
      const match = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i)
      if (match && Number(match[1]) === port) pids.add(Number(match[2]))
    }
    return [...pids]
  }

  const result = spawnSync('lsof', ['-ti', `TCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' })
  if (result.error) throw result.error
  // lsof uses status 1 when the query finds no listener.
  if (result.status !== 0 && result.status !== 1) throw new Error(`lsof failed with status ${result.status}`)
  return [...new Set((result.stdout ?? '').split(/\r?\n/).map(Number).filter(Boolean))]
}

let pids
try {
  pids = listeningPids().filter((pid) => pid !== process.pid)
} catch (error) {
  console.error(`Unable to inspect port ${port}: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}

// Keep the legacy command name, but never infer permission to terminate a
// process from its port. It could be another checkout or an unrelated service.
if (pids.length) {
  console.error(`[clean-port] port ${port} is occupied by PID(s) ${pids.join(', ')}. No process was stopped. Verify ownership before stopping it explicitly.`)
  process.exit(1)
}
console.log(`[clean-port] port ${port} has no detected listener; startup still uses strict-port binding.`)
