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

  let vodId: string | null = null
  let source: PageVodScrapeResult['source'] = null
  let scannedScripts = 0
  let streamId: string | null = null

  // Inspect bounded script text only. The complete document can contain chat
  // and unrelated page content that the extension never needs.
  for (const script of document.querySelectorAll('script')) {
    const text = script.textContent
    if (!text || text.length < 40 || text.length > 512_000) continue
    scannedScripts += 1
    vodId ??= scanVod(text)
    streamId ??= scanStream(text)
    if (vodId) source = 'page_script'
    if (vodId && streamId) break
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
  const timeoutMs = 10_000
  const maxBytes = 512 * 1024

  async function readBounded(res: Response, controller: AbortController): Promise<string> {
    const declared = Number(res.headers.get('content-length') ?? '')
    if (Number.isFinite(declared) && declared > maxBytes) {
      controller.abort()
      throw new Error('gql_response_too_large')
    }
    if (!res.body) {
      const text = await res.text()
      if (new TextEncoder().encode(text).byteLength > maxBytes) throw new Error('gql_response_too_large')
      return text
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let total = 0
    let text = ''
    let complete = false
    try {
      while (true) {
        const next = await reader.read()
        if (next.done) break
        total += next.value.byteLength
        if (total > maxBytes) {
          controller.abort()
          throw new Error('gql_response_too_large')
        }
        text += decoder.decode(next.value, { stream: true })
      }
      complete = true
      return text + decoder.decode()
    } finally {
      if (!complete) {
        await reader.cancel().catch(() => {})
      }
      reader.releaseLock()
    }
  }

  async function post(query: string): Promise<{ status: number; json: unknown; error?: string }> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const controller = new AbortController()
      timer = setTimeout(() => controller.abort(), timeoutMs)
      const res = await fetch('https://gql.twitch.tv/gql', {
        method: 'POST',
        credentials: 'omit',
        signal: controller.signal,
        headers: {
          'Client-ID': clientId,
          'Content-Type': 'text/plain;charset=UTF-8',
        },
        body: JSON.stringify({ query, variables: { login: channel } }),
      })
      const text = await readBounded(res, controller)
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
    } finally {
      if (timer) clearTimeout(timer)
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
        edges { node { id broadcastId stream { id } } }
      }
    }
  }`

  return { live: await post(liveQuery), list: await post(listQuery) }
}
