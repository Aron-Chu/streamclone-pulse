import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { execSync } from 'node:child_process'

const dist = join(process.cwd(), 'dist')
const zip = join(process.cwd(), 'streamclone-pulse.zip')

function listFiles(dir: string, base = dir): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...listFiles(full, base))
    } else {
      out.push(relative(base, full))
    }
  }
  return out
}

if (process.platform === 'win32') {
  execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${dist}\\*' -DestinationPath '${zip}' -Force"`, {
    stdio: 'inherit',
  })
} else {
  execSync(`cd "${dist}" && zip -r "${zip}" .`, { stdio: 'inherit' })
}

console.log(`Wrote ${zip} (${listFiles(dist).length} files)`)
