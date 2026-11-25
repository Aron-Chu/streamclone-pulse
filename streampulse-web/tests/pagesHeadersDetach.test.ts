/**
 * Cloudflare Pages joins every matching rule's headers: a value set on `/*` is added to the same header set by a
 * narrower rule, comma-separated. `/*` sends `Cache-Control: public, max-age=0, must-revalidate`, so without a
 * detach `/assets/*` went out as `public, max-age=0, must-revalidate, public, max-age=31536000, immutable` and
 * browsers revalidated every hashed file on each visit. Each narrower rule that sets a header `/*` also sets
 * detaches it first with `! Header`.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

type Rule = { path: string; lines: string[] }

function rules(): Rule[] {
  const text = readFileSync(resolve(__dirname, '..', 'public/_headers'), 'utf8')
  const out: Rule[] = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    if (!/^\s/.test(line)) out.push({ path: line.trim(), lines: [] })
    else out.at(-1)?.lines.push(line.trim())
  }
  return out
}

const headerName = (line: string) => line.split(':')[0].trim().toLowerCase()

describe('public/_headers', () => {
  const all = rules()
  const root = all.find(rule => rule.path === '/*')
  const rootNames = new Set((root?.lines ?? []).filter(line => !line.startsWith('!')).map(headerName))

  it('has the site-wide rule with its no-cache default', () => {
    expect(root).toBeTruthy()
    expect(root!.lines).toContain('Cache-Control: public, max-age=0, must-revalidate')
  })

  for (const rule of all.filter(r => r !== root)) {
    for (const line of rule.lines.filter(l => !l.startsWith('!'))) {
      const name = headerName(line)
      if (!rootNames.has(name)) continue
      it(`${rule.path} detaches the site-wide ${name} before setting its own`, () => {
        const at = rule.lines.indexOf(line)
        const detach = rule.lines.findIndex(l => l.startsWith('!') && l.slice(1).trim().toLowerCase() === name)
        expect(detach, `"! ${name}" in ${rule.path}`).toBeGreaterThanOrEqual(0)
        expect(detach).toBeLessThan(at)
      })
    }
  }

  it('keeps hashed files cacheable for a year', () => {
    for (const path of ['/assets/*', '/static/*']) {
      expect(all.find(rule => rule.path === path)?.lines).toContain('Cache-Control: public, max-age=31536000, immutable')
    }
  })
})
