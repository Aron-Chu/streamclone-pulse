import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ComponentType } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SUPPORTER_PERKS from '../../src/shared/supporter-perks.json'
import Privacy from '../src/routes/public/Privacy'
import Supporter from '../src/routes/public/Supporter'
import Terms from '../src/routes/public/Terms'
import { supporterChatBadgesEnabled } from '../src/lib/supporterChatBadgesFlag'
import { supporterOnlyYou, supporterPerkNames } from '../src/ui/components/SupporterPerks'

/**
 * "Seen in chat" (optional Supporter chat crest) copy. With
 * VITE_SUPPORTER_CHAT_BADGES off the public pages keep today's promises
 * (nothing in chat, nobody else sees the perks), which stay true until the
 * feature ships. With it on, no page may still say "nobody else sees them" or
 * "no public Twitch chat badge", and each says what is published, who sees it,
 * how to turn it off and how fast the entry disappears.
 */
const pages: Array<[string, ComponentType, string]> = [
  ['Terms', Terms, 'terms-of-use'],
  ['Supporter', Supporter, 'supporter-offer'],
  ['Privacy', Privacy, 'privacy-policy'],
]

function textOf(Page: ComponentType, testId: string): string {
  render(<MemoryRouter><Page /></MemoryRouter>)
  const text = screen.getByTestId(testId).textContent ?? ''
  cleanup()
  return text
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('supporter-perks.json Seen in chat entry', () => {
  it('pins the shared perk text (byte-identical with the extension)', () => {
    expect(SUPPORTER_PERKS.seenInChat).toEqual({
      name: 'Seen in chat',
      detail: 'optional: your crest beside your name and your paint on it in Twitch chat, for other StreamPulse viewers. Off until you turn it on.',
      onlyYou: 'Title paint, emote rain and the Supporter card show only in your own StreamPulse extension. Seen in chat is the one exception, and only if you turn it on: then other StreamPulse viewers see your crest and paint in chat. People without StreamPulse always see normal Twitch chat.',
    })
    // The four private perks are unchanged; Seen in chat is never one of `names`.
    expect(SUPPORTER_PERKS.names).toEqual(['Title paint', 'Tenure crest', 'Emote rain', 'Supporter card'])
  })
})

describe('VITE_SUPPORTER_CHAT_BADGES flag', () => {
  it.each([
    [undefined, false], ['', false], ['off', false], ['true', false], ['ON', false], ['on', true], ['1', true],
  ] as const)('%s -> %s', (value, expected) => {
    if (value !== undefined) vi.stubEnv('VITE_SUPPORTER_CHAT_BADGES', value)
    expect(supporterChatBadgesEnabled()).toBe(expected)
  })
})

describe('Seen in chat copy, flag off (before launch)', () => {
  it.each(['', 'off'])('keeps today’s promises with VITE_SUPPORTER_CHAT_BADGES=%s', value => {
    vi.stubEnv('VITE_SUPPORTER_CHAT_BADGES', value)
    expect(supporterOnlyYou()).toBe(SUPPORTER_PERKS.onlyYou)
    expect(supporterPerkNames()).toEqual(SUPPORTER_PERKS.names)
    expect(textOf(Terms, 'terms-of-use')).toContain('no public Twitch chat badge — it is not included')
    expect(textOf(Supporter, 'supporter-offer')).toMatch(/No public Twitch chat badge\. A chat badge is not included in Supporter/)
    for (const [, Page, testId] of pages) {
      const body = textOf(Page, testId)
      expect(body).not.toMatch(/Seen in chat/)
      expect(body).not.toMatch(/public list/)
    }
  })

  it('privacy says chatter identity is never exposed, without exception', () => {
    const body = textOf(Privacy, 'privacy-policy').replace(/\s+/g, ' ')
    expect(body).toContain('do not expose raw chat messages or chatter identity to users. The extension')
    expect(body).not.toMatch(/except the Twitch usernames/)
    expect(body).not.toMatch(/in plain form/)
  })
})

describe('Seen in chat copy, flag on (launch)', () => {
  it.each(pages)('%s no longer promises that nobody else sees the perks', (_, Page, testId) => {
    vi.stubEnv('VITE_SUPPORTER_CHAT_BADGES', 'on')
    const body = textOf(Page, testId)
    expect(body).not.toMatch(/nobody else sees them/i)
    expect(body).not.toMatch(/no public Twitch chat badge/i)
    expect(body).not.toMatch(/A chat badge is not included/i)
    expect(body).not.toMatch(/Nothing is added to chat/i)
  })

  it('lists Seen in chat as the fifth perk on /supporter and in the Terms', () => {
    vi.stubEnv('VITE_SUPPORTER_CHAT_BADGES', 'on')
    const expected = [
      ...SUPPORTER_PERKS.names.map(name => `${name}: ${SUPPORTER_PERKS.details[name as keyof typeof SUPPORTER_PERKS.details]}`),
      `Seen in chat: ${SUPPORTER_PERKS.seenInChat.detail}`,
    ]
    render(<MemoryRouter><Supporter /></MemoryRouter>)
    expect(Array.from(screen.getByTestId('supporter-perks').querySelectorAll('li')).map(li => li.textContent)).toEqual(expected)
    cleanup()
    render(<MemoryRouter><Terms /></MemoryRouter>)
    const benefits = screen.getByTestId('terms-supporter-benefits')
    expect(Array.from(benefits.querySelectorAll('li')).map(li => li.textContent)).toEqual(expected)
    expect(benefits.textContent).toContain(`${SUPPORTER_PERKS.seenInChat.onlyYou} ${SUPPORTER_PERKS.moved} Nothing else is promised.`)
    expect(supporterPerkNames()).toEqual([...SUPPORTER_PERKS.names, 'Seen in chat'])
  })

  it('Terms states what is published, who sees it, how to turn it off and how fast it leaves', () => {
    vi.stubEnv('VITE_SUPPORTER_CHAT_BADGES', 'on')
    render(<MemoryRouter><Terms /></MemoryRouter>)
    const notIncluded = (screen.getByTestId('terms-not-included').textContent ?? '').replace(/\s+/g, ' ')
    expect(notIncluded).toBe('What you do not get: nothing is added to Twitch’s own chat — people without StreamPulse always see normal chat — and no analytics, coverage or rate-limit changes of any kind.')
    const seen = (screen.getByTestId('terms-seen-in-chat').textContent ?? '').replace(/\s+/g, ' ')
    expect(seen).toMatch(/^Seen in chat \(optional\): it is off until you turn it on in the extension’s Account & Supporter settings\./)
    expect(seen).toContain('publishes your Twitch username, Twitch user ID, crest level and paint in a public list')
    expect(seen).toContain('to its users who haven’t hidden crests')
    expect(seen).toContain('Anyone can download that list.')
    expect(seen).toContain('Turn it off at any time; your entry leaves the list within about an hour.')
    expect(screen.getByTestId('terms-seen-in-chat').querySelector('a[href="/privacy"]')).toBeTruthy()
  })

  it('/supporter states the opt-in, what is published, who sees it and how to turn it off', () => {
    vi.stubEnv('VITE_SUPPORTER_CHAT_BADGES', 'on')
    render(<MemoryRouter><Supporter /></MemoryRouter>)
    const notIncluded = (screen.getByTestId('supporter-not-included-chat').textContent ?? '').replace(/\s+/g, ' ')
    expect(notIncluded).toBe('No Twitch chat badge. Twitch’s own chat never changes. Your crest and paint show only to other StreamPulse viewers, and only if you turn on Seen in chat.')
    const seen = (screen.getByTestId('supporter-seen-in-chat').textContent ?? '').replace(/\s+/g, ' ')
    expect(seen).toContain('It stays off until you turn it on')
    expect(seen).toContain('publishes your Twitch username, Twitch user ID, crest level and paint in a public list')
    expect(seen).toContain('who haven’t hidden crests')
    expect(seen).toContain('People without StreamPulse see normal chat, and nothing is sent to Twitch.')
    expect(seen).toContain('your entry leaves the list within about an hour')
  })

  it('Privacy describes storage, the public list, local matching, the Helix lookup and deletion', () => {
    vi.stubEnv('VITE_SUPPORTER_CHAT_BADGES', 'on')
    render(<MemoryRouter><Privacy /></MemoryRouter>)
    const body = (screen.getByTestId('privacy-policy').textContent ?? '').replace(/\s+/g, ' ')
    expect(body).toContain('chatter identity to users, except the Twitch usernames of Supporters who choose to be seen in chat.')
    expect((screen.getByTestId('privacy-continue-with-twitch').textContent ?? '').replace(/\s+/g, ' '))
      .toContain('If you turn on Seen in chat, StreamPulse also stores your Twitch user ID and username in plain form so it can publish them; turning it off deletes them.')
    const section = (screen.getByTestId('privacy-seen-in-chat').textContent ?? '').replace(/\s+/g, ' ')
    expect(section).toMatch(/^Seen in chat \(optional, Supporters only\)/)
    expect(section).toContain('Nothing until you turn it on.')
    expect(section).toContain('your Twitch user ID, Twitch username, crest level')
    expect(section).toContain('no account identifier, email, billing detail or date')
    expect(section).toContain('Anyone can download it.')
    expect(section).toContain('StreamPulse never learns which channels or chats anyone opens.')
    expect(section).toContain('asks Twitch’s API for the current username')
    expect(section).toContain('your entry leaves the list within about an hour')
    expect(section).toContain('deleted 30 days later')
    expect((screen.getByTestId('privacy-observes-chat-usernames').textContent ?? '').replace(/\s+/g, ' '))
      .toBe('To show Supporter crests, the extension reads the usernames on chat lines in your browser and compares them with the Seen in chat list. It doesn’t store or send them.')
    expect((screen.getByTestId('privacy-third-party-twitch').textContent ?? '').replace(/\s+/g, ' '))
      .toContain('StreamPulse also uses that notification to delete your Seen in chat entry.')
    // Billing identifiers are still never attached to a badge.
    expect(body).toContain('never shown publicly or attached to a badge or profile')
  })
})
