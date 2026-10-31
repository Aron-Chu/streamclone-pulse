/**
 * Ask Twitch's box-art CDN for a cover at about 2x the size it is drawn (candidate, 10-30, PIC-2).
 *
 * The games answer carries one size (live-games 2026-10-30: `ttv-boxart/509658-210x280.jpg`). A 36x48 caption
 * cover downscales that fine, but the reel's hero cover (up to 144 CSS px tall) wants more pixels on a 2x screen,
 * and the 15x20 row cover wants far fewer. Twitch's box-art URLs name their size (`{id}-WxH.jpg`,
 * `{id}_IGDB-WxH.jpg`, `{name}-144x192.jpg`), so only those are rewritten: any other URL comes back as it was.
 * The size Twitch actually serves for an arbitrary WxH is not checked here (no live calls); a miss falls back
 * through the caller's onError, which still reports the original URL.
 */

const BOX_ART_SIZED = /^(https:\/\/static-cdn\.jtvnw\.net\/ttv-boxart\/[^?#]+?-)(\d{1,4})x(\d{1,4})(\.(?:jpe?g|png|webp))((?:[?#].*)?)$/i

/** `url` at `width`x`height` when it is a sized Twitch box-art URL; otherwise `url` unchanged. */
export function boxArtAtSize(url: string, width: number, height: number): string {
  const w = Math.round(width)
  const h = Math.round(height)
  if (!(w > 0 && h > 0 && w < 10_000 && h < 10_000)) return url
  const match = BOX_ART_SIZED.exec(url)
  if (!match) return url
  const [, head, , , ext, tail] = match
  return `${head}${w}x${h}${ext}${tail ?? ''}`
}
