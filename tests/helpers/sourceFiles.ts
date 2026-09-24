import { readdirSync, statSync } from 'node:fs'
import { join, posix, sep } from 'node:path'

const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', '.git', 'test-results', 'playwright-report'])

/**
 * Recursively list extension source files.
 *
 * Deliberately walks the filesystem rather than shelling out to `git ls-files`:
 * on Windows `execSync` runs through cmd.exe, where a quoted pathspec such as
 * `'src/**' + '/*.ts'` keeps its literal quotes and matches nothing. A lint-style
 * test that silently scans zero files passes for the wrong reason, so this must
 * not depend on shell quoting or on whether a file is tracked yet.
 */
export function listSourceFiles(root = 'src', extensions = ['.ts', '.tsx']): string[] {
  const found: string[] = []
  function walk(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || SKIP_DIRECTORIES.has(entry.name)) continue
      const full = join(directory, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!extensions.some(extension => entry.name.endsWith(extension))) continue
      if (entry.name.includes('.test.')) continue
      found.push(full.split(sep).join(posix.sep))
    }
  }
  if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) return found
  walk(root)
  return found.sort()
}
