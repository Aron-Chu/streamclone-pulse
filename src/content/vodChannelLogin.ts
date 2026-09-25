import { normalizeLogin } from '../shared/login.ts'
import { TWITCH_SYSTEM_ROUTES } from './twitch.ts'

/**
 * High-confidence Twitch page embeds for the VOD owner login.
 * Prefer owner/broadcaster fields over bare "login" keys that appear on every user card.
 */
const VOD_CHANNEL_LOGIN_PATTERNS: RegExp[] = [
  /"owner"\s*:\s*\{[^}]*?"login"\s*:\s*"([a-z0-9_]{3,25})"/i,
  /"broadcaster"\s*:\s*\{[^}]*?"login"\s*:\s*"([a-z0-9_]{3,25})"/i,
  /"channel"\s*:\s*\{[^}]*?"login"\s*:\s*"([a-z0-9_]{3,25})"/i,
  /"channelLogin"\s*:\s*"([a-z0-9_]{3,25})"/i,
  /"broadcasterLogin"\s*:\s*"([a-z0-9_]{3,25})"/i,
]

const CHANNEL_HREF = /(?:https?:\/\/(?:www\.)?twitch\.tv\/|href=["']\/)([a-z0-9_]{3,25})(?:\/?["'#?]|$)/i

const CHANNEL_LINK_SELECTORS = [
  '[data-a-target="video-info-username"]',
  '[data-a-target="player-overlay-channel-link"]',
  'a[data-test-selector="stream-info-card-component__title-link"]',
  '.channel-info-content a[href^="/"]',
  'a[data-a-target="about-panel-channel"]',
]

function acceptLogin(raw: string | null | undefined): string | null {
  const login = normalizeLogin(raw ?? '')
  if (!login) return null
  if (TWITCH_SYSTEM_ROUTES.has(login)) return null
  if (login === 'videos') return null
  return login
}

/** Pure HTML/script scrape for the VOD owner channel login. */
export function scrapeVodChannelLoginFromText(text: string): string | null {
  if (!text) return null
  for (const pattern of VOD_CHANNEL_LOGIN_PATTERNS) {
    const match = text.match(pattern)
    const login = acceptLogin(match?.[1])
    if (login) return login
  }

  // Fall back to the first non-system twitch.tv/{login} href in the document.
  const hrefMatches = text.matchAll(new RegExp(CHANNEL_HREF.source, 'gi'))
  for (const match of hrefMatches) {
    const login = acceptLogin(match[1])
    if (login) return login
  }
  return null
}

/** Prefer explicit channel chrome on the VOD watch page, then page HTML embeds. */
export function scrapeVodChannelLoginFromPage(doc: Document = document): string | null {
  for (const selector of CHANNEL_LINK_SELECTORS) {
    const el = doc.querySelector(selector)
    if (!el) continue
    const href = el.getAttribute('href') ?? ''
    const fromHref = scrapeVodChannelLoginFromText(href)
    if (fromHref) return fromHref
    const textLogin = acceptLogin(el.textContent ?? '')
    if (textLogin) return textLogin
  }

  const ogUrl =
    doc.querySelector('meta[property="og:url"]')?.getAttribute('content')
    ?? doc.querySelector('link[rel="canonical"]')?.getAttribute('href')
    ?? ''
  // og/canonical on /videos/{id} is usually the video URL itself — still try.
  const fromMeta = scrapeVodChannelLoginFromText(ogUrl)
  if (fromMeta && fromMeta !== 'videos') return fromMeta

  const html = doc.documentElement?.innerHTML ?? ''
  const scriptTexts = Array.from(doc.querySelectorAll('script'))
    .map(node => node.textContent ?? '')
    .filter(text => text.length >= 40)
  const fromHtml = scrapeVodChannelLoginFromText(html)
  if (fromHtml) return fromHtml
  for (const scriptText of scriptTexts) {
    const fromScript = scrapeVodChannelLoginFromText(scriptText)
    if (fromScript) return fromScript
  }
  return null
}
