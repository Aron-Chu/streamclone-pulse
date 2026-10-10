import perks from '../../../../src/shared/supporter-perks.json'
import { supporterChatBadgesEnabled } from '../../lib/supporterChatBadgesFlag'

/**
 * Every Supporter perk the extension gives: the one list in
 * src/shared/supporter-perks.json that the extension's offer, settings banner
 * and quick settings also render (owner decision 2026-10-09, Terms option a).
 * /supporter and the Terms show it through this component, so the two pages
 * and the extension cannot drift apart.
 *
 * "Seen in chat" (perks.seenInChat) is listed, and its "onlyYou" sentence used,
 * only while VITE_SUPPORTER_CHAT_BADGES is on, so the pages never promise the
 * chat crest before it ships and never say "nobody else sees them" after.
 */
export const SUPPORTER_PERKS = perks

/** The "who sees them" sentence that is true for this build. */
export function supporterOnlyYou(): string {
  return supporterChatBadgesEnabled() ? perks.seenInChat.onlyYou : perks.onlyYou
}

/** Perk names for this build, in list order. */
export function supporterPerkNames(): string[] {
  return supporterChatBadgesEnabled() ? [...perks.names, perks.seenInChat.name] : [...perks.names]
}

export function SupporterPerkItems() {
  return (
    <>
      {perks.names.map(name => (
        <li key={name} data-perk-name={name}>
          <strong>{name}</strong>: {perks.details[name as keyof typeof perks.details]}
        </li>
      ))}
      {supporterChatBadgesEnabled() ? (
        <li key={perks.seenInChat.name} data-perk-name={perks.seenInChat.name}>
          <strong>{perks.seenInChat.name}</strong>: {perks.seenInChat.detail}
        </li>
      ) : null}
    </>
  )
}
