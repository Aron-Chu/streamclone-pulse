import { isKitEmote, type KitEmoteName } from '../supporter/kit.ts'

/**
 * A Supporter's signature emote: one emote from a curated 7TV set that stands
 * for them on the Supporter card and banner.
 *
 * It is a presentation choice kept in this browser profile's synced settings,
 * like wave and sheen; the backend has no field for it yet. It is a Supporter
 * perk on the same rule as emote rain (`supporterPerksAllowed`): only a verified
 * membership shows it or may change it. A stored choice is kept, untouched,
 * while someone is not supporting, so it returns if they support again.
 */
export const SUPPORTER_SIGNATURE_KEY = 'supporterSignatureEmote'

/** The lab's signature choices plus the wide emotes, all from cdn.7tv.app. */
export const SIGNATURE_EMOTES = ['wideSpeedLaugh4', 'wideReacting', 'wideSpeedNod', 'PepePls', 'peepoPls', 'PartyParrot', 'BillyApprove', 'PETPET', 'AlienDance'] as const satisfies ReadonlyArray<KitEmoteName>
export type SignatureEmote = (typeof SIGNATURE_EMOTES)[number]

/** What a Supporter who never picked one gets. */
export const DEFAULT_SIGNATURE_EMOTE: SignatureEmote = 'wideSpeedLaugh4'

export function normalizeSignatureEmote(value: unknown): SignatureEmote {
  return isKitEmote(value) && (SIGNATURE_EMOTES as ReadonlyArray<string>).includes(value) ? value as SignatureEmote : DEFAULT_SIGNATURE_EMOTE
}

/** The emote to show for this person: theirs with Supporter perks, otherwise none (locked). */
export function signatureEmoteFor(perks: boolean, stored: unknown): SignatureEmote | null {
  return perks ? normalizeSignatureEmote(stored) : null
}

export async function getSignatureEmote(): Promise<SignatureEmote> {
  const stored = await chrome.storage.sync.get(SUPPORTER_SIGNATURE_KEY)
  return normalizeSignatureEmote(stored?.[SUPPORTER_SIGNATURE_KEY])
}

/**
 * Saves a choice. Only a Supporter may: without perks the choice is refused
 * and whatever was stored stays as it was.
 */
export async function setSignatureEmote(perks: boolean, value: SignatureEmote): Promise<boolean> {
  if (!perks || !(SIGNATURE_EMOTES as ReadonlyArray<string>).includes(value)) return false
  await chrome.storage.sync.set({ [SUPPORTER_SIGNATURE_KEY]: value })
  return true
}
