import { scrapeStreamIdFromText, scrapeVodFromPageTexts, scrapeVodIdFromText } from '../shared/vodIdPatterns.ts'

export type LiveVodNavigationSource =
  | 'native_twitch_control'
  | 'page_archive_metadata'
  | 'twitch_page_vod_candidate'

export type LiveJumpDestinationSource =
  | LiveVodNavigationSource
  | 'locally_validated_gql'
  | 'past_streams_current_live'

export interface LiveVodNavigationCandidate {
  vodId: string
  source: LiveVodNavigationSource
  /** Present only when Twitch exposed an explicit current-page archive link. */
  href?: string
}

export interface LiveJumpDestination {
  vodId: string
  source: LiveJumpDestinationSource
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
/** Twitch’s live player often exposes a short “VOD” chip rather than a full sentence. */
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
  // Compact "VOD" / "Video" chips are accepted only with a player/control hint.
  if (COMPACT_PLAYER_ARCHIVE_LABEL.test(label) && PLAYER_CONTROL_HINT.test(target)) return true
  return false
}

/**
 * Resolve only Twitch's explicit current-broadcast archive control.
 *
 * A channel page can contain many unrelated `/videos/{id}` thumbnails. Those
 * are deliberately rejected unless the anchor is labelled as a watch-from-
 * beginning/archive control, a compact player VOD chip, or lives inside the
 * player controls. This source is safe for user navigation only; it must never
 * be persisted as analytics identity or used to authorize backfill.
 */
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

/**
 * Resolve a same-origin Twitch VOD candidate already exposed by the page.
 *
 * Unlike `resolveNativeLiveVodLink`, this can be a regular video card. It is a
 * deliberate last-resort navigation source: clicking it may open Twitch's
 * most relevant archive, but it is never exact enough for persistence or
 * analytics backfill.
 */
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
  // When both sides expose a stream identity, a conflict is conclusive and
  // must fail closed. Twitch sometimes omits the stream ID while still
  // emitting the semantic `archiveVideoId` field; that field is accepted for
  // navigation only on the current channel page.
  if (expected && scraped.streamId && scraped.streamId !== expected) return null
  return { vodId: scraped.vodId, source: 'page_archive_metadata' }
}

/**
 * Pure resolver shared by jump label + click. Prefers an exact locally validated
 * GQL archive, then the Past Streams current-live video id (Helix/history — works
 * even when page GQL is blocked), then a page/DOM navigation candidate.
 * Navigation-only — never treat the result as analytics identity.
 */
export function resolveLiveJumpDestination(input: {
  streamId?: string | null
  locallyValidatedVodId?: string | null
  locallyValidatedStreamId?: string | null
  pastStreamsVodId?: string | null
  pageCandidate?: LiveVodNavigationCandidate | null
}): LiveJumpDestination | null {
  const streamId = input.streamId?.trim() || ''
  const localVod = input.locallyValidatedVodId?.trim() || ''
  const localStream = input.locallyValidatedStreamId?.trim() || ''
  if (localVod && localStream && streamId && localStream === streamId) {
    return { vodId: localVod, source: 'locally_validated_gql' }
  }
  const pastVod = input.pastStreamsVodId?.trim() || ''
  if (pastVod && streamId) {
    return { vodId: pastVod, source: 'past_streams_current_live' }
  }
  const pageVod = input.pageCandidate?.vodId?.trim()
  if (pageVod) {
    return { vodId: pageVod, source: input.pageCandidate!.source }
  }
  return null
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
      // DOM may be mid-replacement; semantic labels still fail closed below.
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

/** Cheap DOM lookup used while rendering the jump control label. */
export function discoverNativeLiveVodLink(): LiveVodNavigationCandidate | null {
  if (typeof document === 'undefined') return null
  return resolveNativeLiveVodLink(nativeVodLinkDescriptors(), window.location.href)
}

/**
 * Navigation-only fallback for the current Twitch broadcast.
 *
 * Prefer the explicit native control, then semantic archive metadata. Never
 * fall back to an arbitrary video-card anchor here.
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
 * Shared live jump destination: local exact GQL match, else current-page
 * Twitch archive control / metadata. Safe for navigation only.
 */
export function discoverLiveJumpDestination(input: {
  streamId?: string | null
  locallyValidatedVodId?: string | null
  locallyValidatedStreamId?: string | null
  pastStreamsVodId?: string | null
}): LiveJumpDestination | null {
  const pageCandidate = typeof document === 'undefined'
    ? null
    : discoverLiveVodNavigationCandidate(input.streamId)
  return resolveLiveJumpDestination({
    streamId: input.streamId,
    locallyValidatedVodId: input.locallyValidatedVodId,
    locallyValidatedStreamId: input.locallyValidatedStreamId,
    pastStreamsVodId: input.pastStreamsVodId,
    pageCandidate,
  })
}

/** Best-effort VOD id from embedded Twitch page HTML (content script only). */
export function discoverLiveVodIdFromDom(): string | null {
  if (typeof document === 'undefined') return null

  const scriptTexts: string[] = []
  for (const script of document.querySelectorAll('script')) {
    const text = script.textContent
    if (text) scriptTexts.push(text)
  }

  const scraped = scrapeVodFromPageTexts(document.documentElement.innerHTML, scriptTexts)
  if (scraped.vodId) return scraped.vodId

  for (const anchor of document.querySelectorAll<HTMLAnchorElement>('a[href*="/videos/"]')) {
    const href = anchor.getAttribute('href') ?? ''
    const match = href.match(/\/videos\/(\d{6,20})/)
    if (match?.[1]) {
      return match[1]
    }
  }

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
