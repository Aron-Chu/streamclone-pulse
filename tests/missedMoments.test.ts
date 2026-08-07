import { describe, expect, it } from 'vitest'
import {
  canShowVodBackfillCTA,
  coverageCardCopy,
  evaluateBackfillRefresh,
  isPulseBackfillTerminal,
  missedMomentsButtonLabel,
  missedMomentsButtonState,
  backendResolvedVod,
  resolvePulseCoverage,
  shouldShowMissedMomentsBanner,
  shouldShowStreamStartAction,
} from '../src/ui/missedMoments.ts'
import type { PulseCoverage } from '../src/shared/messages.ts'

function partialCoverage(overrides: Partial<PulseCoverage> = {}): PulseCoverage {
  return {
    state: 'partial_tracking',
    coverageStartOffsetSeconds: 7200,
    coverageEndOffsetSeconds: 9000,
    hasFullStreamCoverage: false,
    hasGaps: true,
    missingRanges: [{ fromOffsetSeconds: 0, toOffsetSeconds: 7140 }],
    canBackfill: true,
    backfillReason: 'vod_available',
    message: 'Showing moments since 2:00:00',
    ...overrides,
  }
}

describe('missedMoments helpers', () => {
  it('hides stream-start action until late join or VOD/backfill path exists', () => {
    expect(
      shouldShowStreamStartAction({
        tracking: true,
        coverageStartOffsetSeconds: 0,
        isLive: true,
      }),
    ).toBe(false)
    expect(
      shouldShowStreamStartAction({
        tracking: true,
        coverageStartOffsetSeconds: 900,
        vodId: '2797507897',
        isLive: true,
      }),
    ).toBe(true)
    expect(
      shouldShowStreamStartAction({
        tracking: false,
        coverageStartOffsetSeconds: 900,
        vodId: '2797507897',
        isLive: true,
      }),
    ).toBe(false)
  })

  it('shows banner for actionable VOD backfill or active backfill states', () => {
    const coverage = partialCoverage()
    expect(shouldShowMissedMomentsBanner({ coverage, vodId: '2797507897' })).toBe(true)
    expect(
      shouldShowMissedMomentsBanner({ coverage: partialCoverage({ hasFullStreamCoverage: true }) }),
    ).toBe(false)
    expect(
      shouldShowMissedMomentsBanner({
        coverageStartOffsetSeconds: 900,
        isLive: true,
      }),
    ).toBe(true)
  })

  it('derives coverage when backend omits nested coverage object', () => {
    const resolved = resolvePulseCoverage({
      coverageStartOffsetSeconds: 900,
      vodId: '2797507897',
      isLive: true,
    })
    expect(resolved?.canBackfill).toBe(true)
    expect(
      shouldShowMissedMomentsBanner({
        coverageStartOffsetSeconds: 900,
        vodId: '2797507897',
        isLive: true,
      }),
    ).toBe(true)
    expect(missedMomentsButtonLabel('load')).toBe('Fill from Twitch VOD')
  })

  it('labels load vs backfill states', () => {
    expect(missedMomentsButtonLabel('load')).toBe('Fill from Twitch VOD')
    expect(missedMomentsButtonLabel('backfilling', {
      jobId: 'x',
      status: 'fetching_chat',
      message: 'Fetching',
      progress: { percent: 33 },
      range: { fromOffsetSeconds: 0, toOffsetSeconds: 100 },
      streamId: '1',
      login: 'chan',
    })).toContain('33%')
    expect(missedMomentsButtonLabel('waiting_vod')).toBe('Waiting for VOD')
    expect(missedMomentsButtonLabel('check_vod')).toBe('Check for VOD')
  })

  it('derives button state from coverage with G2 gating', () => {
    expect(
      missedMomentsButtonState({ coverage: partialCoverage(), vodId: '2797507897' }, false, false),
    ).toBe('load')
    expect(
      missedMomentsButtonState({ coverage: partialCoverage(), vodId: '2797507897' }, false, false, 'hint'),
    ).toBe('load')
    expect(
      missedMomentsButtonState({ coverage: partialCoverage() }, false, false),
    ).toBe('check_vod')
    expect(
      missedMomentsButtonState({ coverageStartOffsetSeconds: 900, isLive: true }, false, false),
    ).toBe('check_vod')
    expect(
      missedMomentsButtonState({ coverage: partialCoverage({ state: 'backfill_running' }) }, false, false),
    ).toBe('backfilling')
    expect(
      missedMomentsButtonState({ coverage: partialCoverage({ state: 'waiting_for_vod' }) }, false, false),
    ).toBe('check_vod')
    expect(
      missedMomentsButtonState({ coverage: partialCoverage(), vodId: '2797507897' }, false, true),
    ).toBe('refreshed')
  })

  it('canShowVodBackfillCTA requires canBackfill and vod or hint', () => {
    expect(canShowVodBackfillCTA({ coverage: partialCoverage(), vodId: '123' })).toBe(true)
    expect(canShowVodBackfillCTA({ coverage: partialCoverage() }, '456')).toBe(true)
    expect(canShowVodBackfillCTA({ coverage: partialCoverage() })).toBe(false)
    expect(
      canShowVodBackfillCTA({
        coverage: partialCoverage({ canBackfill: false }),
        vodId: '123',
      }),
    ).toBe(false)
  })

  it('does not unlock backfill from navigationVodId alone', () => {
    expect(
      canShowVodBackfillCTA({
        coverage: partialCoverage({ state: 'waiting_for_vod', canBackfill: false }),
        navigationVodId: '2839713915',
        isLive: true,
      }),
    ).toBe(false)
    expect(
      canShowVodBackfillCTA({
        coverage: partialCoverage({ canBackfill: true }),
        navigationVodId: '2839713915',
      }),
    ).toBe(false)
    expect(
      resolvePulseCoverage({
        coverage: partialCoverage({ state: 'waiting_for_vod', canBackfill: false }),
        navigationVodId: '2839713915',
      })?.canBackfill,
    ).toBe(false)
    expect(
      shouldShowMissedMomentsBanner({
        coverage: partialCoverage({ state: 'waiting_for_vod', canBackfill: false }),
        navigationVodId: '2839713915',
        isLive: true,
      }),
    ).toBe(true)
  })

  it('overrides hosted waiting_for_vod copy when navigationVodId is known', () => {
    const copy = coverageCardCopy({
      coverage: partialCoverage({
        state: 'waiting_for_vod',
        canBackfill: false,
        copyKey: 'waiting_for_vod',
        message: 'VOD chat not available yet — archive publishes after the stream ends',
      }),
      navigationVodId: '2839713915',
      isLive: true,
    })
    expect(copy?.title).toBe('Current-broadcast VOD available')
    expect(copy?.body).toMatch(/Jump|Past Streams/i)
    expect(copy?.body).not.toMatch(/archive publishes after the stream ends/i)
    expect(
      missedMomentsButtonState({
        coverage: partialCoverage({ state: 'waiting_for_vod' }),
        navigationVodId: '2839713915',
      }, false, false),
    ).toBe('recheck_pulse_link')
    expect(missedMomentsButtonLabel('recheck_pulse_link')).toBe('Recheck Pulse link')
  })

  it('treats terminal backfill statuses', () => {
    expect(isPulseBackfillTerminal('done')).toBe(true)
    expect(isPulseBackfillTerminal('already_available')).toBe(true)
    expect(isPulseBackfillTerminal('fetching_chat')).toBe(false)
  })

  it('evaluates backfill refresh outcomes from coverage movement', () => {
    const before = {
      coverageStartOffsetSeconds: 7200,
      coverage: partialCoverage(),
    }
    expect(
      evaluateBackfillRefresh(before, {
        coverageStartOffsetSeconds: 7200,
        coverage: partialCoverage({ hasFullStreamCoverage: true }),
      }),
    ).toBe('full')
    expect(
      evaluateBackfillRefresh(before, {
        coverageStartOffsetSeconds: 3600,
        coverage: partialCoverage({ coverageStartOffsetSeconds: 3600 }),
      }),
    ).toBe('partial')
    expect(
      evaluateBackfillRefresh(before, {
        coverageStartOffsetSeconds: 7200,
        coverage: partialCoverage(),
      }),
    ).toBe('none')
  })

  it('evaluates refresh when backend omits nested coverage', () => {
    const before = { coverageStartOffsetSeconds: 900, vodId: '123', isLive: true }
    expect(
      evaluateBackfillRefresh(before, {
        coverageStartOffsetSeconds: 120,
        vodId: '123',
        isLive: true,
      }),
    ).toBe('partial')
  })

  it('prefers backend copyKey and message over legacy derivation', () => {
    const resolved = resolvePulseCoverage({
      coverageStartOffsetSeconds: 900,
      vodId: '2797507897',
      isLive: true,
      coverage: {
        state: 'waiting_for_vod',
        coverageStartOffsetSeconds: 900,
        coverageEndOffsetSeconds: 4500,
        hasFullStreamCoverage: false,
        hasGaps: true,
        canBackfill: false,
        copyKey: 'waiting_for_vod',
        message: 'VOD chat not published yet — IRC tracking continues live.',
        vodStatus: 'pending',
        trackedFromStart: false,
        manualRetryAllowed: true,
        chatSource: 'irc',
      },
    })
    expect(resolved?.message).toBe('VOD chat not published yet — IRC tracking continues live.')
    expect(resolved?.vodStatus).toBe('pending')
  })

  it('detects backend-resolved VOD from vodId or vodStatus', () => {
    expect(backendResolvedVod({ vodId: '2797507897' })).toBe(true)
    expect(backendResolvedVod({ coverage: { ...partialCoverage(), vodStatus: 'available' } })).toBe(true)
    expect(backendResolvedVod({ coverage: partialCoverage({ vodStatus: 'pending' }) })).toBe(false)
  })

  it('offers load CTA when backend linked VOD despite local GQL failure path', () => {
    const source = {
      coverageStartOffsetSeconds: 900,
      vodId: '2797507897',
      isLive: true,
      coverage: partialCoverage({
        copyKey: 'missing_ranges_detected',
        message: 'Fill missing start from Twitch VOD',
        vodStatus: 'available',
        manualRetryAllowed: true,
      }),
    }
    expect(missedMomentsButtonState(source, false, false)).toBe('load')
  })
})
