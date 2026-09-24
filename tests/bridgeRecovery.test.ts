import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendBackgroundMessage } from '../src/content/bridge.ts'

afterEach(() => vi.unstubAllGlobals())
describe('stale extension bridge', () => {
  it('preserves a recovery code when the extension context is gone', async () => {
    vi.stubGlobal('chrome', { runtime: {} })
    expect(await sendBackgroundMessage({ type: 'HEALTH' })).toEqual({ ok: false, error: 'extension_context_invalidated' })
  })
  it('handles rejected Chrome connections without leaking raw errors', async () => {
    vi.stubGlobal('chrome', { runtime: { id: 'test', sendMessage: vi.fn().mockRejectedValue(new Error('Extension context invalidated.')) } })
    expect(await sendBackgroundMessage({ type: 'OPEN_SETTINGS_HOST' })).toEqual({ ok: false, error: 'extension_context_invalidated' })
  })
})
