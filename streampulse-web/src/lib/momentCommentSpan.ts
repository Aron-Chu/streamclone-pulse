import type { MomentFeedback } from './momentFeedback'

/**
 * The clock the comment span reads while a stream is live. A seam so tests
 * can fix it; the page never sets it.
 */
let clock: () => number = () => Date.now()
export function momentNow(): number { return clock() }
export function setMomentNowForTests(next: (() => number) | null): void { clock = next ?? (() => Date.now()) }

export interface CommentSpan { from: number; to: number }

const SECOND = 1000
const wholeUp = (ms: number) => Math.ceil(ms / SECOND) * SECOND
const wholeDown = (ms: number) => Math.floor(ms / SECOND) * SECOND

/**
 * The seconds a comment may sit at, in ms, both ends included (R85, R91): from
 * the later of the window's start and the stream's start (rounded up to a whole
 * second), to the earlier of the window's last whole second (its end is
 * exclusive) and the stream's end, or `nowMs` while it is live (rounded down).
 * A span that would run backwards (a live minute and a slow clock) is its
 * lower bound alone. It sits inside the backend's accepted span.
 */
export function commentSpan(feedback: Pick<MomentFeedback, 'window' | 'stream'>, nowMs: number): CommentSpan {
  const windowFrom = Date.parse(feedback.window.from)
  const windowTo = Date.parse(feedback.window.to)
  const started = Date.parse(feedback.stream.startedAt)
  const from = Math.max(windowFrom, Number.isFinite(started) ? wholeUp(started) : windowFrom)
  const ended = feedback.stream.endedAt === null ? nowMs : Date.parse(feedback.stream.endedAt)
  const upper = Number.isFinite(ended) ? Math.min(windowTo - SECOND, wholeDown(ended)) : windowTo - SECOND
  return { from, to: Math.max(from, upper) }
}

/** `ms` moved to the nearest end of the span when it is outside it. */
export const clampToSpan = (ms: number, span: CommentSpan): number => Math.min(span.to, Math.max(span.from, ms))
