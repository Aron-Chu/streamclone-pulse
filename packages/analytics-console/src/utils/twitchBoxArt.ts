/**
 * Twitch box art by game name, and a check for Twitch's grey "?" cover
 * (fix, 10-30, GP-8).
 *
 * The box-art CDN answers an unknown game name with its 404_boxart picture:
 * HTTP 200 at the asked size, so an <img> never fires onError and the page
 * shows a generic cover as if it were the game's. Checked 10-30 in a browser:
 * static-cdn.jtvnw.net sends CORS headers, so a picture loaded with
 * crossOrigin="anonymous" can be drawn to a canvas, and an unknown name draws
 * exactly the same pixels as ttv-static/404_boxart-{w}x{h}.jpg. The check
 * compares a small downscaled signature of the two. Anything it cannot read
 * (no canvas, a tainted canvas, a reference that fails to load) keeps the
 * picture: it only ever removes a cover it has proven is the placeholder.
 */

const BOX_ART_ORIGIN = 'https://static-cdn.jtvnw.net'

/** Signature grid (portrait, like the art): 12 x 16 RGB samples. */
const SIGNATURE_WIDTH = 12
const SIGNATURE_HEIGHT = 16
/** Mean per-channel difference still read as the same picture (decoder noise). */
const SIGNATURE_TOLERANCE = 4
/** A reference that has not loaded by then keeps the picture. */
const REFERENCE_TIMEOUT_MS = 5_000

const validSize = (px: number) => Number.isInteger(px) && px > 0 && px <= 4096

/** Name-based ttv-boxart URL ("Just Chatting" at 144 x 192), or null for a blank name. */
export function twitchBoxArtByName(name: string | null | undefined, width: number, height: number): string | null {
  const normalized = name?.trim()
  if (!normalized || !validSize(width) || !validSize(height)) return null
  return `${BOX_ART_ORIGIN}/ttv-boxart/${encodeURIComponent(normalized)}-${width}x${height}.jpg`
}

/**
 * A standard cover built from a category id alone (ttv-boxart/{id}-{w}x{h}.jpg). The backend sends this when its
 * Twitch name lookup finds nothing, and for a newer (IGDB) game Twitch redirects it to the "?" cover.
 */
const ID_BUILT_BOX_ART = /^https:\/\/static-cdn\.jtvnw\.net\/ttv-boxart\/\d{1,20}-\d{1,4}x\d{1,4}\.jpg$/i
export const isIdBuiltBoxArt = (url: string | null | undefined): boolean => typeof url === 'string' && ID_BUILT_BOX_ART.test(url)

/** Twitch's own "?" cover at a size. */
export function twitchPlaceholderBoxArtUrl(width: number, height: number): string {
  return `${BOX_ART_ORIGIN}/ttv-static/404_boxart-${width}x${height}.jpg`
}

/** Same picture: same length and a mean channel difference within tolerance. */
export function boxArtSignaturesMatch(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  tolerance = SIGNATURE_TOLERANCE,
): boolean {
  if (!a.length || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff += Math.abs(a[i]! - b[i]!)
  return diff / a.length <= tolerance
}

export interface TwitchPlaceholderCheckDeps {
  /** Load a picture with crossOrigin="anonymous"; null when it fails. */
  loadReference(url: string): Promise<HTMLImageElement | null>
  /** RGB samples of a loaded picture; null (or a throw) when it cannot be read. */
  signatureOf(img: HTMLImageElement): ArrayLike<number> | null
}

function safeSignature(deps: TwitchPlaceholderCheckDeps, img: HTMLImageElement): ArrayLike<number> | null {
  try {
    return deps.signatureOf(img)
  } catch {
    return null
  }
}

/** The check with its loader and canvas reader passed in (the tests stub both). */
export function createTwitchPlaceholderCheck(deps: TwitchPlaceholderCheckDeps): (img: HTMLImageElement) => Promise<boolean> {
  // One reference per size; a failed one is dropped so the next check tries again.
  const references = new Map<string, Promise<ArrayLike<number> | null>>()
  const referenceFor = (width: number, height: number) => {
    const url = twitchPlaceholderBoxArtUrl(width, height)
    let pending = references.get(url)
    if (!pending) {
      pending = deps.loadReference(url)
        .then(img => (img ? safeSignature(deps, img) : null))
        .catch(() => null)
        .then(signature => {
          if (!signature) references.delete(url)
          return signature
        })
      references.set(url, pending)
    }
    return pending
  }
  return async img => {
    const width = img.naturalWidth
    const height = img.naturalHeight
    if (!img.complete || !validSize(width) || !validSize(height)) return false
    const own = safeSignature(deps, img)
    if (!own) return false
    const reference = await referenceFor(width, height)
    return reference ? boxArtSignaturesMatch(own, reference) : false
  }
}

function loadCorsImage(url: string): Promise<HTMLImageElement | null> {
  if (typeof Image === 'undefined') return Promise.resolve(null)
  return new Promise(resolve => {
    const img = new Image()
    const timer = setTimeout(() => done(null), REFERENCE_TIMEOUT_MS)
    function done(result: HTMLImageElement | null) {
      clearTimeout(timer)
      img.onload = null
      img.onerror = null
      resolve(result)
    }
    img.crossOrigin = 'anonymous'
    img.referrerPolicy = 'no-referrer'
    img.decoding = 'async'
    img.onload = () => done(img)
    img.onerror = () => done(null)
    img.src = url
  })
}

function canvasSignature(img: HTMLImageElement): Uint8ClampedArray | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = SIGNATURE_WIDTH
  canvas.height = SIGNATURE_HEIGHT
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null
  context.drawImage(img, 0, 0, SIGNATURE_WIDTH, SIGNATURE_HEIGHT)
  const rgba = context.getImageData(0, 0, SIGNATURE_WIDTH, SIGNATURE_HEIGHT).data
  const rgb = new Uint8ClampedArray(SIGNATURE_WIDTH * SIGNATURE_HEIGHT * 3)
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    rgb[j] = rgba[i]!
    rgb[j + 1] = rgba[i + 1]!
    rgb[j + 2] = rgba[i + 2]!
  }
  return rgb
}

/**
 * True only when a loaded box-art picture (crossOrigin="anonymous") draws the
 * same pixels as Twitch's 404_boxart at its size; false keeps the picture.
 */
export const isTwitchPlaceholderBoxArt = createTwitchPlaceholderCheck({
  loadReference: loadCorsImage,
  signatureOf: canvasSignature,
})
