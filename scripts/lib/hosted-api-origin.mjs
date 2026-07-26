/**
 * Exact-host checks for the hosted StreamPulse API origin.
 * Avoids incomplete substring sanitization (evil.api.streampulse.stream, etc.).
 */

export const HOSTED_API_ORIGIN = 'https://api.streampulse.stream'
export const HOSTED_API_HOSTNAME = 'api.streampulse.stream'

/**
 * @param {string} url
 * @returns {boolean}
 */
export function isHostedApiUrl(url) {
  if (!url || typeof url !== 'string') return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && parsed.hostname === HOSTED_API_HOSTNAME
  } catch {
    return false
  }
}

/**
 * True when packable/bundle text embeds the hosted API origin as a real URL token
 * (not as a substring of another hostname).
 * @param {string} text
 * @returns {boolean}
 */
export function textContainsHostedApiOrigin(text) {
  if (!text) return false
  // Quote/boundary-aware: require the exact origin characters as a URL token.
  return /(?:^|["'`\s(=,:])https:\/\/api\.streampulse\.stream(?=["'`\s/),]|$)/.test(text)
}
