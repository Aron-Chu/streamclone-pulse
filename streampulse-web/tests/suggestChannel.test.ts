import { afterEach, describe, expect, it, vi } from 'vitest'
import { SUGGEST_IN_DISCORD_LABEL, suggestChannelLink } from '../src/lib/suggestChannel'

afterEach(() => vi.unstubAllEnvs())

describe('suggestChannelLink', () => {
  it('goes straight to the public Discord, and says so, until the private form opens', () => {
    vi.stubEnv('VITE_PUBLIC_DISCORD_INVITE_URL', 'https://discord.gg/streampulse')
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '')
    expect(suggestChannelLink()).toEqual({ href: 'https://discord.gg/streampulse', label: 'Suggest it in Discord (public)' })
    expect(SUGGEST_IN_DISCORD_LABEL).toBe('Suggest it in Discord (public)')
  })

  it('keeps "Suggest a channel" on /feedback once the form is open', () => {
    vi.stubEnv('VITE_PUBLIC_DISCORD_INVITE_URL', 'https://discord.gg/streampulse')
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '0x4AAAAAAA-site-key')
    expect(suggestChannelLink()).toBeUndefined()
  })

  it('keeps it on /feedback when this build has no valid Discord invite (Discord links stay hidden)', () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '')
    vi.stubEnv('VITE_PUBLIC_DISCORD_INVITE_URL', '')
    expect(suggestChannelLink()).toBeUndefined()
    vi.stubEnv('VITE_PUBLIC_DISCORD_INVITE_URL', 'http://discord.gg/streampulse')
    expect(suggestChannelLink()).toBeUndefined()
    vi.stubEnv('VITE_PUBLIC_DISCORD_INVITE_URL', 'https://evil.example/streampulse')
    expect(suggestChannelLink()).toBeUndefined()
  })
})
