// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { SupporterAccountSection } from '../src/options/SupporterAccountSection.tsx'
import { SupporterCosmeticControls } from '../src/options/SupporterCosmeticControls.tsx'
import { parseBackgroundRequest } from '../src/shared/parseBackgroundRequest.ts'
import type { SupporterEntitlement } from '../src/shared/supporterAccount.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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
      expect(card.getAttribute('aria-label')).toBe('Your Supporter card')
      expect(card.dataset.supporterCard).toBe('sample')
      expect(card.querySelector('.pulse-supporter-card-who strong')?.textContent).toBe('Not signed in')
      expect(card.querySelector('.pulse-supporter-card-avatar')?.getAttribute('data-identity')).toBe('none')
      expect(card.querySelector('.pulse-supporter-card-sample')?.textContent).toBe('Sample look')
      expect(card.textContent).not.toMatch(/twitch/i)
      // The card wears the sample paint, with emote rain across its top and no gradient layer of its own.
      expect(card.style.getPropertyValue('--spk-fin')).toBe('#efc96a')
      expect(card.querySelector('.pulse-supporter-card-banner .pulse-banner-art')?.getAttribute('data-mode')).toBe('rain')
      expect(card.querySelectorAll('.pulse-supporter-card-banner .pulse-banner-art img')).toHaveLength(6)
      // The five-step crest ladder starts at New for everyone who is not a Supporter.
      const steps = [...card.querySelectorAll<HTMLElement>('.pulse-supporter-ladder li')]
      expect(steps.map(step => step.textContent)).toEqual(['New', '3 mo', '6 mo', '1 year', '2 years'])
      expect(steps.map(step => step.dataset.step)).toEqual(['start', 'off', 'off', 'off', 'off'])
      expect(card.querySelector('.pulse-supporter-ladder-next')?.textContent).toBe('Your crest starts at New and grows at 3, 6, 12 and 24 months.')
      // The journey is the card's footer: one primary action, with the price.
      const journey = card.querySelector<HTMLElement>('.pulse-journey')!
      expect(journey.dataset.journeyState).toBe('unlinked')
      expect([...journey.querySelectorAll('.pulse-journey-primary')].map(button => button.textContent)).toEqual(['Become a Supporter'])
      expect(journey.textContent).toContain('US$4.99 / month')
      // Status comes from the server. An unlinked install must say how it
      // would connect rather than implying the preview grants anything.
      expect(host.textContent).toContain('opens streampulse.stream, where you sign in and approve this extension before paying on Stripe')
      expect(host.textContent).toContain('remain free')
      // Who sees what: everything is yours only; the chat crest is a labelled concept.
      const rows = [...host.querySelectorAll<HTMLElement>('.pulse-supporter-who > li')]
      expect(rows.map(row => row.querySelector('strong')?.textContent)).toEqual(['You', 'Other StreamPulse viewers', 'Everyone else on Twitch'])
      expect(rows[0].querySelector('.pulse-supporter-vis')?.textContent).toBe('Only you')
      expect(rows[1].dataset.concept).toBe('true')
      expect(rows[1].querySelector('.pulse-supporter-vis')?.textContent).toBe('Concept · not built')
      expect(rows[2].textContent).toContain('Normal chat. Nothing added.')
      expect(host.textContent).toContain('Shown with the sample look')
      // Your look: paint, wave, sheen and emote rain; rain is a locked perk here.
      expect([...host.querySelectorAll('.pulse-supporter-look-row > legend')].map(legend => legend.textContent)).toEqual(['Paint', 'Wave', 'Sheen', 'Emote rain'])
      expect(host.querySelector('[data-supporter-perk="emote-rain"]')?.textContent).toContain('Supporter perk')
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
        { type: 'SUPPORTER_RESTORE', action: 'status' },
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
      // The identity that exists: the connected StreamPulse account, masked as the website shows it.
      const name = card.querySelector<HTMLElement>('.pulse-supporter-card-who strong')!
      expect(name.textContent).toBe('··1a1b2c')
      expect(card.querySelector('.pulse-supporter-card-avatar')?.getAttribute('data-identity')).toBe('pulse')
      // Painted in their equipped finish, with the crest the server's count earns.
      expect(name.querySelector('.pulse-crest')?.getAttribute('data-tenure')).toBe('6m')
      expect(name.querySelector<HTMLElement>('.pulse-paint')?.dataset).toMatchObject({ finish: 'halo', text: '··1a1b2c' })
      expect(card.style.getPropertyValue('--spk-fin')).toBe('#e6a9d6')
      expect(card.querySelector('.pulse-supporter-card-who > span')?.textContent).toBe('Pulse Supporter · 7 months')
      const steps = [...card.querySelectorAll<HTMLElement>('.pulse-supporter-ladder li')]
      expect(steps.map(step => step.dataset.step)).toEqual(['past', 'past', 'current', 'off', 'off'])
      expect(steps[2].getAttribute('aria-current')).toBe('step')
      expect(card.querySelector('.pulse-supporter-ladder-next')?.textContent).toBe('Steady signal now · Year-one crest in 5 months')
      // Billing is one tap away, and nothing about a chat badge is offered as included.
      expect([...host.querySelectorAll('button')].map(button => button.textContent)).toContain('Manage billing ↗')
      expect(host.textContent).toContain('Concept · not built')
      expect(host.textContent).not.toContain('US$4.99 / month')
      // An active member's pre-purchase choice is never read.
      expect(sendMessage.mock.calls.map(([message]) => message)).toEqual([{ type: 'SUPPORTER_ACCOUNT', action: 'status' }, { type: 'SUPPORTER_ENTITLEMENT' }, { type: 'SUPPORTER_BILLING', action: 'status' }, { type: 'SUPPORTER_RESTORE', action: 'status' }])
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
      const button = host.querySelector('.pulse-account-link-actions button') as HTMLButtonElement
      expect(button.disabled).toBe(true)
      expect(button.textContent).toContain('Default active')
      // Emote rain is locked too, and its saved choice untouched.
      expect(host.querySelector('[data-supporter-perks="locked"]')?.querySelectorAll('button:disabled')).toHaveLength(3)
      expect(host.textContent).toContain('Equipping an accent requires an active linked Supporter membership')
      // Only a read of the optional saved choice; never a save.
      expect(sendMessage.mock.calls).toEqual([[{ type: 'SUPPORTER_FINISH_INTENT' }]])
    } finally {
      act(() => root.unmount())
      host.remove()
      vi.unstubAllGlobals()
    }
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
      await render({ ...entitlement, cosmetics: { enabled: true, finish: 'glass' } })
      expect(radio('etched').checked).toBe(true)
      expect(host.textContent).toContain('Preview: Etched / Active: Glass')

      await render({ ...entitlement, cosmetics: { enabled: true, finish: 'halo' } })
      expect(radio('halo').checked).toBe(true)
      expect(host.querySelector('[data-preview-finish]')?.getAttribute('data-preview-finish')).toBe('halo')
      expect(host.textContent).toContain('Halo active')
      expect((host.querySelector('.pulse-account-link-actions button') as HTMLButtonElement).disabled).toBe(true)

      await render({ ...entitlement, cosmetics: { enabled: false, finish: 'halo' } })
      expect(radio('default').checked).toBe(true)
      expect(host.textContent).toContain('Default active')
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
      expect(host.textContent).toContain('Halo accent equipped.')
      expect(host.textContent).toContain('Halo active')

      await act(async () => {
        if (entitlement.state === 'ready') entitlement = { ...entitlement, cosmetics: { enabled: true, finish: 'etched' } }
        render()
      })
      expect(host.textContent).toContain('Etched active')
      expect(host.textContent).not.toContain('Halo accent equipped.')
      expect((host.querySelector('input[value="finish-etched"]') as HTMLInputElement).checked).toBe(true)
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
      await render(active)
      act(() => radio('halo').click())
      // A background read that cannot confirm the status, then the same status again.
      await render(null)
      expect(radio('halo').checked).toBe(true)
      expect((host.querySelector('.pulse-account-link-actions button') as HTMLButtonElement).disabled).toBe(true)
      await render({ ...active })
      expect(radio('halo').checked).toBe(true)
      expect(host.textContent).toContain('Preview: Halo / Active: Glass')
      // Active members never had the pre-purchase choice read for them.
      expect(sendMessage).not.toHaveBeenCalled()
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
      expect(host.textContent).toContain('Halo accent equipped.')
      expect(host.textContent).toContain('Halo active')
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
      expect(host.querySelector('.pulse-supporter-save-status')?.textContent).toBe('Halo accent equipped.')
      expect(host.textContent).toContain('Halo active')
    } finally {
      act(() => root.unmount())
      host.remove()
      vi.unstubAllGlobals()
    }
  })

  it('keeps a finish chosen while the status is still checking when the first answer arrives', async () => {
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
      act(() => radio('glass').click())
      await act(async () => root.render(<SupporterCosmeticControls entitlement={active({ enabled: false, finish: 'glass' })} />))
      expect(radio('glass').checked).toBe(true)
      expect(host.textContent).toContain('Preview: Glass / Active: Default')
      expect(button().textContent).toBe('Equip accent')
      // After that, a change to the applied finish still replaces the draft.
      await act(async () => root.render(<SupporterCosmeticControls entitlement={active({ enabled: true, finish: 'halo' })} />))
      expect(radio('halo').checked).toBe(true)
      expect(host.textContent).toContain('Halo active')
    } finally {
      act(() => root.unmount())
      host.remove()
      vi.unstubAllGlobals()
    }
  })
})
