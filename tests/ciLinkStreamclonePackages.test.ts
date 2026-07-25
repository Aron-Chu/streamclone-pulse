import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..')
const linkScript = join(repoRoot, 'scripts', 'ci-link-streamclone-packages.sh')

const GIT_BASH_CANDIDATES = [
  'C:\\Program Files\\Git\\bin\\bash.exe',
  'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
]

function resolveBash() {
  for (const p of GIT_BASH_CANDIDATES) {
    const r = spawnSync(p, ['-lc', 'echo ok'], { encoding: 'utf8' })
    if (r.status === 0 && String(r.stdout).includes('ok')) return p
  }
  // Prefer non-WSL bash when `bash` is on PATH (CI Linux).
  const r = spawnSync('bash', ['-lc', 'uname -s'], { encoding: 'utf8' })
  if (r.status === 0 && !/microsoft/i.test(r.stdout || '')) return 'bash'
  return null
}

/** Convert a Windows path to a form Git Bash / MSYS accepts. */
function toBashPath(p) {
  const norm = String(p).replace(/\\/g, '/')
  const m = /^([A-Za-z]):\/(.*)$/.exec(norm)
  if (m) return `/${m[1].toLowerCase()}/${m[2]}`
  return norm
}

describe('ci-link-streamclone-packages', () => {
  /** @type {string[]} */
  const dirs = []

  afterEach(() => {
    for (const d of dirs.splice(0)) {
      try {
        rmSync(d, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
  })

  it('refuses unexpected pre-existing sibling packages and never selects stale content', () => {
    const bashExe = resolveBash()
    expect(bashExe, 'Git Bash or Linux bash required for package-link shell test').toBeTruthy()

    const nest = mkdtempSync(join(tmpdir(), 'pulse-link-nest-'))
    dirs.push(nest)
    const root = join(nest, 'workspace')
    mkdirSync(root)

    const verified = join(root, '_streampulse-backend', 'packages')
    for (const pkg of ['pulse-core', 'analytics-console', 'pulse-charts']) {
      const p = join(verified, pkg, 'src')
      mkdirSync(p, { recursive: true })
      if (pkg === 'pulse-core') writeFileSync(join(p, 'liveHeat.ts'), 'export const VERIFIED="yes"\n')
      if (pkg === 'analytics-console') writeFileSync(join(p, 'index.tsx'), 'export const VERIFIED="yes"\n')
      if (pkg === 'pulse-charts') writeFileSync(join(p, 'index.ts'), 'export const VERIFIED="yes"\n')
      writeFileSync(join(verified, pkg, 'package.json'), '{"name":"x","private":true}\n')
    }
    mkdirSync(join(root, '_streampulse-backend', '.git'), { recursive: true })
    writeFileSync(join(root, 'pulse-packages-resolved.sha'), 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n')

    // Stale sibling packages that look complete (old linker would trust the probe file).
    const packagesDest = join(nest, 'streampulse-backend', 'packages')
    mkdirSync(join(packagesDest, 'pulse-core', 'src'), { recursive: true })
    writeFileSync(join(packagesDest, 'pulse-core', 'src', 'liveHeat.ts'), 'export const STALE="yes"\n')
    writeFileSync(join(packagesDest, 'pulse-core', 'package.json'), '{"name":"stale"}\n')

    const bashRoot = toBashPath(root)
    const bashScript = toBashPath(linkScript)
    const refused = spawnSync(bashExe, [bashScript], {
      cwd: root,
      env: { ...process.env, GITHUB_WORKSPACE: bashRoot, MSYS_NO_PATHCONV: '1' },
      encoding: 'utf8',
    })
    expect(refused.status).not.toBe(0)
    expect(refused.stderr + refused.stdout).toMatch(/refusing unexpected pre-existing/i)
    expect(readFileSync(join(packagesDest, 'pulse-core', 'src', 'liveHeat.ts'), 'utf8')).toContain('STALE')

    writeFileSync(join(packagesDest, '.streampulse-ci-linked-packages'), 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n')
    const ok = spawnSync(bashExe, [bashScript], {
      cwd: root,
      env: { ...process.env, GITHUB_WORKSPACE: bashRoot, MSYS_NO_PATHCONV: '1' },
      encoding: 'utf8',
    })
    expect(ok.status).toBe(0)
    expect(ok.stdout).toMatch(/verified_package_sha=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/)
    expect(readFileSync(join(packagesDest, 'pulse-core', 'src', 'liveHeat.ts'), 'utf8')).toContain('VERIFIED')
    expect(readFileSync(join(packagesDest, 'pulse-core', 'src', 'liveHeat.ts'), 'utf8')).not.toContain('STALE')
    expect(existsSync(join(packagesDest, '.streampulse-ci-linked-packages'))).toBe(true)
  })
})
