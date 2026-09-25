import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PulseMomentsLivePanel } from '../src/ui/components/analytics/PulseMomentsLivePanel'
import { normalizePublicHub, type PublicHubMomentsResponse } from '../src/lib/publicHub'
import { clearBucketMomentsCache, readBucketMomentsResponse, writeBucketMomentsCache } from '../src/lib/bucketMomentsCache'
import { mapHubPulseMoment } from '../src/lib/figmaSessionAnalytics'

const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('../src/lib/prefetchHubBucketMoments', () => ({ requestHubBucketMoments: request }))
const hub = normalizePublicHub(null)
const t = Math.floor(Date.now() / 360_000) * 360_000 - 720_000
function response(bucketT = t, status = 'empty', reason?: string): PublicHubMomentsResponse {
  return { bucketT, bucketStart: new Date(bucketT).toISOString(), bucketEnd: new Date(bucketT + 360_000).toISOString(), hubGeneratedAt: new Date().toISOString(), source: 'corpus_historical', status, reason, activityWindowMinutes: 1440, moments: [] }
}
function panel(bucketT: number | null, hoverBucketT?: number) {
  return <MemoryRouter><PulseMomentsLivePanel hub={hub} topEmotes={[]} feed={{ source: 'network', moments: [] }} layout="embedded" selectedBucketT={bucketT} hoverBucketT={hoverBucketT} activityWindow="24h" activityWindowMinutes={1440} onClearBucketFilter={() => {}} /></MemoryRouter>
}
beforeEach(() => { request.mockReset(); clearBucketMomentsCache() })
describe('bucket investigation recovery', () => {
  it('does not fetch historical moments on hover', () => {
    render(panel(null, t))
    expect(request).not.toHaveBeenCalled()
  })
  it('reports one failure without claiming no spikes and retries successfully', async () => {
    request.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(response())
    render(panel(t))
    await screen.findByText('Could not load moments for this bucket.')
    expect(screen.getByText('Selected bucket moments')).toBeTruthy()
    expect(screen.queryByText('Live-session peaks')).toBeNull()
    expect(screen.queryByText('No spikes in this bucket')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByText('No spikes in this bucket')
    expect(request).toHaveBeenCalledTimes(2)
  })
  it('retains unavailable status and exact server boundaries through cache', async () => {
    const unavailable = response(t, 'unavailable', 'store_unavailable')
    writeBucketMomentsCache(t, '24h', [], unavailable)
    render(panel(t))
    expect(await screen.findByText('Stored moments are currently unavailable.')).toBeTruthy()
    expect(screen.queryByText('No spikes in this bucket')).toBeNull()
    expect(readBucketMomentsResponse(t, '24h')).toEqual(unavailable)
    expect(request).not.toHaveBeenCalled()
  })
  it('retains confirmed empty status and boundaries without requesting again', () => {
    const empty = response(t, 'empty', 'no_moments')
    writeBucketMomentsCache(t, '24h', [], empty)
    render(panel(t))
    expect(screen.getByText('No spikes in this bucket')).toBeTruthy()
    expect(screen.getByText('Selected bucket moments')).toBeTruthy()
    expect(readBucketMomentsResponse(t, '24h')).toEqual(empty)
    expect(request).not.toHaveBeenCalled()
  })
  it('keeps matching recent moments when historical storage fails', async () => {
    const moment = mapHubPulseMoment({ login: 'knownchannel', displayName: 'Known Channel', streamId: 'stream-1', at: t + 60_000, offsetSeconds: 60, score: 80, label: 'Chat spike', kind: 'chat_spike', chatPerMin: 200, emotesPerMin: 20, viewers: 5000 })
    request.mockRejectedValueOnce(new Error('offline'))
    render(<MemoryRouter><PulseMomentsLivePanel hub={hub} topEmotes={[]} feed={{ source: 'network', moments: [moment] }} layout="embedded" selectedBucketT={t} activityWindow="24h" activityWindowMinutes={1440} onClearBucketFilter={() => {}} /></MemoryRouter>)
    await screen.findByText('Could not load moments for this bucket. Showing previously loaded matches.')
    expect(screen.getAllByText('Known Channel').length).toBeGreaterThan(0)
    expect(screen.queryByText('No spikes in this bucket')).toBeNull()
  })
  it('ignores an obsolete response after rapid bucket selection', async () => {
    let finish!: (value: PublicHubMomentsResponse) => void
    request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValueOnce(response(t + 360_000))
    const view = render(panel(t))
    view.rerender(panel(t + 360_000))
    await screen.findByText('No spikes in this bucket')
    await act(async () => finish(response(t, 'unavailable', 'store_unavailable')))
    expect(screen.queryByText('Stored moments are currently unavailable.')).toBeNull()
  })
  it('keeps retry disabled until Retry-After elapses', async () => {
    vi.useFakeTimers()
    try {
      request.mockRejectedValue({ retryAfterMs: 40_000 })
      render(panel(t))
      await act(async () => { await Promise.resolve() })
      const button = screen.getByRole('button', { name: 'Retry shortly' })
      expect((button as HTMLButtonElement).disabled).toBe(true)
      await act(async () => { await vi.advanceTimersByTimeAsync(40_000) })
      expect((screen.getByRole('button', { name: 'Retry' }) as HTMLButtonElement).disabled).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
