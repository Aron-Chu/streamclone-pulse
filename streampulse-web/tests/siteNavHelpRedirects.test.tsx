import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { SITE_FOOTER_ITEMS, SITE_NAV_ITEMS } from '../src/lib/siteNav'
import { resolvePageMetadata } from '../src/lib/pageMetadata'
import { AppRoutes } from '../src/routes/index'
import { PublicLayout } from '../src/ui/components/PublicLayout'
import { SiteFooter } from '../src/ui/components/SiteFooter'
import { SiteHeader } from '../src/ui/components/SiteHeader'

const NAV = [['Hub', '/analytics'], ['Moments', '/analytics/moments'], ['Help', '/help']]
const FOOTER = [['Status', '/status'], ['Changelog', '/changelog'], ['Privacy', '/privacy'], ['Terms', '/terms']]

/** The site's own links that sit directly in a row: not the store button, not the analytics choice's policy link. */
function links(container: HTMLElement) {
  return within(container).getAllByRole('link')
    .filter((a) => a.getAttribute('href')?.startsWith('/') && !a.closest('.analytics-preferences'))
    .map((a) => [a.textContent, a.getAttribute('href')])
}

describe('shared site navigation', () => {
  it('names the main destinations and the site information once', () => {
    expect(SITE_NAV_ITEMS.map((item) => [item.label, item.to])).toEqual(NAV)
    expect(SITE_FOOTER_ITEMS.map((item) => [item.label, item.to])).toEqual(FOOTER)
  })

  it('gives the site pages and the analytics pages the same header links', () => {
    const site = render(<MemoryRouter><PublicLayout><p>page</p></PublicLayout></MemoryRouter>)
    expect(links(screen.getByRole('navigation', { name: 'Main' }))).toEqual(NAV)
    site.unmount()
    render(<MemoryRouter><SiteHeader mainId="analytics-main" variant="analytics" /></MemoryRouter>)
    expect(links(screen.getByRole('navigation', { name: 'Main' }))).toEqual(NAV)
  })

  it('puts the destinations, then the site information, in the shared footer', () => {
    render(<MemoryRouter><PublicLayout><p>page</p></PublicLayout></MemoryRouter>)
    const rows = [...screen.getByRole('navigation', { name: 'Footer' }).querySelectorAll<HTMLElement>('.app-footer__links')]
    expect(rows).toHaveLength(2)
    expect(links(rows[0])).toEqual(NAV)
    expect(links(rows[1])).toEqual(FOOTER)
    // Off the menus, still reachable by their own addresses.
    const footer = document.querySelector('footer')!
    for (const gone of ['/recaps', '/supporter', '/refunds', '/account', '/docs', '/support', '/feedback']) {
      expect(footer.querySelector(`a[href="${gone}"]`), gone).toBeNull()
    }
  })

  it('styles the footer brand row with its own classes, which the home and analytics pages load too', () => {
    // The site's Tailwind utilities exist only as `.app-shell .x`, and only
    // PublicLayout has that wrapper; the footer also sits on the home page and
    // the analytics pages, so the row must not lean on them.
    render(<MemoryRouter><SiteFooter /></MemoryRouter>)
    const lead = document.querySelector<HTMLElement>('.app-footer__inner > :first-child')!
    expect(lead.className).toBe('app-footer__lead')
    const classes = [lead, ...lead.querySelectorAll('*')].flatMap((el) => (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean))
    expect(classes.filter((name) => !name.startsWith('app-footer__'))).toEqual([])
    expect(lead.querySelector('.app-footer__name')?.textContent).toBe('StreamPulse')
    expect(lead.querySelector('.app-footer__tagline')?.textContent).toBe('Free Twitch chat and emote stats. Not affiliated with Twitch.')

    // The same values the utilities gave it inside .app-shell (and live's row).
    const css = readFileSync(resolve(process.cwd(), 'src/ui/global.css'), 'utf8')
    expect(css).toMatch(/\.app-footer__lead\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center;[^}]*gap:\s*0\.5rem;/)
    expect(css).toMatch(/\.app-footer__name\s*\{[^}]*font-weight:\s*700;[^}]*color:\s*#d4d4d8;/)
    expect(css).toMatch(/\.app-footer__sep,\s*\.app-footer__tagline\s*\{[^}]*color:\s*#a1a1aa;/)
    expect(css).toMatch(/\.app-footer__tagline\s*\{[^}]*font-size:\s*0\.75rem;[^}]*line-height:\s*1rem;/)
    expect(css).toMatch(/@media \(max-width: 560px\)[^@]*\.app-footer__lead\s*\{\s*flex-wrap:\s*wrap;/)
    expect(css).not.toMatch(/\.app-footer__inner\s*>\s*div/)
  })
})

function Where() {
  const { pathname, search, hash } = useLocation()
  return <span data-testid="where">{pathname}{search}{hash}</span>
}

describe('old help addresses', () => {
  it.each([
    ['/docs', '/help#install'],
    ['/docs#extension', '/help#install'],
    ['/docs#analytics', '/help#hub'],
    ['/docs#coverage', '/help#coverage'],
    ['/docs#api', '/help#api'],
    ['/docs#help', '/help#ask'],
    ['/docs/getting-started', '/help#install'],
    ['/docs/coverage', '/help#coverage'],
    ['/docs/api', '/help#api'],
    ['/install?utm_source=store', '/help?utm_source=store#install'],
    ['/support', '/help#fix'],
    ['/support#install', '/help#install'],
    ['/support#billing-email', '/help#billing-email'],
    ['/support#send-feedback', '/help#feedback'],
    ['/support#contact', '/help#contact'],
    ['/support#security', '/help#security'],
    ['/feedback', '/help#feedback'],
    ['/support#constructor', '/help#fix'],
    // Where the edge sends /docs and /support, with the anchor the browser carried over.
    ['/help?from=docs', '/help#install'],
    ['/help?from=docs#analytics', '/help#hub'],
    ['/help?from=support', '/help#fix'],
    ['/help?from=support#billing-email', '/help#billing-email'],
    ['/help?from=support#send-feedback', '/help#feedback'],
    ['/help?from=support&utm_source=store', '/help?utm_source=store#fix'],
  ])('opens %s at %s', async (from, to) => {
    render(<MemoryRouter initialEntries={[from]}><Where /><AppRoutes /></MemoryRouter>)
    expect(await screen.findByTestId('help-page')).toBeTruthy()
    expect(screen.getByTestId('where').textContent).toBe(to)
    expect(document.getElementById(to.split('#')[1]), to).toBeTruthy()
  })

  it('leaves Help as it is for a from it does not know', async () => {
    render(<MemoryRouter initialEntries={['/help?from=constructor#api']}><Where /><AppRoutes /></MemoryRouter>)
    expect(await screen.findByTestId('help-page')).toBeTruthy()
    expect(screen.getByTestId('where').textContent).toBe('/help?from=constructor#api')
  })

  const edgeTargets = () => readFileSync(resolve(process.cwd(), 'public/_redirects'), 'utf8').split(/\r?\n/)
    .filter((line) => line.trim() && !line.startsWith('#'))
    .map((line) => line.trim().split(/\s+/)[1])

  it('lands each edge redirect that names its old page on a section of Help', async () => {
    const targets = edgeTargets().filter((target) => target.startsWith('/help?from='))
    // /docs and /support, with and without the slash.
    expect(targets).toHaveLength(4)
    for (const target of new Set(targets)) {
      const view = render(<MemoryRouter initialEntries={[target]}><Where /><AppRoutes /></MemoryRouter>)
      expect(await screen.findByTestId('help-page')).toBeTruthy()
      const where = screen.getByTestId('where').textContent ?? ''
      expect(where, target).toMatch(/^\/help#[a-z-]+$/)
      expect(document.getElementById(where.split('#')[1]), target).toBeTruthy()
      view.unmount()
    }
  })

  it('sends each edge redirect into Help to a section the page has', async () => {
    const targets = edgeTargets().filter((target) => target.startsWith('/help#'))
    // /install, /docs/getting-started, /docs/coverage, /docs/api and /feedback, with and without the slash.
    expect(targets).toHaveLength(10)
    render(<MemoryRouter initialEntries={['/help']}><AppRoutes /></MemoryRouter>)
    expect(await screen.findByTestId('help-page')).toBeTruthy()
    for (const anchor of new Set(targets.map((target) => target.slice('/help#'.length)))) {
      expect(document.getElementById(anchor), anchor).toBeTruthy()
    }
  })

  it('opens the timestamp builder in the guide it moved into, keeping the query', async () => {
    render(<MemoryRouter initialEntries={['/tools/twitch-vod-timestamp-link?ref=old']}><Where /><AppRoutes /></MemoryRouter>)
    expect(await screen.findByRole('heading', { level: 1, name: 'Twitch VOD timestamp links' })).toBeTruthy()
    expect(screen.getByTestId('where').textContent).toBe('/guides/twitch-vod-timestamps?ref=old')
    expect(screen.getByRole('button', { name: 'Build timestamp link' })).toBeTruthy()
  })

  it('keeps /discord as its own page', async () => {
    render(<MemoryRouter initialEntries={['/discord']}><Where /><AppRoutes /></MemoryRouter>)
    expect(await screen.findByTestId('discord-page')).toBeTruthy()
    expect(screen.getByTestId('where').textContent).toBe('/discord')
  })
})

describe('Help page metadata and sitemap', () => {
  it('indexes /help and points the old help addresses at it', () => {
    expect(resolvePageMetadata('/help')).toMatchObject({ title: 'Help — StreamPulse', canonicalPath: '/help', robots: 'index,follow' })
    for (const old of ['/docs', '/docs/coverage', '/support', '/feedback']) {
      expect(resolvePageMetadata(old), old).toMatchObject({ canonicalPath: '/help', robots: 'noindex,nofollow' })
    }
  })

  it('lists /help and the guide, and none of the addresses that redirect', () => {
    const sitemap = readFileSync(resolve(process.cwd(), 'public/sitemap.xml'), 'utf8')
    const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => new URL(match[1]).pathname)
    expect(urls).toContain('/help')
    expect(urls).toContain('/guides/twitch-vod-timestamps')
    for (const gone of ['/docs', '/support', '/feedback', '/install', '/tools/twitch-vod-timestamp-link']) {
      expect(urls, gone).not.toContain(gone)
    }
  })
})
