import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const webRoot = join(__dirname, '..')

/**
 * The Discord invite is a build-time input (VITE_PUBLIC_DISCORD_INVITE_URL).
 * A literal invite in shipped source would bypass the gate that hides every
 * Discord link until a real one is configured, and would leak or freeze a code.
 */
const INVITE_LITERAL = /discord(?:app)?\.gg\/|discord(?:app)?\.com\/invite\//i

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}

describe('Discord invite literals', () => {
  it('appear nowhere in shipped website source', () => {
    const scanned = [...files(join(webRoot, 'src')), ...files(join(webRoot, 'public')), join(webRoot, 'index.html')]
      .filter(path => /\.(?:[cm]?[jt]sx?|css|html|json|txt|xml|md|svg|webmanifest)$|_redirects$|_headers$/.test(path))
    expect(scanned.length).toBeGreaterThan(50)
    const offenders = scanned
      .filter(path => INVITE_LITERAL.test(readFileSync(path, 'utf8')))
      .map(path => relative(webRoot, path).split('\\').join('/'))
    expect(offenders).toEqual([])
  })

  it('the pattern catches both invite forms', () => {
    for (const literal of ['https://discord.gg/sp-fake', 'discord.com/invite/sp-fake', 'https://DISCORDAPP.com/invite/x']) {
      expect(INVITE_LITERAL.test(literal)).toBe(true)
    }
    expect(INVITE_LITERAL.test("hostname === 'discord.gg'")).toBe(false)
  })
})
