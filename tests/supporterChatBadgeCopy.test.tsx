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
    const html = renderToStaticMarkup(<SupporterPerkList seenInChat />)
    expect(html).toContain('Seen in chat')
    expect(html).toContain('only if you turn it on')
    expect(html).not.toContain('Nothing is added to chat')
    const preview = renderToStaticMarkup(<SupporterLookPreview finish="glass" paint={DEFAULT_SUPPORTER_PAINT} tenure="new" rain={{ mode: 'off', intensity: 35, title: '' }} seenInChat />)
    expect(preview).toContain('separately opt in')
    expect(preview).not.toContain('Everyone else on Twitch sees normal chat.')
  })

  it('allows an outdated paused consent to be withdrawn even before a key is pinned', () => {
    const html = renderToStaticMarkup(<SupporterChatBadgeControls entitlement={{
      state: 'ready', status: 'active', supportPeriods: 6, features: [],
      chatBadge: { available: true, state: 'paused', login: 'fixture', consentVersion: 1 },
    }} />)
    expect(html).toContain('Turn on again to keep showing')
    expect(html).toContain('Turn off')
    expect(html).toContain('disabled=""')
    expect(html).not.toContain('Paused while your membership is inactive')
  })
})
