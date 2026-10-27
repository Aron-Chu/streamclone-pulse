import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import releaseNotes from '../../src/shared/release-notes.json'
import { AppRoutes, preloadOpeningPage } from '../src/routes/index'
import { resolvePageMetadata } from '../src/lib/pageMetadata'
import { prerenderPublicPage } from '../src/prerender'

interface ReleaseFixture {
  version: string
  status: string
  title: string
  summary: string
  preview?: string[]
  new?: string[]
  changed?: string[]
  improved?: string[]
  fixed?: string[]
  knownIssues?: string[]
  links?: { details?: string }
}

/** The page's note headings, in its order (the extension's changelog card uses the same). */
const CATEGORY_HEADINGS = [['new', 'New'], ['changed', 'Changed'], ['improved', 'Improved'], ['fixed', 'Fixed'], ['knownIssues', 'Known limitations']] as const
/** Groups that stay open; the rest fold to their count. */
const OPEN_GROUPS = ['changed', 'knownIssues']

const { releases } = releaseNotes as { releases: ReleaseFixture[] }
const webRoot = resolve(import.meta.dirname, '..')
const read = (path: string) => readFileSync(resolve(webRoot, path), 'utf8')

afterEach(cleanup)
// Public pages load on demand; load this one first, as main.tsx does for the page a visit opens on.
beforeAll(() => preloadOpeningPage('/changelog'))

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

  it('describes only released versions and starts with the latest release', () => {
    render(<MemoryRouter initialEntries={['/changelog']}><AppRoutes /></MemoryRouter>)
    expect(screen.getByRole('heading', { level: 1, name: 'Release notes' })).toBeTruthy()
    const released = releases.filter((release) => release.status === 'released')
    expect(released.length).toBeGreaterThan(0)
    // The latest release leads with its highlights; older ones say when they were released.
    const latest = (released[0].preview?.length ?? 0) > 0 ? released[0] : null
    for (const release of releases) {
      const section = document.getElementById(`v${release.version}`)
      if (release.status === 'released') {
        const scoped = within(section!)
        expect(scoped.getByRole('heading', { level: 2, name: release.title })).toBeTruthy()
        expect(scoped.getByText(release.summary)).toBeTruthy()
        expect(section!.textContent).toContain(release === latest ? `What’s new in v${release.version}` : `v${release.version} · Released`)
      } else {
        // Unreleased entries, the version in development included, get no section.
        expect(section).toBeNull()
        expect(document.body.textContent).not.toContain(release.summary)
      }
    }
    expect(document.body.textContent).not.toContain('Preview')
    // Read from the notes, so a release step that marks a version released changes no test:
    // each released version lists its own notes, under the headings they fill, each
    // group showing its count; Changed and Known limitations open, the rest folded.
    for (const release of released) {
      const section = document.getElementById(`v${release.version}`)!
      const filled = CATEGORY_HEADINGS.filter(([key]) => (release[key]?.length ?? 0) > 0)
      expect(within(section).queryAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(filled.map(([, label]) => label))
      const groups = [...section.querySelectorAll('details')]
      expect(groups.map((group) => group.dataset.category)).toEqual(filled.map(([key]) => key))
      for (const [index, [key]] of filled.entries()) {
        expect(groups[index].open).toBe(OPEN_GROUPS.includes(key))
        expect(groups[index].querySelector('summary')!.textContent).toContain(String(release[key]!.length))
      }
      expect([...section.querySelectorAll('details li')].map((item) => item.textContent)).toEqual(filled.flatMap(([key]) => release[key] ?? []))
    }
    // The latest release's card shows its title and up to three highlights, then links to all changes.
    if (latest) {
      const card = screen.getByTestId('changelog-whats-new')
      expect(document.getElementById(`v${latest.version}`)!.contains(card)).toBe(true)
      expect(within(card).getByRole('heading', { level: 2, name: latest.title })).toBeTruthy()
      expect([...card.querySelectorAll('li')].map((item) => item.textContent)).toEqual(latest.preview!.slice(0, 3))
      expect(within(card).getByRole('link', { name: 'See all changes ↓' }).getAttribute('href')).toBe(`#v${latest.version}-changes`)
      expect(document.getElementById(`v${latest.version}-changes`)?.textContent).toBe('All changes')
    }
    expect(screen.queryAllByTestId('changelog-whats-new').length).toBe(latest ? 1 : 0)
    // One rule under the header: the header draws none, each version's section draws the one above it.
    const page = screen.getByTestId('changelog-page')
    expect(page.querySelector('header')!.className).not.toMatch(/\bborder-b\b/)
    for (const section of page.querySelectorAll('section')) expect(section.className).toMatch(/\bborder-t\b/)
    // No "Next version" placeholder: the first section is the first released entry.
    expect(document.body.textContent).not.toContain('In development')
    expect(document.body.textContent).not.toContain('Next version')
    const firstSection = screen.getByTestId('changelog-page').querySelector('section')
    expect(firstSection?.id).toBe(`v${released[0].version}`)
    expect(screen.getByRole('link', { name: 'StreamPulse Support' }).getAttribute('href')).toBe('/support')
    // The page itself makes no claim about which build the Chrome Web Store lists, and
    // does not say Chrome-only: the extension is also built for Edge and Firefox.
    expect(screen.getByText('What changed in each version of the StreamPulse extension.')).toBeTruthy()
    expect(document.body.textContent).not.toContain('Chrome extension')
    expect(document.body.textContent).not.toContain('not on the Chrome Web Store yet')
    // Nor do the released notes it shows: the Store's current version is not recorded in them.
    expect(document.body.textContent).not.toMatch(/currently (listed|on the Chrome Web Store)/i)
  })

  it('is a prerendered page kept out of search, so a cold load is served without edge rewrites', () => {
    expect(resolvePageMetadata('/changelog')).toEqual({
      title: 'Release Notes — StreamPulse',
      description: 'What changed in each version of the StreamPulse extension.',
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
