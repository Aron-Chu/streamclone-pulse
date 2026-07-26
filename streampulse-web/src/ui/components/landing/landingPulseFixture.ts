import type { LandingPastVodRow, LandingPulsePayload } from './landingExtensionTypes.ts'
import { toFixtureEmote } from './landingEmoteEnrich.ts'

export type { LandingPastVodRow, LandingPulsePayload }

const TWITCH_THUMB_XQC =
  'https://static-cdn.jtvnw.net/previews-ttv/live_user_xqc-320x180.jpg'

const EMOTE_CATALOG = [
  toFixtureEmote('widespeedlaugh', 37),
  toFixtureEmote('degloved', 28),
  toFixtureEmote('widereacting', 21),
  toFixtureEmote('peepoHappy', 17),
  toFixtureEmote('forsenPls', 12),
  toFixtureEmote('Kappa', 9),
]

const LANDING_PEAKS: LandingPulsePayload['peaks'] = [
  {
    offsetSeconds: 2520,
    score: 92,
    reasons: ['chat_spike'],
    reasonLabel: 'Chat spike',
    dominantSignal: 'chat',
    chatCount: 608,
    emoteCount: 211,
    topEmotes: [
      toFixtureEmote('WAYTOODANK', 36),
      toFixtureEmote('FeelsDankMan', 24),
      toFixtureEmote('KEKW', 14),
    ],
  },
  {
    offsetSeconds: 11040,
    score: 78,
    reasons: ['chat_spike'],
    reasonLabel: 'Chat spike',
    dominantSignal: 'chat',
    chatCount: 420,
    emoteCount: 118,
    topEmotes: [
      toFixtureEmote('widespeedlaugh', 22),
      toFixtureEmote('OMEGALUL', 18),
      toFixtureEmote('degloved', 11),
    ],
  },
  {
    offsetSeconds: 1860,
    score: 71,
    reasons: ['seventv_spike'],
    reasonLabel: 'Emote spike',
    dominantSignal: 'seventv',
    chatCount: 285,
    emoteCount: 164,
    topEmotes: [
      toFixtureEmote('widereacting', 31),
      toFixtureEmote('peepoHappy', 19),
      toFixtureEmote('gachiBASS', 9),
    ],
  },
  {
    offsetSeconds: 3240,
    score: 64,
    reasons: ['chat_spike'],
    reasonLabel: 'Chat spike',
    dominantSignal: 'chat',
    chatCount: 340,
    emoteCount: 96,
    topEmotes: [
      toFixtureEmote('forsenPls', 17),
      toFixtureEmote('Clap', 12),
      toFixtureEmote('LUL', 8),
    ],
  },
  {
    offsetSeconds: 900,
    score: 58,
    reasons: ['seventv_spike'],
    reasonLabel: 'Emote spike',
    dominantSignal: 'seventv',
    chatCount: 198,
    emoteCount: 142,
    topEmotes: [
      toFixtureEmote('AlienDance', 20),
      toFixtureEmote('peepoPls', 14),
      toFixtureEmote('PogChamp', 6),
    ],
  },
  {
    offsetSeconds: 1680,
    score: 52,
    reasons: ['chat_spike'],
    reasonLabel: 'Chat spike',
    dominantSignal: 'chat',
    chatCount: 256,
    emoteCount: 74,
    topEmotes: [
      toFixtureEmote('BillyApprove', 15),
      toFixtureEmote('PETPET', 10),
      toFixtureEmote('ppL', 7),
    ],
  },
  {
    offsetSeconds: 2100,
    score: 47,
    reasons: ['chat_spike'],
    reasonLabel: 'Chat spike',
    dominantSignal: 'chat',
    chatCount: 220,
    emoteCount: 68,
    topEmotes: [
      toFixtureEmote('PartyParrot', 13),
      toFixtureEmote('WAYTOODANK', 9),
      toFixtureEmote('Kappa', 5),
    ],
  },
  {
    offsetSeconds: 2880,
    score: 41,
    reasons: ['seventv_spike'],
    reasonLabel: 'Emote spike',
    dominantSignal: 'seventv',
    chatCount: 175,
    emoteCount: 88,
    topEmotes: [
      toFixtureEmote('PepePls', 11),
      toFixtureEmote('degloved', 8),
      toFixtureEmote('widespeedlaugh', 6),
    ],
  },
]

function spikeAt(minute: number, at: number, boost: number, width: number): number {
  const d = minute - at
  return boost * Math.exp(-(d * d) / (2 * width * width))
}

function buildRollups(count = 60): LandingPulsePayload['rollups'] {
  const rollups: LandingPulsePayload['rollups'] = []
  for (let i = 0; i < count; i++) {
    const base = 11 + 6 * Math.sin(i * 0.45) + spikeAt(i, 18, 18, 1.4) + spikeAt(i, 42, 24, 1.2)
    const chatCount = Math.max(4, Math.round(base + i * 0.35))
    const sevenTv = Math.max(2, Math.round(chatCount * 0.72 + spikeAt(i, 42, 8, 1)))
    const totalEmote = Math.max(sevenTv, Math.round(sevenTv * 1.08))
    const viewerCount = 320 + Math.round(40 * Math.sin(i * 0.18) + i * 0.9)
    rollups.push({
      offsetSeconds: i * 60,
      chatCount,
      sevenTvEmoteCount: sevenTv,
      totalEmoteCount: totalEmote,
      viewerCount,
      topEmotes: i === 42 ? EMOTE_CATALOG.slice(0, 3) : i % 11 === 0 ? [EMOTE_CATALOG[0]!] : undefined,
    })
  }
  return rollups
}

const rollups = buildRollups(60)

export const LANDING_PAST_VODS: LandingPastVodRow[] = [
  {
    streamId: '319999888777',
    videoId: '2467890123',
    title: 'LIVE HERE DRAMA REACTS',
    category: 'Just Chatting',
    startedAt: '2026-07-07T20:00:00.000Z',
    durationMinutes: 59,
    thumbnailUrl: TWITCH_THUMB_XQC,
    analyticsStatus: 'current-live',
  },
  {
    streamId: '319253683932',
    videoId: '2467000001',
    title: 'Rank grind + patch notes',
    category: 'Just Chatting',
    startedAt: '2026-07-06T18:00:00.000Z',
    durationMinutes: 262,
    thumbnailUrl: TWITCH_THUMB_XQC,
    analyticsStatus: 'synced',
  },
  {
    streamId: '319240001111',
    videoId: '2466000001',
    title: 'Scrim block w/ chat Q&A',
    category: 'Fortnite',
    startedAt: '2026-07-05T20:00:00.000Z',
    durationMinutes: 138,
    thumbnailUrl: TWITCH_THUMB_XQC,
    analyticsStatus: 'stats-only',
  },
]

export const LANDING_PULSE_PAYLOAD = {
  login: 'xqc',
  isLive: true,
  tracking: true,
  streamId: '319999888777',
  startedAt: '2026-07-07T20:00:00.000Z',
  title: 'Just Chatting',
  category: 'Just Chatting',
  peakViewers: 23900,
  currentOffsetSeconds: 3540,
  coverageStartOffsetSeconds: 102,
  viewerStartOffsetSeconds: 0,
  coverage: {
    state: 'partial_tracking',
    coverageStartOffsetSeconds: 102,
    coverageEndOffsetSeconds: 3540,
    hasFullStreamCoverage: false,
    trackedFromStart: false,
    hasGaps: false,
    canBackfill: false,
    chatSource: 'irc',
    chatSourceDetail: 'live rollups',
    copyKey: 'live_window',
    message: 'Live chat and emote rollups update each minute with honest coverage windows.',
  },
  topEmotes: EMOTE_CATALOG,
  rollups,
  lanes: {
    composite: rollups.map(r => r.chatCount + (r.sevenTvEmoteCount ?? 0)),
    chat: rollups.map(r => r.chatCount),
    seventv: rollups.map(r => r.sevenTvEmoteCount ?? 0),
    viewers: rollups.map(r => r.viewerCount ?? 0),
  },
  peaks: LANDING_PEAKS,
  recap: null,
  games: [{ gameName: 'Just Chatting', offsetSeconds: 0, durationSeconds: 3540 }],
  emoteSync: { state: 'ready', provider: '7TV' },
  rosterEligible: true,
  top500Eligible: true,
} as LandingPulsePayload

export function loadLandingPulseFixture(): LandingPulsePayload {
  return structuredClone(LANDING_PULSE_PAYLOAD)
}

export function isLandingPulsePayload(value: unknown): value is LandingPulsePayload {
  if (!value || typeof value !== 'object') return false
  const payload = value as LandingPulsePayload
  return typeof payload.login === 'string' && Array.isArray(payload.rollups)
}
