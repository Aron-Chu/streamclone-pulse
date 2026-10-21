#!/usr/bin/env node
/**
 * Writes src/demo/demoTape.json: the made-up stream the /extension demo plays.
 *
 * Nothing here is recorded. The channel, title, per-minute numbers and moments
 * are generated from a fixed seed, so the file is the same on every run and
 * shows no real streamer or chat. Emotes are Twitch's global emotes (served
 * from Twitch's emote CDN, which the site CSP already allows).
 *
 * The output has the shape of GET /v1/extension/pulse/vods/{id}
 * (src/types/vodPulseTypes.ts), so the shipped panel reads it as it reads a
 * real past broadcast.
 *
 *   node scripts/generate-demo-tape.mjs           # write
 *   node scripts/generate-demo-tape.mjs --check   # fail if the file is stale
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(here, '../src/demo/demoTape.json')

export const DEMO_CHANNEL_LOGIN = 'pulse_demo_channel'
export const DEMO_CHANNEL_NAME = 'Pulse Demo Channel'
// Eighteen digits: far past any real Twitch video id, so it can never name one.
// DemoPanel also keeps the panel's Twitch links from leaving the page.
export const DEMO_VOD_ID = '900000000000000001'
export const DEMO_STREAM_ID = 'demo-stream-0001'

const BUCKET = 60
const DURATION = 3 * 60 * 60

/** Twitch global emotes: id, code. */
const EMOTES = {
  LUL: '425618',
  PogChamp: '305954156',
  Kappa: '25',
  Kreygasm: '41',
  NotLikeThis: '58765',
  BibleThump: '86',
  DansGame: '33',
  SeemsGood: '64138',
  WutFace: '28087',
  HeyGuys: '30259',
  ResidentSleeper: '245',
  '4Head': '354',
}

function emote(name, count) {
  const id = EMOTES[name]
  return {
    id: `twitch:${id}`,
    providerEmoteId: id,
    name,
    imageUrl: `https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/1.0`,
    count,
    provider: 'twitch',
  }
}

/** mulberry32: small, fixed-seed PRNG so the tape is reproducible. */
function prng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * The stream's story: a just-chatting opener, a game, a clutch win, a fail,
 * a sad moment, a raid. Each beat is a reaction that rises over a minute and
 * fades over a few.
 */
const BEATS = [
  { at: 9 * 60, lift: 1.6, reason: 'chat_spike', emotes: ['HeyGuys', 'SeemsGood', 'Kappa'] },
  { at: 31 * 60, lift: 2.4, reason: 'twitch_emote_spike', emotes: ['LUL', '4Head', 'Kappa'] },
  { at: 52 * 60, lift: 3.6, reason: 'twitch_emote_spike', emotes: ['PogChamp', 'Kreygasm', 'SeemsGood'] },
  { at: 74 * 60, lift: 2.1, reason: 'chat_spike', emotes: ['WutFace', 'DansGame', 'LUL'] },
  { at: 96 * 60, lift: 3.1, reason: 'twitch_emote_spike', emotes: ['NotLikeThis', 'LUL', 'DansGame'] },
  { at: 118 * 60, lift: 1.9, reason: 'chat_spike', emotes: ['BibleThump', 'NotLikeThis', 'SeemsGood'] },
  { at: 139 * 60, lift: 4.2, reason: 'twitch_emote_spike', emotes: ['PogChamp', 'LUL', 'Kreygasm'] },
  { at: 163 * 60, lift: 2.6, reason: 'viewer_spike', emotes: ['HeyGuys', 'PogChamp', 'SeemsGood'] },
]

export function buildDemoTape() {
  const random = prng(20261021)
  const points = []
  for (let offset = BUCKET; offset <= DURATION; offset += BUCKET) {
    const minute = offset / 60
    // Viewers climb for 40 minutes, hold, then ease off before the end.
    const ramp = Math.min(1, minute / 40)
    const fade = minute > 150 ? 1 - (minute - 150) / 120 : 1
    let viewers = (2400 + 7600 * ramp * ramp * (3 - 2 * ramp)) * fade
    viewers *= 0.97 + random() * 0.06
    let chat = viewers * 0.042 * (0.82 + random() * 0.36)
    let emoteShare = 0.3 + random() * 0.08
    let raid = 0
    let beat = null
    for (const b of BEATS) {
      const d = offset - b.at
      if (d < -60 || d > 300) continue
      // One minute up, then a fall over about four.
      const shape = d <= 0 ? 1 + d / 60 : Math.exp(-d / 110)
      chat *= 1 + (b.lift - 1) * shape
      emoteShare += 0.32 * shape
      if (b.reason === 'viewer_spike' && d >= 0) raid = Math.max(raid, 1800 * Math.exp(-d / 900))
      if (shape > 0.5) beat = b
    }
    viewers += raid
    const chatPerMin = Math.round(chat)
    const emotesPerMin = Math.round(chat * Math.min(0.92, emoteShare))
    const point = { offsetSeconds: offset, chatPerMin, emotesPerMin, viewers: Math.round(viewers) }
    if (beat) {
      point.topEmotes = beat.emotes.map((name, i) => emote(name, Math.round(emotesPerMin * [0.46, 0.21, 0.11][i])))
    }
    points.push(point)
  }

  const peakChat = Math.max(...points.map(p => p.chatPerMin))
  for (const point of points) point.score = Math.round((point.chatPerMin / peakChat) * 100)

  const topMoments = BEATS.map(b => {
    const apex = points.find(p => p.offsetSeconds === b.at)
    const onset = b.at - 40
    const score = apex.score
    return {
      offsetSeconds: b.at,
      label: b.reason === 'chat_spike' ? 'Chat spike' : b.reason === 'viewer_spike' ? 'Viewer spike' : 'Emote spike',
      reason: b.reason,
      score,
      compositeScore: score,
      reactionScore: score,
      reactionOnsetOffsetSeconds: onset,
      reactionApexOffsetSeconds: b.at - 8,
      seekOffsetSeconds: onset - 15,
      precisionSeconds: 10,
      refinementStatus: 'refined',
      chatPerMin: apex.chatPerMin,
      emotesPerMin: apex.emotesPerMin,
      topEmotes: apex.topEmotes,
    }
  }).sort((a, b) => b.score - a.score)

  const totals = new Map()
  for (const point of points) {
    for (const e of point.topEmotes ?? []) totals.set(e.name, (totals.get(e.name) ?? 0) + e.count)
  }
  for (const name of Object.keys(EMOTES)) totals.set(name, (totals.get(name) ?? 0) + 40 + Math.round(random() * 200))
  const topEmotes = [...totals]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => emote(name, count))

  return {
    mode: 'vod',
    vodId: DEMO_VOD_ID,
    streamId: DEMO_STREAM_ID,
    login: DEMO_CHANNEL_LOGIN,
    channelLogin: DEMO_CHANNEL_LOGIN,
    channelDisplayName: DEMO_CHANNEL_NAME,
    title: 'Sample stream: chatting, a co-op run and a raid at the end',
    startedAt: '2026-10-11T18:00:00.000Z',
    durationSeconds: DURATION,
    coverageStatus: 'ready',
    coverageMessage: 'Replay Pulse ready',
    resolutionState: 'vod_validated',
    retryable: false,
    timeline: { bucketSeconds: BUCKET, points },
    topMoments,
    topEmotes,
    games: [
      { gameName: 'Just Chatting', categoryId: '509658', offsetSeconds: 0, durationSeconds: 24 * 60 },
      { gameName: 'Minecraft', categoryId: '27471', offsetSeconds: 24 * 60, durationSeconds: DURATION - 24 * 60 },
    ],
  }
}

function serialize(tape) {
  return `${JSON.stringify(tape, null, 1)}\n`
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const next = serialize(buildDemoTape())
  if (process.argv.includes('--check')) {
    let current = ''
    try {
      current = readFileSync(OUT, 'utf8')
    } catch {
      // Missing counts as stale.
    }
    if (current.replace(/\r\n/g, '\n') !== next) {
      console.error('src/demo/demoTape.json is stale: run node scripts/generate-demo-tape.mjs')
      process.exit(1)
    }
    console.log('demoTape.json is current')
  } else {
    writeFileSync(OUT, next)
    console.log(`wrote ${OUT} (${next.length} bytes)`)
  }
}
