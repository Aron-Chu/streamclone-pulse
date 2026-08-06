export const VOD_ID = /^\d{6,20}$/

/** Twitch broadcast/stream ids are opaque, nonempty identifiers. */
export const STREAM_ID = /^[A-Za-z0-9_-]{1,64}$/

export function normalizeVodId(value: unknown): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return VOD_ID.test(trimmed) ? trimmed : null
}

export function normalizeStreamId(value: unknown): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return STREAM_ID.test(trimmed) ? trimmed : null
}

/** VOD / archive video id patterns only — never match stream/broadcast ids here. */
export const VOD_JSON_PATTERNS: RegExp[] = [
  /"archiveVideoID"\s*:\s*"(\d{6,20})"/i,
  /"archiveVideoId"\s*:\s*"(\d{6,20})"/i,
  /"videoArchiveId"\s*:\s*"(\d{6,20})"/i,
  /"slayerWholeFeedUiChannelArchiveVideoID"\s*:\s*"(\d{6,20})"/i,
  /"channelArchiveVideoID"\s*:\s*"(\d{6,20})"/i,
]

export const STREAM_JSON_PATTERNS: RegExp[] = [
  /"broadcastId"\s*:\s*"(\d{6,20})"/,
  /"streamId"\s*:\s*"(\d{6,20})"/,
]

export function scrapeVodIdFromText(text: string): string | null {
  for (const pattern of VOD_JSON_PATTERNS) {
    const match = text.match(pattern)
    if (match?.[1] && VOD_ID.test(match[1])) {
      return match[1]
    }
  }
  return null
}

export function scrapeStreamIdFromText(text: string): string | null {
  for (const pattern of STREAM_JSON_PATTERNS) {
    const match = text.match(pattern)
    if (match?.[1] && VOD_ID.test(match[1])) {
      return match[1]
    }
  }
  return null
}

export interface PageVodScrapeResult {
  vodId: string | null
  streamId: string | null
  source: 'page_html' | 'page_script' | null
  scannedScripts: number
}

/** Scan page HTML + inline scripts for archive VOD ids (no network). */
export function scrapeVodFromPageTexts(html: string, scriptTexts: string[]): PageVodScrapeResult {
  let vodId = scrapeVodIdFromText(html)
  let source: PageVodScrapeResult['source'] = vodId ? 'page_html' : null
  let scannedScripts = 0

  if (!vodId) {
    for (const scriptText of scriptTexts) {
      if (!scriptText || scriptText.length < 40) continue
      scannedScripts += 1
      vodId = scrapeVodIdFromText(scriptText)
      if (vodId) {
        source = 'page_script'
        break
      }
    }
  }

  let streamId = scrapeStreamIdFromText(html)
  if (!streamId) {
    for (const scriptText of scriptTexts) {
      streamId = scrapeStreamIdFromText(scriptText)
      if (streamId) break
    }
  }

  return { vodId, streamId, source, scannedScripts }
}
