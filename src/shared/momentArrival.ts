/**
 * Why a VOD tab was opened: a one-time note left where a Pulse Watch link is
 * clicked (My Moments, the popup, the panel's new-tab jump), so the panel in
 * that tab locks the moment's minute with its card open. The panel on that VOD
 * reads it once; it expires on its own after two minutes.
 */
export const MOMENT_ARRIVAL_STORAGE_KEY = 'sp.momentArrival.v1' // gitleaks:allow (storage key name)
export const MOMENT_ARRIVAL_TTL_MS = 2 * 60 * 1000

export type MomentArrivalSource = 'library' | 'popup' | 'panel' | 'link'

export interface MomentArrival {
  vodId: string
  /** The moment's second: on the stream's clock (what the chart counts) from Pulse, on the VOD's from a bare link. */
  offsetSeconds: number
  clock: 'stream' | 'vod'
  source: MomentArrivalSource
  login?: string
  streamId?: string
  title?: string
}

interface StoredArrival extends MomentArrival {
  savedAtMs: number
}

const VOD_ID = /^\d{1,20}$/

/** Leaves the note just before the Watch link opens Twitch. */
export async function rememberMomentArrival(input: {
  vodId: string | null | undefined
  offsetSeconds: number | null | undefined
  source: Exclude<MomentArrivalSource, 'link'>
  login?: string
  streamId?: string
  title?: string
}): Promise<void> {
  const vodId = input.vodId?.trim() ?? ''
  const offset = input.offsetSeconds
  if (!VOD_ID.test(vodId) || typeof offset !== 'number' || !Number.isFinite(offset) || offset < 0) return
  const record: StoredArrival = {
    vodId,
    offsetSeconds: Math.floor(offset),
    clock: 'stream',
    source: input.source,
    ...(input.login ? { login: input.login.toLowerCase() } : {}),
    ...(input.streamId ? { streamId: input.streamId } : {}),
    ...(input.title ? { title: input.title.slice(0, 120) } : {}),
    savedAtMs: Date.now(),
  }
  try {
    await globalThis.chrome?.storage?.local?.set({ [MOMENT_ARRIVAL_STORAGE_KEY]: record })
  } catch {
    // The panel then falls back to Twitch's own ?t=.
  }
}

/** Twitch's `t`: 1h4m39s, 3879s or 3879. */
export function parseTwitchTime(value: string): number | null {
  const match = /^(?:(\d{1,3})h)?(?:(\d{1,4})m)?(?:(\d{1,6})s?)?$/i.exec(value.trim())
  if (!match || !value.trim()) return null
  const [, h = '0', m = '0', s = '0'] = match
  const seconds = Number(h) * 3600 + Number(m) * 60 + Number(s)
  return Number.isFinite(seconds) ? seconds : null
}

/** A timestamped link to this VOD, as the website and shared links open it. */
export function arrivalFromLink(href: string, vodId: string): MomentArrival | null {
  let url: URL
  try { url = new URL(href) } catch { return null }
  if (!/^(www\.)?twitch\.tv$/i.test(url.hostname)) return null
  if (url.pathname.replace(/\/+$/, '') !== `/videos/${vodId}`) return null
  const t = url.searchParams.get('t')
  const seconds = t ? parseTwitchTime(t) : null
  if (seconds == null || seconds <= 0) return null
  return { vodId, offsetSeconds: seconds, clock: 'vod', source: 'link' }
}

function validStored(value: unknown): value is StoredArrival {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<StoredArrival>
  return typeof record.vodId === 'string' && VOD_ID.test(record.vodId)
    && typeof record.offsetSeconds === 'number' && Number.isFinite(record.offsetSeconds) && record.offsetSeconds >= 0
    && record.clock === 'stream' && (record.source === 'library' || record.source === 'popup' || record.source === 'panel')
    && typeof record.savedAtMs === 'number'
}

/**
 * The page's first address. Only a VOD opened straight from a link counts, not
 * one Twitch navigated to later inside the tab.
 */
let firstHref: string | null = typeof location === 'undefined' ? null : location.href

/** Test hook: the address the next page load starts on. */
export function resetMomentArrivalPage(href: string | null): void {
  firstHref = href
}

/**
 * Why this VOD was opened, once per page: the note a Pulse link left, else a
 * timestamped link this tab opened on.
 */
export async function takeMomentArrival(vodId: string, nowMs = Date.now()): Promise<MomentArrival | null> {
  const href = firstHref
  firstHref = null
  const local = globalThis.chrome?.storage?.local
  try {
    const stored = (await local?.get(MOMENT_ARRIVAL_STORAGE_KEY))?.[MOMENT_ARRIVAL_STORAGE_KEY]
    if (validStored(stored) && stored.vodId === vodId) {
      const age = nowMs - stored.savedAtMs
      await local?.remove(MOMENT_ARRIVAL_STORAGE_KEY)
      if (age >= 0 && age <= MOMENT_ARRIVAL_TTL_MS) {
        const { savedAtMs: _savedAtMs, ...arrival } = stored
        return arrival
      }
    }
  } catch {
    // Storage is unavailable: the link alone still says where to land.
  }
  return href ? arrivalFromLink(href, vodId) : null
}
