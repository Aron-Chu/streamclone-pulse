import { LAND_S, OPEN_S } from './catStreamTimes'

/**
 * The front page's "beside Twitch chat" demo (board extension-brainchat 11-22, ★ E1 push-in): a Twitch-style page,
 * the stream on the left and the extension's column on the right, drawn in a 1280x800 world that the camera moves
 * over. Everything here is static: made-up names and lines, and the column pictures come from the extension's own
 * test harness on the made-up channel streampulse_demo.
 */

/** The world the stage scales: a 1280x800 Twitch page, the player on the left and the 340 px column at x 940. */
export const WORLD_W = 1280
export const WORLD_H = 800
export const PLAYER_W = 940
export const COL_W = 340
/** The column's middle, where the camera centres when it moves in. */
const COL_MID_X = PLAYER_W + COL_W / 2
/** With the camera in, the part of the column that shows (tabs, then the panel down to the Jump button). */
const SEEN_H = 458

/** The stage is never wider than the page's content column. */
export const STAGE_MAX_W = 1120
/** Below this width the stage takes the phone shape: taller than wide, the column across the screen. */
export const PHONE_BELOW = 600
const PHONE_MAX_H = 640
const CAPTION_MAX_W = 240
const CAPTION_MIN_W = 200
const CAPTION_GAP = 34

/** out: the whole page; in: on the column from its top; low: on the column from its bottom, where chat floods (phones). */
export type Cam = 'in' | 'out' | 'low'
/** translate x, translate y, scale */
export type CamPose = readonly [number, number, number]

export interface StageLayout {
  width: number
  height: number
  phone: boolean
  cam: Readonly<Record<Cam, CamPose>>
  /** Left edge and width of the caption beside the column, or null when it does not fit and shows under the stage. */
  capLeft: number | null
  capWidth: number
}

/** The stage's size and camera poses for the width it has. */
export function stageLayout(available: number): StageLayout {
  const width = Math.max(240, Math.round(Math.min(available, STAGE_MAX_W)))
  const phone = width < PHONE_BELOW
  const height = phone ? Math.round(Math.min((width * 560) / 358, PHONE_MAX_H)) : Math.round((width * 700) / 1120)
  const s0 = Math.min(width / WORLD_W, height / WORLD_H)
  // In, the column fills a phone's width; wider, it grows to about 1.5x at full size and always shows SEEN_H of it.
  const s1 = phone ? Math.min(width / COL_W, height / SEEN_H) : height / SEEN_H
  const cam = {
    out: [(width - WORLD_W * s0) / 2, (height - WORLD_H * s0) / 2, s0] as const,
    in: [width / 2 - COL_MID_X * s1, 0, s1] as const,
    low: [width / 2 - COL_MID_X * s1, Math.min(0, height - WORLD_H * s1), s1] as const,
  }
  const left = Math.round(width / 2 + (COL_W / 2) * s1 + CAPTION_GAP)
  const capWidth = Math.min(CAPTION_MAX_W, width - left - 12)
  const capLeft = !phone && capWidth >= CAPTION_MIN_W ? left : null
  return { width, height, phone, cam, capLeft, capWidth }
}

/**
 * The stream's drawing-buffer ratio: sharp at the size the player shows, never above 1.25. The player is at most
 * about 820 CSS px wide on screen, so 1.25 is about 1,175 px across, and the frame's grain hides the rest.
 */
export function sceneRatio(layout: StageLayout, devicePixelRatio: number): number {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1
  return Math.max(0.5, Math.min(dpr * layout.cam.out[2], 1.25))
}

export const BEATS = ['Chat goes wild', 'Pulse marks the spike', 'Top moments', 'Open one, press Jump', 'Lands just before it'] as const
export const CAPS = [
  'Something happens on stream and chat floods.',
  'Chat per minute jumps at 1:37:00, and the chart shows it.',
  'The biggest reactions of the stream, with the emotes chat used.',
  'Each moment opens a card: when it was and how chat reacted.',
  'The video jumps to a few seconds before the moment.',
] as const
export type Beat = 0 | 1 | 2 | 3 | 4

/**
 * The camera for each step. Wider stages: in on the column for steps 2-4, out on the whole page for the flood and the
 * jump. Phones stay in on the column (★ E1), at its foot for the chat flood, since the whole page would be too small.
 */
export function camFor(beat: Beat, phone = false): Cam {
  if (phone) return beat === 0 ? 'low' : 'in'
  return beat >= 1 && beat <= 3 ? 'in' : 'out'
}

/** How far the panel picture is scrolled at each step, in its own CSS px. */
export const SCROLL: readonly [number, number, number, number, number] = [0, 380, 830, 900, 900]
/** Where the pointer goes, in world px (the column's content starts at y 60). */
export const AT = {
  tab: [1173, 30],
  spike: [1124, 60 + 660 - 380],
  row: [1090, 60 + 950 - 830],
  jump: [1024, 60 + 1231 - 900],
  chat: [1100, 560],
} as const

/** The stream second the demo opens on, and where Jump lands. */
export const FROM_S = OPEN_S
export const TO_S = LAND_S

/** One run, in ms from its start. The video lands at `landed` and plays on through the moment at 1:37:00. */
export const TIMES = {
  chatFast: 900,
  chatFlood: 1500,
  camIn: 1900,
  pointerShows: 2700,
  tabClick: 3500,
  pulseOpens: 3750,
  toSpike: 4300,
  topMoments: 6200,
  rowClick: 7600,
  card: 7850,
  jumpClick: 9500,
  jumped: 9750,
  landed: 10250,
  loop: 19500,
} as const
export const MAX_LOOPS = 2
/** The clock runs from where the video was to 1:36:55 in this many steps of SCRUB_STEP_MS. */
export const SCRUB_STEPS = 16
export const SCRUB_STEP_MS = 55
/** Chat lines kept on screen. */
export const MAX_LINES = 21

export interface DemoChatLine {
  color: string
  name: string
  text: string
}

/** Chat before the can goes over. Made-up names. */
export const CALM: readonly DemoChatLine[] = [
  { color: '#94a3b8', name: 'quietfox', text: 'is he allowed up there' },
  { color: '#8ab4ff', name: 'kayto', text: 'what aisle is this' },
  { color: '#34d399', name: 'wisp', text: 'the cans are so lined up' },
  { color: '#fbbf24', name: 'lumen', text: 'dont do it' },
]

/** Chat once it has. */
export const FLOOD: readonly DemoChatLine[] = [
  { color: '#ff7fbf', name: 'pixelmoth', text: 'HE DID IT' },
  { color: '#8ab4ff', name: 'kayto', text: 'no way' },
  { color: '#34d399', name: 'gr4vy', text: 'LMAOOO' },
  { color: '#fbbf24', name: 'nub_irl', text: 'the can is gone' },
  { color: '#c4b5fd', name: 'zeph', text: 'eye contact the whole time' },
  { color: '#f87171', name: 'mochi_rae', text: 'NOT THE CANS' },
  { color: '#8ab4ff', name: 'kayto', text: 'he looked right at us' },
  { color: '#34d399', name: 'wisp', text: 'clip it' },
  { color: '#ff7fbf', name: 'pixelmoth', text: 'AGAIN AGAIN' },
  { color: '#fbbf24', name: 'lumen', text: 'cleanup on aisle 4' },
  { color: '#c4b5fd', name: 'zeph', text: 'zero remorse' },
  { color: '#f87171', name: 'arro', text: 'the pyramid is next' },
]

/** The chat a still first step shows: the calm lines, then the start of the flood. */
export function stillChat(maxLines: number = MAX_LINES): DemoChatLine[] {
  return [...CALM, ...FLOOD.slice(0, 9)].slice(-maxLines)
}
