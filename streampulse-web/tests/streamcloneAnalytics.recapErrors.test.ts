import { beforeEach, describe, expect, it, vi } from 'vitest'

// Round 3 (SESSION-MOMENTS-4): the portal adapter returns null only when there is no recap (404) or the request was
// cancelled. A failed recap rethrows, so the session can say "Recap unavailable" with Try again.

const apiClientMock = vi.fn()

vi.mock('../src/lib/apiClient', () => ({
  apiClient: (...args: unknown[]) => apiClientMock(...args),
  getBackendUrl: () => 'http://127.0.0.1:8081',
}))

const apiError = (kind: string, status: number) => ({ kind, message: `${kind} ${status}`, status })

describe('portalAnalyticsApi.getPulseStreamRecap errors', () => {
  beforeEach(() => apiClientMock.mockReset())

  it('returns null for a 404 (no recap for this stream)', async () => {
    const { portalAnalyticsApi } = await import('../src/lib/streamcloneAnalytics')
    apiClientMock.mockRejectedValueOnce(apiError('bad_request', 404))
    await expect(portalAnalyticsApi.getPulseStreamRecap('recap-404')).resolves.toBeNull()
  })

  it('returns null for a cancelled request', async () => {
    const { portalAnalyticsApi } = await import('../src/lib/streamcloneAnalytics')
    apiClientMock.mockRejectedValueOnce(apiError('aborted', 0))
    await expect(portalAnalyticsApi.getPulseStreamRecap('recap-aborted')).resolves.toBeNull()
  })

  it('rethrows a 500 so the console shows the failure', async () => {
    const { portalAnalyticsApi } = await import('../src/lib/streamcloneAnalytics')
    const failure = apiError('server', 500)
    apiClientMock.mockRejectedValueOnce(failure)
    await expect(portalAnalyticsApi.getPulseStreamRecap('recap-500')).rejects.toBe(failure)
  })

  it('rethrows an unreachable backend', async () => {
    const { portalAnalyticsApi } = await import('../src/lib/streamcloneAnalytics')
    const failure = apiError('unreachable', 0)
    apiClientMock.mockRejectedValueOnce(failure)
    await expect(portalAnalyticsApi.getPulseStreamRecap('recap-unreachable')).rejects.toBe(failure)
  })

  it.each([
    ['timeout', 0],
    ['rate_limited', 429],
    ['bad_request', 400],
    ['unauthorized', 401],
  ])('rethrows %s (%i)', async (kind, status) => {
    const { portalAnalyticsApi } = await import('../src/lib/streamcloneAnalytics')
    const failure = apiError(kind, status)
    apiClientMock.mockRejectedValueOnce(failure)
    await expect(portalAnalyticsApi.getPulseStreamRecap(`recap-${kind}`)).rejects.toBe(failure)
  })

  it('still returns the normalized recap on success', async () => {
    const { portalAnalyticsApi } = await import('../src/lib/streamcloneAnalytics')
    apiClientMock.mockResolvedValueOnce({ data: { streamId: 'recap-ok', topMoments: [] } })
    const recap = await portalAnalyticsApi.getPulseStreamRecap('recap-ok') as { streamId?: string } | null
    expect(recap?.streamId).toBe('recap-ok')
  })
})
