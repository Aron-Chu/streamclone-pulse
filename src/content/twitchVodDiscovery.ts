import { scrapeStreamIdFromText, scrapeVodFromPageTexts, scrapeVodIdFromText } from '../shared/vodIdPatterns.ts'

export type { GqlVodDiscoveryResult } from '../shared/twitchVodGql.ts'
export {
  parseArchiveListVodFromGql,
  parseLiveArchiveVodFromGql,
} from '../shared/twitchVodGql.ts'

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
