/**
 * Requests of content/moment-frames.js: the pictures the worker asked its tab
 * for (src/background/momentPictures.ts), and Twitch's pictures of a VOD
 * (`vod`, src/shared/vodPictures.ts).
 */

/** Largest JPEG accepted; the frames script sends 320 px wide frames of ~20 KB. */
export const MAX_PICTURE_BYTES = 120_000

export type MomentPictureRequest =
  | { type: 'MOMENT_PICTURE'; action: 'wants' }
  | { type: 'MOMENT_PICTURE'; action: 'frame'; token: string; image: string; offset: number }
  | { type: 'MOMENT_PICTURE'; action: 'vod'; vodId: string }

export function parseMomentPicture(raw: Record<string, unknown>): MomentPictureRequest | null {
  const keys = Object.keys(raw).sort().join(',')
  if (raw.action === 'wants') return keys === 'action,type' ? { type: 'MOMENT_PICTURE', action: 'wants' } : null
  if (raw.action === 'vod') {
    return keys === 'action,type,vodId' && typeof raw.vodId === 'string' && /^\d{6,20}$/.test(raw.vodId)
      ? { type: 'MOMENT_PICTURE', action: 'vod', vodId: raw.vodId }
      : null
  }
  if (raw.action !== 'frame' || keys !== 'action,image,offset,token,type') return null
  if (typeof raw.token !== 'string' || !/^[0-9a-f-]{36}$/.test(raw.token)) return null
  if (typeof raw.image !== 'string' || raw.image.length > MAX_PICTURE_BYTES * 1.4) return null
  if (typeof raw.offset !== 'number' || !Number.isFinite(raw.offset) || raw.offset < 0) return null
  return { type: 'MOMENT_PICTURE', action: 'frame', token: raw.token, image: raw.image, offset: raw.offset }
}
