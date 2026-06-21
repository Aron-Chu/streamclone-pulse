#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Minimal 16x16 solid #9146FF PNG
const png16 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAFUlEQVR42mP8z8BQz0AEYBxVSFUAAP//AwD5FQBq3R8AAAAASUVORK5CYII=',
  'base64',
)

const dir = join(process.cwd(), 'public', 'icons')
mkdirSync(dir, { recursive: true })
for (const size of [16, 48, 128]) {
  writeFileSync(join(dir, `icon${size}.png`), png16)
}
console.log('Wrote placeholder icons to public/icons')
