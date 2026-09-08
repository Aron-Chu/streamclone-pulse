import { afterEach, expect, it, vi } from 'vitest'
import { fetchPublicHubRecentMoments, normalizePublicHubRecentMoments } from '../src/lib/publicHub'

afterEach(() => vi.unstubAllGlobals())

it('uses the legacy hub only for an exact missing-route response', async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response('{}', { status: 404 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({
      generatedAt: '2026-09-08T00:00:00Z',
      livePulseMoments: [{ login: 'fixture', streamId: 's1', offsetSeconds: 12, score: 50, label: 'Measured', category: 'Exact' }],
    })))
  vi.stubGlobal('fetch', fetch)
  const result = await fetchPublicHubRecentMoments(new AbortController().signal)
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(fetch.mock.calls[1][0]).toContain('/v1/public/hub?activityWindow=30m')
  expect(result.loadSource).toBe('legacy_full_hub')
  expect(result.data.moments[0].streamId).toBe('s1')
})

it('does not amplify a rate limit into a full-hub read', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 429 }))
  vi.stubGlobal('fetch', fetch)
  await expect(fetchPublicHubRecentMoments()).rejects.toMatchObject({ status: 429 })
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('bounds results and rejects mismatched explicit category artwork', () => {
  const result = normalizePublicHubRecentMoments({ limit: 1, moments: [
    { offsetSeconds: 1, score: 50, label: 'Measured', categoryId: '42', boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/43-210x280.jpg' },
    { offsetSeconds: 2, score: 60, label: 'Measured' },
  ] })
  expect(result.hasMore).toBe(true)
  expect(result.moments).toHaveLength(1)
  expect(result.moments[0].boxArtUrl).toBeUndefined()
  expect(result.moments[0].categoryMetadataRejected).toBe(true)
})
