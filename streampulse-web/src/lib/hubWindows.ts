/**
 * Hub activity windows (plan H1 / AD-14). The hub shows three window buttons;
 * the long windows stay reachable by URL only and show as a fourth pressed
 * button while active.
 *
 * Tiny and dependency-free on purpose: `hubEarlyFetch.ts` imports it from the
 * entry chunk, before React mounts.
 */

/** Every window the backend accepts on `/v1/public/hub?activityWindow=`. */
export type HubApiWindow = 'all' | '1y' | '6m' | '3m' | '1m' | '7d' | '24h' | '30m' | 'recent'

/** The windows `/analytics` understands in its URL. */
export type HubUrlWindow = '30m' | '24h' | '7d' | '1m' | '3m' | '1y'

export interface HubWindowOption {
  key: HubUrlWindow
  label: string
  minutes: number
}

const DAY_MINUTES = 24 * 60

export const HUB_DEFAULT_WINDOW: HubUrlWindow = '24h'

/** The three window buttons (30m / 24h / 7d). */
export const HUB_VISIBLE_WINDOWS: readonly HubWindowOption[] = Object.freeze([
  Object.freeze({ key: '30m', label: '30m', minutes: 30 }),
  Object.freeze({ key: '24h', label: '24h', minutes: DAY_MINUTES }),
  Object.freeze({ key: '7d', label: '7d', minutes: 7 * DAY_MINUTES }),
] as const satisfies readonly HubWindowOption[])

/** Long windows, reachable by URL only (labels as on prod today). */
export const HUB_URL_ONLY_WINDOWS: readonly HubWindowOption[] = Object.freeze([
  Object.freeze({ key: '1m', label: '1mo', minutes: 30 * DAY_MINUTES }),
  Object.freeze({ key: '3m', label: '3mo', minutes: 3 * 30 * DAY_MINUTES }),
  Object.freeze({ key: '1y', label: '1 year', minutes: 365 * DAY_MINUTES }),
] as const satisfies readonly HubWindowOption[])

const ALL_URL_WINDOWS: readonly HubWindowOption[] = [...HUB_VISIBLE_WINDOWS, ...HUB_URL_ONLY_WINDOWS]
const URL_WINDOW_KEYS: ReadonlySet<string> = new Set(ALL_URL_WINDOWS.map((option) => option.key))
const URL_ONLY_KEYS: ReadonlySet<string> = new Set(HUB_URL_ONLY_WINDOWS.map((option) => option.key))

export function isHubUrlWindow(value: unknown): value is HubUrlWindow {
  return typeof value === 'string' && URL_WINDOW_KEYS.has(value)
}

/** True for 1mo / 3mo / 1y: the card shows bucket totals only and the list asks to zoom in. */
export function isHubLongWindow(value: unknown): boolean {
  return typeof value === 'string' && URL_ONLY_KEYS.has(value)
}

export function hubWindowOption(key: HubUrlWindow): HubWindowOption {
  return ALL_URL_WINDOWS.find((option) => option.key === key) ?? HUB_VISIBLE_WINDOWS[1]
}

export function hubWindowMinutes(key: HubUrlWindow): number {
  return hubWindowOption(key).minutes
}

/**
 * Same rule as `AnalyticsLandingPage.tsx` (`window` first, then
 * `activityWindow`; anything unknown is 24h). A Set lookup instead of the
 * page's `in` check, so `?window=toString` is not accepted.
 */
export function parseHubWindowParam(search: string | URLSearchParams | null | undefined): HubUrlWindow {
  let params: URLSearchParams
  try {
    params = search instanceof URLSearchParams ? search : new URLSearchParams(search ?? '')
  } catch {
    return HUB_DEFAULT_WINDOW
  }
  const raw = params.get('window') || params.get('activityWindow')
  return isHubUrlWindow(raw) ? raw : HUB_DEFAULT_WINDOW
}
