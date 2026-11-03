// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsWorkspace } from '../src/ui/SettingsWorkspace.tsx'

vi.mock('../src/shared/extensionAnalytics.ts', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/shared/extensionAnalytics.ts')>()),
  EXTENSION_ANALYTICS_INGEST_ENABLED: true,
}))
vi.mock('../src/content/bridge.ts', () => ({ sendBackgroundMessage: vi.fn(async () => ({ ok: true })) }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('analytics consent in open settings', () => {
  let root: Root
  let container: HTMLDivElement
  let local: Record<string, unknown>
  let listeners: Set<(changes: Record<string, chrome.storage.StorageChange>, area: string) => void>
  let sendMessage: ReturnType<typeof vi.fn>
  const key = 'pulse-analytics-consent-v1'
  const grant = { schemaVersion: 1, granted: true, updatedAt: 1 }

  beforeEach(() => {
    local = { [key]: grant }
    listeners = new Set()
    sendMessage = vi.fn(async (message: { type: string }) => message.type === 'PREPARE_ANALYTICS_CONSENT_GRANT'
      ? { ok: true, grantTicket: '00000000-0000-4000-8000-000000000001' }
      : { ok: true })
    vi.stubGlobal('chrome', {
      runtime: { id: 'test-ext', getManifest: () => ({ version: '0.2.6' }), sendMessage },
      storage: {
        local: {
          get: vi.fn(async (name: string) => ({ [name]: local[name] })),
          set: vi.fn(async (items: Record<string, unknown>) => { Object.assign(local, items) }),
          remove: vi.fn(async (name: string) => { delete local[name] }),
        },
        sync: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) },
        session: { get: vi.fn(async () => ({})), remove: vi.fn(async () => {}) },
        onChanged: {
          addListener: (listener: typeof listeners extends Set<infer T> ? T : never) => listeners.add(listener),
          removeListener: (listener: typeof listeners extends Set<infer T> ? T : never) => listeners.delete(listener),
        },
      },
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  function toggle(): HTMLInputElement {
    const label = [...container.querySelectorAll('label')].find(node => node.textContent === 'Share anonymous product usage')
    if (!label) throw new Error('Missing analytics toggle')
    const input = document.getElementById(label.htmlFor)
    if (!(input instanceof HTMLInputElement)) throw new Error('Missing analytics input')
    return input
  }

  function turnOffButton(): HTMLButtonElement {
    const button = [...container.querySelectorAll('button')].find(node => node.textContent === 'Turn off sharing')
    if (!button) throw new Error('Missing explicit turn-off control')
    return button
  }

  it('associates the sharing purpose, scope, processor and withdrawal limits with the control', async () => {
    await act(async () => { root.render(<SettingsWorkspace activeSection="privacy" />) })
    const description = document.getElementById(toggle().getAttribute('aria-describedby') ?? '')
    expect(description?.textContent).toMatch(/Pulse receives data without a reported error and when a panel rendering error is shown/)
    expect(description?.textContent).toMatch(/aggregate counts to PostHog/)
    expect(description?.textContent).toMatch(/stops new events from this browser/)
    expect(description?.textContent).toMatch(/Events already sent to StreamPulse may still be added to totals sent to PostHog/)
    expect(description?.textContent).toMatch(/six calendar months/)
    expect(description?.textContent).toMatch(/permanently deletes expired events at the following monthly cleanup/)
  })

  it('reflects a withdrawal made in another context', async () => {
    await act(async () => { root.render(<SettingsWorkspace activeSection="privacy" />) })
    expect(toggle().checked).toBe(true)
    delete local[key]
    await act(async () => { for (const listener of listeners) listener({ [key]: { oldValue: grant } }, 'local') })
    expect(toggle().checked).toBe(false)
  })

  it('still shows an existing analytics grant if the unrelated cache count cannot load', async () => {
    vi.mocked(chrome.storage.session.get).mockRejectedValueOnce(new Error('cache unavailable'))
    await act(async () => { root.render(<SettingsWorkspace activeSection="privacy" />) })
    expect(toggle().checked).toBe(true)
    expect(container.textContent).toContain('Could not load privacy settings')
  })

  it('does not wait for a stalled cache count before displaying the analytics choice', async () => {
    let resumeCache!: (value: Record<string, unknown>) => void
    vi.mocked(chrome.storage.session.get).mockImplementationOnce(() => new Promise(resolve => { resumeCache = resolve }))
    await act(async () => { root.render(<SettingsWorkspace activeSection="privacy" />) })
    expect(toggle().checked).toBe(true)
    expect(toggle().disabled).toBe(false)
    await act(async () => { resumeCache({}) })
  })

  it('prepares a grant before the click and keeps the off switch disabled until ready', async () => {
    delete local[key]
    let finishPrepare!: (value: { ok: boolean; grantTicket: string }) => void
    sendMessage.mockImplementationOnce(() => new Promise(resolve => { finishPrepare = resolve }))
    await act(async () => { root.render(<SettingsWorkspace activeSection="privacy" />) })
    expect(toggle().checked).toBe(false)
    expect(toggle().disabled).toBe(true)
    expect(container.textContent).toContain('Preparing the sharing control')
    const grantTicket = '00000000-0000-4000-8000-000000000002'
    await act(async () => { finishPrepare({ ok: true, grantTicket }) })
    expect(toggle().disabled).toBe(false)
    await act(async () => { toggle().click() })
    expect(sendMessage).toHaveBeenCalledWith({ type: 'SET_ANALYTICS_CONSENT', granted: true, grantTicket })
    expect(toggle().checked).toBe(true)
  })

  it('allows the user to retry when preparing a grant fails', async () => {
    delete local[key]
    sendMessage.mockResolvedValueOnce({ ok: false })
    await act(async () => { root.render(<SettingsWorkspace activeSection="privacy" />) })
    expect(toggle().disabled).toBe(true)
    expect(container.textContent).toContain('Unable to prepare the sharing control')
    const retry = [...container.querySelectorAll('button')].find(node => node.textContent === 'Try again')
    if (!retry) throw new Error('Missing retry control')
    await act(async () => { retry.click() })
    expect(toggle().disabled).toBe(false)
  })

  it('allows an explicit withdrawal while a consent read is pending and ignores the stale result', async () => {
    let resumeRead!: (value: Record<string, unknown>) => void
    vi.mocked(chrome.storage.local.get).mockImplementationOnce(() => new Promise(resolve => { resumeRead = resolve }))
    await act(async () => { root.render(<SettingsWorkspace activeSection="privacy" />) })
    expect(toggle().disabled).toBe(true)
    expect(container.textContent).toContain('Checking your saved analytics choice')
    await act(async () => { turnOffButton().click() })
    expect(sendMessage).toHaveBeenCalledWith({ type: 'SET_ANALYTICS_CONSENT', granted: false })
    await act(async () => { resumeRead({ [key]: grant }) })
    expect(toggle().checked).toBe(false)
    expect(toggle().disabled).toBe(false)
  })

  it('shows an unavailable state and permits withdrawal if the analytics consent read fails', async () => {
    vi.mocked(chrome.storage.local.get).mockImplementation(async name => {
      if (name === key) throw new Error('consent read unavailable')
      return {}
    })
    await act(async () => { root.render(<SettingsWorkspace activeSection="privacy" />) })
    expect(toggle().disabled).toBe(true)
    expect(container.textContent).toContain('Unable to check your saved analytics choice')
    await act(async () => { turnOffButton().click() })
    expect(sendMessage).toHaveBeenCalledWith({ type: 'SET_ANALYTICS_CONSENT', granted: false })
    expect(toggle().checked).toBe(false)
    expect(toggle().disabled).toBe(false)
  })

  it('keeps the choice unavailable if forced withdrawal fails', async () => {
    vi.mocked(chrome.storage.local.get).mockImplementation(async name => {
      if (name === key) throw new Error('consent read unavailable')
      return {}
    })
    sendMessage.mockResolvedValueOnce({ ok: false })
    await act(async () => { root.render(<SettingsWorkspace activeSection="privacy" />) })
    await act(async () => { turnOffButton().click() })
    expect(toggle().disabled).toBe(true)
    expect(turnOffButton().disabled).toBe(false)
    expect(container.textContent).toContain('Unable to check your saved analytics choice')
    expect(container.textContent).toContain('Could not save analytics sharing')
  })

  it('does not remain stuck loading when withdrawal fails during an earlier read', async () => {
    let resumeRead!: (value: Record<string, unknown>) => void
    vi.mocked(chrome.storage.local.get).mockImplementationOnce(() => new Promise(resolve => { resumeRead = resolve }))
    sendMessage.mockResolvedValueOnce({ ok: false })
    await act(async () => { root.render(<SettingsWorkspace activeSection="privacy" />) })
    await act(async () => { turnOffButton().click() })
    await act(async () => { resumeRead({ [key]: grant }) })
    expect(toggle().disabled).toBe(true)
    expect(container.textContent).toContain('Unable to check your saved analytics choice')
    await act(async () => { turnOffButton().click() })
    expect(toggle().checked).toBe(false)
    expect(toggle().disabled).toBe(false)
  })

  it('does not restore a stale initial grant after a withdrawal', async () => {
    let resumeRead!: (value: Record<string, unknown>) => void
    vi.mocked(chrome.storage.local.get).mockImplementationOnce(() => new Promise(resolve => { resumeRead = resolve }))
    await act(async () => { root.render(<SettingsWorkspace activeSection="privacy" />) })
    delete local[key]
    await act(async () => { for (const listener of listeners) listener({ [key]: { oldValue: grant } }, 'local') })
    await act(async () => { resumeRead({ [key]: grant }) })
    expect(toggle().checked).toBe(false)
  })

  it('does not undo a newer withdrawal when an older save response fails', async () => {
    let rejectSave!: (error: Error) => void
    sendMessage.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectSave = reject }))
    await act(async () => { root.render(<SettingsWorkspace activeSection="privacy" />) })
    expect(toggle().checked).toBe(true)
    await act(async () => { toggle().click() })
    expect(toggle().disabled).toBe(true)
    delete local[key]
    await act(async () => { for (const listener of listeners) listener({ [key]: { oldValue: grant } }, 'local') })
    await act(async () => { rejectSave(new Error('response lost')) })
    expect(toggle().checked).toBe(false)
    expect(container.textContent).toContain('Could not save analytics sharing')
  })
})
