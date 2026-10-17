/**
 * Fixture for the moments strip golden test and the pins tests: a recap with
 * seven ranked moments (top moments plus clip candidates), a heatmap, the
 * stream's top emotes and measured minutes for three of the moments.
 */
import type { AnalyticsMinuteRollup, AnalyticsTopEmote, PulseStreamRecap } from '../../../apiTypes.ts'
import type { ReplayHeatmapPoint } from '../../../types/heatmap.ts'

export const STRIP_STARTED_AT = '2026-09-08T18:00:00Z'
const startMs = Date.parse(STRIP_STARTED_AT)
const minuteTs = (offsetSeconds: number) => new Date(startMs + Math.floor(offsetSeconds / 60) * 60_000).toISOString()

export const STRIP_TOP_EMOTES: AnalyticsTopEmote[] = [
  { key: '7tv:1', name: 'OMEGALUL', id: '1', provider: '7tv', imageUrl: 'https://cdn.7tv.app/emote/1/1x.webp', count: 9120 },
  { key: '7tv:2', name: 'KEKW', id: '2', provider: '7tv', imageUrl: 'https://cdn.7tv.app/emote/2/1x.webp', count: 6400 },
  { key: 'twitch:3', name: 'PogChamp', id: '3', provider: 'twitch', count: 2210 },
  { key: '7tv:4', name: 'Clap', id: '4', provider: '7tv', imageUrl: 'https://cdn.7tv.app/emote/4/1x.webp', count: 1830 },
  { key: 'bttv:5', name: 'catJAM', id: '5', provider: 'bttv', count: 950 },
  { key: '7tv:6', name: 'Sadge', id: '6', provider: '7tv', count: 410 },
  { key: 'ffz:7', name: 'monkaS', id: '7', provider: 'ffz', count: 220 },
]

export const STRIP_RECAP: PulseStreamRecap = {
  streamId: 'strip-golden-1',
  login: 'golden',
  durationSeconds: 12_600,
  totalMessages: 52_000,
  topMoments: [
    { offsetSeconds: 4_510, reactionOnsetOffsetSeconds: 4_518, precisionSeconds: 1, score: 94, reasons: ['emote_spike'], chatCount: 1134, emoteCount: 3483, topEmotes: [{ code: 'OMEGALUL', count: 1536 }] },
    { offsetSeconds: 8_960, score: 81, reasons: ['chat_spike'], chatCount: 880, emoteCount: 1200, topEmotes: [{ code: 'KEKW', count: 610 }] },
    { offsetSeconds: 9_720, score: 77, reasons: ['emote_spike'], chatCount: 640, emoteCount: 2400, topEmotes: [{ code: 'Clap', count: 900 }] },
    { offsetSeconds: 7_200, score: 70, reasons: ['viewer_surge'], chatCount: 520, emoteCount: 820 },
  ],
  clipCandidates: [
    { offsetSeconds: 5_300, score: 66, reasons: ['emote_spike'], chatCount: 410, emoteCount: 1500, topEmotes: [{ code: 'catJAM', count: 300 }] },
    { offsetSeconds: 5_390, score: 52, reasons: ['chat_spike'], chatCount: 300, emoteCount: 200 },
    { offsetSeconds: 1_200, score: 41, reasons: ['chat_spike'], chatCount: 220, emoteCount: 90 },
  ],
}

export const STRIP_ROLLUPS: AnalyticsMinuteRollup[] = [4_518, 8_960, 5_300].map((offset, index) => ({
  minuteTs: minuteTs(offset),
  viewerAvg: 27_000 + index * 400,
  chatCount: 400 + index * 50,
  totalEmoteCount: 900 + index * 70,
  emotes: { OMEGALUL: 300 - index * 40, KEKW: 120 + index * 10, Clap: 40 },
})) as AnalyticsMinuteRollup[]

export const STRIP_HEATMAP: ReplayHeatmapPoint[] = [
  {
    offsetSeconds: 4_500, durationSeconds: 60, score: 92, confidence: 0.9, reason: 'emote_spike',
    topEmotes: [{ id: '1', name: 'OMEGALUL', imageUrl: 'https://cdn.7tv.app/emote/1/1x.webp', count: 1536, provider: '7tv' }],
    vodId: null, streamId: 'strip-golden-1', minuteTs: minuteTs(4_500),
  },
  {
    offsetSeconds: 10_800, durationSeconds: 60, score: 39, confidence: 0.7, reason: 'chat_spike',
    topEmotes: [], vodId: null, streamId: 'strip-golden-1', minuteTs: minuteTs(10_800),
  },
] as ReplayHeatmapPoint[]
