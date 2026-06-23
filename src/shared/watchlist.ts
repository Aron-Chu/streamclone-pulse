import { normalizeLogin } from './login.ts'

const WATCHLIST_KEY = 'watchlist'

export async function getWatchlist(): Promise<string[]> {
  const stored = await chrome.storage.sync.get(WATCHLIST_KEY)
  return normalizeWatchlist(stored[WATCHLIST_KEY])
}

export async function setWatchlist(logins: string[]): Promise<string[]> {
  const next = normalizeWatchlist(logins)
  await chrome.storage.sync.set({ [WATCHLIST_KEY]: next })
  return next
}

export async function addToWatchlist(login: string): Promise<string[]> {
  const normalized = normalizeLogin(login)
  if (!normalized) {
    throw new Error('invalid_channel')
  }
  const current = await getWatchlist()
  if (current.includes(normalized)) {
    return current
  }
  return setWatchlist([...current, normalized])
}

export async function removeFromWatchlist(login: string): Promise<string[]> {
  const normalized = normalizeLogin(login)
  if (!normalized) {
    return getWatchlist()
  }
  const current = await getWatchlist()
  return setWatchlist(current.filter(item => item !== normalized))
}

export function normalizeWatchlist(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of value) {
    const login = normalizeLogin(String(item ?? ''))
    if (!login || seen.has(login)) continue
    seen.add(login)
    out.push(login)
  }
  out.sort()
  return out
}
