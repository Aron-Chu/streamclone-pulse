import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('overlay mount styles', () => {
  it('does not let the shell entrance animation overwrite floating placement transforms', () => {
    const source = readFileSync('src/content/mount.tsx', 'utf8')
    const shellBlock = source.match(/\.pulse-shell\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? ''

    expect(shellBlock).toContain('animation: pulse-shell-in')
    expect(shellBlock).toContain('overflow: hidden')
    expect(shellBlock).not.toContain('overflow: auto')
    expect(shellBlock).not.toContain('animation: pulse-in')
    expect(source).toMatch(/@keyframes pulse-shell-in\s*\{\s*from \{ opacity: 0; \}\s*to \{ opacity: 1; \}/)
  })
})
