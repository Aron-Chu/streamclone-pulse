import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CHROME_WEB_STORE_EXTENSION_ID,
  CHROME_WEB_STORE_LISTING_URL,
  EDGE_ADDONS_LISTING_URL,
  FIREFOX_ADDONS_LISTING_URL,
  PUBLIC_SITE,
  STREAM_PULSE_ANALYTICS_URL,
  STREAM_PULSE_PRIVACY_URL,
  STREAM_PULSE_SUPPORT_URL,
  chromeWebStoreUrlForPage,
  storeLinkPageForPath,
  type StoreLinkPage,
} from '../src/lib/publicSiteConfig'
import { detectInstallStore, installStoreUrl } from '../src/lib/installBrowser'
import { InstallCta } from '../src/ui/components/InstallCta'
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
    expect(STREAM_PULSE_ANALYTICS_URL).toBe('https://streampulse.stream/analytics')
    expect(STREAM_PULSE_SUPPORT_URL).toBe('https://streampulse.stream/support')
    expect(STREAM_PULSE_PRIVACY_URL).toBe('https://streampulse.stream/privacy')
  })
})

function assertSafeCwsLink(anchor: HTMLElement) {
  const href = anchor.getAttribute('href') ?? ''
  const parsed = new URL(href)
  expect(`${parsed.origin}${parsed.pathname}`).toBe(CANONICAL)
  expect(parsed.searchParams.get('utm_source')).toBe('streampulse.stream')
  expect(parsed.searchParams.get('utm_medium')).toMatch(/^[a-z0-9-]+$/)
  expect(anchor.getAttribute('target')).toBe('_blank')
  expect(anchor.getAttribute('rel')).toBe('noopener noreferrer')
  expect(anchor.getAttribute('href') ?? '').not.toMatch(/^chrome:/i)
}

describe('store link page kind', () => {
  it('maps a path to a fixed page kind, never the path itself', () => {
    expect(storeLinkPageForPath('/')).toBe('home')
    expect(storeLinkPageForPath('')).toBe('home')
    expect(storeLinkPageForPath('/analytics')).toBe('analytics')
    expect(storeLinkPageForPath('/analytics/zackrawrr')).toBe('analytics')
    expect(storeLinkPageForPath('/analytics/zackrawrr/317702962423')).toBe('analytics')
    expect(storeLinkPageForPath('/s/zackrawrr/317702962423')).toBe('analytics')
    expect(storeLinkPageForPath('/privacy/')).toBe('privacy')
    expect(storeLinkPageForPath('/supporter/thanks')).toBe('supporter')
    expect(storeLinkPageForPath('/account/confirm')).toBe('account')
    expect(storeLinkPageForPath('/zackrawrr')).toBe('site')
    expect(storeLinkPageForPath('/Analytics/zackrawrr')).toBe('site')
  })

  it('never puts an unlisted value in utm_medium', () => {
    const url = new URL(chromeWebStoreUrlForPage('/analytics/zackrawrr/317702962423' as StoreLinkPage))
    expect(url.searchParams.get('utm_medium')).toBe('site')
    expect(new URL(chromeWebStoreUrlForPage('supporter')).searchParams.get('utm_medium')).toBe('supporter')
  })
})

const UA = {
  chrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
  firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0',
  safari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15',
  // Brave sends Chrome's user agent; its brands say Brave.
  brave: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
} as const

describe('install store detection', () => {
  it('sends Edge to Edge Add-ons, Firefox to Firefox Add-ons and every other browser to the Chrome Web Store', () => {
    expect(detectInstallStore({ userAgent: UA.edge })).toBe('edge')
    expect(detectInstallStore({ userAgent: UA.chrome, userAgentData: { brands: [{ brand: 'Microsoft Edge' }] } })).toBe('edge')
    expect(detectInstallStore({ userAgent: UA.firefox })).toBe('firefox')
    expect(detectInstallStore({ userAgent: 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/144.0 Mobile/15E148' })).toBe('firefox')
    expect(detectInstallStore({ userAgent: UA.chrome })).toBe('chrome')
    expect(detectInstallStore({ userAgent: UA.brave, userAgentData: { brands: [{ brand: 'Brave' }, { brand: 'Chromium' }] } })).toBe('chrome')
    expect(detectInstallStore({ userAgent: UA.safari })).toBe('chrome')
    expect(detectInstallStore({ userAgent: '' })).toBe('chrome')
    expect(detectInstallStore(undefined)).toBe('chrome')
  })

  it('opens the official listings, with the page kind on the Chrome link only', () => {
    expect(installStoreUrl('edge', 'analytics')).toBe(EDGE_ADDONS_LISTING_URL)
    expect(installStoreUrl('firefox', 'analytics')).toBe(FIREFOX_ADDONS_LISTING_URL)
    expect(new URL(installStoreUrl('chrome', 'analytics')).searchParams.get('utm_medium')).toBe('analytics')
  })
})

describe('InstallCta', () => {
  const realUa = Object.getOwnPropertyDescriptor(window.navigator, 'userAgent')
  const setUa = (value: string) => Object.defineProperty(window.navigator, 'userAgent', { configurable: true, get: () => value })
  afterEach(() => {
    window.history.replaceState(null, '', '/')
    if (realUa) Object.defineProperty(window.navigator, 'userAgent', realUa)
    else delete (window.navigator as { userAgent?: string }).userAgent
  })

  it('uses the exact canonical CWS listing with safe target/rel', () => {
    render(<InstallCta />)
    const link = screen.getByRole('link', { name: /Add StreamPulse to Chrome/i })
    assertSafeCwsLink(link)
  })

  it('keeps the channel and stream id out of the store link on a session page', () => {
    window.history.replaceState(null, '', '/analytics/zackrawrr/317702962423')
    render(<InstallCta />)
    const link = screen.getByRole('link', { name: /Add StreamPulse to Chrome/i })
    const href = link.getAttribute('href') ?? ''
    expect(new URL(href).searchParams.get('utm_medium')).toBe('analytics')
    expect(href).not.toMatch(/zackrawrr|317702962423/)
    expect(link.getAttribute('data-cws-listing')).toBe(href)
  })

  it.each([
    ['edge', UA.edge, 'Add to Edge', EDGE_ADDONS_LISTING_URL],
    ['firefox', UA.firefox, 'Add to Firefox', FIREFOX_ADDONS_LISTING_URL],
  ] as const)('shows one %s button for that browser, opening its official listing', (store, ua, name, url) => {
    setUa(ua)
    render(<InstallCta label="short" icon="mark" />)
    const link = screen.getByRole('link', { name })
    expect(link.getAttribute('href')).toBe(url)
    expect(link.getAttribute('data-store')).toBe(store)
    expect(link.getAttribute('data-cws-listing')).toBeNull()
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    expect(link.querySelector(`.${store}-mark`)).toBeTruthy()
    expect(screen.getAllByRole('link')).toHaveLength(1)
  })

  it.each([['Brave', UA.brave], ['Safari', UA.safari]])('sends %s to the Chrome Web Store', (_name, ua) => {
    setUa(ua)
    render(<InstallCta label="short" />)
    assertSafeCwsLink(screen.getByRole('link', { name: 'Add to Chrome' }))
  })

  it('keeps a fixed store whatever the browser', () => {
    setUa(UA.edge)
    render(<InstallCta store="firefox" label="short" />)
    expect(screen.getByRole('link', { name: 'Add to Firefox' }).getAttribute('href')).toBe(FIREFOX_ADDONS_LISTING_URL)
  })
})

describe('install CTAs across surfaces', () => {
  it('lists the published Edge and Firefox listings beside Chrome, with honest desktop guidance', () => {
    render(<MemoryRouter><Docs /></MemoryRouter>)
    const install = screen.getByRole('heading', { name: /install the streampulse extension/i }).closest('section')!
    const firefox = within(install).getByRole('link', { name: 'Add to Firefox' })
    expect(firefox.getAttribute('href')).toBe(FIREFOX_ADDONS_LISTING_URL)
    expect(PUBLIC_SITE.firefoxAddonsListingUrl).toBe(FIREFOX_ADDONS_LISTING_URL)
    expect(firefox.getAttribute('target')).toBe('_blank')
    expect(firefox.getAttribute('rel')).toBe('noopener noreferrer')
    const edge = within(install).getByRole('link', { name: 'Add to Edge' })
    expect(edge.getAttribute('href')).toBe(EDGE_ADDONS_LISTING_URL)
    expect(PUBLIC_SITE.edgeAddonsListingUrl).toBe(EDGE_ADDONS_LISTING_URL)
    expect(edge.getAttribute('target')).toBe('_blank')
    expect(edge.getAttribute('rel')).toBe('noopener noreferrer')
    expect(install.textContent).toContain('On a phone or tablet, open this page on your computer.')
    expect(install.textContent).not.toContain('will appear here once its listing is verified')
  })

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
    assertSafeCwsLink(within(header).getByRole('link', { name: 'Add to Chrome' }))
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
      assertSafeCwsLink(link)
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

function InstallLocationProbe() {
  const { pathname, search, hash } = useLocation()
  return <span data-testid="install-location">{pathname}{search}{hash}</span>
}

describe('install entry', () => {
  it.each(['/install', '/install/'])('opens the guide from %s without forwarding query values to stores', async path => {
    const search = '?utm_campaign=editor-pilot&channel=private-channel&email=private@example.test'
    window.history.replaceState({}, '', `${path}${search}`)
    render(
      <MemoryRouter initialEntries={[`${path}${search}#old-anchor`]}>
        <InstallLocationProbe />
        <AppRoutes />
      </MemoryRouter>,
    )
    expect(await screen.findByTestId('docs-page')).toBeTruthy()
    expect(screen.getByTestId('install-location').textContent).toBe(`/docs${search}#extension`)
    for (const link of screen.getAllByRole('link').filter(el =>
      el.hasAttribute('data-cws-listing') || el.getAttribute('href') === FIREFOX_ADDONS_LISTING_URL,
    )) {
      expect(link.getAttribute('href')).not.toMatch(/editor-pilot|private-channel|private@example/)
    }
    expect(screen.queryByTestId('not-found')).toBeNull()
    window.history.replaceState({}, '', '/')
  })
})

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
    // The hub's install card and the bar's button (which hides while the card shows).
    const installs = screen.getAllByRole('link', { name: 'Add to Chrome' })
    expect(installs.map((a) => a.getAttribute('data-cta')).sort()).toEqual(['chrome-install-analytics', 'chrome-install-hub-hero'])
    for (const link of installs) assertSafeCwsLink(link)
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
