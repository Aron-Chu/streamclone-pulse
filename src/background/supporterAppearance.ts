import type { BackgroundResponse } from '../shared/messages.ts'
import { supporterPerksAllowed, type SupporterEntitlement } from '../shared/supporterAccount.ts'
import { supporterTenureForMonths, type SupporterPaintStyle } from '../shared/supporterPaint.ts'

type AppearanceReply = Extract<BackgroundResponse, { type: 'SUPPORTER_APPEARANCE' }>

/**
 * What Twitch tabs and settings may draw for this membership.
 *
 * `perks` follows the same rule as the finish controls, so emote rain is on for
 * exactly the members who may equip a finish, whether or not they equipped one.
 * The crest follows the server's support count and travels with the perks, so
 * the Supporter card can climb to it with or without a finish; wave and sheen
 * are this profile's presentation choice and only travel with a verified
 * finish. A non-Supporter's reply is unchanged: no finish, no perks, nothing to
 * renew.
 *
 * A read that failed or is waiting on a renewal proves nothing either way, so
 * it is marked `unverified`: surfaces keep what they last verified until that
 * expires instead of blinking paint and rain off.
 */
export async function supporterAppearanceReply(
  entitlement: SupporterEntitlement,
  readPaint: () => Promise<SupporterPaintStyle>,
): Promise<AppearanceReply> {
  const unverified = entitlement.state === 'error' || (entitlement.state === 'unavailable' && entitlement.reason === 'temporarily_unavailable')
  if (unverified) return { type: 'SUPPORTER_APPEARANCE', finish: null, validForMs: 0, unverified: true }
  if (entitlement.state !== 'ready' || !supporterPerksAllowed(entitlement)) return { type: 'SUPPORTER_APPEARANCE', finish: null, validForMs: 0 }
  const finish = entitlement.cosmetics?.enabled ? entitlement.cosmetics.finish : null
  const tenure = supporterTenureForMonths(entitlement.supportPeriods)
  const paint = finish ? { paint: await readPaint() } : {}
  return { type: 'SUPPORTER_APPEARANCE', finish, validForMs: entitlement.validForMs ?? 0, tenure, ...paint, perks: true }
}
