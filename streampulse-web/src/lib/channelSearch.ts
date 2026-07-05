import { apiClient } from './apiClient'
import { absolutizeEmoteAssetUrl } from './emoteAssetUrl'
import { isPlausibleTwitchLogin, normalizeTwitchLogin } from './normalizeTwitchLogin'

export interface ChannelSearchSuggestion {
  login: string
  displayName?: string
  category?: string
  viewers?: number
  profileImageUrl?: string
  live?: boolean
}

interface MetadataSearchStream {
  login?: string
  displayName?: string
  profileImageUrl?: string
  /** Legacy metadata channel shape — some proxies still emit `profileImage`. */
  profileImage?: string
  isLive?: boolean
  viewers?: number
  category?: string
}

interface MetadataSearchResponse {
  streams?: MetadataSearchStream[]
}

interface MetadataChannelResponse {
  login?: string
  displayName?: string
  profileImage?: string
  isLive?: boolean
  viewers?: number
  category?: string
}

function resolveProfileImageUrl(
  profileImageUrl?: string,
  profileImage?: string,
): string | undefined {
  return absolutizeEmoteAssetUrl(profileImageUrl ?? profileImage)
}

function mapSearchStream(stream: MetadataSearchStream): ChannelSearchSuggestion | null {
  const login = normalizeTwitchLogin(stream.login ?? '')
  if (!isPlausibleTwitchLogin(login)) return null
  return {
    login,
    displayName: stream.displayName,
    category: stream.category,
    viewers: stream.viewers,
    profileImageUrl: resolveProfileImageUrl(stream.profileImageUrl, stream.profileImage),
    live: Boolean(stream.isLive),
  }
}

/** Twitch channel typeahead via metadata `/v1/search` (live + offline channels). */
export async function searchChannelSuggestions(query: string, limit = 8): Promise<ChannelSearchSuggestion[]> {
  const q = query.trim()
  if (q.length < 2) return []
  const params = new URLSearchParams({ q, limit: String(limit) })
  const { data } = await apiClient<MetadataSearchResponse>(`/v1/search?${params.toString()}`)
  const rows: ChannelSearchSuggestion[] = []
  const seen = new Set<string>()
  for (const stream of data.streams ?? []) {
    const mapped = mapSearchStream(stream)
    if (!mapped || seen.has(mapped.login)) continue
    seen.add(mapped.login)
    rows.push(mapped)
    if (rows.length >= limit) break
  }
  return rows
}

/** Exact login lookup when typeahead has no local matches (works for offline channels). */
export async function lookupChannelSuggestion(rawLogin: string): Promise<ChannelSearchSuggestion | null> {
  const login = normalizeTwitchLogin(rawLogin)
  if (!isPlausibleTwitchLogin(login)) return null
  try {
    const { data } = await apiClient<MetadataChannelResponse>(`/v1/channels/${encodeURIComponent(login)}`)
    if (!data.login) return { login }
    return {
      login: normalizeTwitchLogin(data.login),
      displayName: data.displayName,
      category: data.category,
      viewers: data.viewers,
      profileImageUrl: resolveProfileImageUrl(data.profileImage),
      live: Boolean(data.isLive),
    }
  } catch {
    return null
  }
}

function enrichHubSuggestion<T extends ChannelSearchSuggestion>(
  base: T,
  incoming: ChannelSearchSuggestion,
): T {
  return {
    ...base,
    login: base.login,
    displayName: base.displayName?.trim() || incoming.displayName,
    category: base.category || incoming.category,
    viewers: base.viewers ?? incoming.viewers,
    profileImageUrl: base.profileImageUrl || incoming.profileImageUrl,
    live: Boolean(base.live || incoming.live),
  }
}

/** Merge local hub rows with remote metadata search, enriching duplicates instead of dropping remote fields. */
export function mergeHubSuggestions<T extends ChannelSearchSuggestion>(
  local: T[],
  remote: ChannelSearchSuggestion[],
  max: number,
): T[] {
  const byLogin = new Map<string, T>()
  for (const row of [...local, ...remote] as T[]) {
    const login = row.login.trim().toLowerCase()
    if (!login) continue
    const existing = byLogin.get(login)
    if (existing) {
      byLogin.set(login, enrichHubSuggestion(existing, row))
      continue
    }
    byLogin.set(login, { ...row, login })
  }
  return Array.from(byLogin.values()).slice(0, max)
}
