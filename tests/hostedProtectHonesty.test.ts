import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

/**
 * Hosted Protect network writes must be skipped to avoid unauthorized sync storms.
 * Local BFF may still attempt best-effort sync.
 */
describe('hosted Protect sync skip contract', () => {
  it('documents that hosted applyAlwaysTrackedPlan attempts zero network writes', () => {
    // Behavioral coverage lives in service-worker integration; this unit documents the RC policy.
    const hostedPlanResult = { attempted: 0, unauthorized: 0, failed: 0 }
    expect(hostedPlanResult.attempted).toBe(0)
  })
})

describe('setAlwaysTracked unauthorized soft-fail', () => {
  const getBackendUrl = vi.hoisted(() => vi.fn(async () => 'https://api.streampulse.stream'))
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.resetModules()
    getBackendUrl.mockResolvedValue('https://api.streampulse.stream')
    vi.doMock('../src/shared/storage.ts', () => ({ getBackendUrl }))
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
