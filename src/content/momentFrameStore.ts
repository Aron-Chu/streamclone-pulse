/** One kept frame: the stream offset it shows and an object URL of its JPEG. */
export interface StoredFrame {
  offset: number
  url: string
  /** When it was captured (ms), for the rolling window. */
  at: number
}

export interface MomentFrameStoreOptions {
  /** Frames older than this are dropped unless a kept span covers them. */
  windowMs: number
  /** Most frames kept for spans; the oldest captures go first. */
  maxKept: number
  /** A new capture this close to a kept frame is skipped. */
  minGapSeconds: number
  revoke: (url: string) => void
  now: () => number
}

/** Index of the frame closest to `offset`, or -1 when there are none. Frames are sorted by offset. */
export function nearestFrameIndex(frames: readonly StoredFrame[], offset: number): number {
  let best = -1
  for (let index = 0; index < frames.length; index++) {
    if (best < 0 || Math.abs(frames[index]!.offset - offset) < Math.abs(frames[best]!.offset - offset)) best = index
  }
  return best
}

/**
 * Frames of what one stream's player showed, sorted by stream offset.
 *
 * Captures roll off after `windowMs` so a long watch costs a few hundred KB,
 * except frames inside a kept span (ranked moments), which stay until the
 * stream changes or `maxKept` pushes the oldest out. Moments surface a minute
 * or two after they happen, so the window must outlast that delay.
 */
export class MomentFrameStore {
  private frames: StoredFrame[] = []
  private spans: ReadonlyArray<readonly [number, number]> = []
  private readonly listeners = new Set<() => void>()
  private key: string | null = null

  constructor(private readonly options: MomentFrameStoreOptions) {}

  /** Frames belong to one stream; a different key drops them all. */
  useStream(key: string): void {
    if (key === this.key) return
    this.key = key
    this.clear()
  }

  has(offset: number): boolean {
    const index = nearestFrameIndex(this.frames, offset)
    return index >= 0 && Math.abs(this.frames[index]!.offset - offset) < this.options.minGapSeconds
  }

  add(offset: number, url: string): void {
    const frame = { offset, url, at: this.options.now() }
    const index = this.frames.findIndex(other => other.offset > offset)
    if (index < 0) this.frames.push(frame)
    else this.frames.splice(index, 0, frame)
    this.prune()
    this.emit()
  }

  keep(spans: ReadonlyArray<readonly [number, number]>): void {
    this.spans = spans
    if (this.prune()) this.emit()
  }

  inRange(from: number, to: number): StoredFrame[] {
    return this.frames.filter(frame => frame.offset >= from && frame.offset <= to)
  }

  get size(): number {
    return this.frames.length
  }

  clear(): void {
    if (this.frames.length === 0) return
    for (const frame of this.frames) this.options.revoke(frame.url)
    this.frames = []
    this.emit()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private kept(frame: StoredFrame): boolean {
    return this.spans.some(([from, to]) => frame.offset >= from && frame.offset <= to)
  }

  /** Drops expired and over-cap frames; true when any went. */
  private prune(): boolean {
    const cutoff = this.options.now() - this.options.windowMs
    const dropped = new Set<StoredFrame>()
    const kept = this.frames.filter(frame => {
      if (this.kept(frame)) return true
      if (frame.at < cutoff) dropped.add(frame)
      return false
    })
    for (const frame of [...kept].sort((a, b) => a.at - b.at).slice(0, Math.max(0, kept.length - this.options.maxKept))) {
      dropped.add(frame)
    }
    if (dropped.size === 0) return false
    for (const frame of dropped) this.options.revoke(frame.url)
    this.frames = this.frames.filter(frame => !dropped.has(frame))
    return true
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}
