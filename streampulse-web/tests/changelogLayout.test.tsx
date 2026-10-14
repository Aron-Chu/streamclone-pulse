import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

// /changelog reads the extension's src/shared/release-notes.json, which the
// extension's release changes. This renders the page with notes shaped like
// the 0.2.2 release (no Changed group, three highlights, marked released) to
// prove the layout holds for that text as well as for the notes on disk. The
// Supporter lines use the owner-approved UP-1 wording.
vi.mock('../../src/shared/release-notes.json', () => ({
  default: {
    schemaVersion: 1,
    currentVersion: '0.2.2',
    releases: [
      {
        version: '0.2.2',
        status: 'released',
        releasedAt: null,
        title: 'Whole-stream charts and a new popup',
        summary: 'Whole-stream charts, a calmer Top Moments list and a redesigned popup.',
        preview: [
          'Send feedback and Discord links are in settings.',
          'Top Moments opens a card only when you pick one.',
          'The 7TV header backdrop is a Supporter perk; sign-ups are not open yet.',
          'A fourth highlight that the card leaves out.',
        ],
        new: ['Bookmarks work without an account.', 'The toolbar popup is redesigned.'],
        improved: ['Long streams chart end to end.'],
        fixed: ['Hiding Pulse in the right dock no longer draws a dark shape.', 'VODs without replay data no longer show a false outage.', 'Retry shows when StreamPulse cannot be reached.'],
        knownIssues: ['Accounts and Supporter sign-ups are not open yet.'],
        links: { details: '/changelog' },
      },
      {
        version: '0.2.1',
        status: 'released',
        releasedAt: '2026-08-31',
        title: 'Selected-minute clarity',
        summary: 'Exact bucket selection.',
        preview: ['An older highlight.'],
        new: ['Clicking a chart bucket opens a card.'],
        fixed: ['A locked bucket keeps its highlight.'],
        links: { details: '/changelog' },
      },
    ],
  },
}))

const { default: Changelog } = await import('../src/routes/public/Changelog')

afterEach(cleanup)

function renderPage() {
  render(<MemoryRouter initialEntries={['/changelog']}><Changelog /></MemoryRouter>)
  return screen.getByTestId('changelog-page')
}

describe('/changelog layout with the 0.2.2 notes', () => {
  it('leads with the latest release: its title and three highlights, then all changes', () => {
    renderPage()
    const card = screen.getByTestId('changelog-whats-new')
    expect(document.getElementById('v0.2.2')!.contains(card)).toBe(true)
    expect(card.textContent).toContain('What’s new in v0.2.2')
    expect(within(card).getByRole('heading', { level: 2, name: 'Whole-stream charts and a new popup' })).toBeTruthy()
    expect([...card.querySelectorAll('li')].map((item) => item.textContent)).toEqual([
      'Send feedback and Discord links are in settings.',
      'Top Moments opens a card only when you pick one.',
      'The 7TV header backdrop is a Supporter perk; sign-ups are not open yet.',
    ])
    expect(within(card).getByRole('link', { name: 'See all changes ↓' }).getAttribute('href')).toBe('#v0.2.2-changes')
    // Only the latest release gets the card; the older one keeps its plain header.
    expect(screen.getAllByTestId('changelog-whats-new')).toHaveLength(1)
    expect(document.getElementById('v0.2.1')!.textContent).toContain('v0.2.1 · Released · Aug 31, 2026')
  })

  it('folds New, Improved and Fixed to counts, omits Changed and keeps Known limitations open', () => {
    renderPage()
    const section = document.getElementById('v0.2.2')!
    const groups = [...section.querySelectorAll('details')].map((group) => ({
      key: group.dataset.category,
      open: group.open,
      label: group.querySelector('h3')!.textContent,
      count: group.querySelector('summary span')!.textContent,
      items: group.querySelectorAll('li').length,
    }))
    expect(groups).toEqual([
      { key: 'new', open: false, label: 'New', count: '2', items: 2 },
      { key: 'improved', open: false, label: 'Improved', count: '1', items: 1 },
      { key: 'fixed', open: false, label: 'Fixed', count: '3', items: 3 },
      { key: 'knownIssues', open: true, label: 'Known limitations', count: '1', items: 1 },
    ])
    expect(section.querySelector('[data-category="changed"]')).toBeNull()
    expect(section.textContent).not.toMatch(/moved from free to Supporter/)
  })
})
