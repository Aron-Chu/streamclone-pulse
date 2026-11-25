/** Public pages with a useful job before an extension install. */
export const GROWTH_PAGES = [
  { path: 'guides/find-twitch-moments', canonicalPath: '/guides/find-twitch-moments',
    title: 'Find and Bookmark Twitch Reaction Moments — StreamPulse',
    description: 'Use StreamPulse coverage, measured chat reactions, verified replay links and local bookmarks to review moments from tracked Twitch streams.', robots: 'index,follow' as const },
  // The timestamp link builder sits at the top of this guide. Its old address,
  // TIMESTAMP_TOOL_PATH, opens here.
  { path: 'guides/twitch-vod-timestamps', canonicalPath: '/guides/twitch-vod-timestamps',
    title: 'Twitch VOD Timestamp Link Builder and Guide — StreamPulse',
    description: 'Make a Twitch VOD link that starts at the time you found, right in your browser. Then check which time to enter and why a replay link can stop working.', robots: 'index,follow' as const },
  // Lists every reviewed recap in content/recap-pilot.json, so it grows with the manifest.
  { path: 'recaps', canonicalPath: '/recaps',
    title: 'Twitch Chat Recaps — StreamPulse',
    description: 'Reviewed recaps of tracked Twitch streams: the top chat reactions, most-used emotes and measured coverage for each broadcast, with replay links where available.', robots: 'index,follow' as const },
] as const

/** The timestamp builder's old address. It opens the guide, so search lists only the guide. */
export const TIMESTAMP_TOOL_PATH = '/tools/twitch-vod-timestamp-link'
