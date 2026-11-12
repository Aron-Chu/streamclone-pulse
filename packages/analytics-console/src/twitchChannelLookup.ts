import { getConfiguredAnalyticsApi, type TwitchChannelLookup } from './configureApi.ts'

/** The configured app's Twitch check for a login; an app without one, or a failed read, is "unknown". */
export async function lookupTwitchChannel(login: string): Promise<TwitchChannelLookup> {
  try {
    const fn = getConfiguredAnalyticsApi().lookupTwitchChannel
    return fn ? await fn(login) : { state: 'unknown' }
  } catch {
    return { state: 'unknown' }
  }
}
