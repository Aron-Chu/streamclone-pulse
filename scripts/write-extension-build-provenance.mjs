import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = process.cwd()
const dist = join(root, 'dist')
const outDir = join(root, '.artifacts')
const outPath = join(outDir, 'extension-build-provenance.json')
const targetPath = join(dist, 'extension-target.json')
export const buildInputs = [
  'src',
  'public',
  'manifest.json',
  'manifests',
  'packages',
  'tsconfig.json',
  'vite.config.ts',
  'vite.shared.ts',
  'vite.content.config.ts',
  'package.json',
  'package-lock.json',
  'scripts/ensure-packages-built.mjs',
  'scripts/extension-target.mjs',
  'scripts/package-extension-target.mjs',
  'scripts/zip-dist.mjs',
  'scripts/stage-extension-attribution.mjs',
  'scripts/archive-byte-scan.mjs',
  'scripts/validate-extension-package.mjs',
  'scripts/extension-package-lib.mjs',
  'scripts/lib/release-notes-gate.mjs',
  'scripts/extension-permission-allowlists.mjs',
  'scripts/remote-code-scan.mjs',
  'scripts/zip-byte-validate.mjs',
  'scripts/write-extension-build-provenance.mjs',
]

export function buildInputState(inputRoot = root) {
  const status = spawnSync('git', ['status', '--porcelain=v1', '--untracked-files=all', '--', ...buildInputs], {
    cwd: inputRoot,
    encoding: 'utf8',
  })
  if (status.status !== 0) {
    throw new Error(`could not inspect build inputs: ${status.stderr || status.stdout}`)
  }
  const text = status.stdout.trim()
  const digest = createHash('sha256')
  digest.update(text)
  digest.update('\0')

  const inputFiles = spawnSync('git', [
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
    '--',
    ...buildInputs,
  ], {
    cwd: inputRoot,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
  if (inputFiles.status !== 0) {
    throw new Error(`could not enumerate build inputs: ${inputFiles.stderr || inputFiles.stdout}`)
  }
  for (const relativePath of inputFiles.stdout.split(/\r?\n/).filter(Boolean).sort()) {
    digest.update(relativePath)
    digest.update('\0')
    try {
      digest.update(readFileSync(join(inputRoot, relativePath)))
    } catch {
      // A file may disappear between discovery and the read; the git state
      // remains captured above for this provenance record.
    }
    digest.update('\0')
  }
  return {
    dirty: Boolean(text),
    summary: text,
    digest: digest.digest('hex'),
  }
}

function builtExtensionId(inputState, packageBuildCommit) {
  try {
    const target = JSON.parse(readFileSync(targetPath, 'utf8'))
    if (typeof target.buildId === 'string' && target.buildId.length > 0) return target.buildId
  } catch {
    // Keep the provenance script useful if invoked outside the normal Vite
    // build sequence; the fallback below still records the commit and inputs.
  }
  return `dev-${packageBuildCommit.slice(0, 12)}-${inputState.dirty ? `dirty-${inputState.digest.slice(0, 8)}` : 'clean'}`
}

function gitHead() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`could not resolve build commit: ${result.stderr || result.stdout}`)
  }
  const commit = result.stdout.trim()
  if (!/^[0-9a-f]{40}$/i.test(commit)) throw new Error(`invalid build commit: ${commit}`)
  return commit.toLowerCase()
}

function distFiles(dir = dist) {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap(entry => {
      const fullPath = join(dir, entry.name)
      return entry.isDirectory() ? distFiles(fullPath) : [fullPath]
    })
    .sort()
}

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

function writeProvenance() {
  const inputState = buildInputState()
  const packageBuildCommit = gitHead()
  const files = Object.fromEntries(
    distFiles().map(filePath => [relative(dist, filePath).replaceAll('\\', '/'), sha256(filePath)]),
  )

  mkdirSync(outDir, { recursive: true })
  writeFileSync(
    outPath,
    `${JSON.stringify(
      {
        schema: 'streampulse.extension-build-provenance/v1',
        kind: 'local-dist-build',
        packageBuildCommit,
        buildId: builtExtensionId(inputState, packageBuildCommit),
        worktreeState: inputState.dirty ? 'dirty' : 'clean',
        inputStatusDigest: inputState.digest,
        files,
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
  console.log(`Wrote local dist build provenance for ${packageBuildCommit} (${inputState.dirty ? 'dirty' : 'clean'} inputs)`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  writeProvenance()
}
