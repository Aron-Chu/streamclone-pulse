import { discordInviteUrl } from './discord'
import { feedbackSiteKey, supportFormAvailability } from './supportForm'

/** The label that says where the link goes and that it is public. */
export const SUGGEST_IN_DISCORD_LABEL = 'Suggest it in Discord (public)'

/**
 * Where "Suggest a channel" goes on a channel StreamPulse has not recorded.
 *
 * Until the private feedback form opens, /feedback only says "Form opens soon",
 * so the link goes straight to the public Discord, and its label says so. Once
 * the form is open, or in a build with no valid Discord invite (Discord links
 * stay hidden then), this returns undefined and the link stays "Suggest a
 * channel" on /feedback.
 */
export function suggestChannelLink(): { href: string; label: string } | undefined {
  const discord = discordInviteUrl()
  if (!discord) return undefined
  if (supportFormAvailability(feedbackSiteKey()) === 'ready') return undefined
  return { href: discord, label: SUGGEST_IN_DISCORD_LABEL }
}
