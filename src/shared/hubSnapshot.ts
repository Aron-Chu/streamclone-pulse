/**
 * The slice of the public analytics hub the toolbar popup shows away from a
 * stream: what Twitch chat is doing right now across the channels Pulse
 * charts. Only aggregates and public channel metadata; never message text.
 */
export interface HubEmote {
  name: string
  imageUrl: string | null
  /** Uses in the hub's activity window (30 minutes). */
  count: number
  animated: boolean
}

export interface HubChannel {
  login: string
  displayName: string
  category: string | null
  avatarUrl: string | null
  viewers: number
  chatPerMin: number
}

export interface HubSnapshot {
  generatedAt: string
  /** Live channels in the pool Pulse charts. */
  liveChannels: number
  viewers: number | null
  emotesPerMin: number | null
  /** Most-used emotes across those channels, busiest first. */
  topEmotes: HubEmote[]
  /** The busiest chats right now, busiest first. */
  channels: HubChannel[]
}

const TOP_EMOTES = 12
const TOP_CHANNELS = 3

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const count = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
const text = (value: unknown, max: number): string | null => typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : null

/** Twitch serves profile images at fixed sizes; the popup never needs more than 70 px. */
function smallAvatar(url: string | null): string | null {
  return url ? url.replace(/-profile_image-\d+x\d+\.(png|jpe?g|webp)$/, '-profile_image-70x70.$1') : null
}

/** Reduce a raw `/v1/public/hub` body to what the popup renders, or null when it is unusable. */
export function slimHubSnapshot(raw: unknown): HubSnapshot | null {
  if (!isRecord(raw)) return null
  const generatedAt = text(raw.generatedAt, 64)
  const liveChannels = count(raw.poolSize)
  if (!generatedAt || liveChannels === null) return null
  const activity = isRecord(raw.activity) ? raw.activity : {}
  const intel = isRecord(raw.emoteIntel) ? raw.emoteIntel : {}

  const topEmotes: HubEmote[] = []
  for (const emote of Array.isArray(raw.topEmotes) ? raw.topEmotes : []) {
    if (!isRecord(emote)) continue
    const name = text(emote.name, 100)
    const uses = count(emote.count)
    if (!name || !uses) continue
    topEmotes.push({ name, imageUrl: text(emote.imageUrl, 500), count: uses, animated: emote.animated === true })
    if (topEmotes.length === TOP_EMOTES) break
  }

  const channels: HubChannel[] = []
  for (const channel of Array.isArray(raw.liveChannels) ? raw.liveChannels : []) {
    if (!isRecord(channel)) continue
    const login = text(channel.login, 25)
    const viewers = count(channel.viewers)
    const chatPerMin = count(channel.chatPerMin)
    // Only channels whose chat Pulse is actually reading; stats-only rows carry no chat rate.
    if (!login || !/^\w{1,25}$/.test(login) || viewers === null || !chatPerMin || channel.coverageState !== 'synced') continue
    channels.push({
      login: login.toLowerCase(),
      displayName: text(channel.displayName, 50) ?? login,
      category: text(channel.category, 120),
      avatarUrl: smallAvatar(text(channel.profileImageUrl, 500)),
      viewers,
      chatPerMin,
    })
  }
  channels.sort((a, b) => b.chatPerMin - a.chatPerMin)

  return {
    generatedAt,
    liveChannels,
    viewers: count(activity.livePoolViewerSum),
    emotesPerMin: count(intel.emotesPerMin),
    topEmotes,
    channels: channels.slice(0, TOP_CHANNELS),
  }
}
