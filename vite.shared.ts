import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolveExtensionTarget } from './scripts/extension-target.mjs'
import { loadExtensionReleasePreview } from './scripts/release-preview.ts'

const root = fileURLToPath(new URL('.', import.meta.url))

export const extensionReleasePreview = loadExtensionReleasePreview(
  resolve(root, 'src/shared/release-notes.json'),
)

export const extensionTarget = resolveExtensionTarget()
export const isStoreBuild =
  extensionTarget === 'cws' || extensionTarget === 'edge' || extensionTarget === 'firefox'

function gitOutput(args: string[]): string {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}

function worktreeDigest(): string {
  const hash = createHash('sha256')
  const status = gitOutput(['status', '--porcelain=v1', '--untracked-files=all', '--'])
  const diff = gitOutput(['diff', '--no-ext-diff', '--binary', 'HEAD', '--'])
  hash.update(status)
  hash.update('\0')
  hash.update(diff)
  hash.update('\0')

  // Status only identifies an untracked path, not later edits to that file.
  // Include untracked contents so a local build can never silently retain an
  // old runtime identity while chart support files change in place.
  const untracked = gitOutput(['ls-files', '--others', '--exclude-standard', '--'])
    .split(/\r?\n/)
    .filter(Boolean)
    .sort()
  for (const relativePath of untracked) {
    hash.update(relativePath)
    hash.update('\0')
    try {
      hash.update(readFileSync(resolve(root, relativePath)))
    } catch {
      // A file can disappear between git discovery and the read. The status
      // and diff still remain part of the identity for that build.
    }
    hash.update('\0')
  }
  return hash.digest('hex').slice(0, 8)
}

/**
 * Every local bundle carries a worktree-sensitive identity. The semantic
 * manifest version is intentionally not used here because several unpacked
 * validation builds can share it while containing different source.
 */
export const extensionBuildId = (() => {
  const explicit = process.env.STREAMPULSE_BUILD_ID?.trim()
  if (explicit) return explicit
  const commit = gitOutput(['rev-parse', '--short=12', 'HEAD']) || 'nogit'
  const status = gitOutput(['status', '--porcelain=v1', '--untracked-files=all', '--'])
  const state = status ? `dirty-${worktreeDigest()}` : 'clean'
  return `dev-${commit}-${state}`
})()

/** One React instance for overlay + @streampulse/pulse-charts (nested package react breaks hooks). */
export function extensionResolve() {
  return {
    dedupe: ['react', 'react-dom'],
    alias: {
      react: resolve(root, 'node_modules/react'),
      'react-dom': resolve(root, 'node_modules/react-dom'),
      // In-repo RPR-6 packages (src exports for Vite DX).
      // pulse-charts resolves to a curated extension surface so portal-only
      // chart machinery is never bundled into the content script.
      '@streampulse/pulse-core': resolve(root, 'packages/pulse-core/src/index.ts'),
      '@streampulse/pulse-charts': resolve(root, 'packages/pulse-charts/src/extension.ts'),
    },
  }
}

export const sharedOutput = {
  entryFileNames: '[name].js',
  chunkFileNames: 'chunks/[name].js',
  assetFileNames: 'assets/[name][extname]',
}
