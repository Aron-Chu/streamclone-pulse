import { scrapeStreamIdFromText, scrapeVodFromPageTexts, scrapeVodIdFromText } from '../shared/vodIdPatterns.ts'

export type { GqlVodDiscoveryResult } from '../shared/twitchVodGql.ts'
export {
  parseArchiveListVodFromGql,
  parseLiveArchiveVodFromGql,
} from '../shared/twitchVodGql.ts'

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
