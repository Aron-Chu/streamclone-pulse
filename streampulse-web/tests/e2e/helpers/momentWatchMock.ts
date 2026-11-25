import type { Page, Route } from '@playwright/test'
import { buildMinutes } from './portalAcceptanceHarness'

/**
 * The made-up stream behind the Moment page specs (moment-watch*.portal-mocked.spec.ts). Every name,
 * id and emote is made up. The Moment's minute is 0:40:00 into the stream (offset 2400 s).
 */
export const STREAM_ID = '9000001'
export const LOGIN = 'fakechan01'
export const CHANNEL = 'FakeChan01'
export const GAME = 'Fake Game'
export const STARTED_AT = '2026-11-10T18:00:00Z'
export const ENDED_AT = '2026-11-10T21:00:00Z'
export const MOMENT_KEY = '20261110T1840Z'
export const OFFSET_SECONDS = 2400
export const VOD_ID = '9000000001'
export const MINUTE_MS = Date.parse('2026-11-10T18:40:00Z')
/** The feedback answer's window: the comments' span. */
export const WINDOW = { from: '2026-11-10T18:38:00Z', to: '2026-11-10T18:43:00Z' }
export const PAGE_PATH = `/analytics/moments/${STREAM_ID}/${MOMENT_KEY}`
export const TITLE = `Moment at 0:40:00 — ${CHANNEL} — StreamPulse`
/** A storyboard sheet: the frame route only names cloudfront sheets. */
export const SHEET_URL = 'https://d1fakesheets.cloudfront.net/9000000001/storyboards/fake-strip-0.jpg'
export const VOD_THUMBNAIL_URL = `https://static-cdn.jtvnw.net/cf_vods/fakevods/${VOD_ID}/thumb/thumb0-640x360.jpg`
/** A Twitch clip cut from the same broadcast, its middle (2420 s) 10 s before the middle of the Moment's minute (2430 s). */
export const NEARBY_CLIP = {
  id: 'FakeClipNearby', url: 'https://clips.twitch.tv/FakeClipNearby', title: 'fake clip near the moment',
  thumbnailUrl: 'https://static-cdn.jtvnw.net/twitch-clips/fake-nearby-480x272.jpg', videoId: VOD_ID,
  vodOffsetSeconds: 2405, durationSeconds: 30, viewCount: 12,
}
/** A clip whose middle is the Moment's own middle second, on another broadcast: never "nearby". */
export const OTHER_VOD_CLIP = {
  ...NEARBY_CLIP, id: 'FakeClipOtherVod', url: 'https://clips.twitch.tv/FakeClipOtherVod',
  thumbnailUrl: 'https://static-cdn.jtvnw.net/twitch-clips/fake-other-vod-480x272.jpg', videoId: '9000000002', vodOffsetSeconds: 2415,
}
/** A Twitch category id: the game art is Twitch's box art for it. */
export const CATEGORY_ID = '509658'
export const GAME_ART_URL = `https://static-cdn.jtvnw.net/ttv-boxart/${CATEGORY_ID}-285x380.jpg`

const EXISTING = [
  { id: '11111111-1111-4111-8111-111111111111', at: '2026-11-10T18:40:22Z', body: 'fake-pog all over chat', author: 'fakeviewer01', ago: 5 },
  { id: '22222222-2222-4222-8222-222222222222', at: '2026-11-10T18:41:05Z', body: 'that was the moment', author: 'fakeviewer02', ago: 9 },
]
export const EXISTING_COMMENT_IDS = EXISTING.map(c => c.id)

export interface MomentWatchOptions {
  signedIn?: boolean
  canWrite?: boolean
  /** False: the stream is live (the stream route leaves endedAt out, the feedback answer says null). */
  ended?: boolean
  /** The recap's top Moments, as offsets. The Moment's own minute by default. */
  recapOffsets?: number[]
  /** The feedback route's status: 200 answers the Moment, anything else answers { error: 'not_found' }. */
  feedbackStatus?: number
  /** True: the storyboard route answers a tile (a "Stream frame"); false: 404 no_storyboard. */
  frame?: boolean
  /** The clips route's items for the channel. */
  clips?: unknown[]
  /**
   * The category id of the game the stream was on, all through: its /games answer names it with Twitch's
   * box art, the game art. No game segments by default.
   */
  categoryId?: string
  /** True: the stream answer carries the archive's verified thumbnail. */
  vodThumbnail?: boolean
  /**
   * The channel's other streams in its streams list ("More from {channel}"), with each one's recap top
   * Moments as offsets. The list names only this stream by default.
   */
  otherStreams?: Array<{ streamId: string; startedAt: string; recapOffsets: number[]; vodThumbnail?: boolean }>
  /** The Moments list's hub snapshot's Moments ("More {game} Moments"), as the hub sends them. None by default. */
  hubMoments?: unknown[]
  /** Held until this settles: the answers to the channel's streams list and the hub (the reads behind those two sections). */
  holdMore?: Promise<void>
}

export interface MomentWatchServed {
  /** Every /v1/account/... call, as "METHOD /path". */
  accountCalls: string[]
  /** GETs of this Moment's feedback route. */
  feedbackCalls: number
  ratingCalls: string[]
  commentPosts: Array<Record<string, unknown>>
  reports: Array<{ id: string; body: Record<string, unknown> }>
  commentQueries: URLSearchParams[]
  /** Calls to /v1/public/moments, as their query strings. They answer 404, the feature-off shape. */
  feedCalls: string[]
  /** GETs of the stream route and its recap. */
  streamCalls: number
  recapCalls: number
  /** The clips route's queries for the channel. */
  clipCalls: URLSearchParams[]
  /** The storyboard route's offsets. */
  frameCalls: string[]
  /** GETs of the stream's game segments (/games) and of the channel's Twitch profile. */
  gamesCalls: number
  profileCalls: number
  /** The channel's streams list reads, as their `limit`: the channel lookup asks for 1, "More from" for 24. */
  channelStreamsCalls: string[]
  /** GETs of the hub's Moments snapshot (/v1/public/hub?include=livePulseMoments). */
  hubCalls: string[]
  /** GETs of another stream's route and recap, as their stream ids. */
  otherStreamCalls: string[]
  otherRecapCalls: string[]
  /** Calls to the API that no mock here answered, as "METHOD /path". Every test ends by expecting none. */
  unmatched: string[]
}

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, json: body })
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const comment = (c: { id: string; at: string; body: string; author: string; ago: number }) => ({
  id: c.id, at: c.at, body: c.body, createdAt: new Date(Date.now() - c.ago * 60_000).toISOString(),
  author: { login: c.author, displayName: c.author, profileImageUrl: '' }, mine: false, reportedByYou: false,
})

/** Answers every /v1 call the Moment page makes; anything else is recorded and answered 599, so nothing reaches a real API. */
export async function serveMomentWatch(page: Page, options: MomentWatchOptions = {}): Promise<MomentWatchServed> {
  const {
    signedIn = false, canWrite = signedIn, ended = true, recapOffsets = [OFFSET_SECONDS], feedbackStatus = 200,
    frame = true, clips = [], categoryId, vodThumbnail = false, otherStreams = [], hubMoments = [], holdMore,
  } = options
  const served: MomentWatchServed = {
    accountCalls: [], feedbackCalls: 0, ratingCalls: [], commentPosts: [], reports: [], commentQueries: [], feedCalls: [],
    streamCalls: 0, recapCalls: 0, clipCalls: [], frameCalls: [], gamesCalls: 0, profileCalls: 0,
    channelStreamsCalls: [], hubCalls: [], otherStreamCalls: [], otherRecapCalls: [], unmatched: [],
  }
  let verdict: 'real' | 'not_real' | null = null
  const comments = EXISTING.map(comment)
  const feedback = () => ({
    schemaVersion: 1, streamId: STREAM_ID, momentAt: '2026-11-10T18:40:00Z',
    stream: { login: LOGIN, displayName: CHANNEL, profileImageUrl: '', category: GAME, startedAt: STARTED_AT, endedAt: ended ? ENDED_AT : null },
    window: WINDOW, clips: [],
    ratings: { yes: 6 + (verdict === 'real' ? 1 : 0), total: null, share: null },
    you: { signedIn, canWrite, verdict: signedIn ? verdict : null },
    comments: { total: comments.length }, hidden: false,
  })
  // The storyboard sheet a frame points at.
  await page.route(url => url.hostname.endsWith('.cloudfront.net'), route => route.fulfill({ status: 200, contentType: 'image/png', body: TINY_PNG }))
  // Only the app's origin and the API host: any other host falls through to the network guard.
  const isApi = (url: URL) => url.pathname.startsWith('/v1/') && ['127.0.0.1', 'localhost', 'api.streampulse.stream'].includes(url.hostname)
  await page.route(isApi, async route => {
    const request = route.request()
    const { pathname, searchParams } = new URL(request.url())
    const method = request.method()
    if (pathname.startsWith('/v1/account/')) served.accountCalls.push(`${method} ${pathname}`)
    if (pathname === `/v1/account/streams/${STREAM_ID}/moments/${MOMENT_KEY}/feedback` && method === 'GET') {
      served.feedbackCalls += 1
      return feedbackStatus === 200 ? json(route, feedback()) : json(route, { error: 'not_found' }, feedbackStatus)
    }
    if (pathname === `/v1/account/streams/${STREAM_ID}/moments/${MOMENT_KEY}/rating`) {
      served.ratingCalls.push(method)
      verdict = method === 'PUT' ? (request.postDataJSON() as { verdict: 'real' | 'not_real' }).verdict : null
      return json(route, feedback())
    }
    if (pathname === `/v1/account/streams/${STREAM_ID}/comments`) {
      if (method === 'GET') {
        served.commentQueries.push(searchParams)
        return json(route, { schemaVersion: 1, items: comments, total: comments.length })
      }
      const body = request.postDataJSON() as { at: string; body: string }
      served.commentPosts.push(body)
      const mine = { ...comment({ id: '33333333-3333-4333-8333-333333333333', at: body.at, body: body.body, author: LOGIN, ago: 0 }),
        author: { login: LOGIN, displayName: CHANNEL, profileImageUrl: '' }, mine: true }
      comments.unshift(mine)
      return json(route, mine, 201)
    }
    const report = /^\/v1\/account\/stream-comments\/([0-9a-f-]{36})\/report$/.exec(pathname)
    if (report && method === 'POST') {
      served.reports.push({ id: report[1]!, body: request.postDataJSON() as Record<string, unknown> })
      return route.fulfill({ status: 204 })
    }
    if (pathname === `/v1/portal/analytics/streams/${STREAM_ID}` && method === 'GET') {
      served.streamCalls += 1
      return json(route, {
        channel: LOGIN, vodId: VOD_ID, vodAlignSeconds: 0, vodTiming: { state: 'verified' }, vodDurationSeconds: 9000,
        ...(vodThumbnail ? { vodArtwork: { vodId: VOD_ID, kind: 'archive_thumbnail', url: VOD_THUMBNAIL_URL } } : {}),
        // The stream route leaves endedAt out while the stream is live.
        stream: {
          streamId: STREAM_ID, login: LOGIN, channel: LOGIN, displayName: CHANNEL, category: GAME, startedAt: STARTED_AT,
          ...(ended ? { endedAt: ENDED_AT } : {}),
        },
      })
    }
    if (pathname === `/v1/portal/analytics/streams/${STREAM_ID}/recap`) {
      served.recapCalls += 1
      return json(route, { streamId: STREAM_ID, login: LOGIN, durationSeconds: 7200, topMoments: recapOffsets.map(offsetSeconds => ({ offsetSeconds })) })
    }
    if (pathname === `/v1/portal/analytics/streams/${STREAM_ID}/minutes`) {
      return json(route, { ...buildMinutes({ count: 60, startedAt: STARTED_AT, withEmotes: false }), streamId: STREAM_ID, channel: LOGIN })
    }
    if (pathname === `/v1/portal/analytics/streams/${STREAM_ID}/games` && method === 'GET') {
      served.gamesCalls += 1
      return json(route, categoryId ? [{
        id: 1, streamId: STREAM_ID, gameName: GAME, categoryId, boxArtUrl: `https://static-cdn.jtvnw.net/ttv-boxart/${categoryId}-210x280.jpg`,
        offsetSeconds: 0, durationSeconds: 10800, source: 'snapshot', createdAt: ENDED_AT,
      }] : [])
    }
    // The channel's Twitch profile, without a picture: the head keeps its letter.
    if (pathname === `/v1/channels/${LOGIN}` && method === 'GET') {
      served.profileCalls += 1
      return json(route, { login: LOGIN, displayName: CHANNEL, profileImageUrl: '' })
    }
    if (pathname === `/v1/channels/${LOGIN}/clips` && method === 'GET') {
      served.clipCalls.push(searchParams)
      return json(route, { items: clips })
    }
    if (pathname === `/v1/analytics/vods/${VOD_ID}/storyboard-thumb` && method === 'GET') {
      served.frameCalls.push(searchParams.get('offsetSec') ?? '')
      return frame
        ? json(route, { sheetUrl: SHEET_URL, sheetWidth: 1100, sheetHeight: 620, cropX: 220, cropY: 124, cropW: 220, cropH: 124 })
        : json(route, { reason: 'no_storyboard' }, 404)
    }
    // The channel's streams list: this stream, newest, then its other streams.
    if (pathname === `/v1/portal/analytics/channels/${LOGIN}/streams` && method === 'GET') {
      served.channelStreamsCalls.push(searchParams.get('limit') ?? '')
      if (searchParams.get('limit') !== '1') await holdMore
      return json(route, { items: [
        { streamId: STREAM_ID, login: LOGIN, displayName: CHANNEL, category: GAME, startedAt: STARTED_AT, ...(ended ? { endedAt: ENDED_AT } : {}) },
        ...otherStreams.map(({ streamId, startedAt }) => ({ streamId, login: LOGIN, displayName: CHANNEL, category: GAME, startedAt })),
      ] })
    }
    const other = /^\/v1\/portal\/analytics\/streams\/(\d+)(\/recap)?$/.exec(pathname)
    if (other && other[1] !== STREAM_ID && method === 'GET') {
      const stream = otherStreams.find(s => s.streamId === other[1])
      ;(other[2] ? served.otherRecapCalls : served.otherStreamCalls).push(other[1]!)
      if (!stream) return json(route, { error: 'not_found' }, 404)
      if (other[2]) return json(route, { streamId: stream.streamId, login: LOGIN, durationSeconds: 7200, topMoments: stream.recapOffsets.map(offsetSeconds => ({ offsetSeconds })) })
      const vodId = `9${stream.streamId.padStart(9, '0')}`
      return json(route, {
        channel: LOGIN, vodId, vodAlignSeconds: 0, vodTiming: { state: 'verified' }, vodDurationSeconds: 9000,
        ...(stream.vodThumbnail ? { vodArtwork: { vodId, kind: 'archive_thumbnail', url: `https://static-cdn.jtvnw.net/cf_vods/fakevods/${vodId}/thumb/thumb0-640x360.jpg` } } : {}),
        stream: { streamId: stream.streamId, login: LOGIN, channel: LOGIN, displayName: CHANNEL, category: GAME, startedAt: stream.startedAt, endedAt: new Date(Date.parse(stream.startedAt) + 10_800_000).toISOString() },
      })
    }
    // The Moments list's hub snapshot: the shape the hub contract requires, with these Moments.
    if (pathname === '/v1/public/hub' && method === 'GET') {
      served.hubCalls.push(searchParams.toString())
      await holdMore
      return json(route, {
        generatedAt: new Date().toISOString(), poolSize: 0,
        corpus: { streamsTracked: 0, momentsDetected: 0, chatMessagesProcessed: 0, emotesIndexed: 0, vodsAnalyzed: 0 },
        coverage: { databaseOk: true, state: 'ok' }, activity: { points: [], channelCount: 0, windowMinutes: 30 },
        liveChannels: [], moments: [], topEmotes: [], topMovers: [],
        livePulseMoments: hubMoments, livePulseMomentsStatus: hubMoments.length ? 'ready' : 'no_peaks',
      })
    }
    if (pathname === '/v1/public/moments' && method === 'GET') {
      served.feedCalls.push(searchParams.toString())
      return json(route, { error: 'not_found' }, 404)
    }
    // Not the feature-off 404: a call nothing here expects is recorded and fails the test.
    served.unmatched.push(`${method} ${pathname}`)
    return json(route, { error: 'unmocked' }, 599)
  })
  return served
}

/**
 * Opens the page as the hub's link does, with its hand-over state { from: 'hub' }: the link that calls
 * the minute one of the stream's top Moments. React Router keeps a link's state in history.state.usr,
 * and a reload keeps it.
 */
export async function openFromHub(page: Page, path = PAGE_PATH): Promise<void> {
  await page.goto(path)
  await page.evaluate(() => history.replaceState({ ...(history.state ?? {}), usr: { from: 'hub' } }, ''))
  await page.reload()
}

/** The build's switches, as the spec process sees them: export the same values the build used. */
export const switchOn = (name: string) => ['1', 'on'].includes(process.env[name] ?? '')
