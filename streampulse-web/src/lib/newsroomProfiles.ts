import { apiClient, getBackendUrl } from './momentsApiClient'
import { isPlausibleTwitchLogin, normalizeTwitchLogin } from './normalizeTwitchLogin'

const MAX_PROFILES = 20
const MAX_CACHE = 120
const cache = new Map<string, { url?: string; expires: number }>()
type ProfileRequest = { controller: AbortController; users: number; result: Promise<string | undefined> }
const inFlight = new Map<string, ProfileRequest>()

/** Share cosmetic reads, not caller cancellation. The last subscriber owns abort. */
function requestProfile(origin: string, login: string, signal: AbortSignal): Promise<string | undefined> {
  if (signal.aborted) return Promise.resolve(undefined)
  const key = `${origin}|${login}`
  let request = inFlight.get(key)
  if (!request) {
    // Each surface also keeps its existing three-worker limit.
    if (inFlight.size >= MAX_PROFILES) return Promise.resolve(undefined)
    const controller = new AbortController()
    const entry: ProfileRequest = { controller, users: 0, result: Promise.resolve(undefined) }
    inFlight.set(key, entry)
    entry.result = Promise.resolve().then(async () => {
      let url: string | undefined
      try {
        if (controller.signal.aborted) return undefined
        const { data } = await apiClient<{ login?: unknown; profileImage?: unknown; profileImageUrl?: unknown }>(
          `${origin}/v1/channels/${encodeURIComponent(login)}`,
          { signal: controller.signal, timeoutMs: 3500, maxResponseBytes: 64 * 1024, credentials: 'omit', redirect: 'error' },
        )
        if (typeof data?.login === 'string' && normalizeTwitchLogin(data.login) === login) {
          url = newsroomProfileUrl(data.profileImageUrl) ?? newsroomProfileUrl(data.profileImage)
        }
      } catch {
        // Missing identity remains a cosmetic fallback.
      }
      if (controller.signal.aborted) return undefined
      cache.delete(key)
      cache.set(key, { url, expires: Date.now() + (url ? 10 * 60_000 : 60_000) })
      while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!)
      return url
    }).finally(() => { if (inFlight.get(key) === entry) inFlight.delete(key) })
    request = entry
  }
  const shared = request
  shared.users++
  return new Promise(resolve => {
    let settled = false
    const finish = (url?: string) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', aborted)
      shared.users--
      if (shared.users === 0 && inFlight.get(key) === shared) {
        inFlight.delete(key)
        shared.controller.abort()
      }
      resolve(url)
    }
    const aborted = () => finish()
    signal.addEventListener('abort', aborted, { once: true })
    void shared.result.then(finish)
    if (signal.aborted) aborted()
  })
}

/** Creator identity only: never borrow current viewers/category/live state for a story. */
export function newsroomProfileUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  try {
    const url = new URL(value)
    return url.origin === 'https://static-cdn.jtvnw.net'
      && (url.pathname.startsWith('/jtv_user_pictures/') || url.pathname.startsWith('/user-default-pictures'))
      && !url.username && !url.password
      && !url.search && !url.hash ? url.href : undefined
  } catch { return undefined }
}

export function getCachedNewsroomProfile(login: string): string | undefined {
  const norm = normalizeTwitchLogin(login)
  if (!norm) return undefined
  const key = `${getBackendUrl()}|${norm}`
  const cached = cache.get(key)
  if (cached && cached.expires > Date.now()) return cached.url
  return undefined
}

export async function loadNewsroomProfiles(
  rawLogins: string[], signal: AbortSignal,
  onProfile: (login: string, url: string) => void,
): Promise<void> {
  const logins = [...new Set(rawLogins.map(normalizeTwitchLogin).filter(isPlausibleTwitchLogin))].slice(0, MAX_PROFILES)
  const origin = getBackendUrl()
  let cursor = 0
  const worker = async () => {
    while (!signal.aborted && cursor < logins.length) {
      const login = logins[cursor++]!
      const key = `${origin}|${login}`
      const cached = cache.get(key)
      if (cached && cached.expires > Date.now()) {
        cache.delete(key)
        cache.set(key, cached)
        if (cached.url) onProfile(login, cached.url)
        continue
      }
      const url = await requestProfile(origin, login, signal)
      if (url && !signal.aborted) onProfile(login, url)
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, logins.length) }, worker))
}
