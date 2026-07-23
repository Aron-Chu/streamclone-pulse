import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const dist = join(root, 'dist')
const outDir = join(root, '.artifacts')
const outPath = join(outDir, 'extension-build-provenance.json')

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

const packageBuildCommit = gitHead()
const files = Object.fromEntries(
  distFiles().map(filePath => [relative(dist, filePath).replaceAll('\\', '/'), sha256(filePath)]),
)

mkdirSync(outDir, { recursive: true })
writeFileSync(
  outPath,
  `${JSON.stringify({ packageBuildCommit, files }, null, 2)}\n`,
  'utf8',
)
console.log(`Wrote build provenance for ${packageBuildCommit}`)
