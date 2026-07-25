#!/usr/bin/env node
/**
 * Watch-build extension shells and content IIFE in parallel.
 * Content-only edits must rebuild via vite.content.config.ts — not only closeBundle.
 */
import { spawn } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const viteBin = resolve(root, 'node_modules/vite/bin/vite.js')
const node = process.execPath

function spawnWatch(args, label) {
  const child = spawn(node, [viteBin, ...args], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  })
  child.on('exit', code => {
    if (code && code !== 0) {
      console.error(`[dev-extension-watch] ${label} exited with code ${code}`)
      shutdown(code)
    }
  })
  return child
}

const children = [
  spawnWatch(['build', '--watch'], 'main'),
  spawnWatch(['build', '--watch', '--config', 'vite.content.config.ts'], 'content'),
]

function shutdown(code = 0) {
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM')
  }
  process.exit(code)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
