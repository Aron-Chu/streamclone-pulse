import { expect, type Page, type Route, type Request } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { seedBetaKey } from './auth'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE_DIR = join(__dirname, '../fixtures/portal-acceptance')

export const PORTAL_LOGIN = 'xqc'
export const PORTAL_STREAM_ID = '320567744986'
export const PORTAL_STARTED_AT = '2026-07-25T21:28:27.000Z'
export const PORTAL_VOD_ID = 'vod_exact_320567744986'
export const NEIGHBOR_VOD_ID = 'vod_neighbor_other_stream'
export const SYSTEM_TIME_ISO = '2026-07-26T12:00:00.000Z'

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

const ALLOWED_NAV_HOSTS = new Set(['127.0.0.1', 'localhost'])
const MOCK_API_HOSTS = new Set(['api.streampulse.stream'])
const MOCK_ASSET_HOSTS = new Set([
  'cdn.7tv.app',
  'cdn.frankerfacez.com',
  'static-cdn.jtvnw.net',
  'fonts.gstatic.com',
  'fonts.googleapis.com',
])

export type JsonBody = Record<string, unknown> | unknown[] | null

export type FulfillSpec =
  | { kind: 'json'; status?: number; body: JsonBody; delayMs?: number }
  | { kind: 'text'; status?: number; body: string; contentType?: string; delayMs?: number }
  | { kind: 'abort'; delayMs?: number }
  | { kind: 'timeout'; delayMs?: number }

export class RequestCounter {
  readonly urls: string[] = []
  private readonly counts = new Map<string, number>()

  record(url: string): void {
    this.urls.push(url)
    const key = normalizeRequestKey(url)
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1)
  }

  count(matcher: string | RegExp): number {
    if (typeof matcher === 'string') {
      return this.counts.get(matcher) ?? this.urls.filter((u) => u.includes(matcher)).length
    }
    return this.urls.filter((u) => matcher.test(u)).length
  }

  matching(matcher: string | RegExp): string[] {
    return this.urls.filter((u) => (typeof matcher === 'string' ? u.includes(matcher) : matcher.test(u)))
  }

  exact(pathAndQuery: string): number {
    return this.counts.get(pathAndQuery) ?? 0
  }
}

export class SequentialJsonHandler {
  private readonly queue: FulfillSpec[] = []
  private fallback: FulfillSpec | null = null

  push(...items: FulfillSpec[]): this {
    this.queue.push(...items)
    return this
  }

  setFallback(spec: FulfillSpec): this {
    this.fallback = spec
    return this
  }

  next(): FulfillSpec {
    if (this.queue.length) return this.queue.shift()!
    if (this.fallback) return this.fallback
    return { kind: 'json', status: 404, body: { error: 'no_sequential_response' } }
  }

  remaining(): number {
    return this.queue.length
  }
}

export interface PortalHarness {
  counter: RequestCounter
  unexpected: string[]
  status: SequentialJsonHandler
  minutesFull: SequentialJsonHandler
  minutesTail: SequentialJsonHandler
  detail: SequentialJsonHandler
  games: SequentialJsonHandler
  summary: SequentialJsonHandler
  emotes30d: SequentialJsonHandler
  recap: SequentialJsonHandler
  streams: SequentialJsonHandler
  setMinutesPayload(body: JsonBody): void
  setGamesPayload(body: JsonBody): void
  setSummaryPayload(body: JsonBody): void
  setEmotes30dPayload(body: JsonBody): void
  advancePoll(ms?: number): Promise<void>
}

function normalizeRequestKey(url: string): string {
  try {
    const u = new URL(url)
    return `${u.pathname}${u.search}`
  } catch {
    return url
  }
}

function loadJsonFixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8')) as T
}

export function measuredObservation(observedAt: string, source = 'fixture') {
  return { state: 'measured', observedAt, coveragePct: 100, source }
}

export function buildMinutes(opts?: {
  count?: number
  startedAt?: string
  openMinuteOffset?: number
  openMinuteChat?: number
  appendOffsets?: number[]
  withEmotes?: boolean
}): {
  streamId: string
  channel: string
  startedAt: string
  coverageStartOffsetSeconds: number
  minutes: Array<Record<string, unknown>>
  updatedAt: number
  signalWatermarks: Record<string, unknown>
} {
  const startedAt = opts?.startedAt ?? PORTAL_STARTED_AT
  const count = opts?.count ?? 24
  const withEmotes = opts?.withEmotes ?? true
  const emoteNames = [
    { name: 'KEKW', provider: 'twitch', id: 'tw1', countBase: 40 },
    { name: 'OMEGALUL', provider: 'twitch', id: 'tw2', countBase: 35 },
    { name: 'Clap', provider: '7tv', id: 'stv1', countBase: 30 },
    { name: 'Clap', provider: 'bttv', id: 'bt1', countBase: 28 },
    { name: 'NODDERS', provider: '7tv', id: 'stv2', countBase: 22 },
    { name: 'Sadge', provider: '7tv', id: 'stv3', countBase: 18 },
    { name: 'Pog', provider: 'ffz', id: 'ffz1', countBase: 12 },
    { name: 'RareGhost', provider: '7tv', id: 'stv4', countBase: 2 },
  ]

  const minutes: Array<Record<string, unknown>> = []
  for (let i = 0; i < count; i++) {
    const offsetSeconds = i * 60
    const observedAt = new Date(Date.parse(startedAt) + offsetSeconds * 1000).toISOString()
    const topEmotes = withEmotes
      ? emoteNames.map((e, idx) => ({
          name: e.name,
          provider: e.provider,
          imageUrl:
            e.provider === '7tv'
              ? `https://cdn.7tv.app/emote/${e.id}/1x.webp`
              : e.provider === 'bttv'
                ? `https://cdn.frankerfacez.com/emote/${e.id}/1`
                : `https://static-cdn.jtvnw.net/emoticons/v2/${e.id}/default/dark/1.0`,
          count: Math.max(1, e.countBase - idx + (i % 3)),
        }))
      : []
    minutes.push({
      offsetSeconds,
      viewerAvg: 10_000 + i * 12,
      viewerMax: 10_050 + i * 12,
      viewerLatest: 10_020 + i * 12,
      viewerSamples: 4,
      chatCount: opts?.openMinuteOffset === offsetSeconds ? (opts.openMinuteChat ?? 90) : 40 + i * 3,
      totalEmoteCount: 20 + i * 2,
      seventvEmoteCount: 8 + i,
      topEmotes,
      signalObservations: {
        chat: measuredObservation(observedAt),
        emotes: measuredObservation(observedAt),
        viewers: measuredObservation(observedAt, 'helix'),
      },
    })
  }

  for (const offset of opts?.appendOffsets ?? []) {
    if (minutes.some((m) => m.offsetSeconds === offset)) continue
    const observedAt = new Date(Date.parse(startedAt) + offset * 1000).toISOString()
    minutes.push({
      offsetSeconds: offset,
      viewerAvg: 11_000,
      viewerMax: 11_100,
      viewerLatest: 11_050,
      viewerSamples: 4,
      chatCount: 120,
      totalEmoteCount: 60,
      seventvEmoteCount: 30,
      topEmotes: withEmotes
        ? [
            {
              name: 'KEKW',
              provider: 'twitch',
              imageUrl: 'https://static-cdn.jtvnw.net/emoticons/v2/tw1/default/dark/1.0',
              count: 50,
            },
          ]
        : [],
      signalObservations: {
        chat: measuredObservation(observedAt),
        emotes: measuredObservation(observedAt),
        viewers: measuredObservation(observedAt, 'helix'),
      },
    })
  }

  minutes.sort((a, b) => Number(a.offsetSeconds) - Number(b.offsetSeconds))
  const lastOffset = Number(minutes.at(-1)?.offsetSeconds ?? 0)
  const through = new Date(Date.parse(startedAt) + lastOffset * 1000).toISOString()

  return {
    streamId: PORTAL_STREAM_ID,
    channel: PORTAL_LOGIN,
    startedAt,
    coverageStartOffsetSeconds: 0,
    minutes,
    updatedAt: Date.parse(SYSTEM_TIME_ISO),
    signalWatermarks: {
      chat: { state: 'current', observedThrough: through, source: 'fixture', coveragePct: 100 },
      emotes: { state: 'current', observedThrough: through, source: 'fixture', coveragePct: 100 },
      viewers: { state: 'current', observedThrough: through, source: 'helix' },
    },
  }
}

export function buildStreamRecord(overrides: Record<string, unknown> = {}) {
  return {
    streamId: PORTAL_STREAM_ID,
    login: PORTAL_LOGIN,
    displayName: 'xQc',
    title: 'Deterministic portal acceptance fixture',
    category: 'Just Chatting',
    startedAt: PORTAL_STARTED_AT,
    endedAt: null,
    currentViewers: 42_000,
    peakViewers: 55_000,
    viewerSamples: 400,
    chatMessages: 120_000,
    vodId: '',
    ...overrides,
  }
}

export function buildDetail(overrides: Record<string, unknown> = {}) {
  const stream = buildStreamRecord(
    (overrides.stream as Record<string, unknown> | undefined) ?? {},
  )
  return {
    channel: PORTAL_LOGIN,
    state: 'live',
    stream,
    sources: [{ source: 'fixture', state: 'ok', label: 'Fixture data' }],
    updatedAt: Date.parse(SYSTEM_TIME_ISO),
    chatCoveragePct: 99.5,
    analyticsQuality: 'limited',
    availability: {
      liveDvrState: 'live',
      vodState: 'pending_live',
      chartState: 'usable',
      chartUsable: true,
      coveragePct: 99.5,
    },
    signalWatermarks: {
      chat: {
        state: 'current',
        observedThrough: new Date(Date.parse(PORTAL_STARTED_AT) + 23 * 60_000).toISOString(),
        source: 'fixture',
        coveragePct: 100,
      },
      emotes: {
        state: 'current',
        observedThrough: new Date(Date.parse(PORTAL_STARTED_AT) + 23 * 60_000).toISOString(),
        source: 'fixture',
        coveragePct: 100,
      },
      viewers: {
        state: 'current',
        observedThrough: new Date(Date.parse(PORTAL_STARTED_AT) + 23 * 60_000).toISOString(),
        source: 'helix',
      },
    },
    ...overrides,
    stream,
  }
}

export function buildStatus(overrides: Record<string, unknown> = {}) {
  return {
    channel: PORTAL_LOGIN,
    state: 'live',
    streamId: PORTAL_STREAM_ID,
    updatedAt: Date.parse(SYSTEM_TIME_ISO),
    chatCoveragePct: 99.5,
    analyticsQuality: 'limited',
    availability: {
      liveDvrState: 'live',
      vodState: 'pending_live',
      chartState: 'usable',
      chartUsable: true,
    },
    stream: buildStreamRecord(),
    ...overrides,
  }
}

export function buildSummary(overrides: Record<string, unknown> = {}) {
  return {
    streamId: PORTAL_STREAM_ID,
    channel: PORTAL_LOGIN,
    state: 'live',
    stream: buildStreamRecord(),
    updatedAt: Date.parse(SYSTEM_TIME_ISO),
    metrics: {
      chat_per_min: 80,
      emotes_per_min: 40,
      seventv_per_min: 20,
      minutesWithData: 24,
      data_coverage_pct: 99,
      sync_health_state: 'synced',
    },
    topEmotes: [
      {
        key: 'twitch:KEKW:KEKW',
        name: 'KEKW',
        id: 'tw1',
        provider: 'twitch',
        imageUrl: 'https://static-cdn.jtvnw.net/emoticons/v2/tw1/default/dark/1.0',
        count: 900,
      },
      {
        key: 'twitch:OMEGALUL:OMEGALUL',
        name: 'OMEGALUL',
        id: 'tw2',
        provider: 'twitch',
        imageUrl: 'https://static-cdn.jtvnw.net/emoticons/v2/tw2/default/dark/1.0',
        count: 800,
      },
      {
        key: '7tv:Clap:Clap',
        name: 'Clap',
        id: 'stv1',
        provider: '7tv',
        imageUrl: 'https://cdn.7tv.app/emote/stv1/1x.webp',
        count: 700,
      },
      {
        key: 'bttv:Clap:Clap',
        name: 'Clap',
        id: 'bt1',
        provider: 'bttv',
        imageUrl: 'https://cdn.frankerfacez.com/emote/bt1/1',
        count: 650,
      },
      {
        key: '7tv:NODDERS:NODDERS',
        name: 'NODDERS',
        id: 'stv2',
        provider: '7tv',
        imageUrl: 'https://cdn.7tv.app/emote/stv2/1x.webp',
        count: 500,
      },
      {
        key: '7tv:Sadge:Sadge',
        name: 'Sadge',
        id: 'stv3',
        provider: '7tv',
        imageUrl: 'https://cdn.7tv.app/emote/stv3/1x.webp',
        count: 400,
      },
      {
        key: 'ffz:Pog:Pog',
        name: 'Pog',
        id: 'ffz1',
        provider: 'ffz',
        imageUrl: 'https://cdn.frankerfacez.com/emote/ffz1/1',
        count: 200,
      },
      {
        key: '7tv:RareGhost:RareGhost',
        name: 'RareGhost',
        id: 'stv4',
        provider: '7tv',
        imageUrl: 'https://cdn.7tv.app/emote/stv4/1x.webp',
        count: 3,
      },
    ],
    ...overrides,
  }
}

export function buildEmotes30d(overrides: Record<string, unknown> = {}) {
  return {
    channel: PORTAL_LOGIN,
    topEmotes: [
      {
        provider: 'twitch',
        providerEmoteId: 'tw1',
        name: 'KEKW',
        imageUrl: 'https://static-cdn.jtvnw.net/emoticons/v2/tw1/default/dark/1.0',
        useCount: 50_000,
      },
      {
        provider: '7tv',
        providerEmoteId: 'stv1',
        name: 'Clap',
        imageUrl: 'https://cdn.7tv.app/emote/stv1/1x.webp',
        useCount: 40_000,
      },
      {
        provider: 'bttv',
        providerEmoteId: 'bt1',
        name: 'Clap',
        // UUID-style proxy would lose to direct CDN when session/summary has CDN.
        imageUrl: `/v1/portal/analytics/emotes/proxy/bt1.png`,
        useCount: 39_000,
      },
      {
        provider: '7tv',
        providerEmoteId: 'stv2',
        name: 'NODDERS',
        imageUrl: 'https://cdn.7tv.app/emote/stv2/1x.webp',
        useCount: 20_000,
      },
      {
        provider: '7tv',
        providerEmoteId: 'stv3',
        name: 'Sadge',
        imageUrl: 'https://cdn.7tv.app/emote/stv3/1x.webp',
        useCount: 18_000,
      },
      {
        provider: 'twitch',
        providerEmoteId: 'tw2',
        name: 'OMEGALUL',
        imageUrl: 'https://static-cdn.jtvnw.net/emoticons/v2/tw2/default/dark/1.0',
        useCount: 17_000,
      },
      {
        provider: 'ffz',
        providerEmoteId: 'ffz1',
        name: 'Pog',
        imageUrl: 'https://cdn.frankerfacez.com/emote/ffz1/1',
        useCount: 9_000,
      },
      {
        provider: '7tv',
        providerEmoteId: 'ghost-id',
        name: 'UnavailableEmote',
        // intentionally missing usable image; honesty path
        useCount: 1,
      },
    ],
    updatedAt: Date.parse(SYSTEM_TIME_ISO),
    ...overrides,
  }
}

export function buildRecap(overrides: Record<string, unknown> = {}) {
  return {
    streamId: PORTAL_STREAM_ID,
    login: PORTAL_LOGIN,
    durationSeconds: 24 * 60,
    topMoments: [
      {
        offsetSeconds: 240,
        score: 92,
        chatCount: 120,
        emoteCount: 60,
        viewerCount: 11_000,
        peakObservation: {
          state: 'measured',
          observedAt: new Date(Date.parse(PORTAL_STARTED_AT) + 240_000).toISOString(),
          confirmed: true,
          detector: 'fixture:confirmed_peak',
          value: 92,
          source: 'fixture',
          coveragePct: 100,
        },
      },
    ],
    updatedAt: Date.parse(SYSTEM_TIME_ISO),
    ...overrides,
  }
}

export function loadXqcGames(): Array<Record<string, unknown>> {
  return loadJsonFixture('xqc-games.json')
}

async function fulfill(route: Route, spec: FulfillSpec): Promise<void> {
  if (spec.delayMs && spec.delayMs > 0) {
    await new Promise((r) => setTimeout(r, spec.delayMs))
  }
  if (spec.kind === 'abort') {
    await route.abort()
    return
  }
  if (spec.kind === 'timeout') {
    // Hold past apiClient's 8s timeout, then abort so the route does not leak.
    await new Promise((r) => setTimeout(r, spec.delayMs ?? 20_000))
    await route.abort()
    return
  }
  if (spec.kind === 'text') {
    await route.fulfill({
      status: spec.status ?? 200,
      contentType: spec.contentType ?? 'text/plain',
      body: spec.body,
    })
    return
  }
  await route.fulfill({
    status: spec.status ?? 200,
    contentType: 'application/json',
    body: JSON.stringify(spec.body),
  })
}

function isAllowedAssetHost(hostname: string): boolean {
  return MOCK_ASSET_HOSTS.has(hostname)
}

export async function installPortalAcceptanceHarness(
  page: Page,
  opts?: { clock?: boolean },
): Promise<PortalHarness> {
  const counter = new RequestCounter()
  const unexpected: string[] = []

  let minutesPayload: JsonBody = buildMinutes({ withEmotes: true })
  let gamesPayload: JsonBody = loadXqcGames()
  let summaryPayload: JsonBody = buildSummary()
  let emotes30dPayload: JsonBody = buildEmotes30d()
  let detailPayload: JsonBody = buildDetail()
  let streamsPayload: JsonBody = {
    channel: PORTAL_LOGIN,
    items: [buildStreamRecord()],
    updatedAt: Date.parse(SYSTEM_TIME_ISO),
  }
  let recapPayload: JsonBody = buildRecap()

  const status = new SequentialJsonHandler().setFallback({
    kind: 'json',
    body: buildStatus(),
  })
  const minutesFull = new SequentialJsonHandler()
  const minutesTail = new SequentialJsonHandler()
  const detail = new SequentialJsonHandler()
  const games = new SequentialJsonHandler()
  const summary = new SequentialJsonHandler()
  const emotes30d = new SequentialJsonHandler()
  const recap = new SequentialJsonHandler()
  const streams = new SequentialJsonHandler()

  minutesFull.setFallback({ kind: 'json', body: minutesPayload })
  minutesTail.setFallback({ kind: 'json', body: { ...(minutesPayload as object), minutes: [] } })
  detail.setFallback({ kind: 'json', body: detailPayload })
  games.setFallback({ kind: 'json', body: gamesPayload })
  summary.setFallback({ kind: 'json', body: summaryPayload })
  emotes30d.setFallback({ kind: 'json', body: emotes30dPayload })
  recap.setFallback({ kind: 'json', body: recapPayload })
  streams.setFallback({ kind: 'json', body: streamsPayload })

  if (opts?.clock !== false) {
    await page.clock.install({ systemTime: Date.parse(SYSTEM_TIME_ISO) })
  }

  await page.addInitScript(() => {
    const w = window as Window & { __SP_PORTAL_MOUNT_ID?: string }
    if (!w.__SP_PORTAL_MOUNT_ID) {
      w.__SP_PORTAL_MOUNT_ID = `mount-${Math.random().toString(36).slice(2, 10)}`
    }
    ;(window as Window & { __SP_PORTAL_MOUNT_COUNT?: number }).__SP_PORTAL_MOUNT_COUNT =
      ((window as Window & { __SP_PORTAL_MOUNT_COUNT?: number }).__SP_PORTAL_MOUNT_COUNT ?? 0) + 1
  })

  await seedBetaKey(page)

  page.on('request', (request: Request) => {
    const url = request.url()
    try {
      const u = new URL(url)
      if (u.protocol === 'data:' || u.protocol === 'blob:' || u.protocol === 'about:') return
      if (ALLOWED_NAV_HOSTS.has(u.hostname)) return
      if (MOCK_API_HOSTS.has(u.hostname) || isAllowedAssetHost(u.hostname)) {
        counter.record(url)
        return
      }
      // Navigations to Twitch from anchors are asserted via href, not fetched.
      if (u.hostname.endsWith('twitch.tv') && request.isNavigationRequest()) return
      unexpected.push(url)
    } catch {
      unexpected.push(url)
    }
  })

  await page.route('**/*', async (route) => {
    const request = route.request()
    const url = request.url()
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      unexpected.push(url)
      await route.abort()
      return
    }

    if (parsed.protocol === 'data:' || parsed.protocol === 'blob:' || parsed.protocol === 'about:') {
      await route.continue()
      return
    }

    if (ALLOWED_NAV_HOSTS.has(parsed.hostname)) {
      await route.continue()
      return
    }

    if (isAllowedAssetHost(parsed.hostname)) {
      counter.record(url)
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: TINY_PNG,
      })
      return
    }

    if (!MOCK_API_HOSTS.has(parsed.hostname)) {
      unexpected.push(url)
      await route.abort('blockedbyclient')
      return
    }

    counter.record(url)
    const path = parsed.pathname
    const search = parsed.search

    if (path.includes('/emotes/proxy/')) {
      await route.fulfill({ status: 200, contentType: 'image/png', body: TINY_PNG })
      return
    }

    if (path.endsWith(`/streams/${PORTAL_STREAM_ID}/status`)) {
      await fulfill(route, status.next())
      return
    }

    if (path.endsWith(`/streams/${PORTAL_STREAM_ID}/minutes`)) {
      if (search.includes('afterOffset=')) {
        await fulfill(route, minutesTail.next())
      } else {
        // Keep fallback in sync with mutable payload.
        minutesFull.setFallback({ kind: 'json', body: minutesPayload })
        await fulfill(route, minutesFull.next())
      }
      return
    }

    if (path.endsWith(`/streams/${PORTAL_STREAM_ID}`) && !path.endsWith('/status')) {
      detail.setFallback({ kind: 'json', body: detailPayload })
      await fulfill(route, detail.next())
      return
    }

    if (path.endsWith(`/streams/${PORTAL_STREAM_ID}/games`)) {
      games.setFallback({ kind: 'json', body: gamesPayload })
      await fulfill(route, games.next())
      return
    }

    if (path.endsWith(`/streams/${PORTAL_STREAM_ID}/summary`)) {
      summary.setFallback({ kind: 'json', body: summaryPayload })
      await fulfill(route, summary.next())
      return
    }

    if (path.endsWith(`/streams/${PORTAL_STREAM_ID}/recap`)) {
      recap.setFallback({ kind: 'json', body: recapPayload })
      await fulfill(route, recap.next())
      return
    }

    if (path.endsWith(`/streams/${PORTAL_STREAM_ID}/replay-heatmap`)) {
      await fulfill(route, { kind: 'json', body: { points: [] } })
      return
    }

    if (path.endsWith(`/streams/${PORTAL_STREAM_ID}/sync/status`)) {
      await fulfill(route, {
        kind: 'json',
        body: { streamId: PORTAL_STREAM_ID, phase: 'complete', stale: false, updatedAt: PORTAL_STARTED_AT },
      })
      return
    }

    if (path.includes(`/channels/${PORTAL_LOGIN}/emotes`)) {
      emotes30d.setFallback({ kind: 'json', body: emotes30dPayload })
      await fulfill(route, emotes30d.next())
      return
    }

    if (path.includes(`/channels/${PORTAL_LOGIN}/streams`)) {
      streams.setFallback({ kind: 'json', body: streamsPayload })
      await fulfill(route, streams.next())
      return
    }

    if (path.includes(`/channels/${PORTAL_LOGIN}/live`)) {
      await fulfill(route, {
        kind: 'json',
        body: {
          channel: PORTAL_LOGIN,
          state: 'live',
          stream: buildStreamRecord(),
          availability: {
            liveDvrState: 'live',
            vodState: 'pending_live',
            chartState: 'usable',
          },
          updatedAt: Date.parse(SYSTEM_TIME_ISO),
        },
      })
      return
    }

    if (path.includes(`/channels/${PORTAL_LOGIN}/watch`)) {
      await fulfill(route, { kind: 'json', body: { ok: true } })
      return
    }

    if (path.includes('/v1/analytics/') || path.includes('/v1/portal/')) {
      await fulfill(route, { kind: 'json', body: { items: [], streams: [], segments: [], updatedAt: 0 } })
      return
    }

    if (path.includes('/v1/')) {
      await fulfill(route, { kind: 'json', body: { items: [], updatedAt: 0 } })
      return
    }

    unexpected.push(url)
    await route.abort('blockedbyclient')
  })

  const harness: PortalHarness = {
    counter,
    unexpected,
    status,
    minutesFull,
    minutesTail,
    detail,
    games,
    summary,
    emotes30d,
    recap,
    streams,
    setMinutesPayload(body) {
      minutesPayload = body
      minutesFull.setFallback({ kind: 'json', body })
    },
    setGamesPayload(body) {
      gamesPayload = body
      games.setFallback({ kind: 'json', body })
    },
    setSummaryPayload(body) {
      summaryPayload = body
      summary.setFallback({ kind: 'json', body })
    },
    setEmotes30dPayload(body) {
      emotes30dPayload = body
      emotes30d.setFallback({ kind: 'json', body })
    },
    async advancePoll(ms = 30_000) {
      await page.clock.fastForward(ms)
    },
  }

  return harness
}

export async function openAnalyticsSession(
  page: Page,
  opts?: { login?: string; streamId?: string },
): Promise<void> {
  const login = opts?.login ?? PORTAL_LOGIN
  const streamId = opts?.streamId ?? PORTAL_STREAM_ID
  await page.goto(`/analytics/${login}/${streamId}`, { waitUntil: 'domcontentloaded' })
  await expect(
    page.getByRole('region', { name: new RegExp(`Analytics for ${login}|Streamclone analytics console`, 'i') }),
  ).toBeVisible({ timeout: 30_000 })
}

export async function assertNoUnexpected(harness: PortalHarness): Promise<void> {
  expect(harness.unexpected, `unexpected external requests: ${harness.unexpected.join(', ')}`).toEqual([])
}

export async function assertEmotePlotLines(page: Page, expected: number): Promise<void> {
  const paths = page.locator('path.sc-emote-plot-line')
  await expect(paths).toHaveCount(expected, { timeout: 20_000 })
  const geometries = await paths.evaluateAll((nodes) =>
    nodes.map((n) => {
      const d = n.getAttribute('d') || ''
      const box = (n as SVGPathElement).getBBox()
      return { dLen: d.length, width: box.width, height: box.height }
    }),
  )
  expect(geometries.length).toBe(expected)
  for (const g of geometries) {
    expect(g.dLen).toBeGreaterThan(10)
    expect(g.width + g.height).toBeGreaterThan(0)
  }
}

export async function getMountId(page: Page): Promise<string> {
  return page.evaluate(() => (window as Window & { __SP_PORTAL_MOUNT_ID?: string }).__SP_PORTAL_MOUNT_ID || '')
}

export async function openEmotesRail(page: Page): Promise<void> {
  await page.locator('aside').getByRole('button', { name: /^Emotes$/i }).click()
}

export async function setChartViewEmotes(page: Page): Promise<void> {
  // Chart toolbar Overview/Emotes/Spikes — not the right-rail tab.
  await page
    .locator('.analytics-console button.rounded')
    .filter({ hasText: /^Emotes$/i })
    .first()
    .click()
}
