import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import releaseNotes from '../../src/shared/release-notes.json'
import { AppRoutes } from '../src/routes/index'
import { resolvePageMetadata } from '../src/lib/pageMetadata'
import { prerenderPublicPage } from '../src/prerender'

interface ReleaseFixture {
  version: string
  status: string
  title: string
  summary: string
  new?: string[]
  changed?: string[]
  improved?: string[]
  fixed?: string[]
  knownIssues?: string[]
  links?: { details?: string }
}

/** The page's note headings, in its order. */
const CATEGORY_HEADINGS = [['new', 'New'], ['changed', 'Changed'], ['improved', 'Improved'], ['fixed', 'Fixed'], ['knownIssues', 'Known limitations']] as const

const { currentVersion, releases } = releaseNotes as { currentVersion: string; releases: ReleaseFixture[] }
const webRoot = resolve(import.meta.dirname, '..')
const read = (path: string) => readFileSync(resolve(webRoot, path), 'utf8')

afterEach(cleanup)

describe('extension "Release details" destination (OP1-FUN-003)', () => {
  it('resolves every published details link to the release notes page, not the 404', () => {
    const details = [...new Set(releases.map((release) => release.links?.details).filter(Boolean))] as string[]
    expect(details).toEqual(['/changelog'])
    for (const path of details) {
      render(<MemoryRouter initialEntries={[path]}><AppRoutes /></MemoryRouter>)
      expect(screen.getByTestId('changelog-page')).toBeTruthy()
      expect(screen.queryByTestId('not-found')).toBeNull()
      cleanup()
    }
  })

  it('describes only released versions and labels the version in development honestly', () => {
    render(<MemoryRouter initialEntries={['/changelog']}><AppRoutes /></MemoryRouter>)
    expect(screen.getByRole('heading', { level: 1, name: 'Release notes' })).toBeTruthy()
    const released = releases.filter((release) => release.status === 'released')
    expect(released.length).toBeGreaterThan(0)
    for (const release of releases) {
      const section = document.getElementById(`v${release.version}`)
      if (release.status === 'released') {
        const scoped = within(section!)
        expect(scoped.getByRole('heading', { level: 2, name: release.title })).toBeTruthy()
        expect(scoped.getByText(release.summary)).toBeTruthy()
        expect(section!.textContent).toContain(`v${release.version} · Released`)
      } else if (release.version === currentVersion) {
        // Named, never described: its notes can change before it ships.
        expect(section!.textContent).toContain(`v${release.version} · In development`)
        expect(section!.textContent).toContain('has not been released yet')
        expect(document.body.textContent).not.toContain(release.summary)
      } else {
        expect(section).toBeNull()
        expect(document.body.textContent).not.toContain(release.summary)
      }
    }
    expect(document.body.textContent).not.toContain('Preview')
    // Read from the notes, so a release step that marks a version released changes no test:
    // each released version lists its own notes, under the headings they fill.
    for (const release of released) {
      const section = document.getElementById(`v${release.version}`)!
      const filled = CATEGORY_HEADINGS.filter(([key]) => (release[key]?.length ?? 0) > 0)
      expect(within(section).queryAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(filled.map(([, label]) => label))
      expect([...section.querySelectorAll('li')].map((item) => item.textContent)).toEqual(filled.flatMap(([key]) => release[key] ?? []))
    }
    // The in-development label shows only while the current version is not released.
    const inDevelopment = released.some((release) => release.version === currentVersion) ? null : currentVersion
    if (inDevelopment) expect(document.getElementById(`v${inDevelopment}`)?.textContent).toContain(`v${inDevelopment} · In development`)
    else expect(document.body.textContent).not.toContain('In development')
    expect(screen.getByRole('link', { name: 'StreamPulse Support' }).getAttribute('href')).toBe('/support')
    // The page itself makes no claim about which build the Chrome Web Store lists.
    expect(screen.getByText('What changed in each version of the StreamPulse Chrome extension.')).toBeTruthy()
    expect(document.body.textContent).not.toContain('not on the Chrome Web Store yet')
    // Nor do the released notes it shows: the Store's current version is not recorded in them.
    expect(document.body.textContent).not.toMatch(/currently (listed|on the Chrome Web Store)/i)
  })

  it('is a prerendered page kept out of search, so a cold load is served without edge rewrites', () => {
    expect(resolvePageMetadata('/changelog')).toEqual({
      title: 'Release Notes — StreamPulse',
      description: 'What changed in each version of the StreamPulse Chrome extension.',
      canonicalPath: '/changelog',
      robots: 'noindex,nofollow',
    })
    const html = prerenderPublicPage('/changelog')
    expect(html).toContain('data-testid="changelog-page"')
    expect(html).not.toContain('Page not found')

    expect(read('scripts/prerender.mjs')).toMatch(/path: 'changelog',\s+title: 'Release Notes — StreamPulse',/)
    expect(read('scripts/check-public-pages.mjs')).toContain("['changelog/index.html', 'Release Notes — StreamPulse', 'noindex,nofollow', 'https://streampulse.stream/changelog']")
    expect(read('scripts/check-public-links.mjs')).toMatch(/EXTERNALLY_PUBLISHED = \[[^\]]*'\/changelog'/)
    // It documents the extension rather than the site, so it is not offered to search engines.
    expect(read('scripts/prerender.mjs')).toMatch(/canonicalPath: '\/changelog',\s+robots: 'noindex,nofollow',/)
    expect(read('public/sitemap.xml')).not.toContain('/changelog')
  })
})
