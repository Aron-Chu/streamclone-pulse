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
  it('previews bundled badges without storage, network, or entitlement mutation', async () => {
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
      const sample = host.querySelector('.pulse-supporter-chat-preview')!
      // The local preview is intentionally larger for readability; the badge
      // component itself still defaults to the 18px chat footprint.
      expect(sample.querySelector('svg')?.getAttribute('width')).toBe('18')
      expect(sample.querySelector('[data-supporter-badge="new"]')).not.toBeNull()
      act(() => (host.querySelector('input[value="24m"]') as HTMLInputElement).click())
      expect(sample.querySelector('[data-supporter-badge="24m"]')).not.toBeNull()
      act(() => (host.querySelector('input[type="checkbox"]') as HTMLInputElement).click())
      expect(sample.querySelector('svg')).toBeNull()
      expect(host.textContent).toContain('nothing is equipped, published, or injected into Twitch chat')
      // Status comes from the server. An unlinked install must say so rather
      // than implying the preview grants anything.
      expect(host.textContent).toContain('Connect this extension to your Pulse account')
      expect(host.textContent).toContain('remain free')
      // The chat badge must never be presented as included.
      expect(host.textContent).toContain('Not included yet')
      expect(host.textContent).toContain('does not alter Twitch chat')

      // No storage write, no direct fetch: previewing and reading status are
      // both side-effect free, so a local edit cannot grant an entitlement.
      expect(write).not.toHaveBeenCalled()
      const sent = sendMessage.mock.calls.map(([message]) => message)
      expect(sent).toEqual([
        { type: 'SUPPORTER_ACCOUNT', action: 'status' },
        { type: 'SUPPORTER_ENTITLEMENT' },
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

  it('separates service-reported stages from future artwork without granting a badge', async () => {
    const sendMessage = vi.fn().mockImplementation((message: { type: string }) =>
      message.type === 'SUPPORTER_ENTITLEMENT'
        ? Promise.resolve({ type: 'SUPPORTER_ENTITLEMENT', entitlement: {
          state: 'ready', status: 'active', supportPeriods: 6, features: [],
        } })
        : Promise.resolve({ type: 'SUPPORTER_ACCOUNT', account: { state: 'signed_out' } }))
    vi.stubGlobal('chrome', { runtime: { sendMessage } })
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(<SupporterAccountSection />))
      const stage = (id: string) => host.querySelector(`.pulse-supporter-tenure-choices input[value="${id}"]`)?.closest('label')
      expect(stage('new')?.getAttribute('data-stage-state')).toBe('reported-earlier')
      expect(stage('6m')?.getAttribute('data-stage-state')).toBe('reported-current')
      expect(stage('12m')?.getAttribute('data-stage-state')).toBe('future')
      expect(stage('24m')?.textContent).toContain('Future preview')
      expect(host.textContent).toContain('exact tenure still needs ledger reconciliation')
      act(() => (stage('24m')?.querySelector('input') as HTMLInputElement).click())
      expect(host.querySelector('.pulse-supporter-chat-preview [data-supporter-badge="24m"]')).not.toBeNull()
      expect(sendMessage.mock.calls.map(([message]) => message.type)).toEqual(['SUPPORTER_ACCOUNT', 'SUPPORTER_ENTITLEMENT'])
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
      expect(host.textContent).toContain('Equipping an accent requires an active linked Supporter membership')
      expect(sendMessage).not.toHaveBeenCalled()
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
