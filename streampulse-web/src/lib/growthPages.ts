/** Public pages with a useful job before an extension install. */
export const GROWTH_PAGES = [
  { path: 'tools/twitch-vod-timestamp-link', canonicalPath: '/tools/twitch-vod-timestamp-link',
    title: 'Twitch VOD Timestamp Link Builder — StreamPulse',
    description: 'Make a clean Twitch VOD link at a known timestamp. Validate a video URL and elapsed time locally, then copy or open the link.', robots: 'index,follow' as const },
  { path: 'guides/find-twitch-moments', canonicalPath: '/guides/find-twitch-moments',
    title: 'Find and Bookmark Twitch Reaction Moments — StreamPulse',
    description: 'Use StreamPulse coverage, measured chat reactions, verified replay links and local bookmarks to review moments from tracked Twitch streams.', robots: 'index,follow' as const },
  { path: 'guides/twitch-vod-timestamps', canonicalPath: '/guides/twitch-vod-timestamps',
    title: 'Twitch VOD Availability and Timestamps — StreamPulse',
    description: 'Understand Twitch VOD retention, unavailable replays, elapsed player time and broadcast alignment before sharing a timestamped link.', robots: 'index,follow' as const },
  // Lists every reviewed recap in content/recap-pilot.json, so it grows with the manifest.
  { path: 'recaps', canonicalPath: '/recaps',
    title: 'Twitch Chat Recaps — StreamPulse',
    description: 'Reviewed recaps of tracked Twitch streams: the top chat reactions, most-used emotes and measured coverage for each broadcast, with replay links where available.', robots: 'index,follow' as const },
] as const
