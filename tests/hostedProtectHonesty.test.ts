import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

describe('setAlwaysTracked unauthorized soft-fail', () => {
  const getBackendUrl = vi.hoisted(() => vi.fn(async () => 'https://api.streampulse.stream'))
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.resetModules()
    getBackendUrl.mockResolvedValue('https://api.streampulse.stream')
    vi.doMock('../src/shared/storage.ts', () => ({
      DEFAULT_BACKEND_URL: 'https://api.streampulse.stream',
      getBackendUrl,
    }))
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.clearAllMocks()
  })

  it('does not throw on 401 and marks unauthorized', async () => {
    globalThis.fetch = vi.fn(async () => new Response('no', { status: 401 })) as typeof fetch
    const { setAlwaysTracked } = await import('../src/background/api.ts')
    const result = await setAlwaysTracked('xqc', true)
    expect(result).toEqual({ ok: false, status: 401, unauthorized: true })
  })
})
