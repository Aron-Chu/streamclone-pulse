import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const roots = [
  'src/ui/components/analytics',
  'src/ui/components/hub',
  'src/ui/components/newsroom',
  'src/ui/themes',
]

describe('analytics secondary typography floor', () => {
  it('contains no explicit production CSS font size below 12px', async () => {
    const { readdirSync, statSync } = await import('node:fs')
    const files: string[] = []
    const visit = (path: string) => {
      for (const name of readdirSync(path)) {
        if (name === '__mockups__') continue
        const child = resolve(path, name)
        if (statSync(child).isDirectory()) visit(child)
        else if (name.endsWith('.css')) files.push(child)
      }
    }
    roots.forEach((root) => visit(resolve(process.cwd(), root)))
    files.push(resolve(process.cwd(), 'src/ui/analytics-tailwind.css'))
    const offenders: string[] = []
    for (const file of files) {
      const css = readFileSync(file, 'utf8')
      for (const match of css.matchAll(/font-size:\s*(\d*\.?\d+)(px|rem)/g)) {
        const px = Number(match[1]) * (match[2] === 'rem' ? 16 : 1)
        if (px < 12) offenders.push(`${file}:${match[0]}`)
      }
      for (const match of css.matchAll(/--sp-type-(?:label|meta):\s*(\d*\.?\d+)(px|rem)/g)) {
        const px = Number(match[1]) * (match[2] === 'rem' ? 16 : 1)
        if (px < 12) offenders.push(`${file}:${match[0]}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
