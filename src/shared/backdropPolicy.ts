/**
 * The 7TV emote backdrop stays free until Supporter sign-ups open (owner
 * decision 2026-10-11). Set BACKDROP_FREE to false in the release that opens
 * sign-ups: Still and Rain then lock again for anyone who is not a Supporter,
 * with their saved choice kept, and the "becomes a perk" note goes away.
 *
 * Its own module so tests can flip it (vi.mock) and keep the locked path covered.
 */
export const BACKDROP_FREE: boolean = true
export const BACKDROP_FREE_NOTE = 'Becomes a Supporter perk when sign-ups open.'
