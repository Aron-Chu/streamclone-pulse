/**
 * Twitch's own pictures of a VOD: its cover, and the scrub sheets its player
 * shows while seeking (one small tile every `interval` seconds). The worker
 * reads them from Twitch's GQL in the Twitch tab
 * (src/background/twitchPageInject.ts) for the frames script, which draws a
 * moment's tile when this tab kept no frame of it. They load from Twitch's
 * image servers; nothing is stored or sent to Pulse.
 */
export interface VodPictures {
  title?: string
  /** 640×360 JPEG. */
  cover?: string
  /** Sheets of `cols` × `rows` tiles, in order from the VOD's start. */
  sheets: string[]
  cols: number
  rows: number
  /** Tiles in all, one every `interval` seconds. */
  count: number
  interval: number
  /** Twitch is still recording the VOD: it has no scrub sheets until the stream ends. */
  recording?: true
}

/** Twitch's image and storyboard hosts. */
const TWITCH_HOST = /(^|\.)(jtvnw\.net|twitch\.tv|cloudfront\.net)$/

function twitchUrl(value: unknown, base?: string): string | null {
  if (typeof value !== 'string' || !value) return null
  try {
    const url = new URL(value, base)
    return url.protocol === 'https:' && TWITCH_HOST.test(url.hostname) ? url.href : null
  } catch {
    return null
  }
}

const whole = (value: unknown): value is number => Number.isInteger(value) && (value as number) > 0

interface Sheets {
  quality?: unknown
  images?: unknown
  cols?: unknown
  rows?: unknown
  count?: unknown
  interval?: unknown
}

/**
 * The worker's check of what the page read: GQL's `video` and the storyboard
 * index its `seekPreviewsURL` names. The larger sheets win; a VOD Twitch has
 * no cover for yet (its "404_processing" stand-in) has none, and one it is
 * still recording has no sheets either (Twitch refuses its index until the
 * stream ends) but says so. Anything off is left out, and null means there is
 * nothing to draw or say.
 */
export function parseVodPictures(video: unknown, index: unknown): VodPictures | null {
  if (!video || typeof video !== 'object') return null
  const { title, previewThumbnailURL, seekPreviewsURL, status } = video as Record<string, unknown>
  const base = twitchUrl(seekPreviewsURL)
  const all = Array.isArray(index) ? (index as Sheets[]).filter(item => item && typeof item === 'object') : []
  const set = all.find(item => item.quality === 'high') ?? all[0]
  const sheets = base && set && Array.isArray(set.images) ? set.images.map(image => twitchUrl(image, base)) : []
  const tiles = set && whole(set.cols) && whole(set.rows) && whole(set.count) && Number(set.interval) > 0 && sheets.length > 0 && sheets.every(Boolean)
  const cover = twitchUrl(previewThumbnailURL)
  const pictures: VodPictures = {
    sheets: tiles ? (sheets as string[]) : [],
    cols: tiles ? (set.cols as number) : 0,
    rows: tiles ? (set.rows as number) : 0,
    count: tiles ? (set.count as number) : 0,
    interval: tiles ? Number(set.interval) : 0,
  }
  if (cover && !cover.includes('/_404/')) pictures.cover = cover
  if (typeof title === 'string' && title.trim()) pictures.title = title.trim().slice(0, 200)
  if (status === 'RECORDING') pictures.recording = true
  return pictures.cover || pictures.sheets.length > 0 || pictures.recording ? pictures : null
}

/** The tile nearest VOD second `seconds`: its sheet and its column and row there; null outside the VOD. */
export function vodTile(pictures: VodPictures, seconds: number): { sheet: string; col: number; row: number } | null {
  const tile = Math.round(seconds / pictures.interval)
  const perSheet = pictures.cols * pictures.rows
  const sheet = pictures.sheets[Math.floor(tile / perSheet)]
  if (!(seconds >= 0) || !(tile < pictures.count) || !sheet) return null
  const cell = tile % perSheet
  return { sheet, col: cell % pictures.cols, row: Math.floor(cell / pictures.cols) }
}
