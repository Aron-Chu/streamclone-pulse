import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import {
  CHROME_WEB_STORE_EXTENSION_ID,
  CHROME_WEB_STORE_LISTING_URL,
  PUBLIC_SITE,
  STREAM_PULSE_ANALYTICS_URL,
  STREAM_PULSE_PRIVACY_URL,
  STREAM_PULSE_SUPPORT_URL,
} from '../src/lib/publicSiteConfig'
import { ChromeInstallCta } from '../src/ui/components/ChromeInstallCta'
import { AppRoutes } from '../src/routes/index'
import Docs from '../src/routes/public/Docs'
import Support from '../src/routes/public/Support'
import Landing from '../src/routes/public/Landing'
import { AnalyticsTopNav } from '../src/ui/components/analytics/AnalyticsTopNav'
import { PublicLayout } from '../src/ui/components/PublicLayout'

const CANONICAL =
  'https://chromewebstore.google.com/detail/streampulse/nifgoonpcgmdhiffcpmhndjgkgahnelg'

describe('publicSiteConfig', () => {
  it('centralizes CWS listing URL and extension id', () => {
    expect(CHROME_WEB_STORE_EXTENSION_ID).toBe('nifgoonpcgmdhiffcpmhndjgkgahnelg')
    expect(CHROME_WEB_STORE_LISTING_URL).toBe(CANONICAL)
    expect(PUBLIC_SITE.chromeWebStoreListingUrl).toBe(CANONICAL)
    expect(PUBLIC_SITE.chromeWebStoreExtensionId).toBe(CHROME_WEB_STORE_EXTENSION_ID)
    expect(STREAM_PULSE_ANALYTICS_URL).toBe('https://streampulse.stream/analytics/')
    expect(STREAM_PULSE_SUPPORT_URL).toBe('https://streampulse.stream/support')
    expect(STREAM_PULSE_PRIVACY_URL).toBe('https://streampulse.stream/privacy')
  })
})

function assertSafeCwsLink(anchor: HTMLElement) {
  expect(anchor.getAttribute('href')).toBe(CANONICAL)
  expect(anchor.getAttribute('target')).toBe('_blank')
  expect(anchor.getAttribute('rel')).toBe('noopener noreferrer')
  expect(anchor.getAttribute('href') ?? '').not.toMatch(/^chrome:/i)
}

describe('ChromeInstallCta', () => {
  it('uses the exact canonical CWS listing with safe target/rel', () => {
    render(<ChromeInstallCta />)
    const link = screen.getByRole('link', { name: /Add StreamPulse to Chrome/i })
    assertSafeCwsLink(link)
  })
})

describe('install CTAs across surfaces', () => {
  it('landing hero and nav CTAs use the canonical listing', () => {
    render(
      <MemoryRouter>
        <Landing />
      </MemoryRouter>,
    )
    const links = screen.getAllByRole('link').filter((el) => el.getAttribute('data-cws-listing'))
    expect(links.length).toBeGreaterThanOrEqual(2)
    for (const link of links) assertSafeCwsLink(link)
  })

  it('public layout, docs, support, and analytics nav expose the CTA', () => {
    const { unmount: u1 } = render(
      <MemoryRouter>
        <PublicLayout>
          <div>child</div>
        </PublicLayout>
      </MemoryRouter>,
    )
    for (const link of screen.getAllByRole('link', { name: /Add StreamPulse to Chrome/i })) {
      assertSafeCwsLink(link)
    }
    u1()

    const { unmount: u2 } = render(
      <MemoryRouter>
        <Docs />
      </MemoryRouter>,
    )
    for (const link of screen.getAllByRole('link', { name: /Add StreamPulse to Chrome/i })) {
      assertSafeCwsLink(link)
    }
    u2()

    const { unmount: u3 } = render(
      <MemoryRouter>
        <Support />
      </MemoryRouter>,
    )
    for (const link of screen.getAllByRole('link', { name: /Add StreamPulse to Chrome/i })) {
      assertSafeCwsLink(link)
    }
    u3()

    render(
      <MemoryRouter>
        <AnalyticsTopNav items={[{ label: 'Hub', to: '/analytics', end: true }]} />
      </MemoryRouter>,
    )
    const header = screen.getByRole('banner')
    expect(header.getAttribute('data-analytics-build')).toBe('command-center-cws-2026-07-22')
    assertSafeCwsLink(within(header).getByRole('link', { name: /Add StreamPulse to Chrome/i }))
  })

  it('keeps install CTAs visible without overflow on mobile and desktop widths', () => {
    const { container } = render(
      <MemoryRouter>
        <PublicLayout>
          <div>child</div>
        </PublicLayout>
      </MemoryRouter>,
    )

    for (const width of [360, 1280]) {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
      window.dispatchEvent(new Event('resize'))
      const link = screen.getByRole('link', { name: /Add StreamPulse to Chrome/i })
      const nav = container.querySelector('.app-nav')
      expect(link).toBeTruthy()
      expect(link.getAttribute('href')).toBe(CANONICAL)
      // Layout contract: CTA is in the nav flex row and does not use fixed overflow-hidden width.
      expect(nav?.contains(link)).toBe(true)
      const style = window.getComputedStyle(link)
      expect(style.display).not.toBe('none')
      expect(style.visibility).not.toBe('hidden')
    }
  })
})

function LocationProbe() {
  const { pathname } = useLocation()
  return <span data-testid="pathname">{pathname}</span>
}

describe('analytics routes and admin', () => {
  it('resolves /analytics and /analytics/ to the command center', async () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={['/analytics']}>
        <LocationProbe />
        <AppRoutes />
      </MemoryRouter>,
    )
    expect(await screen.findByRole('main', { name: /streampulse analytics/i })).toBeTruthy()
    expect(screen.getByTestId('pathname').textContent).toBe('/analytics')
    expect(document.querySelector('[data-analytics-build="command-center-cws-2026-07-22"]')).toBeTruthy()
    assertSafeCwsLink(screen.getByRole('link', { name: /Add StreamPulse to Chrome/i }))
    unmount()

    render(
      <MemoryRouter initialEntries={['/analytics/']}>
        <LocationProbe />
        <AppRoutes />
      </MemoryRouter>,
    )
    // Trailing slash still mounts the Command Center (not NotFound / channel console).
    expect(await screen.findByRole('main', { name: /streampulse analytics/i })).toBeTruthy()
    expect(screen.queryByTestId('not-found')).toBeNull()
    expect(document.querySelector('[data-analytics-build="command-center-cws-2026-07-22"]')).toBeTruthy()
  })

  it('renders NotFound for /admin without operator console copy', async () => {
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <AppRoutes />
      </MemoryRouter>,
    )
    expect(await screen.findByTestId('not-found')).toBeTruthy()
    expect(screen.queryByText(/Operator console/i)).toBeNull()
    expect(screen.queryByText(/AdminShell/i)).toBeNull()
  })
})
