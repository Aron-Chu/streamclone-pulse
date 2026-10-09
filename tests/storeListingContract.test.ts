import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import perks from '../src/shared/supporter-perks.json'

/**
 * The Chrome Web Store listing copy in the repo matches the 0.2.2 store
 * package: every requested host is justified, the Supporter sentence names the
 * one perk list, and the Support URL is the site's support page.
 */
const listing = readFileSync('docs/pulse-extension/chrome-web-store-listing.md', 'utf8')
const readme = readFileSync('store/cws/README.md', 'utf8')
const manifest = JSON.parse(readFileSync('manifests/cws.json', 'utf8')) as { version: string; permissions: string[]; host_permissions: string[] }
const screenshots = JSON.parse(readFileSync('store/cws/screenshots/manifest.json', 'utf8')) as { files: string[]; dims: { width: number; height: number } }
const section = (heading: string) => {
  const start = listing.indexOf(heading)
  expect(start, heading).toBeGreaterThan(-1)
  const next = listing.indexOf('\n## ', start + heading.length)
  return listing.slice(start, next === -1 ? undefined : next)
}

describe('Chrome Web Store listing copy (0.2.2)', () => {
  it('justifies every permission and host the store manifest requests, and nothing more', () => {
    const justifications = section('## Permission justifications (0.2.2 store package)')
    for (const permission of manifest.permissions) expect(justifications).toContain(`### ${permission}`)
    for (const host of manifest.host_permissions) expect(justifications).toContain(host)
    expect(justifications).not.toMatch(/localhost|127\.0\.0\.1/)
    expect(manifest.permissions).toEqual(['storage', 'scripting'])
  })

  it('names the Supporter perks from the one perk list, in order, and says sign-ups are not open', () => {
    const description = section('### Detailed description')
    const at = perks.names.map(name => description.toLowerCase().indexOf(name.toLowerCase()))
    expect(at.every(index => index > -1)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
    expect(description).toContain('they are not open yet')
    expect(description).toContain('the 7TV header backdrop')
  })

  it('describes no account, Protect enrollment or sign-in this build does not offer', () => {
    const fields = section('## Next store candidate: 0.2.2 listing fields') + section('## Permission justifications (0.2.2 store package)')
    expect(fields).not.toMatch(/Protect|beta access key|Twitch OAuth|Email address for optional sign-in|free Pulse account/i)
  })

  it('points Support at the site support page and keeps the live listing category', () => {
    expect(listing).toContain('| Support URL | `https://streampulse.stream/support` |')
    expect(readme).toContain('**Support URL:** https://streampulse.stream/support')
    expect(section('### Category')).toContain('`Entertainment`')
  })

  it('lists the regenerated 1280×800 screenshot set the README describes', () => {
    expect(screenshots.dims).toEqual({ width: 1280, height: 800 })
    for (const file of screenshots.files) {
      expect(readme).toContain(`screenshots/${file}`)
      const png = readFileSync(`store/cws/screenshots/${file}`)
      expect(png.readUInt32BE(16)).toBe(1280)
      expect(png.readUInt32BE(20)).toBe(800)
    }
  })
})
