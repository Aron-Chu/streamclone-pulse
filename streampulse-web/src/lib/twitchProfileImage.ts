/**
 * Twitch publishes square profile-image renditions (70/150/300/600 px) under
 * the same path. Rows render avatars at ≤ 32 CSS px, so a 300×300 PNG
 * (often 30–105 KB) costs 5–10× the bytes of the 70×70 rendition. Callers keep
 * the original URL as a fallback in case a rendition is missing.
 */
const PROFILE_RENDITION = /^(https:\/\/static-cdn\.jtvnw\.net\/[^?#]*-profile_image-)(\d{2,4})x\2(\.(?:png|jpe?g|webp))$/i

export function twitchProfileImageRendition(url: string | null | undefined, size: 70 | 150 | 300): string | undefined {
  if (!url) return undefined
  const match = PROFILE_RENDITION.exec(url)
  if (!match || Number(match[2]) <= size) return url
  return `${match[1]}${size}x${size}${match[3]}`
}
