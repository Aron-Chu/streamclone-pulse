import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..')
const linkScript = join(repoRoot, 'scripts', 'ci-link-streamclone-packages.sh')
const verifyScript = join(repoRoot, 'scripts', 'ci-verify-pulse-packages.sh')

const GIT_BASH_CANDIDATES = [
  'C:\\Program Files\\Git\\bin\\bash.exe',
  'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
]

function resolveBash() {
  for (const p of GIT_BASH_CANDIDATES) {
    const r = spawnSync(p, ['-lc', 'echo ok'], { encoding: 'utf8' })
    if (r.status === 0 && String(r.stdout).includes('ok')) return p
  }
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

describe('ci-link-streamclone-packages (RPR-6 in-repo no-op)', () => {
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

  it('verifies in-repo packages and no-ops the linker', () => {
    const bashExe = resolveBash()
    expect(bashExe, 'Git Bash or Linux bash required for package-link shell test').toBeTruthy()

    const nest = mkdtempSync(join(tmpdir(), 'pulse-link-nest-'))
    dirs.push(nest)
    const root = join(nest, 'workspace')
    mkdirSync(root)

    for (const pkg of ['pulse-core', 'analytics-console', 'pulse-charts']) {
      const p = join(root, 'packages', pkg)
      mkdirSync(join(p, 'src'), { recursive: true })
      writeFileSync(join(p, 'package.json'), '{"name":"x","private":true}\n')
      writeFileSync(join(p, 'LICENSE'), 'Apache-2.0\n')
      writeFileSync(join(p, 'NOTICE'), 'NOTICE\n')
    }

    const bashRoot = toBashPath(root)
    const verified = spawnSync(bashExe, [toBashPath(verifyScript)], {
      cwd: root,
      env: { ...process.env, GITHUB_WORKSPACE: bashRoot, MSYS_NO_PATHCONV: '1' },
      encoding: 'utf8',
    })
    expect(verified.status).toBe(0)
    expect(verified.stdout).toMatch(/in-repo packages ok/i)

    const linked = spawnSync(bashExe, [toBashPath(linkScript)], {
      cwd: root,
      env: { ...process.env, GITHUB_WORKSPACE: bashRoot, MSYS_NO_PATHCONV: '1' },
      encoding: 'utf8',
    })
    expect(linked.status).toBe(0)
    expect(linked.stdout).toMatch(/no-op/i)
  })

  it('fails verify when an in-repo package is missing', () => {
    const bashExe = resolveBash()
    expect(bashExe).toBeTruthy()

    const nest = mkdtempSync(join(tmpdir(), 'pulse-link-miss-'))
    dirs.push(nest)
    const root = join(nest, 'workspace')
    mkdirSync(join(root, 'packages', 'pulse-core'), { recursive: true })
    writeFileSync(join(root, 'packages', 'pulse-core', 'package.json'), '{}\n')
    writeFileSync(join(root, 'packages', 'pulse-core', 'LICENSE'), 'x\n')
    writeFileSync(join(root, 'packages', 'pulse-core', 'NOTICE'), 'x\n')

    const bashRoot = toBashPath(root)
    const verified = spawnSync(bashExe, [toBashPath(verifyScript)], {
      cwd: root,
      env: { ...process.env, GITHUB_WORKSPACE: bashRoot, MSYS_NO_PATHCONV: '1' },
      encoding: 'utf8',
    })
    expect(verified.status).not.toBe(0)
    expect(verified.stderr + verified.stdout).toMatch(/missing in-repo package/i)
  })
})
