import type { PageVodScrapeResult } from '../shared/vodIdPatterns.ts'

/** Self-contained for chrome.scripting MAIN world injection — no imports inside. */
export function scrapePageVodState(): PageVodScrapeResult {
  const vodPatterns = [
    /"archiveVideoID"\s*:\s*"(\d{6,20})"/i,
    /"archiveVideoId"\s*:\s*"(\d{6,20})"/i,
    /"videoArchiveId"\s*:\s*"(\d{6,20})"/i,
    /"slayerWholeFeedUiChannelArchiveVideoID"\s*:\s*"(\d{6,20})"/i,
    /"channelArchiveVideoID"\s*:\s*"(\d{6,20})"/i,
  ]
  const streamPatterns = [
    /"broadcastId"\s*:\s*"(\d{6,20})"/,
    /"streamId"\s*:\s*"(\d{6,20})"/,
  ]
  const vodIdOk = (id: string) => /^\d{6,20}$/.test(id)

  function scanVod(text: string): string | null {
    for (const pattern of vodPatterns) {
      const match = text.match(pattern)
      if (match?.[1] && vodIdOk(match[1])) return match[1]
    }
    return null
  }

  function scanStream(text: string): string | null {
    for (const pattern of streamPatterns) {
      const match = text.match(pattern)
      if (match?.[1] && vodIdOk(match[1])) return match[1]
    }
    return null
  }

  const html = document.documentElement?.innerHTML ?? ''
  let vodId = scanVod(html)
  let source: PageVodScrapeResult['source'] = vodId ? 'page_html' : null
  let scannedScripts = 0
  let streamId = scanStream(html)

  if (!vodId) {
    for (const script of document.querySelectorAll('script')) {
      const text = script.textContent
      if (!text || text.length < 40) continue
      scannedScripts += 1
      vodId = scanVod(text)
      if (vodId) {
        source = 'page_script'
        break
      }
    }
  }

  if (!streamId) {
    for (const script of document.querySelectorAll('script')) {
      const text = script.textContent
      if (!text) continue
      streamId = scanStream(text)
      if (streamId) break
    }
  }

  return { vodId, streamId, source, scannedScripts }
}

interface GqlPageResponse {
  live: { status: number; json: unknown; error?: string }
  list: { status: number; json: unknown; error?: string }
}

/** Self-contained for MAIN world injection — network GQL (may be blocked by ad blockers). */
export async function gqlDiscoverVodInPage(login: string): Promise<GqlPageResponse> {
  const clientId = 'kimne78kx3ncx6brgo4genct28h5qlw'
  const channel = login.trim().toLowerCase()

  async function post(query: string): Promise<{ status: number; json: unknown; error?: string }> {
    try {
      const res = await fetch('https://gql.twitch.tv/gql', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Client-ID': clientId,
          'Content-Type': 'text/plain;charset=UTF-8',
        },
        body: JSON.stringify({ query, variables: { login: channel } }),
      })
      const text = await res.text()
      let json: unknown = null
      try {
        json = JSON.parse(text)
      } catch {
        json = { raw: text.slice(0, 300) }
      }
      if (!res.ok) {
        return { status: res.status, json, error: text.slice(0, 200) }
      }
      return { status: res.status, json }
    } catch (err) {
      return {
        status: 0,
        json: null,
        error: err instanceof Error ? err.message : 'fetch_failed',
      }
    }
  }

  const liveQuery = `query PulseLiveArchiveVod($login: String!) {
    user(login: $login) {
      stream {
        id
        archiveVideo { id }
      }
    }
  }`
  const listQuery = `query PulseArchiveVod($login: String!) {
    user(login: $login) {
      videos(first: 1, type: ARCHIVE, sort: TIME) {
        edges { node { id } }
      }
    }
  }`

  return { live: await post(liveQuery), list: await post(listQuery) }
}
