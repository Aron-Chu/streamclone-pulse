import { readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// These files are under a separate active edit owner and are checked by that
// workstream. Keep this list narrow rather than weakening the pattern globally.
const delegatedFiles = new Set(['AnalyticsConsole.tsx', 'PastBroadcastBanner.tsx'])

// A decorative exception must be an exact repo-relative path plus a reason.
// There are currently no exceptions: avatar/emote fallbacks still convey text.
const decorativeExceptions = new Map<string, string>()

function componentFiles(root: string): string[] {
  const files: string[] = []
  const visit = (directory: string) => {
    for (const name of readdirSync(directory)) {
      const path = resolve(directory, name)
      if (statSync(path).isDirectory()) visit(path)
      else if (name.endsWith('.tsx') && !name.endsWith('.test.tsx') && !delegatedFiles.has(name)) files.push(path)
    }
  }
  visit(root)
  return files
}

describe('analytics console component typography floor', () => {
  it('has no active component text utility or inline font size below 12px', () => {
    const root = resolve(process.cwd(), 'src/components')
    const offenders: string[] = []
    const files = [
      ...componentFiles(root),
      resolve(process.cwd(), 'src/components/analytics/emoteTableLayout.ts'),
      resolve(process.cwd(), 'src/utils/momentListDisplay.tsx'),
    ]
    for (const file of files) {
      const relative = file.slice(process.cwd().length + 1).replaceAll('\\', '/')
      if (decorativeExceptions.has(relative)) continue
      const source = readFileSync(file, 'utf8')
      if (/text-\[(?:[0-9]|1[01])px\]/.test(source)) offenders.push(relative)
      if (/fontSize\s*[:=]\s*(?:\{\s*)?(?:[0-9]|1[01])(?:\.\d+)?(?!\d)(?:\s*\})?/.test(source)) offenders.push(relative)
      if (/fontSize\s*:\s*['"]0\.(?:[0-6][0-9]*|7[0-4])rem['"]/.test(source)) offenders.push(relative)
    }
    expect(offenders).toEqual([])
  })
})
