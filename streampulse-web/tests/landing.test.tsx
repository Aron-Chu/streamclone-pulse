import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import Landing from '../src/routes/public/Landing'
import { findLandingEmote } from '../src/ui/components/landing/landingEmotes'
import { prerenderPublicPage } from '../src/prerender'

// Plain-function mocks (not vi.fn) so the global afterEach restoreAllMocks in
// tests/setup.ts cannot wipe their implementations between cases.
vi.mock('../src/lib/publicHub', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/publicHub')>()
  const hub = {
    generatedAt: new Date().toISOString(),
    poolSize: 0,
    corpus: {},
    coverage: {},
    activity: { points: [], windowMinutes: 30, channelCount: 0 },
    emoteIntel: {},
    topEmotes: [{ name: 'KEKW', provider: '7tv', count: 900, sharePct: 22 }],
    topMovers: [
      {
        login: 'xqc',
        displayName: 'xQc',
        viewers: 12_000,
        chatPerMin: 400,
        seventvPerMin: 120,
        trendPct: 8,
      },
      // The channel strip needs at least three active, rising channels.
      { login: 'ludwig', displayName: 'ludwig', viewers: 9_000, chatPerMin: 300, seventvPerMin: 60, trendPct: 12 },
      { login: 'tarik', displayName: 'tarik', viewers: 8_000, chatPerMin: 200, seventvPerMin: 30, trendPct: 5 },
    ],
    liveChannels: [
      { login: 'tarik', displayName: 'tarik', viewers: 8_000, chatPerMin: 200, seventvPerMin: 30, trendPct: 5, coverageState: 'full' },
      { login: 'xqc', displayName: 'xQc', viewers: 12_000, chatPerMin: 400, seventvPerMin: 120, trendPct: 8, coverageState: 'full' },
    ],
    moments: [],
  }
  return {
    ...actual,
    fetchPublicHubBase: () =>
      Promise.resolve({
        data: hub,
        loadSource: 'full' as const,
        hubEndpointOk: true,
      }),
  }
})

vi.mock('../src/lib/publicApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/publicApi')>()
  return {
    ...actual,
    fetchPublicStats: () =>
      Promise.resolve({
        data: {
          streamsTracked: 512,
          momentsDetected: 8400,
          chatMessagesProcessed: 263_500,
          emotesIndexed: 206_600,
          vodsAnalyzed: 1280,
          updatedAt: new Date().toISOString(),
        },
      }),
  }
})

function renderLanding() {
  return render(
    <MemoryRouter>
      <Landing />
    </MemoryRouter>,
  )
}

/** Answers matchMedia as a screen at least 961px wide (or not); restored after each test. */
function stubWideScreen(wide: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string): MediaQueryList => ({
    matches: wide && query === '(min-width: 961px)',
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }))
}

describe('landing page', () => {
  it('is the hero with search and the demo, nothing else (Aron, F2, 2026-11-02)', async () => {
    renderLanding()
    await screen.findByRole('heading', { name: /actually reacted to/i })

    // One search, in the hero: the page ends with the demo, then the footer (D1, 11-02).
    expect(screen.getAllByRole('search')).toHaveLength(1)
    expect(screen.getAllByRole('combobox', { name: /search streamers or games/i })).toHaveLength(1)
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      expect.stringMatching(/see it beside twitch chat/i),
    ])
    expect(screen.queryByRole('heading', { name: 'Look up a streamer' })).toBeNull()
    expect(document.querySelector('[data-cta="chrome-install-closing"]')).toBeNull()
    const footer = screen.getByRole('navigation', { name: 'Footer' })
    for (const name of ['Privacy', 'Terms', 'Refunds', 'Supporter']) {
      expect(within(footer).getByRole('link', { name })).toBeTruthy()
    }
    expect(screen.getByText(/not affiliated with twitch/i)).toBeTruthy()
    for (const gone of [/designed around trust/i, /how it works/i, /^resources$/i, /feature by feature/i]) {
      expect(screen.queryByRole('heading', { name: gone })).toBeNull()
    }
    expect(screen.queryByText(/public analytics — no account needed/i)).toBeNull()
    expect(screen.queryByText(/see an example of the pulse tab/i)).toBeNull()
    // ReplayForge was dropped, and the Signal replay waits for the /extension page.
    expect(screen.queryByRole('heading', { name: /^roadmap$/i })).toBeNull()
    expect(screen.queryByRole('heading', { name: /see a stream become a signal/i })).toBeNull()
    expect(screen.queryByText(/replayforge/i)).toBeNull()
    expect(screen.queryByRole('link', { name: /^(roadmap|signal replay)$/i })).toBeNull()
  })

  it.each(['#%', '#100%', '#%E0%A4%A'])('ignores a malformed %s link fragment instead of crashing', async (hash) => {
    const original = Element.prototype.scrollIntoView
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    window.history.replaceState(null, '', `/${hash}`)
    try {
      renderLanding()
      expect(await screen.findByRole('heading', { name: /actually reacted to/i })).toBeTruthy()
      expect(scrollIntoView).not.toHaveBeenCalled()
    } finally {
      window.history.replaceState(null, '', '/')
      Element.prototype.scrollIntoView = original
    }
  })

  it('offers the busiest live channels to try, and / focuses the search', async () => {
    renderLanding()
    const heading = await screen.findByRole('heading', { name: /actually reacted to/i })
    const hero = within(heading.closest('section') as HTMLElement)
    const chips = await hero.findAllByRole('link', { name: /, live, .* viewers$/i })
    expect(chips.map((chip) => chip.lastElementChild?.textContent)).toEqual(['xQc', 'tarik'])
    expect(chips[0]!.getAttribute('href')).toBe('/analytics/xqc')

    const box = hero.getByRole('combobox', { name: /search streamers or games/i })
    fireEvent.keyDown(document.body, { key: '/' })
    expect(document.activeElement).toBe(box)
  })

  it('routes hero CTAs correctly', async () => {
    renderLanding()
    const heading = await screen.findByRole('heading', { name: /actually reacted to/i })
    const hero = heading.closest('section')
    expect(hero).toBeTruthy()
    const heroScope = within(hero as HTMLElement)

    expect(heroScope.getByRole('link', { name: /open the hub/i }).getAttribute('href')).toBe('/analytics')
    const install = heroScope.getByRole('link', { name: /Add StreamPulse to Chrome/i })
    const installUrl = new URL(install.getAttribute('href') ?? '')
    expect(`${installUrl.origin}${installUrl.pathname}`).toBe(
      'https://chromewebstore.google.com/detail/streampulse/nifgoonpcgmdhiffcpmhndjgkgahnelg',
    )
    expect(installUrl.searchParams.get('utm_source')).toBe('streampulse.stream')
    expect(installUrl.searchParams.get('utm_medium')).toBe('referral')
    expect(installUrl.searchParams.get('utm_campaign')).toBe('website_install')
    expect(installUrl.searchParams.get('utm_content')).toBe('home')
    expect(install.getAttribute('target')).toBe('_blank')
    expect(install.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('restores the ungated demo sequence and preserves working in-page navigation', async () => {
    const { container } = renderLanding()
    await screen.findByRole('heading', { name: /actually reacted to/i })
    const samples = container.querySelectorAll('details.sl-optional-demo')
    expect(samples).toHaveLength(0)
    expect(container.querySelector('.sl-fx')).not.toBeNull()
    expect(container.querySelector('main > section:nth-child(2)')?.id).toBe('demo')
    expect(container.querySelector('#analysis')).toBeNull()
    expect(container.querySelector('#roadmap')).toBeNull()
    expect(container.querySelectorAll('.lsg')).toHaveLength(0)
    for (const anchor of container.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')) {
      expect(container.querySelector(anchor.getAttribute('href')!)).not.toBeNull()
    }
    expect(screen.getByRole('link', { name: 'Skip to main content' }).getAttribute('href')).toBe('#landing-main')
  })

  it('does not expose legacy /setup or /login nav CTAs', async () => {
    renderLanding()
    await screen.findByRole('heading', { name: /actually reacted to/i })
    const nav = screen.getByRole('navigation', { name: /streampulse/i })
    const navScope = within(nav)
    expect(navScope.queryByRole('link', { name: /sign in/i })).toBeNull()
    expect(navScope.queryByRole('link', { name: /\/setup/i })).toBeNull()
    expect(navScope.getByRole('link', { name: /open the hub/i }).getAttribute('href')).toBe('/analytics')
  })

  it('mounts the chat backdrop only on screens at least 961px wide', async () => {
    stubWideScreen(true)
    const wide = renderLanding()
    await screen.findByRole('heading', { name: /actually reacted to/i })
    expect(wide.container.querySelector('.sl-chatbg')).not.toBeNull()
    wide.unmount()

    stubWideScreen(false)
    const narrow = renderLanding()
    await screen.findByRole('heading', { name: /actually reacted to/i })
    expect(narrow.container.querySelector('.sl-fx')).not.toBeNull()
    expect(narrow.container.querySelector('.sl-chatbg')).toBeNull()
  })

  it('keeps the chat backdrop and the removed sections out of the prerendered page', () => {
    stubWideScreen(true)
    const html = prerenderPublicPage('/')
    expect(html).toContain('sl-fx')
    expect(html).not.toContain('sl-chatbg')
    expect(html).not.toContain('id="roadmap"')
    expect(html).not.toContain('id="analysis"')
    expect(html).not.toContain('class="lsg')
  })

  it('rains 1x emote files without the three wide emotes', async () => {
    const { container } = renderLanding()
    await screen.findByRole('heading', { name: /actually reacted to/i })
    const sources = [...container.querySelectorAll<HTMLImageElement>('.sl-em img')].map((img) => img.getAttribute('src') ?? '')
    expect(sources).toHaveLength(18)
    for (const src of sources) {
      expect(src).toMatch(/\/1x\.webp$|\/1\.0$/)
    }
    for (const name of ['degloved', 'widespeedlaugh', 'widereacting']) {
      const id = findLandingEmote(name)?.id
      expect(id).toBeTruthy()
      expect(sources.some((src) => src.includes(id!))).toBe(false)
    }
  })

  it('shows the live emote and mover tickers', async () => {
    renderLanding()
    await screen.findByRole('heading', { name: /actually reacted to/i })
    expect(screen.getByText(/trending emotes/i)).toBeTruthy()
    expect(screen.getByText(/trending channels/i)).toBeTruthy()
  })
})

describe('landing hero on a phone (P1, 11-02)', () => {
  it('marks Open the Hub for the phone style and says the extension is for desktop', async () => {
    renderLanding()
    await screen.findByRole('heading', { name: /actually reacted to/i })
    const hub = screen.getAllByRole('link', { name: /open the hub/i }).find((a) => a.closest('.sl-hero__actions'))!
    expect(hub.className).toContain('sl-hero__hub')
    // the outline style stays for wider screens
    expect(hub.className).toContain('sc-btn--outline')
    const desk = document.querySelector('.sl-stage > p.sl-hero__desk')!
    expect(desk.textContent).toBe('Desktop extension for Chrome, Edge and Firefox')
    expect(desk.previousElementSibling?.classList.contains('sl-hero__actions')).toBe(true)
  })

  it('hides the install button and fills Open the Hub only below 720 px', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/ui/components/landing/landing.css'), 'utf8')
    expect(css).toMatch(/\.sl-stage > p\.sl-hero__desk \{ display: none; \}\s*@media \(max-width: 719px\) \{\s*\.sl-hero__actions \[data-cta="chrome-install-hero"\] \{ display: none; \}\s*\.sl-hero__actions \.sc-btn\.sl-hero__hub \{[^}]*background: hsl\(var\(--sc-primary\)\);/)
  })
})
