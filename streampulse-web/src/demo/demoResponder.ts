/**
 * Answers the panel's messages the way the extension's background worker does
 * (src/background/service-worker.ts), from the demo tape and nothing else.
 *
 * Every message type the panel can send has an answer here. Features that need
 * the StreamPulse backend or an account (live backfill, sign-in, history sync,
 * Supporter) answer "not available", and the panel shows its own wording for
 * that. Nothing here makes a network request.
 */

/** Minimal shape of the panel's VOD answer (src/types/vodPulseTypes.ts). */
export interface DemoVodPulse {
  mode: 'vod'
  vodId: string | null
  streamId?: string
  channelLogin?: string
  title?: string
  startedAt?: string
  durationSeconds?: number
  games?: Array<{ gameName: string; offsetSeconds: number; durationSeconds: number }>
  timeline?: { points: Array<{ viewers?: number }> }
}

interface DemoBookmark {
  id: string
  login: string
  streamId?: string
  vodId?: string
  offsetSeconds: number
  label: string
  notes: string
  source: 'extension'
  createdAt: string
  updatedAt: string
}

export interface DemoResponderOptions {
  vodPulse: DemoVodPulse
  version: string
  /** Loads a lazy content script (Catch me up) on the page; resolves false when it can't. */
  loadScript?: (name: 'catch-me-up' | 'moment-frames') => Promise<boolean>
  /** "Open all settings": the extension opens its settings page; the demo tells the page. */
  onOpenSettings?: (section?: string) => void
  /** The panel's Discord and feedback buttons: the extension opens the site's page in a tab. */
  onCommunityLink?: (link: 'discord' | 'feedback') => void
  /** Tests: throw on an unknown message instead of logging it once. */
  strict?: boolean
  now?: () => number
}

/**
 * Every message type the panel and its helpers send (src/shared/messages.ts
 * BackgroundRequest). The responder test sends each one, so a type added in a
 * later extension release fails the test until the demo answers it.
 */
export const DEMO_MESSAGE_TYPES = [
  'HEALTH',
  'GET_PULSE_VOD',
  'GET_PULSE',
  'GET_COVERAGE',
  'GET_ALWAYS_TRACKED',
  'GET_CLIP',
  'LIST_PAST_VODS',
  'HINT_VOD',
  'DISCOVER_LIVE_VOD',
  'LOAD_MISSED_MOMENTS',
  'GET_PULSE_BACKFILL_STATUS',
  'TRACK',
  'UNTRACK',
  'SET_AUTO_UPDATE',
  'LIST_WATCHLIST',
  'ADD_WATCHLIST',
  'REMOVE_WATCHLIST',
  'SYNC_WATCHLIST',
  'LIST_BOOKMARKS',
  'SAVE_BOOKMARK',
  'REMOVE_BOOKMARK',
  'DELETE_BOOKMARK',
  'MY_MOMENTS',
  'MOMENT_CAPTURE',
  'MOMENT_PICTURE',
  'MOMENT_MINUTE',
  'HUB_SNAPSHOT',
  'FETCH_EMOTE_IMAGE',
  'GET_UPDATE_CHECK_CAPABILITY',
  'CHECK_FOR_UPDATE',
  'OPEN_SETTINGS_HOST',
  'OPEN_COMMUNITY_LINK',
  'SUPPORTER_APPEARANCE',
  'SUPPORTER_ENTITLEMENT',
  'SUPPORTER_ACCOUNT',
  'SUPPORTER_BILLING',
  'SUPPORTER_RESTORE',
  'SUPPORTER_DEVICES',
  'SUPPORTER_COSMETICS',
  'SUPPORTER_FINISH_INTENT',
  'SUPPORTER_CARD_SCRIPT',
  'MOMENT_FRAMES_SCRIPT',
  'CATCH_ME_UP_SCRIPT',
  'TWITCH_SIGN_IN',
  'GET_DEVICE_AUTH_STATUS',
  'ENROLL_DEVICE',
  'ROTATE_DEVICE',
  'REVOKE_DEVICE',
  'REPORT_EXTENSION_DIAGNOSTIC',
  'EMIT_EXTENSION_ANALYTICS',
  'GET_PULSE_DEBUG_LOG',
  'APPEND_PULSE_DEBUG',
  'CLEAR_PULSE_DEBUG_LOG',
] as const

export type DemoMessageType = (typeof DEMO_MESSAGE_TYPES)[number]

const NOT_IN_DEMO = 'Not available in the demo'

function messageType(message: unknown): string {
  return message && typeof message === 'object' && 'type' in message && typeof message.type === 'string'
    ? message.type
    : ''
}

function field<T = unknown>(message: unknown, key: string): T | undefined {
  return message && typeof message === 'object' ? (message as Record<string, T>)[key] : undefined
}

export function createDemoResponder(options: DemoResponderOptions) {
  const now = options.now ?? Date.now
  const { vodPulse } = options
  const login = vodPulse.channelLogin ?? ''
  const vodId = vodPulse.vodId ?? ''
  const streamId = vodPulse.streamId ?? ''
  const bookmarks: DemoBookmark[] = []
  const unknownLogged = new Set<string>()
  let nextBookmark = 1

  const viewers = (vodPulse.timeline?.points ?? []).map(point => point.viewers ?? 0).filter(v => v > 0)
  const pastVod = {
    streamId,
    videoId: vodId,
    title: vodPulse.title ?? '',
    category: vodPulse.games?.[vodPulse.games.length - 1]?.gameName,
    startedAt: vodPulse.startedAt,
    durationMinutes: Math.round((vodPulse.durationSeconds ?? 0) / 60),
    avgViewers: viewers.length ? Math.round(viewers.reduce((a, b) => a + b, 0) / viewers.length) : undefined,
    peakViewers: viewers.length ? Math.max(...viewers) : undefined,
    analyticsStatus: 'ready',
  }

  const deviceAuth = { type: 'DEVICE_AUTH', status: { connected: false, state: 'unauthorized' } }

  function answer(message: unknown): unknown {
    const type = messageType(message) as DemoMessageType
    switch (type) {
      case 'HEALTH':
        return {
          type: 'HEALTH',
          ok: true,
          version: options.version,
          hostedMode: true,
          helixEnabled: true,
          identityComplete: true,
          viewerSampling: { enabled: true, streamsWritten: 1, consecutiveFailures: 0 },
          checkedAt: now(),
          cached: false,
        }
      case 'GET_PULSE_VOD':
        return { type: 'VOD_PULSE_UPDATE', vodId: field<string>(message, 'vodId') ?? vodId, vodPulse }
      case 'GET_PULSE':
        return { type: 'PULSE_UPDATE', login: field<string>(message, 'login') ?? login, payload: null, error: NOT_IN_DEMO }
      case 'GET_COVERAGE':
        return { ok: false, error: NOT_IN_DEMO }
      case 'GET_ALWAYS_TRACKED':
        return { type: 'ALWAYS_TRACKED', channels: [] }
      case 'GET_CLIP':
        return { type: 'CLIP', clip: null, clips: [] }
      case 'LIST_PAST_VODS':
        return { type: 'PAST_VODS', items: field(message, 'login') === login ? [pastVod] : [] }
      case 'HINT_VOD':
      case 'TRACK':
      case 'UNTRACK':
      case 'SET_AUTO_UPDATE':
      case 'REPORT_EXTENSION_DIAGNOSTIC':
      case 'EMIT_EXTENSION_ANALYTICS':
      case 'APPEND_PULSE_DEBUG':
      case 'CLEAR_PULSE_DEBUG_LOG':
        return { ok: true }
      case 'DISCOVER_LIVE_VOD':
        return { type: 'DISCOVER_LIVE_VOD', result: { vodId: null, streamId: null }, error: NOT_IN_DEMO }
      case 'LOAD_MISSED_MOMENTS':
        return { type: 'PULSE_BACKFILL', job: null, error: NOT_IN_DEMO }
      case 'GET_PULSE_BACKFILL_STATUS':
        return { type: 'PULSE_BACKFILL_STATUS', job: null, error: NOT_IN_DEMO }
      case 'LIST_WATCHLIST':
      case 'ADD_WATCHLIST':
      case 'REMOVE_WATCHLIST':
        return { type: 'WATCHLIST', channels: [] }
      case 'SYNC_WATCHLIST':
        return { type: 'SYNC_WATCHLIST', channels: [] }
      case 'LIST_BOOKMARKS': {
        const items = bookmarks
          .filter(b => (!field(message, 'login') || b.login === field(message, 'login'))
            && (!field(message, 'vodId') || b.vodId === field(message, 'vodId'))
            && (!field(message, 'streamId') || b.streamId === field(message, 'streamId')))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        return { type: 'BOOKMARKS', items, device: true }
      }
      case 'SAVE_BOOKMARK': {
        // Kept in this page only, as a device save is kept in the browser.
        const input = field<Record<string, unknown>>(message, 'bookmark') ?? {}
        const at = new Date(now()).toISOString()
        const offsetSeconds = Math.floor(Number(input.offsetSeconds) || 0)
        const existing = bookmarks.find(b => b.offsetSeconds === offsetSeconds && b.vodId === (input.vodId ?? vodId))
        const item: DemoBookmark = existing ?? {
          id: `local:demo-${nextBookmark++}`,
          login: String(input.login ?? login),
          ...(input.streamId ? { streamId: String(input.streamId) } : {}),
          vodId: String(input.vodId ?? vodId),
          offsetSeconds,
          label: String(input.label ?? '').slice(0, 160),
          notes: '',
          source: 'extension',
          createdAt: at,
          updatedAt: at,
        }
        if (!existing) bookmarks.push(item)
        return { type: 'BOOKMARK', item, device: true }
      }
      case 'REMOVE_BOOKMARK': {
        const id = field<string>(message, 'id')
        const at = bookmarks.findIndex(b => b.id === id)
        if (at >= 0) bookmarks.splice(at, 1)
        return { type: 'REMOVE_BOOKMARK', ok: at >= 0, device: true }
      }
      case 'DELETE_BOOKMARK':
        return { type: 'DELETE_BOOKMARK', ok: false, error: NOT_IN_DEMO }
      case 'MY_MOMENTS':
        return { type: 'MY_MOMENTS', error: NOT_IN_DEMO }
      case 'MOMENT_CAPTURE':
        // No frame capture and no history on the site.
        return { enabled: false }
      case 'MOMENT_PICTURE':
        return { type: 'MOMENT_PICTURE', ok: false, vod: null, frame: null }
      case 'MOMENT_MINUTE':
        return { type: 'MOMENT_MINUTE', context: null, error: NOT_IN_DEMO }
      case 'HUB_SNAPSHOT':
        return { type: 'HUB_SNAPSHOT', snapshot: null, error: NOT_IN_DEMO }
      case 'FETCH_EMOTE_IMAGE':
        return { type: 'EMOTE_IMAGE', error: NOT_IN_DEMO }
      case 'GET_UPDATE_CHECK_CAPABILITY':
        return { type: 'UPDATE_CHECK_CAPABILITY', supported: false, managedBy: 'browser' }
      case 'CHECK_FOR_UPDATE':
        return { type: 'UPDATE_CHECK', status: 'unsupported' }
      case 'OPEN_SETTINGS_HOST':
        options.onOpenSettings?.(field<string>(message, 'section'))
        return { type: 'OPEN_SETTINGS_HOST', ok: true }
      case 'OPEN_COMMUNITY_LINK': {
        const link = field<string>(message, 'link')
        const known = link === 'discord' || link === 'feedback'
        if (known) options.onCommunityLink?.(link)
        return { type: 'OPEN_COMMUNITY_LINK', ok: known && Boolean(options.onCommunityLink) }
      }
      case 'SUPPORTER_APPEARANCE':
        // The plain look: no finish, no paint, nothing from an account.
        return { type: 'SUPPORTER_APPEARANCE', finish: null, validForMs: 60_000 }
      case 'SUPPORTER_ENTITLEMENT':
      case 'SUPPORTER_ACCOUNT':
      case 'SUPPORTER_BILLING':
      case 'SUPPORTER_RESTORE':
      case 'SUPPORTER_DEVICES':
      case 'TWITCH_SIGN_IN':
        return { ok: false, error: NOT_IN_DEMO }
      case 'SUPPORTER_COSMETICS':
        return { type: 'SUPPORTER_COSMETICS', ok: false }
      case 'SUPPORTER_FINISH_INTENT':
        return { type: 'SUPPORTER_FINISH_INTENT', finish: null }
      case 'SUPPORTER_CARD_SCRIPT':
        // No Supporter pieces load on the site.
        return { type: 'SUPPORTER_CARD_SCRIPT', ok: false }
      case 'MOMENT_FRAMES_SCRIPT':
        // On Twitch, moment pictures come from the player; the demo shows drawn samples (demoMomentPictures.ts).
        return (options.loadScript?.('moment-frames') ?? Promise.resolve(false))
          .catch(() => false)
          .then(ok => ({ type: 'MOMENT_FRAMES_SCRIPT', ok }))
      case 'CATCH_ME_UP_SCRIPT':
        return (options.loadScript?.('catch-me-up') ?? Promise.resolve(false))
          .catch(() => false)
          .then(ok => ({ type: 'CATCH_ME_UP_SCRIPT', ok }))
      case 'GET_DEVICE_AUTH_STATUS':
      case 'ENROLL_DEVICE':
      case 'ROTATE_DEVICE':
      case 'REVOKE_DEVICE':
        return deviceAuth
      case 'GET_PULSE_DEBUG_LOG':
        return { type: 'PULSE_DEBUG_LOG', entries: [] }
      default: {
        const name = type || '(no type)'
        if (options.strict) throw new Error(`demo responder has no answer for ${name}`)
        if (!unknownLogged.has(name)) {
          unknownLogged.add(name)
          console.warn(`[demo] no answer for ${name}`)
        }
        return { error: 'unknown_message' }
      }
    }
  }

  return {
    answer,
    /** Saves made in this page (the demo keeps them only while it is open). */
    bookmarks: () => [...bookmarks],
  }
}
