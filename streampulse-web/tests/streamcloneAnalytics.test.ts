import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createPortalAnalyticsApi, __portalAdapterUsesOnlyPortalChartPaths } from '../src/lib/streamcloneAnalytics'

const apiClientMock = vi.fn()

vi.mock('../src/lib/apiClient', () => ({
  apiClient: (...args: unknown[]) => apiClientMock(...args),
}))

describe('streamcloneAnalytics', () => {
  beforeEach(() => {
    apiClientMock.mockReset()
    apiClientMock.mockResolvedValue({ data: {}, status: 200 })
  })

  it('uses portal paths for stream detail loads', async () => {
    apiClientMock
      .mockResolvedValueOnce({ data: { channel: 'ludwig', stream: { streamId: '1', startedAt: '2026-01-01T00:00:00Z' } }, status: 200 })
      .mockResolvedValueOnce({ data: { minutes: [] }, status: 200 })

    const api = createPortalAnalyticsApi()
    await api.getAnalyticsStream('1', { channel: 'ludwig' })

    const paths = apiClientMock.mock.calls.map((call) => String(call[0]))
    expect(paths.some((path) => path.includes('/v1/portal/analytics/streams/1'))).toBe(true)
    expect(paths.some((path) => path.includes('/v1/analytics/streams/1'))).toBe(false)
  })

  it('uses portal channel live for live reads', async () => {
    const api = createPortalAnalyticsApi()
    await api.getAnalyticsLive('ludwig')
    expect(apiClientMock).toHaveBeenCalledWith('/v1/portal/analytics/channels/ludwig/live', expect.objectContaining({ gated: true }))
  })

  it('rejects raw stream chart paths in helper fixtures', () => {
    for (const path of __portalAdapterUsesOnlyPortalChartPaths()) {
      expect(path).not.toContain('/v1/analytics/streams')
    }
  })
})
