import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { listSourceFiles } from './helpers/sourceFiles.ts'

/**
 * Per-surface type floors from `docs/pulse-extension/ui-design-guide.md` §7.
 *
 * The overlay is allowed 9px for uppercase caps and chart axis labels because it
 * renders in a ~320px rail beside Twitch chat. A real top-level page has no such
 * excuse, so the options surfaces hold 12px. Nothing anywhere may use 8px.
 */
const ABSOLUTE_FLOOR = 9
const PAGE_FLOOR = 12
const PAGE_PREFIXES = ['src/options/']

function trackedSourceFiles(): string[] {
  return listSourceFiles()
}

interface Violation {
  file: string
  line: number
  size: number
  floor: number
  text: string
}

function findViolations(): Violation[] {
  const violations: Violation[] = []
  for (const file of trackedSourceFiles()) {
    const floor = PAGE_PREFIXES.some(prefix => file.startsWith(prefix)) ? PAGE_FLOOR : ABSOLUTE_FLOOR
    readFileSync(file, 'utf8').split('\n').forEach((text, index) => {
      const matches = [
        ...text.matchAll(/fontSize:\s*(\d+(?:\.\d+)?)\b/g),
        ...text.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g),
      ]
      for (const match of matches) {
        const size = Number(match[1])
        if (size < floor) violations.push({ file, line: index + 1, size, floor, text: text.trim() })
      }
    })
  }
  return violations
}

describe('typography floor', () => {
  it('keeps every declared size at or above its surface floor', () => {
    const violations = findViolations()
    const report = violations
      .map(v => `${v.file}:${v.line} uses ${v.size}px (floor ${v.floor}px) — ${v.text.slice(0, 80)}`)
      .join('\n')
    expect(violations, `\n${report}`).toEqual([])
  })

  it('scans a meaningful number of files', () => {
    expect(trackedSourceFiles().length).toBeGreaterThan(50)
  })
})
