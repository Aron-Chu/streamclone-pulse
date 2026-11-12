import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CHAT_BADGE_CONSENT_COPY, SupporterChatBadgeControls } from '../src/options/SupporterChatBadgeControls.tsx'
import { SupporterPerkList } from '../src/options/SupporterPerkList.tsx'
import { SupporterLookPreview } from '../src/options/SupporterLookPreview.tsx'
import { DEFAULT_SUPPORTER_PAINT } from '../src/shared/supporterPaint.ts'

describe('shared cosmetics disclosure', () => {
  it('explains the opt-in, public identity and eventual removal', () => {
    expect(CHAT_BADGE_CONSENT_COPY.version).toBe(2)
    const consent = CHAT_BADGE_CONSENT_COPY.points.join(' ')
    expect(consent).toContain('Twitch user ID')
    expect(consent).toContain('Anyone can download this list.')
    expect(consent).toContain('turn this off')
    expect(consent).toContain('cached copy')
    expect(consent).not.toMatch(/leaves the list within about an hour/)
  })

  it('keeps the original private copy when chat cosmetics are unavailable', () => {
    const html = renderToStaticMarkup(<SupporterPerkList />)
    expect(html).toContain('Nothing is added to Twitch chat')
    expect(html).not.toContain('Seen in chat')
  })

  it('replaces the private-only claim when shared chat appearance is offered', () => {
    // The full list keeps the perk and leaves who-sees-what to the cards' tags.
    const html = renderToStaticMarkup(<SupporterPerkList seenInChat />)
    expect(html).toContain('Seen in chat')
    expect(html).toContain('Off until you turn it on')
    expect(html).not.toContain('Nothing is added to Twitch chat')
    expect(html).not.toContain('only if you turn it on')
    const offer = renderToStaticMarkup(<SupporterPerkList compact seenInChat />)
    expect(offer).toContain('only if you turn it on')
    expect(offer).not.toContain('Nothing is added to Twitch chat')
    const preview = renderToStaticMarkup(<SupporterLookPreview finish="glass" paint={DEFAULT_SUPPORTER_PAINT} tenure="new" rain={{ mode: 'off', intensity: 35, title: '' }} seenInChat />)
    expect(preview).toContain('separately opt in')
    expect(preview).not.toContain('Everyone else on Twitch sees normal chat.')
  })

  it('allows an outdated paused consent to be withdrawn even before a key is pinned', () => {
    const html = renderToStaticMarkup(<SupporterChatBadgeControls entitlement={{
      state: 'ready', status: 'active', supportPeriods: 6, features: [],
      chatBadge: { available: true, state: 'paused', login: 'fixture', consentVersion: 1 },
    }} look={{ finish: null, paint: DEFAULT_SUPPORTER_PAINT, tenure: '6m' }} />)
    expect(html).toContain('Public · Needs your OK')
    expect(html).toContain('Turn on again to keep showing')
    // Without a pinned key, Review and turn on waits; Turn off works.
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Review and turn on<\/button>/)
    expect(html).toMatch(/<button type="button">Turn off<\/button>/)
    expect(html).not.toContain('role="switch"')
    expect(html).not.toContain('Paused while your membership is inactive')
  })
})
