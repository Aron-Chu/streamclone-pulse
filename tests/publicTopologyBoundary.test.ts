import { afterAll, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Value-free regression checks for the public topology boundary. Nothing here
 * names a private host, address, key, or path: the exact deny-list lives in
 * private streampulse-ops and reaches CI as a secret. These tests pin the shape
 * that keeps it out of this repository.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const scannerPath = join(repoRoot, 'scripts/ci-public-topology-scan.sh')
const guardPath = join(repoRoot, 'scripts/pre-commit-public-ops-guard.sh')
const rulePath = join(repoRoot, '.cursor/rules/public-repo-boundary.mdc')
const ciWorkflowPath = join(repoRoot, '.github/workflows/ci.yml')

const read = (path: string) => readFileSync(path, 'utf8')
const boundaryFiles = [scannerPath, guardPath, rulePath]

/** Dotted numeric sequences of three or more octets, escaped for regex or not. */
const IPV4_LIKE = /(?<![\w.\\])\d{1,3}(?:\\{0,2}\.\d{1,3}){2,3}(?![\w])/

function genericPatternFromScanner(): RegExp {
  const match = read(scannerPath).match(/^GENERIC_PATTERN='([^']+)'$/m)
  if (!match) throw new Error('scanner must define GENERIC_PATTERN')
  return new RegExp(match[1])
}

describe('public topology boundary files', () => {
  it('hold no IPv4 addresses or prefixes in any notation', () => {
    for (const file of boundaryFiles) {
      expect(IPV4_LIKE.test(read(file)), file).toBe(false)
    }
  })

  it('hold no concrete operator identifiers matched by the generic rules', () => {
    const generic = genericPatternFromScanner()
    for (const file of boundaryFiles) {
      expect(generic.test(read(file)), file).toBe(false)
    }
  })

  it('keep the exact deny-list out of source and read it at run time', () => {
    const scanner = read(scannerPath)
    const assignments = [...scanner.matchAll(/^([A-Z_]*PATTERN)='/gm)].map((m) => m[1])
    expect(assignments).toEqual(['GENERIC_PATTERN'])
    expect(scanner).toContain('STREAMPULSE_PRIVATE_TOPOLOGY_PATTERN')
    expect(scanner).toContain('STREAMPULSE_PRIVATE_TOPOLOGY_PATTERN_FILE')
    // Path-fragment allowlists once exempted whole directories from the scan.
    expect(scanner).not.toMatch(/ALLOW_RE/)
  })

  it('supplies the private deny-list to CI only through a secret', () => {
    const workflow = read(ciWorkflowPath)
    const step = workflow.slice(workflow.indexOf('- name: Public topology scan'))
    expect(step.slice(0, 600)).toContain(
      'STREAMPULSE_PRIVATE_TOPOLOGY_PATTERN: ${{ secrets.STREAMPULSE_PRIVATE_TOPOLOGY_PATTERN }}',
    )
  })

  it('makes the pre-commit guard delegate to the scanner on staged content', () => {
    const guard = read(guardPath)
    expect(guard).toContain('scripts/ci-public-topology-scan.sh" --cached')
    expect(guard).not.toMatch(/PATTERN='/)
  })
})

function resolveBash(): string | null {
  if (process.platform !== 'win32') return 'bash'
  const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe'
  return existsSync(gitBash) ? gitBash : null
}

const bash = resolveBash()
const tempDirs: string[] = []

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

function tempRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'sp-topology-scan-'))
  tempDirs.push(dir)
  const git = (...args: string[]) => {
    const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
    if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  }
  git('init', '-q')
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content)
  git('add', '--', ...Object.keys(files))
  return dir
}

function scan(dir: string, args: string[] = [], env: Record<string, string> = {}) {
  const cleanEnv = { ...process.env }
  delete cleanEnv.STREAMPULSE_PRIVATE_TOPOLOGY_PATTERN
  delete cleanEnv.STREAMPULSE_PRIVATE_TOPOLOGY_PATTERN_FILE
  delete cleanEnv.GITHUB_ACTIONS
  const result = spawnSync(bash as string, [scannerPath, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...cleanEnv, ...env },
  })
  return { status: result.status, output: `${result.stdout}${result.stderr}` }
}

// Built at run time so this file never matches the scanner itself.
const syntheticKeyHeader = ['BEGIN', 'OPENSSH', 'PRIVATE', 'KEY'].join(' ')
const syntheticToken = () => `synthetic-${randomBytes(6).toString('hex')}`

describe.skipIf(!bash)('ci-public-topology-scan behavior', () => {
  it('passes a clean repository and states that only generic rules ran', () => {
    const result = scan(tempRepo({ 'readme.md': 'nothing sensitive\n' }))
    expect(result.status).toBe(0)
    expect(result.output).toContain('generic rules only')
  })

  it('fails on a generic leak shape without printing the matched line', () => {
    const result = scan(tempRepo({ 'leak.txt': `ok\n-----${syntheticKeyHeader}-----\n` }))
    expect(result.status).toBe(1)
    expect(result.output).toContain('topology-hit rule=generic file=leak.txt line=2')
    expect(result.output).not.toContain(syntheticKeyHeader)
  })

  it('applies an inline private deny-list without echoing it', () => {
    const token = syntheticToken()
    const dir = tempRepo({ 'notes.md': `host ${token}\n` })
    expect(scan(dir).status).toBe(0)
    const result = scan(dir, [], { STREAMPULSE_PRIVATE_TOPOLOGY_PATTERN: token })
    expect(result.status).toBe(1)
    expect(result.output).toContain('topology-hit rule=private file=notes.md line=1')
    expect(result.output).not.toContain(token)
  })

  it('applies a private deny-list file and fails closed when it is unreadable', () => {
    const token = syntheticToken()
    const dir = tempRepo({ 'notes.md': `a\nb ${token}\n` })
    const patternDir = mkdtempSync(join(tmpdir(), 'sp-topology-pattern-'))
    tempDirs.push(patternDir)
    const patternFile = join(patternDir, 'deny.txt')
    writeFileSync(patternFile, `# comment\n\nunrelated-${randomBytes(4).toString('hex')}\n${token}\n`)
    const hit = scan(dir, [], { STREAMPULSE_PRIVATE_TOPOLOGY_PATTERN_FILE: patternFile })
    expect(hit.status).toBe(1)
    expect(hit.output).toContain('topology-hit rule=private file=notes.md line=2')
    expect(hit.output).not.toContain(token)
    const missing = scan(dir, [], { STREAMPULSE_PRIVATE_TOPOLOGY_PATTERN_FILE: join(patternDir, 'absent.txt') })
    expect(missing.status).toBe(1)
    expect(missing.output).toContain('is not readable')
  })

  it('scans staged content in --cached mode', () => {
    const dir = tempRepo({ 'staged.txt': `-----${syntheticKeyHeader}-----\n` })
    writeFileSync(join(dir, 'staged.txt'), 'cleaned in the working tree only\n')
    expect(scan(dir).status).toBe(0)
    const cached = scan(dir, ['--cached'])
    expect(cached.status).toBe(1)
    expect(cached.output).toContain('topology-hit rule=generic file=staged.txt line=1')
  })

  it('rejects unknown arguments', () => {
    expect(scan(tempRepo({ 'a.txt': 'a\n' }), ['--everything']).status).toBe(2)
  })
})
