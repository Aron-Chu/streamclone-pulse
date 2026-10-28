import { act, render, renderHook, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublicHub } from '../src/lib/publicHub'

const poll = vi.fn()
const load = vi.fn()
vi.mock('../src/lib/momentsFeed', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/momentsFeed')>()),
  pollMomentsFeed: (...args: unknown[]) => poll(...args),
  loadMomentsWindow: (...args: unknown[]) => load(...args),
}))
// The feed rows are not under test here: only how often the Moments list is read.
vi.mock('../src/ui/components/hub/v5/hubV5FeedModel', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/ui/components/hub/v5/hubV5FeedModel')>()),
  liveFeedModel: () => ({}),
  feedFresh: () => new Set<string>(),
  feedForGame: () => ({ up: [] }),
}))

import { HubV5LiveFeed, useHubLiveFeed } from '../src/ui/components/hub/v5/HubV5LiveFeed'

const hubAt = (generatedAt: string) => ({ generatedAt }) as unknown as PublicHub
const snapshot = { items: [], generatedAt: '2026-10-22T12:00:00Z' }

beforeEach(() => {
  vi.stubEnv('VITE_PUBLIC_MOMENTS_FEED', '1')
  poll.mockReset()
  load.mockReset().mockResolvedValue({ items: [], generatedAt: Date.parse(snapshot.generatedAt), stale: false, total: 0, verdicts: { ok: 0, warn: 0, bad: 0 }, categories: [], nextCursor: null })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('hub feed Moments list reads', () => {
  it('reads once on mount, not again for the hub first snapshot', async () => {
    poll.mockResolvedValue(snapshot)
    const { rerender } = renderHook(({ hub }) => useHubLiveFeed(hub), { initialProps: { hub: null as PublicHub | null } })
    rerender({ hub: hubAt('2026-10-22T12:00:00Z') })
    await waitFor(() => expect(poll).toHaveBeenCalledTimes(1))
    // Each later hub poll still reads the list again.
    rerender({ hub: hubAt('2026-10-22T12:00:30Z') })
    await waitFor(() => expect(poll).toHaveBeenCalledTimes(2))
  })

  it('keeps the mount read when the hub answers before it does', async () => {
    let answer: (value: typeof snapshot) => void = () => {}
    poll.mockImplementationOnce((_now: number, signal: AbortSignal) => new Promise((resolve, reject) => {
      answer = resolve
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    }))
    const { result, rerender } = renderHook(({ hub }) => useHubLiveFeed(hub), { initialProps: { hub: null as PublicHub | null } })
    rerender({ hub: hubAt('2026-10-22T12:00:00Z') })
    answer(snapshot)
    await waitFor(() => expect(result.current.shown).toEqual({}))
    expect(poll).toHaveBeenCalledTimes(1)
    expect((poll.mock.calls[0][1] as AbortSignal).aborted).toBe(false)
  })

  it('reads again for the hub first snapshot when the mount read failed', async () => {
    poll.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(snapshot)
    const { rerender } = renderHook(({ hub }) => useHubLiveFeed(hub), { initialProps: { hub: null as PublicHub | null } })
    await waitFor(() => expect(poll).toHaveBeenCalledTimes(1))
    await Promise.resolve()
    rerender({ hub: hubAt('2026-10-22T12:00:00Z') })
    await waitFor(() => expect(poll).toHaveBeenCalledTimes(2))
  })
})

describe('hub first load Moments reads', () => {
  function Rail({ hub }: { hub: PublicHub | null }) {
    return <HubV5LiveFeed feed={useHubLiveFeed(hub)} nowMs={Date.parse(snapshot.generatedAt)} />
  }

  it('makes one set: the list once, then Top moments’ window and its four counts once each', async () => {
    poll.mockResolvedValue(snapshot)
    const { rerender } = render(<MemoryRouter><Rail hub={null} /></MemoryRouter>)
    rerender(<MemoryRouter><Rail hub={hubAt('2026-10-22T12:00:00Z')} /></MemoryRouter>)
    await waitFor(() => expect(load).toHaveBeenCalledTimes(5))
    await act(async () => {})
    expect(poll).toHaveBeenCalledTimes(1)
    expect(load).toHaveBeenCalledTimes(5)
    expect(load.mock.calls.every((c) => !(c[1] as AbortSignal).aborted)).toBe(true)
  })
})
