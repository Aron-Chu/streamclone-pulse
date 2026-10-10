import { describe, expect, it, vi } from 'vitest'
import { supporterAppearanceReply } from '../src/background/supporterAppearance.ts'
import { supporterPerksAllowed, type SupporterEntitlement, type SupporterStatus } from '../src/shared/supporterAccount.ts'

const FEATURES = ['supporter.banner.v1', 'supporter.finish.v1', 'supporter.recognition.v1']
function member(status: SupporterStatus, extra: Partial<Extract<SupporterEntitlement, { state: 'ready' }>> = {}): SupporterEntitlement {
  return { state: 'ready', status, supportPeriods: 13, features: FEATURES, validForMs: 45_000, cosmetics: { enabled: false, finish: 'glass' }, ...extra }
}
const paint = { wave: 'aurora', sheen: 'glint' } as const

describe('Supporter perks (emote rain) use the cosmetics rule', () => {
  it('unlocks for active and grace members with the banner and finish features only', () => {
    expect(supporterPerksAllowed(member('active'))).toBe(true)
    expect(supporterPerksAllowed(member('grace'))).toBe(true)
    for (const status of ['none', 'pending', 'expired', 'review'] as const) expect(supporterPerksAllowed(member(status)), status).toBe(false)
    expect(supporterPerksAllowed(member('active', { features: ['supporter.banner.v1'] }))).toBe(false)
    expect(supporterPerksAllowed(member('active', { features: ['supporter.finish.v1'] }))).toBe(false)
    expect(supporterPerksAllowed({ state: 'not_linked' })).toBe(false)
    expect(supporterPerksAllowed({ state: 'unavailable', reason: 'temporarily_unavailable' })).toBe(false)
    expect(supporterPerksAllowed(null)).toBe(false)
  })

  it('tells Twitch tabs about perks and the earned crest even when no finish is equipped, and renews them like a finish', async () => {
    const readPaint = vi.fn().mockResolvedValue(paint)
    expect(await supporterAppearanceReply(member('active'), readPaint)).toStrictEqual({ type: 'SUPPORTER_APPEARANCE', finish: null, validForMs: 45_000, tenure: '12m', perks: true })
    // The crest follows the server's support count, so the Supporter card shows the crest it reports.
    for (const [periods, tenure] of [[0, 'new'], [3, '3m'], [7, '6m'], [12, '12m'], [30, '24m']] as const) {
      expect((await supporterAppearanceReply(member('active', { supportPeriods: periods }), readPaint)).tenure, `${periods} periods`).toBe(tenure)
    }
    // Wave and sheen still only travel with a verified finish.
    expect(readPaint).not.toHaveBeenCalled()
  })

  it('carries the finish, crest and paint with the perks for an equipped Supporter in grace', async () => {
    const reply = await supporterAppearanceReply(member('grace', { cosmetics: { enabled: true, finish: 'etched' } }), async () => paint)
    expect(reply).toStrictEqual({ type: 'SUPPORTER_APPEARANCE', finish: 'etched', validForMs: 45_000, tenure: '12m', paint, perks: true })
  })

  it('gives a lapsed, non-Supporter, unlinked or undeployed install no finish, no perks and nothing to renew', async () => {
    const readPaint = vi.fn().mockResolvedValue(paint)
    for (const entitlement of [
      // Even a stale equipped finish or stray feature flags never outlive the membership.
      member('expired', { cosmetics: { enabled: true, finish: 'halo' } }),
      member('none'),
      { state: 'not_linked' } as const,
      { state: 'unavailable', reason: 'not_deployed' } as const,
      { state: 'unavailable', reason: 'environment_mismatch' } as const,
    ]) {
      expect(await supporterAppearanceReply(entitlement, readPaint)).toStrictEqual({ type: 'SUPPORTER_APPEARANCE', finish: null, validForMs: 0 })
    }
    expect(readPaint).not.toHaveBeenCalled()
  })

  it('marks a failed or renewal-paused account read unverified, so surfaces keep what they last verified', async () => {
    for (const entitlement of [{ state: 'error' } as const, { state: 'unavailable', reason: 'temporarily_unavailable' } as const]) {
      expect(await supporterAppearanceReply(entitlement, async () => paint)).toStrictEqual({ type: 'SUPPORTER_APPEARANCE', finish: null, validForMs: 0, unverified: true })
    }
  })
})
