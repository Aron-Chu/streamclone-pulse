// @vitest-environment jsdom
import SUPPORTER_PERKS from '../src/shared/supporter-perks.json'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { SupporterAccountSection } from '../src/options/SupporterAccountSection.tsx'
import { renewalLine } from '../src/options/SupporterJourney.tsx'
import { SupporterCosmeticControls } from '../src/options/SupporterCosmeticControls.tsx'
import { injectHostStyles } from '../src/options/hostStyles.ts'
import { parseBackgroundRequest } from '../src/shared/parseBackgroundRequest.ts'
import type { SupporterEntitlement } from '../src/shared/supporterAccount.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** The server says Supporter is not on sale yet: the studio is try-only. */
const CLOSED: SupporterEntitlement = { state: 'ready', status: 'none', supportPeriods: 0, features: [], checkoutEnabled: false }

/** The chips on the paint swatches, as "Chip:finish", sorted: the paint in use and the one being tried. */
const chipState = (host: HTMLElement) => [...host.querySelectorAll('.pulse-supporter-tile')]
  .flatMap(tile => [...tile.querySelectorAll('[data-chip]')].map(chip => `${chip.textContent?.trim().replace(/^· /, '')}:${tile.querySelector('input')!.value.replace('finish-', '')}`))
  .sort()

describe('equipping paint without losing keyboard focus', () => {
  it.each([false, true])('keeps focus while saving and respects a user moving elsewhere: %s', async moveElsewhere => {
    let finish!: (value: unknown) => void
    const sendMessage = vi.fn(() => new Promise(resolve => { finish = resolve }))
    vi.stubGlobal('chrome', { runtime: { sendMessage } })
    const host = document.createElement('div'), outside = document.createElement('button')
    document.body.append(host, outside)
    const root = createRoot(host)
    try {
      await act(async () => root.render(<SupporterCosmeticControls entitlement={{ state: 'ready', status: 'active', supportPeriods: 2, features: ['supporter.banner.v1', 'supporter.finish.v1'], cosmetics: { enabled: true, finish: 'glass' } }} />))
      const halo = host.querySelector<HTMLInputElement>('input[value="finish-halo"]')!
      await act(async () => halo.click())
      const equip = [...host.querySelectorAll('button')].find(button => button.textContent === 'Equip look')!
      equip.focus()
      await act(async () => equip.click())
      expect(document.activeElement).toBe(equip)
      expect(equip.disabled).toBe(false)
      expect(equip.getAttribute('aria-busy')).toBe('true')
      await act(async () => equip.click())
      expect(sendMessage).toHaveBeenCalledTimes(1)
      if (moveElsewhere) outside.focus()
      await act(async () => finish({ type: 'SUPPORTER_COSMETICS', ok: true }))
      // Equip look leaves once saved: focus lands on the checked paint, unless the user moved on.
      expect(halo.checked).toBe(true)
      expect(document.activeElement).toBe(moveElsewhere ? outside : halo)
      expect([...host.querySelectorAll('button')].some(button => button.textContent === 'Equip look')).toBe(false)
      expect(host.querySelector('.pulse-supporter-save-status')?.textContent).toBe('Equipped: Halo · Shimmer · no backdrop.')
      expect(halo.closest('label')?.textContent).toContain('· Equipped')
      expect(halo.closest('label')?.querySelector('.pulse-supporter-tile-chip')).toBeNull()
    } finally { act(() => root.unmount()); host.remove(); outside.remove(); vi.unstubAllGlobals() }
  })
})

describe('reverting a look without losing keyboard focus', () => {
  it('moves focus to the checked paint when Revert drops the draft', async () => {
    vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn() } })
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(<SupporterCosmeticControls tenure="new" entitlement={{ state: 'ready', status: 'active', supportPeriods: 2, features: ['supporter.banner.v1', 'supporter.finish.v1'], cosmetics: { enabled: true, finish: 'glass' } }} />))
      await act(async () => host.querySelector<HTMLInputElement>('input[value="finish-halo"]')!.click())
      const revert = [...host.querySelectorAll('button')].find(button => button.textContent === 'Revert')!
      revert.focus()
      await act(async () => revert.click())
      expect([...host.querySelectorAll('button')].some(button => button.textContent === 'Revert' || button.textContent === 'Equip look')).toBe(false)
      expect(host.querySelector<HTMLInputElement>('input[value="finish-glass"]')!.checked).toBe(true)
      expect(document.activeElement).toBe(host.querySelector('.pulse-supporter-look input:checked'))
    } finally { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() }
  })
})

describe('supporter settings', () => {
  it('draws Your card, who sees what and your look without storage, network, or entitlement mutation', async () => {
    const write = vi.fn()
    const sendMessage = vi.fn().mockImplementation((message: { type: string }) =>
      message.type === 'SUPPORTER_ENTITLEMENT'
        ? Promise.resolve({ type: 'SUPPORTER_ENTITLEMENT', entitlement: { state: 'not_linked' } })
        : Promise.resolve({ type: 'SUPPORTER_ACCOUNT', account: { state: 'signed_out' } }))
    vi.stubGlobal('chrome', { storage: { local: { set: write }, sync: { set: write } }, runtime: { sendMessage } })
    vi.stubGlobal('fetch', write)
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(<SupporterAccountSection />))
      expect(host.querySelector('h2')?.textContent).toBe('Account & Supporter')
      // Your card: only an identity that exists. Twitch sign-in is off, so nobody is signed in and no Twitch name is drawn.
      const card = host.querySelector<HTMLElement>('.pulse-supporter-card')!
      // Heading navigation stops at the card: a visually hidden h3 names it,
      // between the page's h2 and "Your look" (the preview's own title is decoration).
      const outline = [...host.querySelectorAll<HTMLElement>('h2, h3')].filter(heading => !heading.closest('[aria-hidden="true"]')).map(heading => `${heading.tagName} ${heading.textContent}`)
      expect(outline).toEqual(['H2 Account & Supporter', 'H3 Your Supporter card', 'H3 Your look', 'H3 Account'])
      const heading = card.querySelector('h3')!
      expect(card.firstElementChild).toBe(heading)
      expect(heading.id).not.toBe('')
      expect(card.getAttribute('aria-labelledby')).toBe(heading.id)
      expect(card.hasAttribute('aria-label')).toBe(false)
      expect(heading.className).toBe('pulse-visually-hidden')
      expect(card.dataset.supporterCard).toBe('sample')
      expect(card.querySelector('.pulse-supporter-card-who strong')?.textContent).toBe('Not connected')
      expect(card.querySelector('.pulse-supporter-card-avatar')?.getAttribute('data-identity')).toBe('none')
      expect(card.querySelector('.pulse-supporter-card-sample')?.textContent).toBe('Sample look')
      // The card names nobody; the footer says how Supporter will start.
      expect(card.querySelector('.pulse-supporter-card-who')?.textContent).not.toMatch(/twitch/i)
      // The card wears the sample paint, with the backdrop across its top and no gradient layer of its own.
      expect(card.style.getPropertyValue('--spk-fin')).toBe('#efc96a')
      expect(card.querySelector('.pulse-supporter-card-banner .pulse-banner-art')?.getAttribute('data-mode')).toBe('rain')
      expect(card.querySelectorAll('.pulse-supporter-card-banner .pulse-banner-art svg')).toHaveLength(6)
      expect(card.querySelectorAll('.pulse-supporter-card-banner img')).toHaveLength(0)
      // The five-step crest ladder starts at New for everyone who is not a Supporter.
      const steps = [...card.querySelectorAll<HTMLElement>('.pulse-supporter-ladder li')]
      expect(steps.map(step => step.textContent)).toEqual(['New', '3 mo', '6 mo', '1 year', '2 years'])
      expect(steps.map(step => step.dataset.step)).toEqual(['start', 'off', 'off', 'off', 'off'])
      expect(card.querySelector('.pulse-supporter-ladder-next')?.textContent).toBe('Your crest starts at New and grows at 3, 6, 12 and 24 months.')
      // The journey is the card's footer: one primary action, with the price.
      const journey = card.querySelector<HTMLElement>('.pulse-journey')!
      expect(journey.dataset.journeyState).toBe('signed-out')
      expect([...journey.querySelectorAll('.pulse-journey-primary')].map(button => button.textContent)).toEqual(['Become a Supporter'])
      expect(journey.textContent).toContain("US$4.99 a month")
      // One click saves a key and asks the server; nothing starts before it.
      expect(journey.textContent).toContain('Opens Stripe checkout. No account or sign-up. Saves a key in this browser.')
      expect(card.textContent?.match(/Free tools work without an account\./g)).toHaveLength(1)
      const previewDisclosure = host.querySelector<HTMLDetailsElement>('[data-supporter-preview-disclosure]')!
      expect(previewDisclosure.open).toBe(false)
      expect(previewDisclosure.querySelector('summary')?.textContent).toBe('Preview Supporter looks')
      expect(previewDisclosure.contains(journey)).toBe(false)
      const help = host.querySelector<HTMLDetailsElement>('.pulse-supporter-help')!
      expect(help.open).toBe(false)
      expect(help.querySelector('summary')?.textContent).toBe('Account help')
      expect(help.querySelector('[data-row="payments"]')).not.toBeNull()
      expect(host.textContent).not.toMatch(/Restore my Supporter|website account|Connect this extension/)
      expect(host.textContent).toContain('remain free')
      // The Your look studio's preview, pinned above its controls: it says once
      // that only you see it, names every perk, and offers nothing unbuilt.
      const preview = host.querySelector<HTMLElement>('.pulse-supporter-studio [data-supporter-preview]')!
      expect(preview.dataset.supporterPreview).toBe('sample')
      expect(preview.querySelector('.pulse-supporter-preview-badge')?.textContent).toBe('Preview · only you see this')
      expect(preview.querySelector('[data-supporter-perk-names="true"]')?.textContent).toBe(SUPPORTER_PERKS.names.join(' · '))
      expect(preview.textContent).toContain('Everyone else on Twitch sees normal chat.')
      expect(preview.textContent).not.toContain('Sample look')
      // It wears the sample paint and crest, with the sample's backdrop drifting.
      expect(preview.style.getPropertyValue('--spk-fin')).toBe('#efc96a')
      expect(preview.querySelector('.pulse-supporter-chat-line .pulse-crest')).not.toBeNull()
      expect(preview.querySelector('.pulse-banner-art')?.getAttribute('data-mode')).toBe('rain')
      expect(host.querySelector('[data-concept]')).toBeNull()
      expect(host.textContent).not.toContain('Concept · not built')
      // Your look: looks, paint, motion and backdrop; the backdrop can be tried here, not saved.
      expect([...host.querySelectorAll('.pulse-supporter-look-row > legend')].map(legend => legend.textContent)).toEqual(['Looks', 'Paint', 'Motion', 'Backdrop'])
      expect(host.querySelector('[data-supporter-perk="backdrop"]')?.textContent).toBe('The backdrop is a Supporter perk. Only you see it. See Supporter →')
      // No signature emote anywhere, and the old badge preview is gone.
      expect(host.textContent).not.toMatch(/signature/i)
      expect(host.querySelector('.pulse-supporter-tenure-choices, .pulse-supporter-chat-preview')).toBeNull()

      // No storage write, no direct fetch: previewing and reading status are
      // both side-effect free, so a local edit cannot grant an entitlement.
      expect(write).not.toHaveBeenCalled()
      const sent = sendMessage.mock.calls.map(([message]) => message)
      expect(sent).toEqual([
        { type: 'SUPPORTER_ACCOUNT', action: 'status' },
        { type: 'SUPPORTER_ENTITLEMENT' },
        { type: 'SUPPORTER_BILLING', action: 'status' },
        // Reading the optional pre-purchase finish choice; no `finish` field, so no write.
        { type: 'SUPPORTER_FINISH_INTENT' },
      ])
      // Both are reads. Nothing here may carry an action that mutates billing.
      for (const message of sent) {
        expect(JSON.stringify(message)).not.toMatch(/checkout|portal|subscribe|equip/i)
      }
    } finally {
      act(() => root.unmount())
      host.remove()
      vi.unstubAllGlobals()
    }
  })

  it('states a Supporter’s months and earned crest on the ladder, naming the connected account, without granting a badge', async () => {
    const sendMessage = vi.fn().mockImplementation((message: { type: string }) =>
      message.type === 'SUPPORTER_ENTITLEMENT'
        ? Promise.resolve({ type: 'SUPPORTER_ENTITLEMENT', entitlement: {
          state: 'ready', status: 'active', supportPeriods: 7, features: ['supporter.banner.v1', 'supporter.finish.v1'], cosmetics: { enabled: true, finish: 'halo' },
        } })
        : message.type === 'SUPPORTER_ACCOUNT'
          ? Promise.resolve({ type: 'SUPPORTER_ACCOUNT', account: { state: 'linked', accountId: '11111111-1111-4111-8111-1111111a1b2c', expiresAt: new Date(Date.now() + 86_400_000).toISOString() } })
          : Promise.resolve(undefined))
    vi.stubGlobal('chrome', { runtime: { sendMessage } })
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(<SupporterAccountSection />))
      const card = host.querySelector<HTMLElement>('.pulse-supporter-card')!
      expect(card.dataset.supporterCard).toBe('own')
      expect(card.querySelector('.pulse-supporter-card-sample')).toBeNull()
      // The card says "You"; the Account row names the connected StreamPulse account, masked as the website shows it.
      const name = card.querySelector<HTMLElement>('.pulse-supporter-card-who strong')!
      expect(name.textContent).toBe('You')
      expect(host.textContent).toContain('Connected to this extension · ··1a1b2c')
      expect(card.querySelector('.pulse-supporter-card-avatar')?.getAttribute('data-identity')).toBe('pulse')
      // Painted in their equipped finish, with the crest the server's count earns.
      expect(name.querySelector('.pulse-crest')?.getAttribute('data-tenure')).toBe('6m')
      expect(name.querySelector<HTMLElement>('.pulse-paint')?.dataset).toMatchObject({ finish: 'halo', text: 'You' })
      expect(card.style.getPropertyValue('--spk-fin')).toBe('#e6a9d6')
      expect(card.querySelector('.pulse-supporter-card-who > span')?.textContent).toBe('Supporter for 7 months')
      const steps = [...card.querySelectorAll<HTMLElement>('.pulse-supporter-ladder li')]
      expect(steps.map(step => step.dataset.step)).toEqual(['past', 'past', 'current', 'off', 'off'])
      expect(steps[2].getAttribute('aria-current')).toBe('step')
      expect(card.querySelector('.pulse-supporter-ladder-next')?.textContent).toBe('Next crest in 5 months')
      // A paid-up member's footer is not the payment-issue warning.
      const journey = card.querySelector<HTMLElement>('.pulse-journey')!
      expect(journey.dataset.journeyState).toBe('active')
      expect(journey.hasAttribute('data-tone')).toBe(false)
      // Billing is one tap away on the card, with no second door in the Account card, and nothing about a chat badge is offered as included.
      expect(host.querySelector('.pulse-journey-primary[data-supporter-action="billing"]')?.textContent).toBe('Manage on Stripe ↗')
      // The ladder and perks stay in the disclosure, closed for members too: Your look and Seen in chat sit below the card.
      expect(host.querySelector<HTMLDetailsElement>('[data-supporter-preview-disclosure]')?.open).toBe(false)
      expect(host.querySelector('[data-row="billing"]')).toBeNull()
      expect(host.querySelector('.pulse-journey')?.closest('[data-supporter-preview-disclosure]')).toBeNull()
      expect(host.textContent).not.toContain('Concept · not built')
      expect(host.textContent).not.toContain("US$4.99 a month")
      // An active member's pre-purchase choice is never read.
      expect(sendMessage.mock.calls.map(([message]) => message)).toEqual([{ type: 'SUPPORTER_ACCOUNT', action: 'status' }, { type: 'SUPPORTER_ENTITLEMENT' }, { type: 'SUPPORTER_BILLING', action: 'status' }])
    } finally {
      act(() => root.unmount())
      host.remove()
      vi.unstubAllGlobals()
    }
  })

  it.each<[string, SupporterEntitlement | null, string | null]>([
    ['open', { state: 'ready', status: 'none', supportPeriods: 0, features: [], checkoutEnabled: true }, "The backdrop is a Supporter perk. Only you see it. See Supporter →"],
    ['closed', { state: 'ready', status: 'none', supportPeriods: 0, features: [], checkoutEnabled: false }, "The backdrop is a Supporter perk. Only you see it. Supporter isn't on sale yet. See Supporter →"],
    ['older server', { state: 'ready', status: 'none', supportPeriods: 0, features: [] }, null],
    ['failed', { state: 'error' }, null],
    ['unavailable', { state: 'unavailable', reason: 'temporarily_unavailable' }, null],
    ['member', { state: 'ready', status: 'active', supportPeriods: 1, features: ['supporter.banner.v1', 'supporter.finish.v1'], checkoutEnabled: true }, null],
    ['pending', null, null],
  ])('keeps backdrop availability honest when %s without changing entitlement', async (_name, entitlement, copy) => {
    const sendMessage = vi.fn(async (_message: { type: string }) => undefined)
    vi.stubGlobal('chrome', { runtime: { sendMessage } })
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(<SupporterCosmeticControls entitlement={entitlement} />))
      expect(host.querySelector('[data-supporter-perk="backdrop"]')?.textContent ?? null).toBe(copy)
      if (entitlement === null) {
        expect(host.querySelector('[data-supporter-perks="pending"]')?.hasAttribute('disabled')).toBe(true)
        expect(host.textContent).toContain('Checking Supporter status…')
      }
      expect(sendMessage.mock.calls.map(([message]) => message)).not.toContainEqual(expect.objectContaining({ type: 'SUPPORTER_COSMETICS' }))
    } finally {
      act(() => root.unmount())
      host.remove()
      vi.unstubAllGlobals()
    }
  })

  it('allows the internal supporter destination but rejects destination injection', () => {
    expect(parseBackgroundRequest({ type: 'OPEN_SETTINGS_HOST', section: 'supporter' })).toEqual({ type: 'OPEN_SETTINGS_HOST', section: 'supporter' })
    for (const field of ['url', 'path', 'target']) {
      expect(parseBackgroundRequest({ type: 'OPEN_SETTINGS_HOST', section: 'supporter', [field]: 'https://example.com' })).toBeNull()
    }
    expect(parseBackgroundRequest({ type: 'OPEN_SETTINGS_HOST', section: 'supporter?token=secret' })).toBeNull()
  })

  it('keeps expired Supporter cosmetics preview-only', async () => {
    const sendMessage = vi.fn()
    vi.stubGlobal('chrome', { runtime: { sendMessage } })
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(
        <SupporterCosmeticControls
          entitlement={{
            state: 'ready',
            status: 'expired',
            supportPeriods: 24,
            features: ['supporter.banner.v1', 'supporter.finish.v1'],
            cosmetics: { enabled: true, finish: 'glass' },
          }}
        />,
      ))
      // An expired member has nothing to equip: the only action is the choice for when Supporter starts, never Equip look.
      expect([...host.querySelectorAll('.pulse-account-link-actions button')].map(button => button.textContent)).toEqual(['Use this look when Supporter starts'])
      expect(host.textContent).not.toMatch(/Equip look|Default active/)
      // The backdrop can be tried in the preview only: it starts on the sample's backdrop, and a press saves nothing.
      const locked = host.querySelector('[data-supporter-perks="locked"]')!
      expect(locked.querySelectorAll('button:disabled')).toHaveLength(0)
      expect([...locked.querySelectorAll('[aria-pressed="true"]')].map(button => button.textContent)).toEqual(['On'])
      await act(async () => { [...locked.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Off')!.click() })
      expect([...locked.querySelectorAll('[aria-pressed="true"]')].map(button => button.textContent)).toEqual(['Off'])
      expect(host.querySelector('[data-supporter-preview] .pulse-banner-art')?.getAttribute('data-mode')).toBe('off')
      // No "Preview: … / Active: …" line: the swatches carry the state.
      expect(host.textContent).not.toMatch(/Preview: |Active: /)
      expect(chipState(host)).toEqual([])
      expect(host.textContent).toContain('Preview is free. Choose a look now and it applies when your Supporter membership starts.')
      // Only a read of the optional saved choice; never a save.
      expect(sendMessage.mock.calls).toEqual([[{ type: 'SUPPORTER_FINISH_INTENT' }]])
    } finally {
      act(() => root.unmount())
      host.remove()
      vi.unstubAllGlobals()
    }
  })

  it('tries every closed-state cosmetic locally, starting on the sample look, without any writes or new worker calls', async () => {
    const sendMessage = vi.fn(async (message: { type: string }) => message.type === 'SUPPORTER_FINISH_INTENT' ? { type: 'SUPPORTER_FINISH_INTENT', ok: true, finish: null } : undefined)
    const write = vi.fn()
    vi.stubGlobal('chrome', { runtime: { id: 'test-extension', sendMessage }, storage: { sync: { get: vi.fn(async () => ({ supporterPaintStyle: { wave: 'ripple', sheen: 'glint' }, pulseBanner: { mode: 'off', intensity: 20, title: '' } })), set: write }, local: { set: write } } })
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const checked = (name: string) => [...host.querySelectorAll<HTMLInputElement>(`input[name="${name}"]:checked`)].map(input => input.value)
    try {
      await act(async () => root.render(<SupporterCosmeticControls entitlement={CLOSED} tenure="new" />))
      expect(host.textContent).toContain("Try a look. Changes here aren't saved.")
      expect(host.textContent).not.toContain('Try anything')
      // A visitor starts on the sample look (Gold leaf), not on what this profile saved or on Default.
      expect(checked('supporter-look')).toEqual(['look-Gold leaf'])
      expect(checked('supporter-finish')).toEqual(['finish-etched'])
      expect(checked('supporter-motion')).toEqual(['motion-drift'])
      expect(host.querySelector('.pulse-supporter-preview .pulse-banner-art')?.getAttribute('data-mode')).toBe('rain')
      expect(host.querySelector<HTMLInputElement>('input[type="range"]')!.value).toBe('40')
      const callsBeforeTry = sendMessage.mock.calls.length
      await act(async () => { host.querySelector<HTMLInputElement>('input[value="finish-halo"]')!.click() })
      await act(async () => { host.querySelector<HTMLInputElement>('input[value="motion-still"]')!.click() })
      expect(host.querySelector('.pulse-supporter-preview .pulse-paint')?.getAttribute('data-finish')).toBe('halo')
      expect(host.querySelector('.pulse-supporter-preview .pulse-paint')?.getAttribute('data-wave')).toBe('smooth')
      expect(host.querySelector('.pulse-supporter-preview .pulse-paint')?.getAttribute('data-sheen')).toBe('none')
      expect(host.querySelector('.pulse-supporter-preview .pulse-banner-art')?.getAttribute('data-mode')).toBe('still')
      await act(async () => { [...host.querySelectorAll<HTMLButtonElement>('[data-supporter-perks="locked"] button')].find(button => button.textContent === 'Off')!.click() })
      expect(host.querySelector('.pulse-supporter-preview .pulse-banner-art')?.getAttribute('data-mode')).toBe('off')
      await act(async () => { host.querySelector<HTMLInputElement>('input[value="look-Signal"]')!.click() })
      expect(checked('supporter-finish')).toEqual(['finish-glass'])
      expect(chipState(host)).toEqual([])
      expect(host.querySelector('.pulse-account-link-actions')).toBeNull()
      expect(host.textContent).not.toMatch(/Save for when|Saved for when|Preview is free|Equip look|Save look/)
      expect(sendMessage).toHaveBeenCalledTimes(callsBeforeTry)
      expect(write).not.toHaveBeenCalled()
    } finally {
      act(() => root.unmount())
      host.remove()
      vi.unstubAllGlobals()
    }
  })

  it('shows a closed earlier choice until its real expiry and removes it through the existing worker action', async () => {
    const now = Date.parse('2026-10-26T12:00:00Z')
    vi.spyOn(Date, 'now').mockReturnValue(now)
    const setAt = Date.parse('2026-10-22T12:00:00Z')
    const sendMessage = vi.fn(async (message: { type: string; finish?: string | null }) => ({ type: 'SUPPORTER_FINISH_INTENT', finish: message.finish === null ? null : 'halo', ...(message.finish === null ? {} : { setAt }) }))
    vi.stubGlobal('chrome', { runtime: { sendMessage } })
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(<SupporterCosmeticControls entitlement={{ state: 'ready', status: 'none', supportPeriods: 0, features: [], checkoutEnabled: false }} />))
      expect(host.querySelector('[data-supporter-finish-intent]')?.textContent).toBe('Saved earlier: Halo, until Oct 29. Remove')
      expect(host.textContent).not.toContain('Clear choice')
      await act(async () => { [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Remove')!.click() })
      expect(sendMessage).toHaveBeenLastCalledWith({ type: 'SUPPORTER_FINISH_INTENT', finish: null })
      expect(host.querySelector('[data-supporter-finish-intent]')).toBeNull()
    } finally {
      act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals()
    }
  })

  it('does not present an expired earlier choice as still saved', async () => {
    const sendMessage = vi.fn(async () => ({ type: 'SUPPORTER_FINISH_INTENT', finish: 'halo', setAt: Date.now() - 8 * 86_400_000 }))
    vi.stubGlobal('chrome', { runtime: { sendMessage } })
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(<SupporterCosmeticControls entitlement={CLOSED} />))
      expect(host.querySelector('[data-supporter-finish-intent]')).toBeNull()
      expect(host.textContent).not.toContain('Remove')
    } finally { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() }
  })

  it('keeps the seven-day line before saving a choice while checkout is open', async () => {
    const sendMessage = vi.fn(async (message: { type: string; finish?: string | null }) => ({ type: 'SUPPORTER_FINISH_INTENT', finish: message.finish ?? null, ...(message.finish ? { setAt: Date.now() } : {}) }))
    vi.stubGlobal('chrome', { runtime: { sendMessage } })
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(<SupporterCosmeticControls entitlement={{ state: 'ready', status: 'none', supportPeriods: 0, features: [], checkoutEnabled: true }} tenure="new" />))
      expect(host.textContent).toContain('We keep this choice for 7 days.')
    } finally { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() }
  })

  it('keeps the seven-day line after saving a choice while checkout is open, and clears it on request', async () => {
    // A live sync store, so the motion and backdrop written with the choice are read back.
    const store: Record<string, unknown> = {}
    const listeners = new Set<(changes: Record<string, chrome.storage.StorageChange>, area: string) => void>()
    const set = vi.fn(async (items: Record<string, unknown>) => {
      const changes = Object.fromEntries(Object.entries(items).map(([key, value]) => [key, { newValue: value }]))
      Object.assign(store, items)
      listeners.forEach(listener => listener(changes, 'sync'))
    })
    const sendMessage = vi.fn(async (message: { type: string; finish?: string | null }) => ({ type: 'SUPPORTER_FINISH_INTENT', finish: message.finish ?? null, ...(message.finish ? { setAt: Date.now() } : {}) }))
    vi.stubGlobal('chrome', { runtime: { id: 'test-extension', sendMessage }, storage: {
      sync: { get: vi.fn(async (key: string) => ({ [key]: store[key] })), set },
      onChanged: { addListener: (listener: never) => listeners.add(listener), removeListener: (listener: never) => listeners.delete(listener) },
    } })
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    const buttons = () => [...host.querySelectorAll<HTMLButtonElement>('button')].map(button => button.textContent)
    try {
      await act(async () => root.render(<SupporterCosmeticControls entitlement={{ state: 'ready', status: 'none', supportPeriods: 0, features: [], checkoutEnabled: true }} tenure="new" />))
      await act(async () => host.querySelector<HTMLInputElement>('input[value="finish-halo"]')!.click())
      const choose = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Use this look when Supporter starts')!
      await act(async () => choose.click())
      expect(sendMessage).toHaveBeenLastCalledWith({ type: 'SUPPORTER_FINISH_INTENT', finish: 'halo' })
      expect(host.querySelector('.pulse-supporter-save-status')?.textContent).toBe('Halo will be applied when your Supporter membership is confirmed.')
      expect(buttons()).toContain('Clear choice')
      expect(buttons()).not.toContain('Use this look when Supporter starts')
      expect(host.textContent).toContain('Halo is applied automatically when your Supporter membership is confirmed. We keep this choice for 7 days.')
      expect(host.textContent).not.toContain('Saved earlier:')
      await act(async () => [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Clear choice')!.click())
      expect(sendMessage).toHaveBeenLastCalledWith({ type: 'SUPPORTER_FINISH_INTENT', finish: null })
      expect(host.querySelector('.pulse-supporter-save-status')?.textContent).toBe('Saved choice cleared.')
    } finally { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() }
  })

  it('reconciles cosmetic-only refreshes while preserving an unchanged local draft', async () => {
    const sendMessage = vi.fn()
    vi.stubGlobal('chrome', { runtime: { sendMessage } })
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const entitlement: SupporterEntitlement = {
      state: 'ready', status: 'active', supportPeriods: 3,
      features: ['supporter.banner.v1', 'supporter.finish.v1'],
      cosmetics: { enabled: true, finish: 'glass' },
    }
    const render = async (next: SupporterEntitlement) =>
      act(async () => root.render(<SupporterCosmeticControls entitlement={next} />))
    const radio = (value: string) => host.querySelector(`input[value="finish-${value}"]`) as HTMLInputElement
    try {
      await render(entitlement)
      act(() => radio('etched').click())
      expect(host.querySelector('.pulse-account-link-actions')?.textContent).toBe('Equip lookRevert')
      await render({ ...entitlement, cosmetics: { enabled: true, finish: 'glass' } })
      expect(radio('etched').checked).toBe(true)
      expect(chipState(host)).toEqual(['Equipped:glass', 'Previewing:etched'].sort())

      await render({ ...entitlement, cosmetics: { enabled: true, finish: 'halo' } })
      expect(radio('halo').checked).toBe(true)
      expect(host.querySelector('[data-preview-finish]')?.getAttribute('data-preview-finish')).toBe('halo')
      expect(chipState(host)).toEqual(['Equipped:halo'])
      // Nothing is left to equip or revert once the draft matches what is applied.
      expect(host.querySelector('.pulse-account-link-actions')).toBeNull()

      await render({ ...entitlement, cosmetics: { enabled: false, finish: 'halo' } })
      expect(radio('default').checked).toBe(true)
      expect(chipState(host)).toEqual(['Equipped:default'])
      expect(host.querySelector('.pulse-account-link-actions')).toBeNull()
      expect(sendMessage).not.toHaveBeenCalled()
    } finally {
      act(() => root.unmount())
      host.remove()
      vi.unstubAllGlobals()
    }
  })

  it('keeps its own save confirmation but clears it after an external change', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ type: 'SUPPORTER_COSMETICS', ok: true })
    vi.stubGlobal('chrome', { runtime: { sendMessage } })
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    let entitlement: SupporterEntitlement = {
      state: 'ready', status: 'active', supportPeriods: 3,
      features: ['supporter.banner.v1', 'supporter.finish.v1'],
      cosmetics: { enabled: false, finish: 'glass' },
    }
    const render = () => root.render(<SupporterCosmeticControls
      entitlement={entitlement}
      tenure="new"
      onSaved={cosmetics => {
        if (entitlement.state === 'ready') entitlement = { ...entitlement, cosmetics }
        render()
      }}
    />)
    try {
      await act(async () => render())
      act(() => (host.querySelector('input[value="finish-halo"]') as HTMLInputElement).click())
      await act(async () => (host.querySelector('.pulse-account-link-actions button') as HTMLButtonElement).click())
      expect(sendMessage).toHaveBeenCalledOnce()
      expect(host.querySelector('.pulse-supporter-save-status')?.textContent).toBe('Equipped: Halo · Shimmer · no backdrop.')
      expect(chipState(host)).toEqual(['Equipped:halo'])

      await act(async () => {
        if (entitlement.state === 'ready') entitlement = { ...entitlement, cosmetics: { enabled: true, finish: 'etched' } }
        render()
      })
      expect(chipState(host)).toEqual(['Equipped:etched'])
      expect(host.querySelector('.pulse-supporter-save-status')?.textContent).toBe('')
      expect((host.querySelector('input[value="finish-etched"]') as HTMLInputElement).checked).toBe(true)
    } finally {
      act(() => root.unmount())
      host.remove()
      vi.unstubAllGlobals()
    }
  })
})

describe('Your card: payment issue and the top crest', () => {
  const linkedAccount = { state: 'linked', accountId: '11111111-1111-4111-8111-1111111a1b2c', expiresAt: new Date(Date.now() + 86_400_000).toISOString() }
  const supporter = (status: 'active' | 'grace', supportPeriods: number, extra: Partial<SupporterEntitlement> = {}): SupporterEntitlement => ({
    state: 'ready', status, supportPeriods, features: ['supporter.banner.v1', 'supporter.finish.v1'], cosmetics: { enabled: true, finish: 'halo' }, ...extra,
  } as SupporterEntitlement)
  const renderCard = async (entitlement: SupporterEntitlement) => {
    const sendMessage = vi.fn(async (message: { type: string }) =>
      message.type === 'SUPPORTER_ENTITLEMENT' ? { type: 'SUPPORTER_ENTITLEMENT', entitlement }
        : message.type === 'SUPPORTER_ACCOUNT' ? { type: 'SUPPORTER_ACCOUNT', account: linkedAccount }
          : undefined)
    vi.stubGlobal('chrome', { runtime: { sendMessage } })
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => root.render(<SupporterAccountSection />))
    const card = host.querySelector<HTMLElement>('.pulse-supporter-card')!
    const steps = [...card.querySelectorAll<HTMLElement>('.pulse-supporter-ladder li')]
    return {
      host,
      card,
      journey: card.querySelector<HTMLElement>('.pulse-journey')!,
      subline: card.querySelector('.pulse-supporter-card-who > span')?.textContent,
      crest: card.querySelector('.pulse-supporter-card-who strong .pulse-crest')?.getAttribute('data-tenure'),
      steps: steps.map(step => step.dataset.step),
      currentStep: steps.filter(step => step.getAttribute('aria-current') === 'step').map(step => step.dataset.tier),
      next: card.querySelector('.pulse-supporter-ladder-next')?.textContent,
      cleanup: () => {
        act(() => root.unmount())
        host.remove()
        vi.unstubAllGlobals()
      },
    }
  }

  it('warns in the footer and the subline when a renewal failed, with the earned crest held on the ladder', async () => {
    const view = await renderCard(supporter('grace', 7, { accessUntil: '2026-10-19T12:00:00Z' }))
    try {
      // The card is still the member's own, painted, with the crest 7 months earned.
      expect(view.card.dataset.supporterCard).toBe('own')
      expect(view.card.querySelector('.pulse-supporter-card-sample')).toBeNull()
      expect(view.crest).toBe('6m')
      expect(view.subline).toBe('Supporter for 7 months · payment due')
      expect(view.steps).toEqual(['past', 'past', 'current', 'off', 'off'])
      expect(view.currentStep).toEqual(['6m'])
      expect(view.next).toBe('Next crest in 5 months')
      // The footer carries the warm payment-issue tone, one line, its date and the fix.
      expect(view.journey.dataset.journeyState).toBe('grace')
      expect(view.journey.dataset.tone).toBe('warn')
      expect(view.journey.querySelector('.pulse-journey-title')?.textContent).toBe("Your last payment didn't go through.")
      expect(view.journey.textContent).toContain(`Supporter stays on until ${new Date('2026-10-19T12:00:00Z').toLocaleDateString([], { month: 'short', day: 'numeric' })}.`)
      expect([...view.journey.querySelectorAll('.pulse-journey-primary')].map(action => action.textContent)).toEqual(['Fix payment ↗'])
      expect(view.journey.querySelector('.pulse-journey-facts')).toBeNull()
      // The warm styling is a settings-page rule this footer actually matches.
      injectHostStyles()
      const css = document.getElementById('streampulse-settings-host-styles')?.textContent ?? ''
      const warnRules = [...css.matchAll(/([^{}]*\[data-tone="warn"\][^{}]*)\{([^}]*)\}/g)].map(([, selector, body]) => ({ selector: selector.trim(), body }))
      const footerRule = warnRules.find(rule => rule.selector === '.pulse-supporter-card > .pulse-journey[data-tone="warn"]')
      expect(footerRule?.body).toMatch(/background:\s*rgba\(253, 186, 116/)
      expect(view.journey.matches(footerRule!.selector)).toBe(true)
      const statusRule = warnRules.find(rule => rule.selector.endsWith('.pulse-journey-status'))
      expect(statusRule).toBeDefined()
      expect(view.journey.querySelector('.pulse-journey-status')?.matches(statusRule!.selector)).toBe(true)
    } finally {
      view.cleanup()
    }
  })

  it('says nothing is due and draws no warning for the same member while paid up', async () => {
    const view = await renderCard(supporter('active', 7, { accessUntil: '2026-10-19T12:00:00Z' }))
    try {
      expect(view.subline).toBe('Supporter for 7 months')
      expect(view.subline).not.toContain('payment due')
      expect(view.journey.dataset.journeyState).toBe('active')
      expect(view.journey.hasAttribute('data-tone')).toBe(false)
      expect(view.journey.querySelector('.pulse-journey-title')?.textContent).toBe('Supporter active')
      expect(view.journey.querySelector('.pulse-journey-facts')).toBeNull()
    } finally {
      view.cleanup()
    }
  })

  it('puts the renewal date in the one status line: until a date after a cancel, renews while renewing, nothing from an older server', async () => {
    const end = '2026-11-30T17:00:00Z'
    const day = new Date(end).toLocaleDateString([], { month: 'short', day: 'numeric' })
    expect(day).not.toContain('2026')
    const title = (journey: HTMLElement) => journey.querySelector('.pulse-journey-title')?.textContent
    const primary = (journey: HTMLElement) => [...journey.querySelectorAll('.pulse-journey-primary')].map(action => action.textContent)
    const cancelled = await renderCard(supporter('active', 7, { accessUntil: end, renewal: 'ends', endsOn: end }))
    try {
      expect(cancelled.journey.dataset.journeyState).toBe('active')
      expect(title(cancelled.journey)).toBe(`Supporter until ${day} · won't renew`)
      expect(primary(cancelled.journey)).toEqual(['Keep Supporter ↗'])
      expect(cancelled.journey.querySelector('.pulse-journey-facts')).toBeNull()
    } finally {
      cancelled.cleanup()
    }
    const renewing = await renderCard(supporter('active', 7, { accessUntil: end, renewal: 'auto', renewsOn: end }))
    try {
      expect(title(renewing.journey)).toBe(`Supporter · renews ${day}`)
      expect(primary(renewing.journey)).toEqual(['Manage on Stripe ↗'])
    } finally {
      renewing.cleanup()
    }
    const older = await renderCard(supporter('active', 7, { accessUntil: end }))
    try {
      expect(title(older.journey)).toBe('Supporter active')
      expect(older.journey.textContent).not.toMatch(/renews|won't renew/)
    } finally {
      older.cleanup()
    }
    // A failed renewal keeps its own warning, with no renewal date.
    const grace = await renderCard(supporter('grace', 7, { accessUntil: end, renewal: 'auto', renewsOn: end }))
    try {
      expect(title(grace.journey)).toBe("Your last payment didn't go through.")
      expect(grace.journey.textContent).not.toContain('renews')
    } finally {
      grace.cleanup()
    }
  })

  it('picks the renewal line only for an active membership with a usable date', () => {
    const end = '2026-11-30T17:00:00Z'
    const day = new Date(end).toLocaleDateString([], { month: 'short', day: 'numeric' })
    expect(renewalLine(supporter('active', 1, { renewal: 'ends', endsOn: end }))).toEqual({ kind: 'ends', text: `Cancels on ${day}` })
    expect(renewalLine(supporter('active', 1, { renewal: 'auto', renewsOn: end }))).toEqual({ kind: 'auto', text: `Renews on ${day}` })
    // Old backend: no fields. Unknown or dateless answers say nothing either.
    expect(renewalLine(supporter('active', 1))).toBeNull()
    expect(renewalLine(supporter('active', 1, { renewal: 'ends' }))).toBeNull()
    expect(renewalLine(supporter('active', 1, { renewal: 'none' }))).toBeNull()
    expect(renewalLine(supporter('active', 1, { renewal: 'ends', endsOn: 'soon' }))).toBeNull()
    expect(renewalLine(supporter('grace', 1, { renewal: 'ends', endsOn: end }))).toBeNull()
    expect(renewalLine({ state: 'ready', status: 'expired', supportPeriods: 1, features: [], renewal: 'none' })).toBeNull()
    expect(renewalLine({ state: 'error' })).toBeNull()
    expect(renewalLine(null)).toBeNull()
  })

  it.each([
    [23, '12m', ['past', 'past', 'past', 'current', 'off'], 'Next crest in 1 month'],
    [24, '24m', ['past', 'past', 'past', 'past', 'current'], 'You have the top crest'],
    [31, '24m', ['past', 'past', 'past', 'past', 'current'], 'You have the top crest'],
  ] as const)('puts %i months at the right rung, naming the top crest from 24 months', async (months, tier, steps, next) => {
    const view = await renderCard(supporter('active', months))
    try {
      expect(view.subline).toBe(`Supporter for ${months} months`)
      expect(view.crest).toBe(tier)
      expect(view.steps).toEqual(steps)
      expect(view.currentStep).toEqual([tier])
      expect(view.next).toBe(next)
    } finally {
      view.cleanup()
    }
  })

  it('keeps the top crest through a payment issue', async () => {
    const view = await renderCard(supporter('grace', 26))
    try {
      expect(view.subline).toBe('Supporter for 26 months · payment due')
      expect(view.currentStep).toEqual(['24m'])
      expect(view.next).toBe('You have the top crest')
      expect(view.journey.dataset.tone).toBe('warn')
    } finally {
      view.cleanup()
    }
  })
})

describe('Your card through a failed refresh', () => {
  it('keeps a Supporter’s confirmed look on the card and in the Your look preview, while the paid controls pause', async () => {
    let membership: SupporterEntitlement | Error = {
      state: 'ready', status: 'active', supportPeriods: 13, features: ['supporter.banner.v1', 'supporter.finish.v1'], cosmetics: { enabled: true, finish: 'halo' },
    }
    const listeners = new Set<(changes: Record<string, chrome.storage.StorageChange>) => void>()
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'SUPPORTER_ENTITLEMENT') {
        if (membership instanceof Error) throw membership
        return { type: 'SUPPORTER_ENTITLEMENT', entitlement: membership }
      }
      if (message.type === 'SUPPORTER_ACCOUNT') return { type: 'SUPPORTER_ACCOUNT', account: { state: 'linked', accountId: '11111111-1111-4111-8111-1111111a1b2c', expiresAt: new Date(Date.now() + 86_400_000).toISOString() } }
      return undefined
    })
    vi.stubGlobal('chrome', { runtime: { sendMessage }, storage: { onChanged: {
      addListener: (listener: (changes: Record<string, chrome.storage.StorageChange>) => void) => listeners.add(listener),
      removeListener: (listener: (changes: Record<string, chrome.storage.StorageChange>) => void) => listeners.delete(listener),
    } } })
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const look = () => {
      const card = host.querySelector<HTMLElement>('.pulse-supporter-card')!
      return {
        card: card.dataset.supporterCard,
        sample: card.querySelector('.pulse-supporter-card-sample') !== null,
        finish: card.style.getPropertyValue('--spk-fin'),
        paint: card.querySelector('.pulse-supporter-card-who strong .pulse-paint')?.getAttribute('data-finish'),
        crest: card.querySelector('.pulse-supporter-card-who strong .pulse-crest')?.getAttribute('data-tenure'),
        line: card.querySelector('.pulse-supporter-card-who > span')?.textContent,
      }
    }
    try {
      await act(async () => root.render(<SupporterAccountSection />))
      const confirmed = look()
      expect(confirmed).toEqual({ card: 'own', sample: false, finish: '#e6a9d6', paint: 'halo', crest: '12m', line: 'Supporter for 13 months' })
      expect(host.textContent).not.toContain('Shown with the sample look')

      // A quiet re-read fails: the footer says it shows the last confirmed status.
      membership = new Error('offline')
      await act(async () => { for (const listener of listeners) listener({ pulseSupporterRevision: { newValue: 'changed', oldValue: 'old' } }) })
      expect(host.querySelector('[data-journey-stale="true"]')).not.toBeNull()
      expect(look()).toEqual(confirmed)
      expect(host.textContent).not.toContain('Sample look')
      expect(host.textContent).not.toContain('Shown with the sample look')
      // Paid controls only act on fresh values, so equipping pauses until a read succeeds.
      expect(host.textContent).toContain('Supporter status unavailable')
      expect([...host.querySelectorAll('button')].some(button => button.textContent === 'Supporter status unavailable')).toBe(false)
      expect(chipState(host)).toEqual([])
    } finally {
      act(() => root.unmount())
      host.remove()
      vi.unstubAllGlobals()
    }
  })
})

describe('cosmetics while membership is unknown', () => {
  it('pauses instead of switching to pre-purchase mode, and keeps the selection', async () => {
    const sendMessage = vi.fn()
    vi.stubGlobal('chrome', { runtime: { sendMessage } })
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const active: SupporterEntitlement = {
      state: 'ready', status: 'active', supportPeriods: 3,
      features: ['supporter.banner.v1', 'supporter.finish.v1'],
      cosmetics: { enabled: true, finish: 'glass' },
    }
    const render = (value: SupporterEntitlement | null) => act(async () => root.render(<SupporterCosmeticControls entitlement={value} />))
    const radio = (value: string) => host.querySelector(`input[value="finish-${value}"]`) as HTMLInputElement
    try {
      await render(null)
      expect(host.textContent).toContain('Checking Supporter status…')
      expect(host.textContent).not.toContain('when Supporter starts')
      expect(chipState(host)).toEqual([])
      await render(active)
      act(() => radio('halo').click())
      expect(chipState(host)).toEqual(['Equipped:glass', 'Previewing:halo'].sort())
      // A background read that cannot confirm the status, then the same status again.
      await render(null)
      expect(radio('halo').checked).toBe(true)
      expect(chipState(host)).toEqual([])
      expect(host.querySelector('.pulse-account-link-actions button')).toBeNull()
      await render({ ...active })
      expect(radio('halo').checked).toBe(true)
      expect(chipState(host)).toEqual(['Equipped:glass', 'Previewing:halo'].sort())
      // Active members never had the pre-purchase choice read for them.
      expect(sendMessage).not.toHaveBeenCalled()
    } finally {
      act(() => root.unmount())
      host.remove()
      vi.unstubAllGlobals()
    }
  })
})

describe('cosmetics while membership is unavailable', () => {
  it.each<[string, SupporterEntitlement | Error]>([
    ['unavailable', { state: 'unavailable', reason: 'temporarily_unavailable' }],
    ['a failed read', { state: 'error' }],
    ['an unreachable worker', new Error('worker asleep')],
  ])('pauses the studio and says so when the status is %s, never offering the pre-purchase choice', async (_label, membership) => {
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'SUPPORTER_ACCOUNT') return { type: 'SUPPORTER_ACCOUNT', account: { state: 'linked', accountId: '11111111-1111-4111-8111-1111111a1b2c', expiresAt: new Date(Date.now() + 86_400_000).toISOString() } }
      if (message.type === 'SUPPORTER_ENTITLEMENT') { if (membership instanceof Error) throw membership; return { type: 'SUPPORTER_ENTITLEMENT', entitlement: membership } }
      return undefined
    })
    vi.stubGlobal('chrome', { runtime: { sendMessage }, storage: { onChanged: { addListener() {}, removeListener() {} } } })
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(<SupporterAccountSection />))
      expect(host.textContent).toContain('Supporter status unavailable')
      expect([...host.querySelectorAll('button')].some(button => button.textContent === 'Supporter status unavailable')).toBe(false)
      expect(host.textContent).not.toContain('Checking Supporter status…')
      expect(host.textContent).not.toContain('when Supporter starts')
      expect(host.textContent).not.toContain('Save for when Supporter opens')
      expect(host.textContent).not.toContain('Sign-ups are not open yet.')
      expect([...host.querySelectorAll<HTMLFieldSetElement>('.pulse-supporter-look fieldset')].every(fieldset => fieldset.disabled)).toBe(true)
      expect(host.querySelector('[data-supporter-perk="backdrop"]')).toBeNull()
      expect(chipState(host)).toEqual([])
    } finally {
      act(() => root.unmount())
      host.remove()
      vi.unstubAllGlobals()
    }
  })

  it('keeps the pre-purchase choice on a server without Supporter, which is an answer rather than an outage', async () => {
    vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(async (message: { type: string }) => message.type === 'SUPPORTER_ACCOUNT'
      ? { type: 'SUPPORTER_ACCOUNT', account: { state: 'linked', accountId: '11111111-1111-4111-8111-1111111a1b2c', expiresAt: new Date(Date.now() + 86_400_000).toISOString() } }
      : message.type === 'SUPPORTER_ENTITLEMENT' ? { type: 'SUPPORTER_ENTITLEMENT', entitlement: { state: 'unavailable', reason: 'not_deployed' } } : undefined) }, storage: { onChanged: { addListener() {}, removeListener() {} } } })
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(<SupporterAccountSection />))
      expect(host.textContent).toMatch(/Use this look when Supporter starts/)
      // The footer says the server has no Supporter yet; the studio itself does not pause.
      expect([...host.querySelectorAll('.pulse-account-link-actions button')].map(button => button.textContent)).not.toContain('Supporter status unavailable')
    } finally {
      act(() => root.unmount())
      host.remove()
      vi.unstubAllGlobals()
    }
  })

  it('drops the not-on-sale line from the backdrop line once paid sign-ups open', async () => {
    vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn() } })
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const none = (checkoutEnabled: boolean): SupporterEntitlement => ({ state: 'ready', status: 'none', supportPeriods: 0, features: [], checkoutEnabled })
    const rain = () => host.querySelector('[data-supporter-perk="backdrop"]')?.textContent
    try {
      await act(async () => root.render(<SupporterCosmeticControls entitlement={none(false)} />))
      expect(rain()).toBe("The backdrop is a Supporter perk. Only you see it. Supporter isn't on sale yet. See Supporter →")
      await act(async () => root.render(<SupporterCosmeticControls entitlement={none(true)} />))
      expect(rain()).toBe('The backdrop is a Supporter perk. Only you see it. See Supporter →')
    } finally {
      act(() => root.unmount())
      host.remove()
      vi.unstubAllGlobals()
    }
  })
})

describe('cosmetic save races', () => {
  it('keeps its confirmation when the refresh it caused arrives before its own response', async () => {
    let respond!: (value: unknown) => void
    const sendMessage = vi.fn(() => new Promise(resolve => { respond = resolve }))
    vi.stubGlobal('chrome', { runtime: { sendMessage } })
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const active = (finish: 'glass' | 'halo', enabled: boolean): SupporterEntitlement => ({
      state: 'ready', status: 'active', supportPeriods: 3,
      features: ['supporter.banner.v1', 'supporter.finish.v1'], cosmetics: { enabled, finish },
    })
    try {
      await act(async () => root.render(<SupporterCosmeticControls entitlement={active('glass', false)} />))
      act(() => (host.querySelector('input[value="finish-halo"]') as HTMLInputElement).click())
      await act(async () => (host.querySelector('.pulse-account-link-actions button') as HTMLButtonElement).click())
      // The worker's change signal made settings re-read first.
      await act(async () => root.render(<SupporterCosmeticControls entitlement={active('halo', true)} />))
      await act(async () => respond({ type: 'SUPPORTER_COSMETICS', ok: true }))
      expect(host.textContent).toContain('Equipped: Halo · Shimmer · no backdrop.')
      expect(chipState(host)).toEqual(['Equipped:halo'])
    } finally {
      act(() => root.unmount())
      host.remove()
      vi.unstubAllGlobals()
    }
  })

  it('keeps its confirmation when a quiet re-check fails and recovers while the save is in flight', async () => {
    let respond!: (value: unknown) => void
    const sendMessage = vi.fn(() => new Promise(resolve => { respond = resolve }))
    vi.stubGlobal('chrome', { runtime: { sendMessage } })
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const active = (finish: 'glass' | 'halo', enabled: boolean): SupporterEntitlement => ({
      state: 'ready', status: 'active', supportPeriods: 3,
      features: ['supporter.banner.v1', 'supporter.finish.v1'], cosmetics: { enabled, finish },
    })
    try {
      await act(async () => root.render(<SupporterCosmeticControls entitlement={active('glass', false)} />))
      act(() => (host.querySelector('input[value="finish-halo"]') as HTMLInputElement).click())
      await act(async () => (host.querySelector('.pulse-account-link-actions button') as HTMLButtonElement).click())
      // The re-read the save triggered could not confirm the status, then did, with the same access.
      await act(async () => root.render(<SupporterCosmeticControls entitlement={null} />))
      await act(async () => root.render(<SupporterCosmeticControls entitlement={active('halo', true)} />))
      await act(async () => respond({ type: 'SUPPORTER_COSMETICS', ok: true }))
      expect(host.querySelector('.pulse-supporter-save-status')?.textContent).toBe('Equipped: Halo · Shimmer · no backdrop.')
      expect(chipState(host)).toEqual(['Equipped:halo'])
    } finally {
      act(() => root.unmount())
      host.remove()
      vi.unstubAllGlobals()
    }
  })

  it('pauses all cosmetic choices while checking, then adopts the first confirmed equipped finish', async () => {
    vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn() } })
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const active = (cosmetics: { enabled: boolean; finish: 'glass' | 'halo' }): SupporterEntitlement => ({
      state: 'ready', status: 'active', supportPeriods: 3,
      features: ['supporter.banner.v1', 'supporter.finish.v1'], cosmetics,
    })
    const radio = (value: string) => host.querySelector(`input[value="finish-${value}"]`) as HTMLInputElement
    const button = () => host.querySelector('.pulse-account-link-actions button') as HTMLButtonElement
    try {
      await act(async () => root.render(<SupporterCosmeticControls entitlement={null} />))
      // Nothing is presumed chosen while checking.
      expect(radio('default').checked).toBe(true)
      expect(chipState(host)).toEqual([])
      expect([...host.querySelectorAll<HTMLFieldSetElement>('.pulse-supporter-look fieldset')].every(fieldset => fieldset.disabled)).toBe(true)
      act(() => radio('glass').click())
      expect(radio('glass').checked).toBe(false)
      await act(async () => root.render(<SupporterCosmeticControls entitlement={active({ enabled: false, finish: 'glass' })} />))
      expect(radio('default').checked).toBe(true)
      expect(chipState(host)).toEqual(['Equipped:default'])
      expect(host.querySelector('.pulse-account-link-actions')).toBeNull()
      // After that, a change to the applied finish still replaces the draft.
      await act(async () => root.render(<SupporterCosmeticControls entitlement={active({ enabled: true, finish: 'halo' })} />))
      expect(radio('halo').checked).toBe(true)
      expect(chipState(host)).toEqual(['Equipped:halo'])
    } finally {
      act(() => root.unmount())
      host.remove()
      vi.unstubAllGlobals()
    }
  })

  it('keeps Equip look enabled and focused through its save, and announces each save afresh', async () => {
    // Each storage write waits for the test to settle it; a settled write is read back like a synced change.
    const store: Record<string, unknown> = {}
    const listeners = new Set<(changes: Record<string, chrome.storage.StorageChange>, area: string) => void>()
    const writes: Array<{ settle: (ok: boolean) => void }> = []
    const set = vi.fn((items: Record<string, unknown>) => new Promise<void>((resolve, reject) => {
      writes.push({ settle: ok => {
        if (!ok) return reject(new Error('quota exceeded'))
        Object.assign(store, items)
        listeners.forEach(listener => listener(Object.fromEntries(Object.entries(items).map(([key, value]) => [key, { newValue: value }])), 'sync'))
        resolve()
      } })
    }))
    vi.stubGlobal('chrome', {
      runtime: { id: 'test-extension', sendMessage: vi.fn() },
      storage: {
        sync: { get: vi.fn(async (key: string) => ({ [key]: store[key] })), set },
        onChanged: { addListener: (listener: never) => listeners.add(listener), removeListener: (listener: never) => listeners.delete(listener) },
      },
    })
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const entitlement: SupporterEntitlement = {
      state: 'ready', status: 'active', supportPeriods: 3,
      features: ['supporter.banner.v1', 'supporter.finish.v1'], cosmetics: { enabled: true, finish: 'glass' },
    }
    // The studio writes motion and backdrop together: two storage writes per save.
    const settleAll = async (ok: boolean) => { await act(async () => { writes.filter((_, index) => index >= settled).forEach(write => write.settle(ok)); settled = writes.length }) }
    let settled = 0
    try {
      await act(async () => root.render(<SupporterCosmeticControls entitlement={entitlement} tenure="new" />))
      const group = host.querySelector<HTMLFieldSetElement>('[data-supporter-perks="on"]')!
      expect(group.querySelector('legend')?.textContent).toBe('Backdrop')
      const choice = (name: string) => [...group.querySelectorAll('button')].find(button => button.textContent === name)!
      const equip = () => [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Equip look' || button.textContent === 'Saving...')!
      // One live region, present and empty before any save, so each result is announced.
      const status = host.querySelector<HTMLElement>('.pulse-supporter-save-status')!
      expect(status.getAttribute('role')).toBe('status')
      expect(status.textContent).toBe('')

      await act(async () => choice('On').click())
      expect(set).not.toHaveBeenCalled()
      equip().focus()
      await act(async () => equip().click())
      expect(set).toHaveBeenCalledTimes(2)
      // Saving keeps the button reachable: a disabled button would drop focus to the body in Chromium.
      expect(equip().disabled).toBe(false)
      expect(equip().getAttribute('aria-busy')).toBe('true')
      expect(document.activeElement).toBe(equip())
      // A second press while the first save runs is ignored.
      await act(async () => equip().click())
      expect(set).toHaveBeenCalledTimes(2)
      await settleAll(true)
      expect(host.querySelector('.pulse-supporter-save-status')).toBe(status)
      expect(status.textContent).toBe('Equipped: Signal.')
      expect(choice('On').getAttribute('aria-pressed')).toBe('true')
      // The buttons leave once the look is worn; focus moves to the look now worn.
      expect(equip()).toBeUndefined()
      expect(document.activeElement).toBe(host.querySelector('.pulse-supporter-look input:checked'))

      // The next save clears the last confirmation while it runs, then reports its own result.
      await act(async () => choice('Off').click())
      equip().focus()
      await act(async () => equip().click())
      expect(set).toHaveBeenCalledTimes(4)
      expect(status.textContent).toBe('')
      await settleAll(false)
      expect(status.textContent).toBe('Could not save. Please try again.')
      expect(document.activeElement).toBe(equip())

      // And a later success is announced again, not left as the old text.
      await act(async () => equip().click())
      expect(status.textContent).toBe('')
      await settleAll(true)
      expect(status.textContent).toBe('Equipped: Glass · Shimmer · no backdrop.')
    } finally {
      act(() => root.unmount())
      host.remove()
      vi.unstubAllGlobals()
    }
  })
})
