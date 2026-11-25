/**
 * Twitch publishes square profile-image renditions (70/150/300/600 px) under
 * the same path. Copied from the site's streampulse-web/src/lib/twitchProfileImage.ts
 * (this package cannot import it), and also reads the older name that puts a hash
 * before the size (`xqc-profile_image-9298dca608632101-300x300.jpeg`). Callers keep
 * the original URL as a fallback in case a rendition is missing.
 */
const PROFILE_RENDITION = /^(https:\/\/static-cdn\.jtvnw\.net\/[^?#]*-profile_image-(?:[0-9a-f]+-)?)(\d{2,4})x\2(\.(?:png|jpe?g|webp))$/i

export function twitchProfileImageRendition(url: string | null | undefined, size: 70 | 150 | 300): string | undefined {
  if (!url) return undefined
  const match = PROFILE_RENDITION.exec(url)
  if (!match || Number(match[2]) <= size) return url
  return `${match[1]}${size}x${size}${match[3]}`
}
