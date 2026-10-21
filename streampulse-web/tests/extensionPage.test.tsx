import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRoutes } from '../src/routes/index'
import { prerenderPublicPage } from '../src/prerender'
import { CHROME_WEB_STORE_LISTING_URL } from '../src/lib/publicSiteConfig'

const FEATURES = ['Live Pulse', 'Top Moments', 'Catch me up', 'Your settings']

beforeEach(() => {
  // The demo loads when it nears the viewport. jsdom never scrolls, so here it never loads.
  vi.stubGlobal('IntersectionObserver', class {
    observe() {}
    disconnect() {}
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('/extension', () => {
  it('renders every section, with the demo waiting until it is on screen', () => {
    render(<MemoryRouter initialEntries={['/extension']}><AppRoutes /></MemoryRouter>)
    const page = screen.getByTestId('extension-page')
    expect(within(page).getByRole('heading', { level: 1, name: 'See what Twitch chat reacted to' })).toBeTruthy()
    for (const name of ['Click anything. It’s the real panel.', 'What it does', 'Privacy, in short', 'What’s new', 'Talk to us']) {
      expect(within(page).getByRole('heading', { level: 2, name: name.replace('’', "'") })).toBeTruthy()
    }
    for (const title of FEATURES) expect(within(page).getByRole('heading', { level: 3, name: title })).toBeTruthy()
    expect(within(page).getByText(/The demo loads when this part of the page is on screen/)).toBeTruthy()
    expect(document.getElementById('demo')).toBeTruthy()
  })

  it('installs from the Chrome Web Store listing and links to feedback and the release notes', () => {
    render(<MemoryRouter initialEntries={['/extension']}><AppRoutes /></MemoryRouter>)
    const page = screen.getByTestId('extension-page')
    const install = within(page).getByRole('link', { name: /Add to Chrome/ })
    expect(install.getAttribute('href')).toBe(CHROME_WEB_STORE_LISTING_URL)
    expect(within(page).getByRole('link', { name: 'Send feedback' }).getAttribute('href')).toBe('/feedback')
    expect(within(page).getByRole('link', { name: /All releases/ }).getAttribute('href')).toBe('/changelog')
    expect(within(page).getByRole('link', { name: /Privacy policy/ }).getAttribute('href')).toBe('/privacy')
  })

  it('prerenders the hero, the four features and the privacy summary', () => {
    const html = prerenderPublicPage('/extension')
    expect(html).toContain('See what Twitch chat reacted to')
    for (const title of FEATURES) expect(html).toContain(title)
    expect(html).toContain('Counts, not chat.')
    expect(html).not.toContain('data-testid="not-found"')
  })
})
