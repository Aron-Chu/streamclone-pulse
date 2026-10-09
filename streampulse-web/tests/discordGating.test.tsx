import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { discordInviteUrl, parseDiscordInviteUrl } from '../src/lib/discord'
import Discord from '../src/routes/public/Discord'
import Landing from '../src/routes/public/Landing'
import Feedback from '../src/routes/public/Feedback'
import Support from '../src/routes/public/Support'
import { PublicLayout } from '../src/ui/components/PublicLayout'

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

    const support = render(<MemoryRouter><Support /></MemoryRouter>)
    expect(discordLinks()).toEqual([])
    support.unmount()

    const feedback = render(<MemoryRouter><Feedback /></MemoryRouter>)
    expect(discordLinks()).toEqual([])
    expect(screen.queryByTestId('support-discord-line')).toBeNull()
    feedback.unmount()

    render(<MemoryRouter><PublicLayout><p>page</p></PublicLayout></MemoryRouter>)
    expect(discordLinks()).toEqual([])
  })

  it('shows the hero pill, nav button, phone icon and footer link on the landing page with a valid invite', async () => {
    vi.stubEnv('VITE_PUBLIC_DISCORD_INVITE_URL', SHORT_INVITE)
    render(<MemoryRouter><Landing /></MemoryRouter>)
    await screen.findByRole('heading', { name: /actually reacted to/i })
    const links = discordLinks()
    expect(links.map(a => a.className.split(' ').find(c => c.startsWith('sl-'))).sort())
      .toEqual(['sl-discord-icon', 'sl-discord-nav', 'sl-discord-pill', 'sl-foot__discord'])
    for (const link of links) {
      expect(link.getAttribute('href')).toBe(SHORT_INVITE)
      expect(link.target).toBe('_blank')
      expect(link.rel).toContain('noopener')
      expect(link.getAttribute('aria-label')).toMatch(/Discord.*opens in a new tab/)
    }
    // The nav button comes first in the right-hand group.
    const right = document.querySelector('.sl-nav__right')!
    expect(right.firstElementChild?.classList.contains('sl-discord-nav')).toBe(true)
    // Menu stays the only control named "Menu".
    expect(screen.getAllByRole('button', { name: 'Menu' })).toHaveLength(1)
    expect(screen.queryAllByRole('link', { name: /menu/i })).toHaveLength(0)
    // Send feedback sits in the footer regardless of Discord.
    const footer = document.querySelector('footer')!
    expect(within(footer as HTMLElement).getByRole('link', { name: 'Send feedback' }).getAttribute('href')).toBe('/feedback')
  })

  it('adds Send feedback and Discord to the site footer', () => {
    vi.stubEnv('VITE_PUBLIC_DISCORD_INVITE_URL', LONG_INVITE)
    render(<MemoryRouter><PublicLayout><p>page</p></PublicLayout></MemoryRouter>)
    const footer = screen.getByRole('navigation', { name: 'Footer' })
    expect(within(footer).getByRole('link', { name: 'Send feedback' }).getAttribute('href')).toBe('/feedback')
    expect(within(footer).getByRole('link', { name: 'Discord (opens in a new tab)' }).getAttribute('href')).toBe(LONG_INVITE)
  })

  it('keeps Send feedback in the site footer without an invite', () => {
    vi.stubEnv('VITE_PUBLIC_DISCORD_INVITE_URL', '')
    render(<MemoryRouter><PublicLayout><p>page</p></PublicLayout></MemoryRouter>)
    const footer = screen.getByRole('navigation', { name: 'Footer' })
    expect(within(footer).getByRole('link', { name: 'Send feedback' })).toBeTruthy()
    expect(within(footer).queryByText('Discord')).toBeNull()
  })

  it('gives every Discord link a name that contains its visible label (WCAG 2.5.3)', async () => {
    vi.stubEnv('VITE_PUBLIC_DISCORD_INVITE_URL', SHORT_INVITE)
    const landing = render(<MemoryRouter><Landing /></MemoryRouter>)
    await screen.findByRole('heading', { name: /actually reacted to/i })
    const support = render(<MemoryRouter><Feedback /></MemoryRouter>)
    const site = render(<MemoryRouter><PublicLayout><p>page</p></PublicLayout></MemoryRouter>)
    const links = discordLinks()
    expect(links.length).toBeGreaterThanOrEqual(6)
    const pill = links.find(a => a.classList.contains('sl-discord-pill'))!
    expect(pill.getAttribute('aria-label')).toBe('Join the Discord (opens in a new tab)')
    for (const link of links) {
      const visible = (link.textContent ?? '').replace(/\s+/g, ' ').trim()
      const name = link.getAttribute('aria-label') ?? visible
      // A voice-control user says what they see; the name has to contain it.
      if (visible) expect(name.toLowerCase(), link.className).toContain(visible.toLowerCase())
    }
    landing.unmount()
    support.unmount()
    site.unmount()
  })

  it('adds the quiet Discord line, labelled public, under the feedback card', () => {
    vi.stubEnv('VITE_PUBLIC_DISCORD_INVITE_URL', SHORT_INVITE)
    render(<MemoryRouter><Feedback /></MemoryRouter>)
    const line = screen.getByTestId('support-discord-line')
    expect(line.textContent).toContain('Ideas or just want to chat?')
    expect(line.textContent).toContain('Anyone there can read it, so keep account problems in this form.')
    expect(within(line).getByRole('link', { name: 'Join the public Discord (opens in a new tab)' }).getAttribute('href')).toBe(SHORT_INVITE)
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

  it('says the server is not open yet and points at /feedback without a valid invite', () => {
    vi.stubEnv('VITE_PUBLIC_DISCORD_INVITE_URL', 'https://discord.gg/not a code')
    const redirect = vi.fn()
    render(<MemoryRouter><Discord redirect={redirect} /></MemoryRouter>)
    expect(screen.getByRole('heading', { level: 1, name: "The StreamPulse Discord isn't open yet" })).toBeTruthy()
    const page = screen.getByTestId('discord-page')
    expect(within(page).getByRole('link', { name: 'Send feedback' }).getAttribute('href')).toBe('/feedback')
    expect(discordLinks()).toEqual([])
    expect(redirect).not.toHaveBeenCalled()
  })
})
