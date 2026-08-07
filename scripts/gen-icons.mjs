#!/usr/bin/env node
/** @deprecated Use scripts/gen-cws-icons.mjs (Peak mark). Kept as alias. */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)))
const r = spawnSync(process.execPath, [join(root, 'gen-cws-icons.mjs')], {
  stdio: 'inherit',
  cwd: join(root, '..'),
})
process.exit(r.status ?? 1)
