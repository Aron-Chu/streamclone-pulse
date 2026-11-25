import { isEmoteName, type EmoteName } from './brainchatEmotes'

/**
 * Made-up data for the /brainchat demo. Nothing here is a real stream, chatter
 * or emote, and no chatter has a name. The stream line and every moment's chat
 * lines come from one seeded generator, and every count the demo shows (lines,
 * people, the busiest 10 s, usual pace, the top emote) is computed from those
 * lines, so no number can disagree with another.
 */

export const BIN_SECONDS = 10
/** A moment's window: the 3 bins before its peak bin and the 8 from it, 120 s in all. */
export const WINDOW_BINS_BEFORE = 3
export const WINDOW_BINS = 12
export const WINDOW_SECONDS = WINDOW_BINS * BIN_SECONDS
/** The replay plays the 120 s window in 15 s. */
export const REPLAY_SPEED = 8
export const STREAM_SECONDS = 3 * 3600 + 10 * 60
export const STREAM_TITLE = 'Speedrun night'

/** A face shows only when its emote is in at least 10% of the window's lines and was sent by at least 5 people. */
const FACE_MIN_SHARE = 0.1
const FACE_MIN_PEOPLE = 5
const SECOND_LINE_CHANCE = 0.15
const LULL_BINS = 14
const LULL_SCALE = 0.15
const SEED = 0x5b7a3c19

export type Doing = 'laughing' | 'cheering' | 'shocked' | 'tense' | 'asking' | 'complaining'

interface MomentSpec {
  /** Stream seconds of the moment's anchor. */
  at: number
  /** Generator input only: the people chatting in the anchor's 10 s. What the demo shows is counted. */
  peak: number
  /** null: BrainChat is not sure what chat was doing. */
  doing: Doing | null
  about: string
  aimedAt: string
  felt: string
  spread: string
  notSure?: string
  /** Chat goes quiet around this moment (the stream line dips) before its small bump. */
  lull?: boolean
  talk: readonly string[]
}

/** What chat says when nothing in particular is happening. */
const BACKGROUND: readonly string[] = [
  'this split is clean', 'o7', 'first time catching this run', 'what category is this', 'how many resets so far',
  ':calmBlob:', 'music is good today', 'hydrate', 'chat is cozy tonight', 'good luck on the run', 'is this the new route',
  ':calmBlob: :calmBlob:', 'what time is it there', 'nice pace so far',
]

const SPECS: readonly MomentSpec[] = [
  {
    at: 1102, peak: 46, doing: 'laughing', about: 'Laughing at a missed jump', aimedAt: 'the streamer', felt: 'amused', spread: 'repeated emotes',
    talk: ['LMAO', ':lolBlob:', ':lolBlob: :lolBlob:', 'he missed it by a mile', 'that jump :lolBlob:', 'clip that', 'never living that down', 'the confidence :lolBlob:', 'lol', 'reset incoming :lolBlob:'],
  },
  {
    at: 2465, peak: 64, doing: 'shocked', about: 'Stunned by a surprise boss phase', aimedAt: 'the game', felt: 'stunned', spread: 'separate messages',
    talk: ['WHAT', ':shockBlob:', ':shockBlob: :shockBlob:', 'where did that come from', 'a second phase??', 'no shot', 'that was not in the guide', 'chat did you know about this', 'WHAT :shockBlob:'],
  },
  {
    at: 3768, peak: 31, doing: 'asking', about: 'Asking about the stream audio', aimedAt: 'a tech problem', felt: 'puzzled', spread: 'separate messages',
    talk: ['is the audio cutting out?', 'mic is really quiet', 'game sound gone?', ':tiltBlob:', 'fine for me', 'audio?', 'refresh fixed it for me', 'stream lagging or just me', 'can hear the game but not you'],
  },
  {
    at: 5047, peak: 83, doing: 'cheering', about: 'Cheering a clutch play', aimedAt: 'the streamer', felt: 'excited', spread: 'chant',
    talk: ['LETS GO :hypeBlob:', ':hypeBlob: :hypeBlob: :hypeBlob:', 'CLUTCH', 'NO WAY', 'he actually did it', 'first try??', ':hypeBlob:', 'LETS GO', 'that was insane', 'hands of steel', 'GG :clapBlob:'],
  },
  {
    at: 5512, peak: 6, lull: true, doing: null, about: 'Not sure', aimedAt: 'unclear', felt: 'unclear', spread: 'few posters', notSure: 'Too few messages to tell.',
    talk: ['?', 'what happened', 'lol', 'huh', 'wait what', 'o7', 'missed it', ':calmBlob:'],
  },
  {
    at: 7110, peak: 52, doing: 'laughing', about: 'Laughing at a joke in chat', aimedAt: 'chat itself', felt: 'amused', spread: 'back and forth',
    talk: [':lolBlob: chat', 'who wrote that', 'chat is on one today', ':lolBlob:', 'the timing :lolBlob:', 'I cant with this chat', 'mods save us :lolBlob:', 'LMAO chat'],
  },
  {
    at: 8414, peak: 58, doing: 'tense', about: 'Tense during a close fight', aimedAt: 'the game', felt: 'nervous', spread: 'separate messages',
    talk: ['careful', 'heal heal heal', ':tiltBlob:', 'my heart', 'dont panic', 'one hit left', ':tiltBlob: :tiltBlob:', 'breathe', 'this fight again'],
  },
  {
    at: 9460, peak: 49, doing: 'complaining', about: 'Complaining about a risky route', aimedAt: 'the streamer', felt: 'annoyed, half joking', spread: 'back and forth',
    talk: ['why that route', 'the safe strat was right there', ':saltBlob:', 'every single time', ':saltBlob: :saltBlob:', 'he never listens', 'called it', 'risky for no reason', 'chat told you'],
  },
  {
    at: 10685, peak: 71, doing: 'cheering', about: 'Cheering the end of the run', aimedAt: 'the streamer', felt: 'proud', spread: 'repeated emotes',
    talk: ['GG', ':clapBlob: :clapBlob:', 'what a run', ':heartBlob:', 'earned it', 'GG :clapBlob:', ':clapBlob:', 'proud of you', 'personal best!!', 'GG GG GG'],
  },
]

/** How a moment's bump rises and fades, by bins from its peak bin. */
const SHAPE: Readonly<Record<number, number>> = {
  [-3]: 0.04, [-2]: 0.1, [-1]: 0.28, 0: 1, 1: 0.84, 2: 0.66, 3: 0.5, 4: 0.38, 5: 0.29, 6: 0.22, 7: 0.16, 8: 0.11, 9: 0.07, 10: 0.04,
}

export interface ChatLine {
  /** Seconds from the window's start. */
  t: number
  /** An anonymous chatter number inside this window, used only for the dot colour. */
  who: number
  text: string
}

export interface MomentFace {
  name: EmoteName
  /** Lines in the window that use it (each line once). */
  lines: number
  /** People who sent it. */
  people: number
}

export interface DemoMoment {
  n: number
  at: number
  doing: Doing | null
  about: string
  aimedAt: string
  felt: string
  spread: string
  notSure: string | null
  /** Stream seconds where the 120 s window starts. */
  windowStart: number
  /** People chatting in each 10 s of the window. */
  bins: number[]
  lines: ChatLine[]
  people: number
  /** People chatting in the window's busiest 10 s, and where that 10 s starts. */
  busiest: number
  busiestAt: number
  /** busiest ÷ usual pace, to one decimal. */
  pace: number
  face: MomentFace | null
  /** The lines said most often in the window, most first (each exact text counted). */
  saidMost: SaidLine[]
}

export interface SaidLine {
  text: string
  /** Lines with exactly this text. */
  lines: number
}

export interface DemoQuestion {
  id: string
  label: string
  /** The word the steps line uses for what it looked for. */
  marked: string
  match: (moment: DemoMoment) => boolean
}

export interface DemoAnswer {
  matches: DemoMoment[]
  leftOut: DemoMoment[]
  steps: string
  lead: string
}

function mulberry32(seed: number): () => number {
  let state = seed | 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/** The emote names a line uses, each once. */
export function emotesIn(text: string): EmoteName[] {
  const found = new Set<EmoteName>()
  for (const match of text.matchAll(/:([A-Za-z]+):/g)) {
    const name = match[1]!
    if (isEmoteName(name)) found.add(name)
  }
  return [...found]
}

export type TalkPart = { kind: 'text'; text: string } | { kind: 'emote'; name: EmoteName }

/** Splits a chat line into words and emotes for drawing. */
export function parseTalk(text: string): TalkPart[] {
  const parts: TalkPart[] = []
  let last = 0
  for (const match of text.matchAll(/:([A-Za-z]+):/g)) {
    const name = match[1]!
    if (!isEmoteName(name)) continue
    const start = match.index ?? 0
    if (start > last) parts.push({ kind: 'text', text: text.slice(last, start) })
    parts.push({ kind: 'emote', name })
    last = start + match[0].length
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) })
  return parts
}

/** The emote in the most lines; ties go to more people, then to the first seen. Null below the minimum. */
export function topFace(lines: readonly ChatLine[]): MomentFace | null {
  const tally = new Map<EmoteName, { lines: number; people: Set<number>; first: number }>()
  lines.forEach((line, index) => {
    for (const name of emotesIn(line.text)) {
      const entry = tally.get(name) ?? { lines: 0, people: new Set<number>(), first: index }
      entry.lines += 1
      entry.people.add(line.who)
      tally.set(name, entry)
    }
  })
  let best: { name: EmoteName; lines: number; people: number; first: number } | null = null
  for (const [name, entry] of tally) {
    const candidate = { name, lines: entry.lines, people: entry.people.size, first: entry.first }
    if (!best
      || candidate.lines > best.lines
      || (candidate.lines === best.lines && candidate.people > best.people)
      || (candidate.lines === best.lines && candidate.people === best.people && candidate.first < best.first)) {
      best = candidate
    }
  }
  if (!best || best.lines < lines.length * FACE_MIN_SHARE || best.people < FACE_MIN_PEOPLE) return null
  return { name: best.name, lines: best.lines, people: best.people }
}

const SAID_MOST_COUNT = 3

/** The texts in the most lines; ties go to the first said. */
export function saidMost(lines: readonly ChatLine[], count: number): SaidLine[] {
  const tally = new Map<string, number>()
  for (const line of lines) tally.set(line.text, (tally.get(line.text) ?? 0) + 1)
  return [...tally.entries()]
    .map(([text, n]) => ({ text, lines: n }))
    .sort((a, b) => b.lines - a.lines)
    .slice(0, count)
}

function buildDemo() {
  const rand = mulberry32(SEED)
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(rand() * list.length)]!
  const binCount = Math.ceil(STREAM_SECONDS / BIN_SECONDS)

  const series = Array.from({ length: binCount }, (_, i) =>
    Math.max(6, Math.round(13 + 4 * Math.sin(i / 41) + 2.5 * Math.sin(i / 9.7 + 1) + (rand() - 0.5) * 5)))
  for (const spec of SPECS) {
    if (!spec.lull) continue
    const anchorBin = Math.floor(spec.at / BIN_SECONDS)
    for (let i = Math.max(0, anchorBin - LULL_BINS); i <= Math.min(binCount - 1, anchorBin + LULL_BINS); i += 1) {
      series[i] = Math.max(2, Math.round(series[i]! * LULL_SCALE))
    }
  }
  for (const spec of SPECS) {
    const anchorBin = Math.floor(spec.at / BIN_SECONDS)
    for (const [offset, weight] of Object.entries(SHAPE)) {
      const i = anchorBin + Number(offset)
      if (i < 0 || i >= binCount) continue
      series[i] = Math.max(series[i]!, Math.round(series[i]! + (spec.peak - series[i]!) * weight))
    }
  }
  const usual = median(series)

  const moments: DemoMoment[] = SPECS.map((spec, index) => {
    const anchorBin = Math.floor(spec.at / BIN_SECONDS)
    const firstBin = anchorBin - WINDOW_BINS_BEFORE
    const bins = series.slice(firstBin, firstBin + WINDOW_BINS)
    const pool = Math.ceil(Math.max(...bins) * 1.7)
    const lines: ChatLine[] = []
    bins.forEach((people, j) => {
      // `people` different chatters speak in this 10 s; a few say a second line.
      const chatters = Array.from({ length: pool }, (_, k) => k)
      for (let k = 0; k < people; k += 1) {
        const swap = k + Math.floor(rand() * (pool - k))
        ;[chatters[k], chatters[swap]] = [chatters[swap]!, chatters[k]!]
      }
      const momentChance = j < WINDOW_BINS_BEFORE ? 0.15 : 0.95 - 0.06 * (j - WINDOW_BINS_BEFORE)
      for (const who of chatters.slice(0, people)) {
        const count = rand() < SECOND_LINE_CHANCE ? 2 : 1
        for (let c = 0; c < count; c += 1) {
          const text = rand() < momentChance ? pick(spec.talk) : pick(BACKGROUND)
          lines.push({ t: j * BIN_SECONDS + rand() * BIN_SECONDS, who, text })
        }
      }
    })
    lines.sort((a, b) => a.t - b.t)

    const busiest = Math.max(...bins)
    const busiestIndex = bins.indexOf(busiest)
    return {
      n: index + 1,
      at: spec.at,
      doing: spec.doing,
      about: spec.about,
      aimedAt: spec.aimedAt,
      felt: spec.felt,
      spread: spec.spread,
      notSure: spec.notSure ?? null,
      windowStart: firstBin * BIN_SECONDS,
      bins,
      lines,
      people: new Set(lines.map(line => line.who)).size,
      busiest,
      busiestAt: (firstBin + busiestIndex) * BIN_SECONDS,
      pace: Math.round((busiest / usual) * 10) / 10,
      face: spec.doing === null ? null : topFace(lines),
      saidMost: saidMost(lines, SAID_MOST_COUNT),
    }
  })

  const busiestThree = [...moments]
    .sort((a, b) => b.busiest - a.busiest || a.at - b.at)
    .slice(0, 3)
    .map(moment => moment.n)

  return { series, usual, moments, busiestThree }
}

export const DEMO = buildDemo()

export const QUESTIONS: readonly DemoQuestion[] = [
  { id: 'laughed', label: 'Where did chat laugh?', marked: 'laughing', match: m => m.doing === 'laughing' },
  { id: 'tense', label: 'When was chat tense or shocked?', marked: 'tense or shocked', match: m => m.doing === 'tense' || m.doing === 'shocked' },
  { id: 'streamer', label: 'Did chat turn on the streamer?', marked: 'complaining about the streamer', match: m => m.doing === 'complaining' && m.aimedAt === 'the streamer' },
]

export function answerQuestion(question: DemoQuestion, moments: readonly DemoMoment[] = DEMO.moments): DemoAnswer {
  const leftOut = moments.filter(m => m.doing === null)
  const matches = moments.filter(m => m.doing !== null && question.match(m))
  const k = matches.length
  return {
    matches,
    leftOut,
    steps: `Read ${moments.length} moments · ${k} marked ${question.marked}`,
    lead: k === 0 ? 'No moment matched.' : `${k} of ${moments.length} moments`,
  }
}

/** 5047 -> "1:24:07"; 42 -> "0:00:42". */
export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  const h = Math.floor(whole / 3600)
  const m = Math.floor((whole % 3600) / 60)
  const s = whole % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** 11400 -> "3 h 10 m". */
export function formatLength(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return h ? `${h} h ${m} m` : `${m} m`
}

/** 5.5 -> "5.5×"; 6 -> "6×". */
export function formatPace(pace: number): string {
  return `${Number.isInteger(pace) ? pace : pace.toFixed(1)}×`
}
