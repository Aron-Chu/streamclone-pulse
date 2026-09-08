import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('../src/lib/momentsApiClient', () => ({ apiClient: request, getBackendUrl: () => 'https://api.streampulse.stream' }))

import { fromHubMoment } from '../src/lib/discoveryMoments'
import { useSavedMomentEvidence } from '../src/hooks/useSavedMomentEvidence'
import { parseSavedMoments, savedMomentRecord } from '../src/lib/savedDiscoveryMoments'

describe('useSavedMomentEvidence', () => {
  beforeEach(() => request.mockReset())

  it('keeps a URL-only saved reaction unchanged when the ranked recap omits its exact offset', async () => {
    // Synthetic reproduction of the live Saved gap: hub URLs, no provider IDs,
    // and a successful ranked recap containing the same name at another offset.
    const original = fromHubMoment({ login: 'creator', streamId: 'saved-recap-gap', offsetSeconds: 11656,
      label: 'Emote spike', category: 'Project Zomboid', chatPerMin: 560, emotesPerMin: 638,
      topEmotes: [{ name: 'LMAO', provider: 'seventv', count: 436,
        imageUrl: 'https://cdn.7tv.app/emote/example/4x.webp' }] })!
    const moments = parseSavedMoments(JSON.stringify({ version: 2, items: [savedMomentRecord(original)] }))
    expect(moments[0].topEmotes?.[0].imageUrl).toBeUndefined()
    request.mockResolvedValue({ data: { login: 'creator', streamId: original.streamId,
      topMoments: [{ offsetSeconds: 3676, reasons: ['seventv_spike'], chatPerMin: 1,
        topEmotes: [{ code: 'LMAO', provider: 'seventv', count: 318,
          imageUrl: 'https://cdn.7tv.app/emote/other/4x.webp' }] }] } })

    const { result, rerender } = renderHook(() => useSavedMomentEvidence(moments, true))
    const initial = result.current
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(result.current).not.toBe(initial))
    expect(result.current[0]).toEqual(moments[0])
    rerender()
    expect(request).toHaveBeenCalledTimes(1)
    expect(result.current[0].topEmotes).toEqual([{ name: 'LMAO', provider: 'seventv', count: 436 }])
  })

  it('hydrates only the first 12 visible saves with at most three exact recap reads at once', async () => {
    let active = 0
    let maxActive = 0
    request.mockImplementation(async (path: string) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise(resolve => setTimeout(resolve, 2))
      active -= 1
      const streamId = path.split('/').at(-2)!
      const index = Number(streamId.slice(1))
      return { data: {
        login: `creator${index}`,
        streamId,
        topMoments: [{
          offsetSeconds: index,
          reasons: ['seventv_spike'],
          topEmotes: [{ code: `emote${index}`, provider: 'seventv', id: `id-${index}`, imageUrl: `https://cdn.7tv.app/emote/id-${index}/2x.webp` }],
        }],
      } }
    })
    const moments = Array.from({ length: 15 }, (_, index) => fromHubMoment({
      login: `creator${index}`,
      streamId: `s${index}`,
      offsetSeconds: index,
      label: 'Emote spike',
      topEmotes: [{ name: `emote${index}`, provider: '7tv' }],
    })!)

    const { result } = renderHook(() => useSavedMomentEvidence(moments, true))
    await waitFor(() => expect(request).toHaveBeenCalledTimes(12))
    await waitFor(() => expect(result.current[11]?.topEmotes?.[0]?.imageUrl).toContain('cdn.7tv.app'))
    expect(result.current[12]?.topEmotes?.[0]?.imageUrl).toBeUndefined()
    expect(maxActive).toBeLessThanOrEqual(3)
  })
})
