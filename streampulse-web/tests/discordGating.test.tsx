import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { discordInviteUrl, parseDiscordInviteUrl } from '../src/lib/discord'
import Discord from '../src/routes/public/Discord'
import Landing from '../src/routes/public/Landing'
import Help from '../src/routes/public/Help'
import { PublicLayout } from '../src/ui/components/PublicLayout'
import Terms from '../src/routes/public/Terms'
import { SiteHeader } from '../src/ui/components/SiteHeader'

// Test-only placeholder invites. Real invite codes never enter the repository.
const SHORT_INVITE = 'https://discord.gg/sp-test-code'
const LONG_INVITE = 'https://discord.com/invite/SpTest42'

vi.mock('../src/lib/publicHub', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/publicHub')>()
  return {
    ...actual,
    fetchPublicHubBase: () => Promise.resolve({
      data: { generatedAt: new Date().toISOString(), poolSize: 0, corpus: {}, coverage: {}, activity: { points: [], windowMinutes: 30, channelCount: 0 },
        emoteIntel: {}, topEmotes: [], topMovers: [], liveChannels: [], moments: [] },
      loadSource: 'full' as const,
      hubEndpointOk: true,
    }),
  }
})

afterEach(() => {
  vi.unstubAllEnvs()
})

function discordLinks(container: ParentNode = document.body) {
  return [...container.querySelectorAll<HTMLAnchorElement>('a[href]')].filter(a => /discord/i.test(a.href))
}

describe('Discord invite validation', () => {
  it.each([SHORT_INVITE, LONG_INVITE, ` ${SHORT_INVITE} `, 'https://discord.gg/sp-fake'])('accepts %s', (value) => {
    expect(parseDiscordInviteUrl(value)).toBe(value.trim())
  })

  it.each([
    undefined, null, '', '   ', 'not a url',
    'http://discord.gg/sp-fake',
    'https://discord.gg/',
    'https://discord.gg/a',
    'https://discord.gg/sp-fake/extra',
    'https://discord.gg/sp-fake?event=1',
    'https://discord.gg/sp-fake#x',
    'https://discord.gg:8443/abc',
    'https://user:pw@discord.gg/sp-fake',
    'https://discord.com/abc',
    'https://discord.com/invite/',
    'https://discord.com/channels/abc',
    'https://www.discord.com/invite/sp-fake',
    'https://discordapp.com/invite/abc',
    'https://discord.gg.evil.example/abc',
    'https://evil.example/discord.gg/sp-fake',
    'https://discord.gg/ab%20c',
    'https://discord.gg/sp-fake def',
    'javascript:alert(1)',
  ])('rejects %j', (value) => {
    expect(parseDiscordInviteUrl(value)).toBeNull()
  })

  it('reads the build-time env and hides Discord without it', () => {
    vi.stubEnv('VITE_PUBLIC_DISCORD_INVITE_URL', '')
    expect(discordInviteUrl()).toBeNull()
    vi.stubEnv('VITE_PUBLIC_DISCORD_INVITE_URL', 'https://example.com/invite/abc')
    expect(discordInviteUrl()).toBeNull()
    vi.stubEnv('VITE_PUBLIC_DISCORD_INVITE_URL', LONG_INVITE)
    expect(discordInviteUrl()).toBe(LONG_INVITE)
  })
})

describe('Discord entry points', () => {
  it.each(['', 'https://discord.gg/', 'http://discord.gg/sp-fake'])('renders no Discord link anywhere when the invite is %j', async (value) => {
    vi.stubEnv('VITE_PUBLIC_DISCORD_INVITE_URL', value)
    const landing = render(<MemoryRouter><Landing /></MemoryRouter>)
    await screen.findByRole('heading', { name: /actually reacted to/i })
    expect(discordLinks()).toEqual([])
    expect(screen.queryByText(/Join the Discord/)).toBeNull()
    landing.unmount()

    const help = render(<MemoryRouter><Help /></MemoryRouter>)
    expect(discordLinks()).toEqual([])
    help.unmount()

    render(<MemoryRouter><PublicLayout><p>page</p></PublicLayout></MemoryRouter>)
    expect(discordLinks()).toEqual([])
  })

  it('shows Discord last in the header on the landing page with a valid invite, and in the phone menu', async () => {
    vi.stubEnv('VITE_PUBLIC_DISCORD_INVITE_URL', SHORT_INVITE)
    render(<MemoryRouter><Landing /></MemoryRouter>)
    await screen.findByRole('heading', { name: /actually reacted to/i })
    // One button: under 1280 px the same link shows as its 44 px mark (site-header.css).
    const links = discordLinks()
    expect(links.map(a => a.className)).toEqual(['site-header__discord'])
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    expect(discordLinks().map(a => a.className)).toEqual(['site-header__discord', 'site-header__discord site-menu__discord'])
    for (const link of discordLinks()) {
      expect(link.getAttribute('href')).toBe(SHORT_INVITE)
      expect(link.target).toBe('_blank')
      expect(link.rel).toContain('noopener')
      expect(link.getAttribute('aria-label')).toMatch(/Discord.*opens in a new tab/)
    }
    // Install and Open the Hub lead the right-hand group (both step back at the top of the page), so Discord
    // stays at the end instead of mid-bar (11-18, 11-22), then the phone Menu (11-24).
    const right = document.querySelector('.site-header__actions')!
    expect([...right.children].map((el) => el.classList[0])).toEqual(['site-header__step', 'site-header__discord', 'site-header__menu'])
    expect([...right.querySelector('.site-header__step')!.children].map((el) => el.classList.contains('site-header__install') || el.classList.contains('site-header__hub'))).toEqual([true, true])
    // Menu stays the only control named "Menu".
    expect(screen.getAllByRole('button', { name: 'Menu' })).toHaveLength(1)
    expect(screen.queryAllByRole('link', { name: /menu/i })).toHaveLength(0)
    // Feedback lives on Help, which the shared footer lists.
    const footer = screen.getByRole('navigation', { name: 'Footer' })
    expect(within(footer).getByRole('link', { name: 'Help' }).getAttribute('href')).toBe('/help')
  })

  it('keeps Discord out of the shared footer, with or without an invite', () => {
    for (const invite of [LONG_INVITE, '']) {
      vi.stubEnv('VITE_PUBLIC_DISCORD_INVITE_URL', invite)
      const { unmount } = render(<MemoryRouter><PublicLayout><p>page</p></PublicLayout></MemoryRouter>)
      const footer = screen.getByRole('navigation', { name: 'Footer' })
      expect(within(footer).getByRole('link', { name: 'Help' }).getAttribute('href')).toBe('/help')
      expect(discordLinks(footer)).toEqual([])
      unmount()
    }
  })

  it('gives every Discord link a name that contains its visible label (WCAG 2.5.3)', async () => {
    vi.stubEnv('VITE_PUBLIC_DISCORD_INVITE_URL', SHORT_INVITE)
    const landing = render(<MemoryRouter><Landing /></MemoryRouter>)
    await screen.findByRole('heading', { name: /actually reacted to/i })
    const help = render(<MemoryRouter><Help /></MemoryRouter>)
    const site = render(<MemoryRouter><PublicLayout><p>page</p></PublicLayout></MemoryRouter>)
    // Each header has one Discord link since 11-24 (its button and its mark are the same link); the phone menu adds one.
    fireEvent.click(within(site.container).getByRole('button', { name: 'Menu' }))
    const links = discordLinks()
    expect(links.length).toBeGreaterThanOrEqual(5)
    expect(links.some((link) => link.classList.contains('site-menu__discord'))).toBe(true)
    for (const link of links) {
      const visible = (link.textContent ?? '').replace(/\s+/g, ' ').trim()
      const name = link.getAttribute('aria-label') ?? visible
      // A voice-control user says what they see; the name has to contain it.
      if (visible) expect(name.toLowerCase(), link.className).toContain(visible.toLowerCase())
    }
    landing.unmount()
    help.unmount()
    site.unmount()
  })

  it('lists the public Discord, labelled public, under Ask us while the private form is open', () => {
    vi.stubEnv('VITE_PUBLIC_DISCORD_INVITE_URL', SHORT_INVITE)
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '1x00000000000000000000AA')
    render(<MemoryRouter><Help /></MemoryRouter>)
    const ask = screen.getByTestId('help-ask-public')
    expect(ask.textContent).toContain('Anyone can read these')
    const link = within(ask).getByRole('link', { name: 'Ask in the public Discord (opens in a new tab)' })
    expect(link.getAttribute('href')).toBe(SHORT_INVITE)
    // Listed once: the form's card does not repeat it while the form is open.
    expect(within(screen.getByTestId('help-feedback')).queryByTestId('feedback-public-alternatives')).toBeNull()
  })

  it('lists Discord once, in the form card, before the private form opens', () => {
    vi.stubEnv('VITE_PUBLIC_DISCORD_INVITE_URL', SHORT_INVITE)
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '')
    render(<MemoryRouter><Help /></MemoryRouter>)
    expect(screen.queryByTestId('help-ask-public')).toBeNull()
    expect(screen.getByTestId('help-ask-intro').textContent).toBe('Ask in public on Discord or GitHub. The links are below.')
    const card = within(screen.getByTestId('help-feedback')).getByTestId('feedback-public-alternatives')
    expect(within(card).getByRole('link', { name: 'Ask in Discord (public, opens in a new tab)' }).getAttribute('href')).toBe(SHORT_INVITE)
  })
})

describe('feedback and Discord beyond the landing page', () => {
  it('puts Discord last in the site header, after the install button, only with an invite', () => {
    vi.stubEnv('VITE_PUBLIC_DISCORD_INVITE_URL', SHORT_INVITE)
    const { unmount } = render(<MemoryRouter><PublicLayout><p>page</p></PublicLayout></MemoryRouter>)
    const header = document.querySelector('header.site-header') as HTMLElement
    const button = header.querySelector<HTMLAnchorElement>('a.site-header__discord')!
    expect(button.getAttribute('href')).toBe(SHORT_INVITE)
    expect(button.textContent).toBe('Discord')
    expect(button.target).toBe('_blank')
    expect(button.getAttribute('aria-label')).toBe('Join the StreamPulse Discord (opens in a new tab)')
    // One bar on every page (11-24): install, then Discord, as on the landing; under 1280 px the same link is its mark.
    expect(button.previousElementSibling?.classList.contains('site-header__install')).toBe(true)
    expect(header.querySelectorAll('a[href*="discord"]')).toHaveLength(1)
    unmount()
    vi.stubEnv('VITE_PUBLIC_DISCORD_INVITE_URL', '')
    render(<MemoryRouter><PublicLayout><p>page</p></PublicLayout></MemoryRouter>)
    expect(document.querySelector('header.site-header a[href*="discord"]')).toBeNull()
  })

  it('shows Discord on the Hub bar the same way, and once more at the foot of the phone menu', () => {
    vi.stubEnv('VITE_PUBLIC_DISCORD_INVITE_URL', SHORT_INVITE)
    render(<MemoryRouter><SiteHeader mainId="analytics-main" variant="analytics" /></MemoryRouter>)
    const bar = document.querySelector<HTMLAnchorElement>('header a.site-header__discord')!
    expect(bar.getAttribute('href')).toBe(SHORT_INVITE)
    expect(bar.previousElementSibling?.classList.contains('site-header__install')).toBe(true)
    expect(discordLinks()).toEqual([bar])
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    const panel = screen.getByRole('dialog')
    expect([...panel.querySelectorAll('nav a')].map((a) => a.textContent)).toEqual(['Hub', 'Moments', 'Help', 'Status', 'Changelog', 'Privacy', 'Terms'])
    const inMenu = panel.querySelector<HTMLAnchorElement>('a.site-menu__discord')!
    expect(inMenu.getAttribute('href')).toBe(SHORT_INVITE)
    expect(inMenu.target).toBe('_blank')
    expect(discordLinks()).toEqual([bar, inMenu])
  })

  it('drops Discord from the bar and the phone menu without an invite', () => {
    vi.stubEnv('VITE_PUBLIC_DISCORD_INVITE_URL', '')
    render(<MemoryRouter><SiteHeader mainId="analytics-main" variant="analytics" /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    expect(discordLinks()).toEqual([])
  })

  it('points Terms contact at private feedback and Discord, keeping GitHub for security reports only', () => {
    vi.stubEnv('VITE_PUBLIC_DISCORD_INVITE_URL', SHORT_INVITE)
    render(<MemoryRouter><Terms /></MemoryRouter>)
    const contact = screen.getByTestId('terms-contact')
    const text = (contact.textContent ?? '').replace(/\s+/g, ' ')
    expect(text).toContain('Product questions and bug reports: send private feedback or join the Discord.')
    expect(text).not.toMatch(/GitHub issues/i)
    expect(within(contact).getByRole('link', { name: 'private feedback' }).getAttribute('href')).toBe('/help#feedback')
    expect(within(contact).getByRole('link', { name: 'Discord (opens in a new tab)' }).getAttribute('href')).toBe(SHORT_INVITE)
    const github = [...contact.querySelectorAll('a')].filter(a => new URL(a.href).hostname === 'github.com')
    expect(github.map(a => a.textContent)).toEqual(['GitHub private vulnerability reporting'])
    expect(github[0].getAttribute('href')).toMatch(/\/security\/advisories\/new$/)
  })

  it('leaves Discord out of the Terms contact line without an invite', () => {
    vi.stubEnv('VITE_PUBLIC_DISCORD_INVITE_URL', '')
    render(<MemoryRouter><Terms /></MemoryRouter>)
    const text = (screen.getByTestId('terms-contact').textContent ?? '').replace(/\s+/g, ' ')
    expect(text).toContain('Product questions and bug reports: send private feedback.')
    expect(discordLinks()).toEqual([])
  })
})

describe('/discord page', () => {
  it('forwards to the invite with a plain link fallback', () => {
    vi.stubEnv('VITE_PUBLIC_DISCORD_INVITE_URL', SHORT_INVITE)
    const redirect = vi.fn()
    render(<MemoryRouter><Discord redirect={redirect} /></MemoryRouter>)
    expect(screen.getByRole('heading', { level: 1, name: 'Opening the StreamPulse Discord' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Join the Discord' }).getAttribute('href')).toBe(SHORT_INVITE)
    expect(redirect).toHaveBeenCalledWith(SHORT_INVITE)
  })

  it('keeps account problems for the private form only once that form is open', () => {
    vi.stubEnv('VITE_PUBLIC_DISCORD_INVITE_URL', SHORT_INVITE)
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '')
    const before = render(<MemoryRouter><Discord redirect={vi.fn()} /></MemoryRouter>)
    expect(screen.getByTestId('discord-page').textContent).toContain('The server is public, so leave out account details and anything personal.')
    expect(screen.queryByRole('link', { name: 'private feedback form' })).toBeNull()
    before.unmount()
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '1x00000000000000000000AA')
    render(<MemoryRouter><Discord redirect={vi.fn()} /></MemoryRouter>)
    expect(screen.getByTestId('discord-page').textContent).toContain('The server is public, so keep account problems for the private feedback form.')
    expect(screen.getByRole('link', { name: 'private feedback form' }).getAttribute('href')).toBe('/help#feedback')
  })

  it('says the server is not open yet and points at the feedback form on Help without a valid invite', () => {
    vi.stubEnv('VITE_PUBLIC_DISCORD_INVITE_URL', 'https://discord.gg/not a code')
    const redirect = vi.fn()
    render(<MemoryRouter><Discord redirect={redirect} /></MemoryRouter>)
    expect(screen.getByRole('heading', { level: 1, name: "The StreamPulse Discord isn't open yet" })).toBeTruthy()
    const page = screen.getByTestId('discord-page')
    expect(within(page).getByRole('link', { name: 'Send feedback' }).getAttribute('href')).toBe('/help#feedback')
    expect(discordLinks()).toEqual([])
    expect(redirect).not.toHaveBeenCalled()
  })
})
