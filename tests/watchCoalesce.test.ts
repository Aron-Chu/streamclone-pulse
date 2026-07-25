import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createWatchCoordinatorState,
  ensureWatchCoalesced,
  WATCH_SUCCESS_TTL_MS,
} from '../src/background/watchCoordinator.ts'

const BASE_URL = 'http://localhost:8081'

describe('ensureWatchCoalesced (B4)', () => {
  let now: number
  let postWatch: ReturnType<typeof vi.fn<(login: string) => Promise<void>>>
  let state: ReturnType<typeof createWatchCoordinatorState>

  beforeEach(() => {
    now = 1_000_000
    postWatch = vi.fn(async () => undefined)
    state = createWatchCoordinatorState()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('concurrent tabs same login → one postWatch', async () => {
    postWatch.mockImplementation(
      () => new Promise<void>(resolve => setTimeout(resolve, 20)),
    )
    vi.useFakeTimers()

    const deps = { postWatch, now: () => now }
    const first = ensureWatchCoalesced('XQC', deps, state)
    const second = ensureWatchCoalesced('xqc', deps, state)

    await vi.advanceTimersByTimeAsync(25)
    const [a, b] = await Promise.all([first, second])

    expect(postWatch).toHaveBeenCalledTimes(1)
    expect(postWatch).toHaveBeenCalledWith('xqc')
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    expect(b.coalesced).toBe(true)
  })

  it('sync sequential → TTL skip on second (skippedTtl)', async () => {
    const deps = {
      postWatch,
      now: () => now,
      onWatchSuccess: (login: string) => {
        state.lastSuccessAt.set(login, now)
      },
    }

    const first = await ensureWatchCoalesced('shroud', deps, state)
    expect(first.skippedTtl).toBe(false)
    expect(postWatch).toHaveBeenCalledTimes(1)

    const second = await ensureWatchCoalesced('shroud', deps, state)
    expect(second.ok).toBe(true)
    expect(second.skippedTtl).toBe(true)
    expect(postWatch).toHaveBeenCalledTimes(1)
  })

  it('success records lastSuccessAt', async () => {
    await ensureWatchCoalesced('summit1g', { postWatch, now: () => now }, state)
    expect(state.lastSuccessAt.get('summit1g')).toBe(now)
  })

  it('failure + pulse ok path: watch throws, ensureWatch returns ok:false, caller can still fetch pulse', async () => {
    postWatch.mockRejectedValue(new Error('watch_failed'))
    const watchResult = await ensureWatchCoalesced('lirik', { postWatch, now: () => now }, state)
    expect(watchResult).toEqual({
      ok: false,
      coalesced: false,
      skippedTtl: false,
      error: 'watch_failed',
    })

    let pulseGets = 0
    if (!watchResult.ok) {
      pulseGets += 1
    }
    pulseGets += 1
    expect(pulseGets).toBe(2)
  })

  it('cooldown/TTL expiry allows retry', async () => {
    const deps = { postWatch, now: () => now, successTtlMs: WATCH_SUCCESS_TTL_MS }

    await ensureWatchCoalesced('ninja', deps, state)
    expect(postWatch).toHaveBeenCalledTimes(1)

    const skipped = await ensureWatchCoalesced('ninja', deps, state)
    expect(skipped.skippedTtl).toBe(true)
    expect(postWatch).toHaveBeenCalledTimes(1)

    now += WATCH_SUCCESS_TTL_MS + 1
    await ensureWatchCoalesced('ninja', deps, state)
    expect(postWatch).toHaveBeenCalledTimes(2)
  })

  it('different logins → separate watches', async () => {
    await ensureWatchCoalesced('xqc', { postWatch, now: () => now }, state)
    await ensureWatchCoalesced('shroud', { postWatch, now: () => now }, state)

    expect(postWatch).toHaveBeenCalledTimes(2)
    expect(postWatch).toHaveBeenNthCalledWith(1, 'xqc')
    expect(postWatch).toHaveBeenNthCalledWith(2, 'shroud')
  })

  it('uses production watch URL shape when wired through injected router', async () => {
    const calls: Array<{ method: string; url: string }> = []
    const routerPostWatch = vi.fn(async (login: string) => {
      calls.push({
        method: 'POST',
        url: `${BASE_URL}/v1/analytics/channels/${encodeURIComponent(login)}/watch`,
      })
    })

    await ensureWatchCoalesced('xqc', { postWatch: routerPostWatch, now: () => now }, state)
    expect(calls).toEqual([
      {
        method: 'POST',
        url: `${BASE_URL}/v1/analytics/channels/xqc/watch`,
      },
    ])
  })
})
