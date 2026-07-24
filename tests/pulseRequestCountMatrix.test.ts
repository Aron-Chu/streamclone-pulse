import { describe, expect, it } from 'vitest'
import {
  coalesceInFlight,
  PULSE_REVALIDATE_FAILURE_COOLDOWN_MS,
  PULSE_REVALIDATE_MIN_GAP_MS,
  shouldAllowPulseRevalidate,
} from '../src/background/pulseRevalidateGate.ts'
import {
  classifyPulseCacheFreshness,
  createRequestGeneration,
  planGetPulseNetwork,
  recurringPollWindow,
} from '../src/background/pulseRequestPolicy.ts'

describe('pulse request-count matrix', () => {
  it('classifies cold / fresh / stale cache ages', () => {
    expect(classifyPulseCacheFreshness(null)).toBe('cold')
    expect(classifyPulseCacheFreshness(0)).toBe('fresh')
    expect(classifyPulseCacheFreshness(PULSE_REVALIDATE_MIN_GAP_MS - 1)).toBe('fresh')
    expect(classifyPulseCacheFreshness(PULSE_REVALIDATE_MIN_GAP_MS)).toBe('stale')
    expect(classifyPulseCacheFreshness(50_000)).toBe('cold')
  })

  it('fresh cache plans zero network', () => {
    expect(planGetPulseNetwork({ freshness: 'fresh', window: 'recent' })).toEqual({
      syncFetch: false,
      asyncRevalidate: false,
    })
  })

  it('stale cache plans one coalesced async revalidate', () => {
    expect(planGetPulseNetwork({ freshness: 'stale', window: 'recent' })).toEqual({
      syncFetch: false,
      asyncRevalidate: true,
    })
  })

  it('cold cache plans one sync fetch', () => {
    expect(planGetPulseNetwork({ freshness: 'cold', window: 'recent' })).toEqual({
      syncFetch: true,
      asyncRevalidate: false,
    })
  })

  it('recurring poll window is always recent', () => {
    expect(recurringPollWindow()).toBe('recent')
  })

  it('explicit Full uses the full window plan', () => {
    expect(planGetPulseNetwork({ freshness: 'cold', window: 'full', explicitFull: true })).toEqual({
      syncFetch: true,
      asyncRevalidate: false,
    })
  })

  it('coalesces simultaneous cold callers into one factory run', async () => {
    const map = new Map<string, Promise<number>>()
    let runs = 0
    const factory = async () => {
      runs += 1
      await new Promise(r => setTimeout(r, 20))
      return 42
    }
    const [a, b, c] = await Promise.all([
      coalesceInFlight(map, 'xqc:recent', factory),
      coalesceInFlight(map, 'xqc:recent', factory),
      coalesceInFlight(map, 'xqc:recent', factory),
    ])
    expect(runs).toBe(1)
    expect([a, b, c]).toEqual([42, 42, 42])
  })

  it('two tabs same login share one in-flight key', async () => {
    const map = new Map<string, Promise<string>>()
    let runs = 0
    const key = 'jynxzi:recent'
    await Promise.all([
      coalesceInFlight(map, key, async () => {
        runs += 1
        return 'ok'
      }),
      coalesceInFlight(map, key, async () => {
        runs += 1
        return 'ok'
      }),
    ])
    expect(runs).toBe(1)
  })

  it('failure cooldown blocks retries until elapsed', () => {
    const lastSuccess = 0
    const failedAt = 10_000
    expect(
      shouldAllowPulseRevalidate(lastSuccess, failedAt + 1, {
        lastFailureAtMs: failedAt,
        failureCooldownMs: PULSE_REVALIDATE_FAILURE_COOLDOWN_MS,
      }),
    ).toBe(false)
    expect(
      shouldAllowPulseRevalidate(lastSuccess, failedAt + PULSE_REVALIDATE_FAILURE_COOLDOWN_MS, {
        lastFailureAtMs: failedAt,
      }),
    ).toBe(true)
  })

  it('force bypasses failure cooldown', () => {
    expect(
      shouldAllowPulseRevalidate(0, 1, {
        force: true,
        lastFailureAtMs: 1,
      }),
    ).toBe(true)
  })

  it('same-channel navigation keeps generation current for ongoing work', () => {
    const gen = createRequestGeneration()
    const g = gen.bump()
    expect(gen.isCurrent(g)).toBe(true)
  })

  it('different-channel navigation cancels obsolete backfill generation', () => {
    const gen = createRequestGeneration()
    const channelA = gen.bump()
    const channelB = gen.bump()
    expect(gen.isCurrent(channelA)).toBe(false)
    expect(gen.isCurrent(channelB)).toBe(true)
  })

  it('covers coverage / local-watch / backfill-status as non-full recent pulse paths', () => {
    expect(recurringPollWindow()).toBe('recent')
    expect(planGetPulseNetwork({ freshness: 'fresh', window: 'recent' }).syncFetch).toBe(false)
    expect(planGetPulseNetwork({ freshness: 'cold', window: 'recent' }).syncFetch).toBe(true)
  })
})

describe('coalesceInFlight cleanup', () => {
  it('clears the map entry after settle so a later call can run again', async () => {
    const map = new Map<string, Promise<number>>()
    let runs = 0
    await coalesceInFlight(map, 'k', async () => {
      runs += 1
      return 1
    })
    await coalesceInFlight(map, 'k', async () => {
      runs += 1
      return 2
    })
    expect(runs).toBe(2)
  })

  it('still clears after rejection', async () => {
    const map = new Map<string, Promise<number>>()
    await expect(
      coalesceInFlight(map, 'k', async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(map.size).toBe(0)
    const value = await coalesceInFlight(map, 'k', async () => 7)
    expect(value).toBe(7)
  })
})
