import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AnalyticsRouteFallback, accountWaitFor } from '../src/routes/AnalyticsRouteFallback'

/**
 * The account card shown while an account page's code loads (and written into
 * each account document by scripts/prerender.mjs) holds the height of the page's
 * first render where that render is taller than the room under the header, so
 * the footer does not jump when the page arrives. jsdom cannot measure layout:
 * this pins which page each card stands in for and that each has its rules.
 */
const css = readFileSync(resolve(process.cwd(), 'src/routes/account/account.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

function waitingCard(path: string) {
  const view = render(<MemoryRouter initialEntries={[path]}><AnalyticsRouteFallback variant="account" /></MemoryRouter>)
  const card = screen.getByRole('region', { name: 'StreamPulse account' })
  expect(card.textContent).toBe('Checking your account…')
  const wait = card.getAttribute('data-account-wait')
  view.unmount()
  return wait
}

afterEach(() => { vi.unstubAllEnvs() })

describe('account waiting card', () => {
  it('names the account page it stands in for', () => {
    vi.stubEnv('VITE_TWITCH_SIGNIN', '')
    expect(waitingCard('/account/sign-in')).toBe('sign-in')
    expect(waitingCard('/account/sign-in/')).toBe('sign-in')
    expect(waitingCard('/account/settings')).toBe('settings')
    expect(waitingCard('/account/billing')).toBe('billing')
    // The return from checkout opens on the same billing page.
    expect(waitingCard('/account/billing/return')).toBe('billing')
  })

  it('holds no height where the page opens on a card that fits the room under the header', () => {
    vi.stubEnv('VITE_TWITCH_SIGNIN', '')
    // Link-device opens on its own short waiting card; confirm and restore on short notes.
    for (const page of ['link-device', 'confirm', 'restore']) expect(waitingCard(`/account/${page}`), page).toBeNull()
    expect(accountWaitFor('/account/unknown')).toBeUndefined()
    // With Twitch sign-in on, sign-in first checks for an existing session on a short card.
    vi.stubEnv('VITE_TWITCH_SIGNIN', '1')
    expect(waitingCard('/account/sign-in')).toBeNull()
  })

  it('gives every page it names a held height on a phone and on a wider screen', () => {
    const phoneAt = css.search(/@media \(max-width: 540px\) \{\s*\.pulse-account\[data-account-wait=/)
    expect(phoneAt, 'the phone band follows the card\'s own 540px breakpoint').toBeGreaterThan(-1)
    const wide = css.slice(0, phoneAt)
    const phone = css.slice(phoneAt, css.indexOf('\n}', phoneAt))
    const held = (block: string, page: string) => block.match(new RegExp(`\\.pulse-account\\[data-account-wait="${page}"\\] \\{ min-height: (\\d+)px; \\}`))?.[1]
    for (const page of ['sign-in', 'settings', 'billing']) {
      // The bare waiting card is 99px tall on a phone and 131px wider: a held height is taller.
      expect(Number(held(phone, page)), `${page} on a phone`).toBeGreaterThan(99)
      expect(Number(held(wide, page)), `${page} on a wider screen`).toBeGreaterThan(131)
    }
    for (const page of ['link-device', 'confirm', 'restore']) expect(css).not.toContain(`data-account-wait="${page}"`)
  })
})
