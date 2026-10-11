import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import releaseNotes from '../src/shared/release-notes.json'
import { ChangelogCard } from '../src/ui/ChangelogCard.tsx'

/**
 * Updates & Changelog links. "Release details" exists only for a version the
 * store published, and it opens that version's own entry on the site's
 * changelog (the site anchors each release as #v0.2.1, #v0.2.0 and so on).
 */
describe('release notes links', () => {
  const html = renderToStaticMarkup(<ChangelogCard variant="history" />)
  const hrefs = [...html.matchAll(/<a href="([^"]+)"[^>]*>Release details/g)].map(match => match[1])

  it('offers Release details only for released versions, each deep-linked to its own entry', () => {
    const released = releaseNotes.releases.filter(release => release.status === 'released' && release.links?.details)
    expect(released.length).toBeGreaterThan(0)
    expect(hrefs).toEqual(released.map(release => `https://streampulse.stream${release.links!.details}#v${release.version}`))
    for (const release of releaseNotes.releases.filter(release => release.status !== 'released')) {
      expect(hrefs.some(href => href.endsWith(`#v${release.version}`)), `${release.version} is not published`).toBe(false)
    }
  })

  it('links only to pages the website in this repo serves', () => {
    const web = (path: string) => readFileSync(`streampulse-web/${path}`, 'utf8')
    const prerendered = new Set([...web('scripts/prerender.mjs').matchAll(/^\s*path: '([^']*)',/gm)].map(match => `/${match[1]}`))
    const rewritten = new Set(web('public/_redirects').split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#')).map(line => line.split(/\s+/)[0]))
    const linked = new Set(releaseNotes.releases.flatMap(release => [release.links?.details, release.links?.support]).filter((path): path is string => Boolean(path)))
    expect(linked).toContain('/changelog')
    expect(linked).toContain('/support')
    const missing = [...linked].filter(path => !prerendered.has(path) && !rewritten.has(path))
    expect(missing, 'streampulse-web does not serve these release-notes links').toEqual([])
  })

  it('the site changelog anchors each release as #v<version>', () => {
    const changelog = readFileSync('streampulse-web/src/routes/public/Changelog.tsx', 'utf8')
    expect(changelog).toContain('id={`v${release.version}`}')
  })
})
