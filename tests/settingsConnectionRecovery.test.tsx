// @vitest-environment jsdom
import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendBackgroundMessage } from '../src/content/bridge.ts'
import { usePulseHealth } from '../src/ui/usePulseHealth.ts'
import { PulseSettingsPanel } from '../src/ui/PulseSettingsPanel.tsx'

vi.mock('../src/content/bridge.ts', () => ({ sendBackgroundMessage: vi.fn() }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function HealthProbe() {
  const { health, checking, error } = usePulseHealth()
  return <output>{checking ? 'checking' : health?.ok ? 'connected' : error ?? 'API unreachable'}</output>
}

describe('settings connection recovery', () => {
  let node: HTMLDivElement
  let root: Root
  beforeEach(() => {
    vi.mocked(sendBackgroundMessage).mockReset()
    const storage = { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) }
    vi.stubGlobal('chrome', {
      runtime: { id: 'test', getManifest: () => ({ version: '0.2.1' }) },
      storage: { sync: storage, local: storage, onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
    })
    node = document.createElement('div'); document.body.append(node); root = createRoot(node)
  })
  afterEach(() => { act(() => root.unmount()); node.remove(); vi.unstubAllGlobals() })

  it('completes the health check during StrictMode effect replay', async () => {
    vi.mocked(sendBackgroundMessage).mockResolvedValue({ type: 'HEALTH', ok: true })
    await act(async () => root.render(<StrictMode><HealthProbe /></StrictMode>))
    expect(node.textContent).toBe('connected')
  })

  it('does not label a disconnected extension as a server outage', async () => {
    vi.mocked(sendBackgroundMessage).mockResolvedValue({ ok: false, error: 'extension_context_invalidated' })
    await act(async () => root.render(<HealthProbe />))
    expect(node.textContent).toContain('Reload this page')
    expect(node.textContent).not.toContain('API unreachable')
  })

  it('still reports a genuine API health failure', async () => {
    vi.mocked(sendBackgroundMessage).mockResolvedValue({ type: 'HEALTH', ok: false })
    await act(async () => root.render(<HealthProbe />))
    expect(node.textContent).toBe('API unreachable')
  })

  it('makes a failed full-settings action visible and retryable', async () => {
    vi.mocked(sendBackgroundMessage).mockImplementation(async ({ type }) => type === 'HEALTH'
      ? { type: 'HEALTH', ok: true }
      : { ok: false, error: 'extension_context_invalidated' })
    await act(async () => root.render(<PulseSettingsPanel />))
    const button = node.querySelector<HTMLButtonElement>('[data-settings-host-cta="pulse"]')!
    await act(async () => button.click())
    expect(node.querySelector('[role="alert"]')?.textContent).toContain('Reload this page')
    expect(button.disabled).toBe(false)
  })
})
