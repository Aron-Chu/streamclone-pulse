// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import releaseNotes from '../src/shared/release-notes.json'
import { ChangelogCard, WhatsNewCard } from '../src/ui/ChangelogCard.tsx'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * Updates & Changelog, layout D of the 2026-10-11 polish: a What's new card with
 * the current version's three highlights first, then the release list. In a
 * release, New, Improved and Fixed fold to a count, while Changed and Known
 * limitations stay open, so a change under you or a missing feature is never
 * hidden behind a click.
 */
const current = releaseNotes.releases.find(release => release.version === releaseNotes.currentVersion)!
const published = releaseNotes.releases.find(release => release.version === '0.2.6')!
const host = document.createElement('div')

afterEach(() => {
  host.replaceChildren()
  vi.unstubAllGlobals()
})

describe('Updates & Changelog layout', () => {
  it('folds New, Improved and Fixed to counts and keeps Changed and Known limitations open', async () => {
    vi.stubGlobal('chrome', { runtime: { getManifest: () => ({ version: '0.2.6' }) } })
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => root.render(<ChangelogCard variant="history" />))
    const release = host.querySelector('.pulse-changelog-release[data-changelog-open="true"]')!
    const groups = [...release.querySelectorAll<HTMLDetailsElement>('details.pulse-changelog-category')]
    const seen = groups.map(group => ({
      key: group.dataset.releaseCategory,
      open: group.open,
      count: group.querySelector('summary .pulse-changelog-count')?.textContent,
      items: group.querySelectorAll('li').length,
    }))
    expect(seen).toEqual([
      { key: 'new', open: false, count: String(published.new!.length), items: published.new!.length },
      { key: 'changed', open: true, count: String(published.changed!.length), items: published.changed!.length },
      { key: 'improved', open: false, count: String(published.improved!.length), items: published.improved!.length },
      { key: 'fixed', open: false, count: String(published.fixed!.length), items: published.fixed!.length },
      { key: 'knownIssues', open: true, count: String(published.knownIssues!.length), items: published.knownIssues!.length },
    ])
    // Each heading is a summary: the group opens with a click or Enter.
    expect(groups.every(group => group.querySelector('summary > h3') !== null)).toBe(true)
    act(() => root.unmount())
  })

  it('omits empty categories for the unreleased candidate and keeps its limitations open', async () => {
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => root.render(<ChangelogCard variant="history" />))
    const release = host.querySelector('.pulse-changelog-release[data-changelog-open="true"]')!
    const groups = [...release.querySelectorAll<HTMLDetailsElement>('details.pulse-changelog-category')]
    expect(groups.map(group => ({ key: group.dataset.releaseCategory, open: group.open }))).toEqual([
      { key: 'new', open: false },
      { key: 'fixed', open: false },
      { key: 'knownIssues', open: true },
    ])
    act(() => root.unmount())
  })

  it('starts every release folded under the What\'s new card', () => {
    const html = renderToStaticMarkup(<ChangelogCard variant="history" startCollapsed />)
    expect(html).not.toContain('data-changelog-open="true"')
    expect(html.match(/data-changelog-open="false"/g)).toHaveLength(releaseNotes.releases.length)
  })

  it('shows the current version\'s title and three highlights, then See all changes', () => {
    const html = renderToStaticMarkup(<WhatsNewCard onSeeAll={() => {}} />)
    expect(html).toContain(`<span class="pulse-changelog-version">v${current.version}</span>`)
    expect(html).toContain(`>${current.title}</h3>`)
    expect([...html.matchAll(/<li>([^<]*)<\/li>/g)].map(match => match[1])).toEqual(current.preview)
    expect(html).toContain('data-changelog-see-all="true"')
    expect(html).toContain('See all changes ↓')
  })
})
