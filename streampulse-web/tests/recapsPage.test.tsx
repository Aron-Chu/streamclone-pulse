import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const list = vi.hoisted(() => [
  { path: '/analytics/fixturechan/124', heading: 'Fixture Channel second recap', description: 'Second synthetic fixture.' },
  { path: '/analytics/fixturechan/123', heading: 'Fixture Channel reaction recap', description: 'First synthetic fixture.' },
])
vi.mock('../src/generated/recap-page-list.json', () => ({ default: list }))
import Recaps from '../src/routes/public/Recaps'

afterEach(() => cleanup())

describe('/recaps', () => {
  it('lists every reviewed recap in manifest order, each a full page load of its own document', () => {
    render(<MemoryRouter initialEntries={['/recaps']}><Recaps /></MemoryRouter>)
    expect(screen.getAllByRole('heading', { level: 1 }).map(heading => heading.textContent)).toEqual(['Twitch chat recaps'])
    const links = screen.getAllByRole('link').filter(link => link.getAttribute('href')?.startsWith('/analytics/fixturechan/'))
    expect(links.map(link => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Fixture Channel second recap', '/analytics/fixturechan/124'],
      ['Fixture Channel reaction recap', '/analytics/fixturechan/123'],
    ])
    // A plain anchor, not a router link: the reviewed summary ships only in the recap's own document.
    for (const link of links) expect(link.hasAttribute('data-discover')).toBe(false)
    expect(screen.getByText('First synthetic fixture.')).toBeTruthy()
  })
})
