import { pulseDebug } from '../shared/pulseDebug.ts'
import {
  mergeGqlDiscoveryResults,
  parseArchiveListVodFromGql,
  parseLiveArchiveVodFromGql,
  type GqlVodDiscoveryResult,
} from '../shared/twitchVodGql.ts'
import type { PageVodScrapeResult } from '../shared/vodIdPatterns.ts'
import { gqlDiscoverVodInPage, scrapePageVodState } from './twitchPageInject.ts'

function resultFromPageResponse<T>(
  part: { status: number; json: unknown; error?: string },
  parser: (body: T) => GqlVodDiscoveryResult,
): GqlVodDiscoveryResult {
  if (part.status !== 200) {
    const detail = part.error?.trim() || `http_${part.status || 'error'}`
    return { vodId: null, streamId: null, source: null, gqlErrors: [detail] }
  }
  return parser(part.json as T)
}

function resultFromPageScrape(page: PageVodScrapeResult): GqlVodDiscoveryResult {
  if (!page.vodId) {
    return {
      vodId: null,
      streamId: page.streamId,
      source: null,
      gqlErrors: [],
    }
  }
  return {
    vodId: page.vodId,
    streamId: page.streamId,
    source: page.source,
    gqlErrors: [],
  }
}

async function runInPageAsync<T>(tabId: number, func: () => Promise<T>): Promise<T | null> {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func,
  })
  return (injection?.result ?? null) as T | null
}

async function runInPage<T>(tabId: number, func: () => T): Promise<T | null> {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func,
  })
  return (injection?.result ?? null) as T | null
}

export async function discoverLiveVodIdFromGqlInTab(tabId: number, login: string): Promise<GqlVodDiscoveryResult> {
  let pageScrape: PageVodScrapeResult | null = null
  try {
    pageScrape = await runInPage(tabId, scrapePageVodState)
  } catch (err) {
    await pulseDebug(
      'vod.discover.page',
      'page scrape injection failed',
      { login, error: err instanceof Error ? err.message : 'inject_failed' },
      'warn',
    )
  }

  if (pageScrape) {
    await pulseDebug(
      'vod.discover.page',
      pageScrape.vodId ? `found archive id in page (${pageScrape.source})` : 'no archive id in page scripts',
      {
        login,
        id: pageScrape.vodId,
        streamId: pageScrape.streamId,
        source: pageScrape.source,
        scannedScripts: pageScrape.scannedScripts,
      },
      pageScrape.vodId ? 'info' : 'warn',
    )
    const scraped = resultFromPageScrape(pageScrape)
    if (scraped.vodId) return scraped
  }

  let gqlPage: Awaited<ReturnType<typeof gqlDiscoverVodInPage>> | null = null
  try {
    gqlPage = await runInPageAsync(tabId, () => gqlDiscoverVodInPage(login))
  } catch (err) {
    return {
      vodId: null,
      streamId: pageScrape?.streamId ?? null,
      source: null,
      gqlErrors: [err instanceof Error ? err.message : 'gql_inject_failed'],
    }
  }

  if (!gqlPage) {
    return {
      vodId: null,
      streamId: pageScrape?.streamId ?? null,
      source: null,
      gqlErrors: ['page_gql_no_result'],
    }
  }

  const live = resultFromPageResponse(gqlPage.live, parseLiveArchiveVodFromGql)
  if (live.vodId) return live
  const listed = resultFromPageResponse(gqlPage.list, parseArchiveListVodFromGql)
  const merged = mergeGqlDiscoveryResults(live, listed)
  return {
    ...merged,
    streamId: merged.streamId ?? pageScrape?.streamId ?? null,
  }
}
