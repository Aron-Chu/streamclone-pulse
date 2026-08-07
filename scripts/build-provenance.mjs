import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, lstatSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { inspectPackageCohort } from './check-package-cohort.mjs'

const GIT_MAX_BUFFER = 8 * 1024 * 1024

function git(repoRoot, args) {
  try {
    return execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: GIT_MAX_BUFFER,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return ''
  }
}

function splitNul(value) {
  return value.split('\0').filter(Boolean).map((path) => path.replaceAll('\\', '/'))
}

function scopedGitPaths(repoRoot, command, scope) {
  const args = command === 'untracked'
    ? ['ls-files', '--others', '--exclude-standard', '-z']
    : ['diff', '--name-only', '-z', ...(command === 'cached' ? ['--cached'] : [])]
  if (scope?.length) args.push('--', ...scope)
  return splitNul(git(repoRoot, args))
}

function fileDigest(repoRoot, paths) {
  const hash = createHash('sha256')
  for (const path of [...new Set(paths)].sort()) {
    hash.update(path)
    hash.update('\0')
    const absolutePath = resolve(repoRoot, path)
    if (!existsSync(absolutePath)) {
      hash.update('<deleted>')
      hash.update('\0')
      continue
    }
    try {
      const stat = lstatSync(absolutePath)
      if (!stat.isFile()) {
        hash.update(`<non-file:${stat.mode}>`)
      } else {
        hash.update(readFileSync(absolutePath))
      }
    } catch {
      hash.update('<unreadable>')
    }
    hash.update('\0')
  }
  return hash.digest('hex')
}

/**
 * Build metadata deliberately contains no environment values, hostnames, or
 * filesystem paths. The fingerprint includes only the selected input scope,
 * the current commit, and the content of changed files in that scope.
 */
export function getBuildProvenance({ repoRoot, repository, mode = 'source', scope = [] }) {
  const commit = git(repoRoot, ['rev-parse', 'HEAD']).trim() || 'unknown'
  const changedPaths = [
    ...scopedGitPaths(repoRoot, 'worktree', scope),
    ...scopedGitPaths(repoRoot, 'cached', scope),
    ...scopedGitPaths(repoRoot, 'untracked', scope),
  ]
  const dirtyTreeHash = changedPaths.length ? fileDigest(repoRoot, changedPaths) : 'clean'
  const sourceFingerprint = createHash('sha256')
    .update(commit)
    .update('\0')
    .update(dirtyTreeHash)
    .digest('hex')
  const dirty = dirtyTreeHash !== 'clean'
  const shortCommit = commit === 'unknown' ? commit : commit.slice(0, 12)
  const packageCohort = inspectPackageCohort({ repoRoot })
  if (!packageCohort.ok) {
    throw new Error(`package cohort is invalid: ${packageCohort.errors.join('; ')}`)
  }
  const packageCohortFingerprint = createHash('sha256')
    .update(JSON.stringify({
      source: packageCohort.source,
      dependencies: packageCohort.dependencies,
    }))
    .digest('hex')

  return {
    repository,
    commit,
    dirty,
    dirtyTreeHash,
    sourceFingerprint,
    packageCohortFingerprint,
    packageCohort: {
      mode: packageCohort.mode,
      source: packageCohort.source,
      dependencies: packageCohort.dependencies,
    },
    inputScope: scope,
    mode,
    buildId: `${repository}@${shortCommit}${dirty ? '-dirty' : ''}`,
    builtAt: new Date().toISOString(),
  }
}

export function writeBuildProvenance(distRoot, metadata) {
  const destination = resolve(distRoot, 'build-meta.json')
  mkdirSync(dirname(destination), { recursive: true })
  writeFileSync(destination, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')
}

export function readBuildProvenance(distRoot) {
  const source = resolve(distRoot, 'build-meta.json')
  if (!existsSync(source)) return null
  try {
    return JSON.parse(readFileSync(source, 'utf8'))
  } catch {
    return null
  }
}
