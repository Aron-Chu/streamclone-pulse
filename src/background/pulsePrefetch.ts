import { fetchExtensionCoverage, fetchPulseChannel } from './api.ts'
import type { ExtensionCoverageTierResponse } from '../shared/messages.ts'
import {
  cacheSessionPulseIfEnabled,
  getKeepLocalCache,
  getSessionCoverage,
  getSessionPulse,
  setSessionCoverage,
  type PulseCacheWindow,
} from '../shared/storage.ts'
import { prefetchChannelLoginFromUrl } from '../routing/twitchRoute.ts'

const inFlight = new Map<string, Promise<void>>()

async function loadCoverageTier(login: string): Promise<ExtensionCoverageTierResponse | null> {
  const cached = await getSessionCoverage(login)
  if (cached) return cached.coverageTier
  try {
    const coverageTier = await fetchExtensionCoverage(login)
    if (coverageTier) {
      await setSessionCoverage(login, { coverageTier, fetchedAt: Date.now() })
    }
    return coverageTier
  } catch {
    return null
  }
}

/** Fetch pulse + coverage and write session cache (same path as GET_PULSE peek). */
export async function fetchAndCachePulseChannel(
  login: string,
  window: PulseCacheWindow = 'recent',
): Promise<void> {
  const [payload, coverageTier] = await Promise.all([
    fetchPulseChannel(login, { window }),
    loadCoverageTier(login),
  ])
  void coverageTier
  await cacheSessionPulseIfEnabled(login, {
    payload,
    fetchedAt: Date.now(),
    window,
    streamId: String(payload.streamId ?? '').trim(),
  })
}

function prefetchKey(login: string, window: PulseCacheWindow = 'recent'): string {
  return `${login.toLowerCase()}:${window}`
}

export async function awaitPulsePrefetchInFlight(
  login: string,
  window: PulseCacheWindow = 'recent',
): Promise<void> {
  const pending = inFlight.get(prefetchKey(login, window))
  if (!pending) return
  await pending.catch(() => {})
}

/**
 * Warm session cache for a channel page. Silent on failure; dedupes per login.
 * Skips when session cache is disabled or a fresh session cache entry already exists.
 */
export function schedulePulsePrefetch(login: string, window: PulseCacheWindow = 'recent'): void {
  const key = prefetchKey(login, window)
  if (inFlight.has(key)) return

  const task = (async () => {
    if (!(await getKeepLocalCache())) return
    const cached = await getSessionPulse(login, window)
    if (cached) return
    await fetchAndCachePulseChannel(login, window)
  })()
    .catch(() => {})
    .finally(() => {
      inFlight.delete(key)
    })

  inFlight.set(key, task)
}

/**
 * Warm the cache for a channel page in the tab the user is looking at. A tab
 * that loads or navigates in the background (restored sessions, raids,
 * middle-click) is skipped: its panel fetches when shown, and these anonymous
 * pulse and coverage GETs would otherwise spend API budget on pages nobody
 * opened yet. `tab` absent means unknown, which keeps the old behaviour.
 */
export function handleTwitchTabNavigation(url: string | undefined, tab?: { active?: boolean }): void {
  if (!url || tab?.active === false) return
  const login = prefetchChannelLoginFromUrl(url)
  if (!login) return
  schedulePulsePrefetch(login)
}

/** chrome.tabs.onUpdated: a URL change, or a completed load, of the active tab. */
export function handleTwitchTabUpdate(changeInfo: { url?: string; status?: string }, tab: { url?: string; active?: boolean }): void {
  if (changeInfo.url) handleTwitchTabNavigation(changeInfo.url, tab)
  else if (changeInfo.status === 'complete') handleTwitchTabNavigation(tab.url, tab)
}

export function resetPulsePrefetchInFlightForTests(): void {
  inFlight.clear()
}

export function pulsePrefetchInFlightCount(): number {
  return inFlight.size
}
