/**
 * Build-time switch for the "Seen in chat" Supporter copy
 * (VITE_SUPPORTER_CHAT_BADGES). Off unless the build sets it to `on` (or `1`,
 * the convention of the other account flags).
 *
 * - off (today): the public pages say exactly what ships now: Supporter perks
 *   show only in your own extension, nothing is added to chat, and nobody else
 *   sees them.
 * - on (launch day only): /supporter, the Terms, the privacy policy and the
 *   billing summary describe the optional chat crest, what it publishes and how
 *   to turn it off.
 *
 * Turn it on only together with the backend's PULSE_SUPPORTER_CHAT_BADGES_ENABLED
 * (public, not pilot) and an extension release that ships the feature, so the
 * site never promises a perk that is not live, and never keeps saying "nobody
 * else sees them" once it is. Design: Supporter chat badges spec, 2026-10-10, §9.
 */
export function supporterChatBadgesEnabled(): boolean {
  const value = import.meta.env.VITE_SUPPORTER_CHAT_BADGES
  return value === 'on' || value === '1'
}
