/**
 * Stored-discovery fixture, shared by the dev fixture server and the Playwright
 * audit helper so browser and tests can never drift apart.
 *
 * Why this exists: the hosted endpoint answers
 * `503 {"error":"discovery_unavailable"}` for `/v1/public/discovery`, so the
 * handoff's ohnePixel 2026-09-03 case (136 detections across more than one
 * indexed broadcast) cannot be reproduced from live data. This reproduces it
 * deterministically.
 *
 * Shaped to satisfy `src/lib/discoveryCatalogue.ts` and `src/lib/discoveryYear.ts`
 * exactly:
 * - `days.length` must equal the real number of days in the month (or year).
 * - a `measured` day needs `coverage: 'partial'`, non-zero `streams` and
 *   `measuredStreamMinutes`, and non-negative integer counts. `detections: 0`
 *   is legal, which is what exercises the legend's "0 detected" key.
 * - `items.length` may not exceed 100, so 136 detections are paginated.
 * - a year summary must carry `items: []`, no `month`, and no `nextCursor`.
 *
 * Dev-only: this file lives under `scripts/` and is never bundled into the app.
 */

export const FIXTURE_MONTH = '2026-09'
export const FIXTURE_DAY = '2026-09-03'
/**
 * A real indexed channel, so `/streams/:id/recap` answers for the first
 * broadcast and the list's server ranking is exercised against real backend
 * data rather than an invented stream id that can only 404.
 */
export const FIXTURE_CREATOR = 'casson'
export const FIXTURE_PAGE_SIZE = 50

/**
 * Minutes the recap ranked for stream 315982311249, observed 2026-09-11. A
 * union of two reads, because the server's ranking moves: the point is that
 * several loaded detections match ranked minutes, not that this list is the
 * ranking. Ranked minutes with no loaded detection are skipped by the UI.
 */
const CASSON_RANKED_OFFSETS = [
  61338, 77538, 77298, 51558, 78378, 6078, 59178, 3378, 2058, 81858, 29778, 81198,
  70218, 63078, 76278, 74478, 51318, 57558, 258, 49458, 2358, 53538, 54438, 75138,
]

/**
 * Two genuinely distinct broadcasts on the same day; these must never merge.
 * The first is a real stream the recap knows, the second is synthetic so the
 * honest "no server ranking for this broadcast" path stays visible too.
 */
export const FIXTURE_BROADCASTS = [
  { streamId: '315982311249', category: 'Counter-Strike 2', detections: 96, startHour: 0, rankedOffsets: CASSON_RANKED_OFFSETS },
  { streamId: '317718621668', category: 'Just Chatting', detections: 40, startHour: 20 },
]

export const FIXTURE_TOTAL_DETECTIONS = FIXTURE_BROADCASTS.reduce(
  (sum, broadcast) => sum + broadcast.detections,
  0,
)

/**
 * Detections per day of the fixture month. Chosen so `ceil(value / max * 4)`
 * covers every ramp level 0–4, including a measured day with zero detections.
 */
const DAY_DETECTIONS = [0, 8, FIXTURE_TOTAL_DETECTIONS, 75, 40, 20, 110, 60]
const NO_MEASUREMENT_DAYS = 3

/** Treated as "now" so the fixture's future days stay stable across runs. */
const FIXTURE_TODAY = '2026-09-11'

const ASOF = '2026-09-11T12:00:00Z'
const PROJECTION_UPDATED_AT = '2026-09-11T11:59:00Z'
const DATA_THROUGH = '2026-09-11T11:58:00Z'

function daysInMonth(month) {
  return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate()
}

function measuredDay(day, detections, streams) {
  const chatMessages = 4000 + detections * 40
  return {
    day,
    state: 'measured',
    coverage: 'partial',
    streams,
    measuredStreamMinutes: 240,
    chatMessages,
    emoteUses: Math.round(chatMessages * 0.4),
    detections,
  }
}

function emptyDay(day) {
  return {
    day,
    state: day > FIXTURE_TODAY ? 'future' : 'no_measurement',
    coverage: 'none',
    streams: 0,
    measuredStreamMinutes: 0,
    chatMessages: null,
    emoteUses: null,
    detections: null,
  }
}

/** Days for the fixture month, exercising every intensity level. */
function fixtureMonthDays(month) {
  const total = daysInMonth(month)
  return Array.from({ length: total }, (_, index) => {
    const day = `${month}-${String(index + 1).padStart(2, '0')}`
    if (month !== FIXTURE_MONTH) {
      // Other months get one measured day so a year overview is not empty.
      return index === 14 ? measuredDay(day, 24 + ((Number(month.slice(5)) * 13) % 60), 1) : emptyDay(day)
    }
    const detections = DAY_DETECTIONS[index]
    if (detections !== undefined) {
      return measuredDay(day, detections, index === 2 ? FIXTURE_BROADCASTS.length : 1)
    }
    if (index < DAY_DETECTIONS.length + NO_MEASUREMENT_DAYS) return emptyDay(day)
    return emptyDay(day)
  })
}

const EMOTES = [
  { name: 'OMEGALUL', provider: 'seventv' },
  { name: 'Pog', provider: 'twitch' },
  { name: 'KEKW', provider: 'bttv' },
]

/**
 * Offsets for one broadcast: its ranked minutes first (so the server ranking
 * has something loaded to rank), then synthetic minutes kept clear of them,
 * including adjacent minutes — adjacent minutes suggest one reaction but do not
 * prove it.
 */
function broadcastOffsets(broadcast) {
  const ranked = (broadcast.rankedOffsets ?? []).slice(0, broadcast.detections)
  const offsets = [...ranked]
  for (let index = 0; offsets.length < broadcast.detections; index += 1) {
    const seconds = (Math.floor(index / 4) * 7 + (index % 4)) * 60
    if (ranked.every(offset => Math.abs(offset - seconds) > 120)) offsets.push(seconds)
  }
  return offsets.sort((left, right) => left - right)
}

/**
 * Every detection on the fixture day, newest first, tagged with the broadcast
 * that owns it.
 */
function dayDetections(day, creator) {
  const items = []
  let sequence = 0
  for (const broadcast of FIXTURE_BROADCASTS) {
    const base = Date.parse(`${day}T${String(broadcast.startHour).padStart(2, '0')}:00:00Z`)
    const offsets = broadcastOffsets(broadcast)
    for (const [index, offsetSeconds] of offsets.entries()) {
      sequence += 1
      items.push({
        id: `dm_${sequence.toString(16).padStart(32, '0')}`,
        login: creator,
        displayName: 'Casson',
        streamId: broadcast.streamId,
        offsetSeconds,
        at: base + offsetSeconds * 1000,
        label: index % 5 === 0 ? 'Chat spike' : 'Emote spike',
        chatPerMin: 120 + ((index * 37) % 500),
        emotesPerMin: 40 + ((index * 23) % 300),
        source: 'stored_irc',
        revision: 1,
        categorySource: 'measured_segment',
        category: broadcast.category,
        topEmotes: EMOTES.map((emote, rank) => ({
          ...emote,
          count: 400 - rank * 90 - (index % 7) * 10,
        })),
      })
    }
  }
  return items.sort((left, right) => Number(right.at) - Number(left.at))
}

function catalogueEnvelope(month, creator) {
  return {
    schemaVersion: 1,
    state: 'ready',
    scope: 'indexed_public_irc_streams',
    calendarScope: 'month_and_creator_only',
    month,
    login: creator,
    asOf: ASOF,
    projectionUpdatedAt: PROJECTION_UPDATED_AT,
    dataThrough: DATA_THROUGH,
    days: fixtureMonthDays(month),
    items: [],
    nextCursor: '',
  }
}

export function discoveryMonthResponse(month, creator) {
  return catalogueEnvelope(month, creator)
}

export function discoveryDayResponse(month, creator, day, cursor) {
  // Only the fixture day owns detections; other days are honestly empty.
  const all = day === FIXTURE_DAY ? dayDetections(day, creator) : []
  const offset = cursor ? Number(cursor) || 0 : 0
  const page = all.slice(offset, offset + FIXTURE_PAGE_SIZE)
  const next = offset + FIXTURE_PAGE_SIZE
  return {
    ...catalogueEnvelope(month, creator),
    items: page,
    nextCursor: next < all.length ? String(next) : '',
  }
}

/** Year summary: same day contract, no items, no cursor, no month. */
export function discoveryYearResponse(year, creator) {
  const days = []
  for (let month = 1; month <= 12; month += 1) {
    days.push(...fixtureMonthDays(`${year}-${String(month).padStart(2, '0')}`))
  }
  return {
    schemaVersion: 1,
    state: 'ready',
    scope: 'indexed_public_irc_streams',
    calendarScope: 'year_and_creator_only',
    year,
    login: creator,
    asOf: ASOF,
    projectionUpdatedAt: PROJECTION_UPDATED_AT,
    dataThrough: DATA_THROUGH,
    days,
    items: [],
    nextCursor: '',
  }
}

/**
 * Resolve a fixture body for a discovery request, or `null` when the path is
 * not one this fixture owns (the caller should pass those through).
 */
export function discoveryFixtureResponse(pathname, searchParams) {
  const creator = searchParams.get('login') || ''
  if (pathname === '/v1/public/discovery') {
    const month = searchParams.get('month') || FIXTURE_MONTH
    const day = searchParams.get('day') || ''
    const cursor = searchParams.get('cursor') || ''
    return day
      ? discoveryDayResponse(month, creator, day, cursor)
      : discoveryMonthResponse(month, creator)
  }
  if (pathname === '/v1/public/discovery/activity') {
    const year = searchParams.get('year') || FIXTURE_MONTH.slice(0, 4)
    return discoveryYearResponse(year, creator)
  }
  return null
}
