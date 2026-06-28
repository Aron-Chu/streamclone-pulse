import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fetchPublicEmotesOverview, normalizePublicEmotesOverview } from '../src/lib/publicEmotesOverview'
import { apiClient } from '../src/lib/apiClient'

vi.mock('../src/lib/apiClient', () => ({
  apiClient: vi.fn(),
}))

const mockedApiClient = vi.mocked(apiClient)

describe('fetchPublicEmotesOverview', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns unavailable contract when route is not deployed (404)', async () => {
    mockedApiClient.mockRejectedValue({ kind: 'bad_request', message: 'HTTP 404', status: 404 })
    const payload = await fetchPublicEmotesOverview('7d')
    expect(payload.state).toBe('unavailable')
    expect(payload.unavailableReason).toBe('route_not_deployed')
    expect(payload.aggregateOnly).toBe(true)
  })

  it('returns unavailable contract when backend returns 503', async () => {
    mockedApiClient.mockRejectedValue({ kind: 'server', message: 'HTTP 503', status: 503 })
    const payload = await fetchPublicEmotesOverview('7d')
    expect(payload.state).toBe('unavailable')
    expect(payload.unavailableReason).toBe('public_emotes_overview_unavailable')
  })

  it('rethrows non-route errors', async () => {
    mockedApiClient.mockRejectedValue({ kind: 'unauthorized', message: 'HTTP 401', status: 401 })
    await expect(fetchPublicEmotesOverview('7d')).rejects.toMatchObject({ status: 401 })
  })
})

describe('normalizePublicEmotesOverview', () => {
  it('defaults missing fields to empty/unavailable-safe values', () => {
    const payload = normalizePublicEmotesOverview(null)
    expect(payload.state).toBe('empty')
    expect(payload.aggregateOnly).toBe(false)
    expect(payload.providerSummaryPreview).toEqual([])
  })
})
