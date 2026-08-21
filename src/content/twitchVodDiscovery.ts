import { scrapeStreamIdFromText, scrapeVodFromPageTexts, scrapeVodIdFromText } from '../shared/vodIdPatterns.ts'

export type LiveVodNavigationSource =
  | 'native_twitch_control'
  | 'page_archive_metadata'
  | 'twitch_page_vod_candidate'

export interface LiveVodNavigationCandidate {
  vodId: string
  source: LiveVodNavigationSource
  /** Present only when Twitch exposed an explicit current-page archive link. */
  href?: string
}

export interface NativeVodLinkDescriptor {
  href: string
  text?: string | null
  ariaLabel?: string | null
  title?: string | null
  dataTarget?: string | null
  testSelector?: string | null
  hidden?: boolean
  withinPlayer?: boolean
}

const TWITCH_VOD_PATH = /^\/videos\/(\d{6,20})\/?$/
const NATIVE_ARCHIVE_CONTROL_LABEL = /(?:watch\s+(?:from\s+)?(?:the\s+)?beginning|watch\s+(?:the\s+)?(?:full\s+)?(?:video|vod|broadcast)|(?:open|view|go\s+to)\s+(?:the\s+)?(?:video|vod|archive)|past\s+broadcast|continue\s+watching|rewind\s+(?:the\s+)?(?:stream|broadcast))/i
const NATIVE_ARCHIVE_CONTROL_TARGET = /(?:watch|open|view|rewind|archive|vod).*(?:video|broadcast|stream|beginning)|(?:video|broadcast|stream|beginning).*(?:watch|open|view|rewind|archive|vod)/i
const COMPACT_PLAYER_ARCHIVE_LABEL = /^\s*(vod|video|archive)\s*$/i
const PLAYER_CONTROL_HINT = /player|vod|archive|watch[-_]?from|video[-_]?player|live[-_]?control/i
const PLAYER_ANCESTOR_SELECTOR = [
  '[data-a-target*="player"]',
  '[data-test-selector*="player"]',
  '.video-player',
  '.persistent-player',
  '[class*="video-player"]',
  '[class*="player-controls"]',
  '[class*="player-overlay"]',
].join(', ')

export type { GqlVodDiscoveryResult } from '../shared/twitchVodGql.ts'
export {
  parseArchiveListVodFromGql,
  parseLiveArchiveVodFromGql,
} from '../shared/twitchVodGql.ts'

/** @internal pure test hook */
export function isNativeArchiveControl(
  link: Pick<NativeVodLinkDescriptor, 'withinPlayer' | 'dataTarget' | 'testSelector'>,
  label: string,
  target = [link.dataTarget, link.testSelector].filter(Boolean).join(' ').trim(),
): boolean {
  if (link.withinPlayer) return true
  if (NATIVE_ARCHIVE_CONTROL_LABEL.test(label)) return true
  if (NATIVE_ARCHIVE_CONTROL_TARGET.test(target)) return true
  return COMPACT_PLAYER_ARCHIVE_LABEL.test(label) && PLAYER_CONTROL_HINT.test(target)
}

/** Resolve only Twitch's explicit current-broadcast archive control. */
export function resolveNativeLiveVodLink(
  links: readonly NativeVodLinkDescriptor[],
  baseHref = 'https://www.twitch.tv/',
): LiveVodNavigationCandidate | null {
  for (const link of links) {
    if (link.hidden) continue
    let url: URL
    try {
      url = new URL(link.href, baseHref)
    } catch {
      continue
    }
    if (url.protocol !== 'https:' || !['twitch.tv', 'www.twitch.tv'].includes(url.hostname.toLowerCase())) {
      continue
    }
    const vodMatch = url.pathname.match(TWITCH_VOD_PATH)
    if (!vodMatch?.[1]) continue

    const label = [link.text, link.ariaLabel, link.title].filter(Boolean).join(' ').trim()
    const target = [link.dataTarget, link.testSelector].filter(Boolean).join(' ').trim()
    if (!isNativeArchiveControl(link, label, target)) continue
    return {
      vodId: vodMatch[1],
      source: 'native_twitch_control',
      href: url.href,
    }
  }
  return null
}

/** Resolve a same-origin Twitch VOD link as a navigation-only last resort. */
export function resolveTwitchPageVodLink(
  links: readonly NativeVodLinkDescriptor[],
  baseHref = 'https://www.twitch.tv/',
): LiveVodNavigationCandidate | null {
  for (const link of links) {
    if (link.hidden) continue
    let url: URL
    try {
      url = new URL(link.href, baseHref)
    } catch {
      continue
    }
    if (url.protocol !== 'https:' || !['twitch.tv', 'www.twitch.tv'].includes(url.hostname.toLowerCase())) {
      continue
    }
    const vodMatch = url.pathname.match(TWITCH_VOD_PATH)
    if (!vodMatch?.[1]) continue
    return {
      vodId: vodMatch[1],
      source: 'twitch_page_vod_candidate',
      href: url.href,
    }
  }
  return null
}

/** @internal pure test hook for Twitch's embedded current-archive metadata. */
export function navigationCandidateFromPageTexts(
  html: string,
  scriptTexts: string[],
  expectedStreamId?: string | null,
): LiveVodNavigationCandidate | null {
  const scraped = scrapeVodFromPageTexts(html, scriptTexts)
  if (!scraped.vodId) return null
  const expected = expectedStreamId?.trim()
  // This is navigation-only, but an explicit stream conflict still fails closed.
  if (expected && scraped.streamId && scraped.streamId !== expected) return null
  return { vodId: scraped.vodId, source: 'page_archive_metadata' }
}

function nativeVodLinkDescriptors(): NativeVodLinkDescriptor[] {
  if (typeof document === 'undefined') return []
  return [...document.querySelectorAll<HTMLAnchorElement>('a[href*="/videos/"]')].map(anchor => {
    const hiddenAncestor = anchor.closest<HTMLElement>('[hidden], [aria-hidden="true"]')
    let styleHidden = false
    try {
      const style = window.getComputedStyle(anchor)
      styleHidden = style.display === 'none' || style.visibility === 'hidden'
    } catch {
      // Twitch may replace an anchor while the descriptor is being read.
    }
    return {
      href: anchor.getAttribute('href') ?? '',
      text: anchor.textContent,
      ariaLabel: anchor.getAttribute('aria-label'),
      title: anchor.getAttribute('title'),
      dataTarget: anchor.getAttribute('data-a-target'),
      testSelector: anchor.getAttribute('data-test-selector'),
      hidden: Boolean(hiddenAncestor || anchor.hidden || styleHidden),
      withinPlayer: Boolean(anchor.closest(PLAYER_ANCESTOR_SELECTOR)),
    }
  })
}

/** Cheap structural lookup for Twitch's explicit current-broadcast archive control. */
export function discoverNativeLiveVodLink(): LiveVodNavigationCandidate | null {
  if (typeof document === 'undefined') return null
  return resolveNativeLiveVodLink(nativeVodLinkDescriptors(), window.location.href)
}

/**
 * Navigation-only fallback for the current Twitch broadcast. This result must
 * never be persisted as analytics identity or used to authorize backfill.
 */
export function discoverLiveVodNavigationCandidate(
  expectedStreamId?: string | null,
): LiveVodNavigationCandidate | null {
  if (typeof document === 'undefined') return null
  const linkDescriptors = nativeVodLinkDescriptors()
  const native = resolveNativeLiveVodLink(linkDescriptors, window.location.href)
  if (native) return native

  const scriptTexts: string[] = []
  for (const script of document.querySelectorAll('script')) {
    const text = script.textContent
    if (text) scriptTexts.push(text)
  }
  return navigationCandidateFromPageTexts(
    document.documentElement.innerHTML,
    scriptTexts,
    expectedStreamId,
  ) ?? resolveTwitchPageVodLink(linkDescriptors, window.location.href)
}

/**
 * Best-effort VOD id from embedded Twitch page HTML (content script only).
 * Requires an exact stream-ID match when `expectedStreamId` is provided — never
 * returns an uncorrelated `/videos/<id>` link from the page.
 */
export function discoverLiveVodIdFromDom(expectedStreamId?: string | null): string | null {
  if (typeof document === 'undefined') return null

  const scriptTexts: string[] = []
  for (const script of document.querySelectorAll('script')) {
    const text = script.textContent
    if (text) scriptTexts.push(text)
  }

  const scraped = scrapeVodFromPageTexts(document.documentElement.innerHTML, scriptTexts)
  if (!scraped.vodId) return null

  const expected = expectedStreamId?.trim()
  if (!expected) return null
  if (scraped.streamId && scraped.streamId === expected) {
    return scraped.vodId
  }
  // archiveVideoId without a paired broadcast id is not safe to hint.
  return null
}

/** @internal test hook */
export function scrapeVodIdFromPageHtml(html: string): string | null {
  return scrapeVodIdFromText(html)
}

/** @internal test hook */
export function scrapeStreamIdFromPageHtml(html: string): string | null {
  return scrapeStreamIdFromText(html)
}
