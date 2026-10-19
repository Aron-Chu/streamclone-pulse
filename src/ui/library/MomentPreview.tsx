import { useEffect, useId, useRef, useState, type MouseEvent } from 'react'
import { LibraryDialog } from './LibraryPrimitives.tsx'
import { replayUrl, timestamp, type LibraryMoment, type MomentReference } from './model.ts'
import { safePresentationUrl, type MomentPresentation } from './MomentMedia.tsx'
import { EmoteArtwork, MomentStats, MomentEmotes } from './MomentStats.tsx'
import { CLIP_LENGTHS, CLIP_NUDGE_SECONDS, centreClipWindow, clipOnTwitchUrl, defaultClipWindow, nudgeClipWindow, resizeClipWindow, type ClipWindow } from './clipWindow.ts'

/** Display-only backend projection. This view never derives a Pulse score or sentiment. */
export interface MomentContext {
  provenance: 'fixture' | 'snapshot'
  capturedAt: number
  /** Broadcast start (epoch ms), when known: dates the moment and places it inside its minute. */
  streamStartedAt?: number
  coverage: 'complete' | 'partial'
  windowLabel: string
  samples: readonly { offsetSeconds: number; messages: number | null }[]
  selectedMessages: number | null
  selectedEmotes: number | null
  selectedViewers?: number | null
  topEmotes: readonly { name: string; count: number; provider?: '7TV' | 'Twitch' | 'BTTV' | 'FFZ'; staticImageUrl?: string }[]
}
export type MomentContextState =
  | { kind: 'ready'; value: MomentContext }
  | { kind: 'loading' }
  | { kind: 'unavailable'; reason: string }

/** Minutes either side of the moment on Preview's chart. */
const SPAN = 10
const BARS = 2 * SPAN + 1
// The chart's drawing box in viewBox units: bars stand on BOTTOM, axis labels sit below it.
const W = 480, H = 94, TOP = 8, BOTTOM = 78
const BAR = W / BARS

const validSeconds = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
const clock = (seconds: number) => timestamp(Math.max(0, seconds)).slice(0, 5)

/**
 * Chat per minute for the 21 minutes around the moment, from the context's
 * consecutive samples. Offsets before the stream start clamp to 0, so the
 * minutes are counted back from the last sample. A gap stays null, never zero.
 */
function minutesAround(context: MomentContext, seconds: number): (number | null)[] {
  const values: (number | null)[] = Array.from({ length: BARS }, () => null)
  const samples = context.samples
  const last = samples[samples.length - 1]
  if (!last) return values
  const lastMinute = Math.round((last.offsetSeconds - seconds) / 60)
  samples.forEach((sample, index) => {
    const minute = lastMinute - (samples.length - 1 - index)
    if (Math.abs(minute) <= SPAN && sample.messages !== null && Number.isFinite(sample.messages) && sample.messages >= 0) values[minute + SPAN] = sample.messages
  })
  return values
}

/** Where the moment falls inside its minute bar; the rollups bucket by wall-clock minute when the start is known. */
function minuteFraction(context: MomentContext, seconds: number): number {
  const start = context.streamStartedAt
  const at = (start !== undefined && Number.isFinite(start) ? Math.ceil(start / 1000) * 1000 : 0) + seconds * 1000
  return (at % 60_000 + 60_000) % 60_000 / 60_000
}

function streamDate(context: MomentContext | undefined, seconds: number | null): string | null {
  const start = context?.streamStartedAt
  if (start === undefined || !Number.isFinite(start) || seconds === null) return null
  const at = new Date(start + seconds * 1000)
  return at.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(at.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }) })
}

/** The frame saved with the bookmark, the minute's top emote over it. */
function SavedFrame({ moment, src, sampled, context, onError }: { moment: LibraryMoment; src: string; sampled: number; context?: MomentContext; onError: () => void }) {
  const top = context?.topEmotes[0]
  return <figure className="pl-around-frame">
    <img src={src} alt={`Saved frame from ${moment.channel} near ${timestamp(sampled)}`} decoding="async" referrerPolicy="no-referrer" onError={onError} />
    <span className="pl-around-pill"><i aria-hidden="true" />Saved frame · {timestamp(sampled)}</span>
    <figcaption className="pl-around-over">{top ? <>{top.staticImageUrl ? <EmoteArtwork emote={top} /> : null}<b>{top.name} ×{top.count.toLocaleString()}</b></> : null}
      <span>{timestamp(moment.offsetSeconds)}</span></figcaption>
  </figure>
}

/** Chat per minute ±10 min; in Clip, the window sits on it and a click moves it. */
function AroundChart({ context, seconds, clip, aside, onPick }: {
  context: MomentContext; seconds: number; clip: ClipWindow | null; aside: string | null; onPick: (seconds: number) => void
}) {
  const [hover, setHover] = useState<number | null>(null)
  const gradient = `pl-around-hot${useId().replace(/:/g, '')}`
  const values = minutesAround(context, seconds)
  const max = Math.max(1, ...values.map(value => value ?? 0))
  const momentX = (SPAN + minuteFraction(context, seconds)) * BAR
  const x = (at: number) => Math.max(0, Math.min(W, momentX + (at - seconds) / 60 * BAR))
  const pointer = (event: MouseEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    return box.width > 0 ? Math.max(0, Math.min(W - 0.001, (event.clientX - box.left) / box.width * W)) : null
  }
  const minute = hover === null ? null : hover - SPAN
  const hovered = hover === null ? null : values[hover]
  // A minute wholly before the stream started has nothing to read.
  const readout = minute !== null && seconds + (minute + 1) * 60 > 0
    ? <><b>{clock(seconds + minute * 60)}</b> · {hovered === null ? 'not measured' : `${hovered.toLocaleString()} chat`}{minute === 0 ? ' · the moment' : ''}</>
    : clip ? <><b>{timestamp(clip.start)} → {timestamp(clip.start + clip.length)}</b> · click to move</> : 'Chat per minute · hover a minute'
  return <div className={`pl-around-chart${clip ? ' pl-around-clipping' : ''}`}>
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Chat per minute, 10 minutes either side of the moment"
      onMouseMove={event => { const at = pointer(event); setHover(at === null ? null : Math.floor(at / BAR)) }}
      onMouseLeave={() => setHover(null)}
      onClick={clip ? event => { const at = pointer(event); if (at !== null) onPick(seconds + (at - momentX) / BAR * 60) } : undefined}>
      <defs><linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#f0abfc" /><stop offset="1" stopColor="#8b5cf6" /></linearGradient></defs>
      {values.map((value, index) => value === null ? null : <rect key={index} x={index * BAR + 2} y={BOTTOM - value / max * (BOTTOM - TOP)} width={BAR - 4} height={value / max * (BOTTOM - TOP)} rx="3"
        fill={index === SPAN ? `url(#${gradient})` : '#4c3f86'} data-minute={index - SPAN} />)}
      {clip ? <g className="pl-around-window">
        <rect x={x(clip.start)} y="2" width={x(clip.start + clip.length) - x(clip.start)} height={BOTTOM - 2} rx="5" fill="rgba(145,70,255,.22)" stroke="#a78bfa" strokeWidth="1.5" />
        <rect x={x(clip.start) - 3} y={BOTTOM / 2 - 10} width="6" height="20" rx="3" fill="#c4b5fd" />
        <rect x={x(clip.start + clip.length) - 3} y={BOTTOM / 2 - 10} width="6" height="20" rx="3" fill="#c4b5fd" />
      </g> : null}
      <line x1={momentX} x2={momentX} y1="0" y2={BOTTOM} stroke="#ff4f8b" strokeWidth="1.2" strokeDasharray="3 2" />
      {[-SPAN, 0, SPAN].map(offset => <text key={offset} x={(offset + SPAN + 0.5) * BAR} y={H} textAnchor="middle">{offset > 0 ? `+${offset}` : offset < 0 ? `−${-offset}` : '0'}</text>)}
    </svg>
    <p className="pl-around-read"><span>{readout}</span>{aside ? <span>{aside}</span> : null}</p>
  </div>
}

function BookmarkIcon({ filled }: { filled: boolean }) {
  return <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false"><path d="M6 3h12v18l-6-4-6 4z" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={filled ? 0 : 1.8} strokeLinejoin="round" /></svg>
}

/**
 * One screen: the saved frame, chat around the moment, the minute's numbers and
 * its top emotes. Clip picks a 30 or 60 s window and opens the VOD there; Twitch's
 * own Clip button makes the clip, so nothing is created or sent from here.
 */
export function MomentPreview({ moment, context, presentation, busy, error, removed = false, onClose, onSave, onRemove, onUndo, onOpenLink }: {
  moment: LibraryMoment; context?: MomentContextState; busy: boolean; error: string | null
  presentation?: MomentPresentation
  /** True right after this Preview removed the bookmark, until Undo or close. */
  removed?: boolean
  onClose: () => void; onSave: (reference: MomentReference) => void; onOpenLink: () => void
  onRemove?: (moment: LibraryMoment) => void; onUndo?: () => void
}) {
  const [clip, setClipWindow] = useState<ClipWindow | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [failedFrame, setFailedFrame] = useState<string | null>(null)
  const clipButton = useRef<HTMLButtonElement>(null)
  const clipLink = useRef<HTMLAnchorElement>(null)
  // Entering or leaving Clip swaps the buttons; keep keyboard focus on the new row.
  const focusNext = useRef<'clip' | 'link' | null>(null)
  useEffect(() => {
    const target = focusNext.current; focusNext.current = null
    if (target) (target === 'link' ? clipLink.current : clipButton.current)?.focus()
  })
  const id = useId()
  const data = context?.kind === 'ready' ? context.value : undefined
  const seconds = validSeconds(moment.offsetSeconds) ? moment.offsetSeconds : null
  const watch = replayUrl(moment)
  // Same gate as Watch: a resolved numeric VOD id and a real position.
  const canClip = watch !== null && seconds !== null
  const clipUrl = clip ? clipOnTwitchUrl(moment.vodId, clip) : null
  const analysisUrl = safePresentationUrl(presentation?.analysisUrl)
  const saved = moment.savedAt !== undefined
  // Without a usable frame the whole picture block is left out.
  const frame = safePresentationUrl(presentation?.image?.url)
  const sampled = presentation?.image?.sampledOffsetSeconds
  const framed = !!frame && failedFrame !== frame && validSeconds(sampled)
  const top = data?.topEmotes[0]
  const setClip = (next: ClipWindow | null) => { setClipWindow(next); setCopied(null) }
  async function copy() {
    if (!clipUrl) return
    try { await navigator.clipboard.writeText(clipUrl); setCopied('Link copied.') }
    catch { setCopied('Could not copy. Clip on Twitch opens the same link.') }
  }
  return <LibraryDialog title="Moment preview" bare className="pl-around" onClose={onClose} canClose={!busy}>
    <header className="pl-around-head">
      <div><small>{[moment.channel, streamDate(data, seconds), timestamp(moment.offsetSeconds)].filter(Boolean).join(' · ')}</small><h2>{moment.title}</h2>
        {data?.provenance === 'fixture' ? <p className="pl-muted">Illustrative analysis · fixture data</p> : null}</div>
      <div className="pl-around-icons">
        <button type="button" className={`pl-around-icon${saved ? ' pl-on' : ''}`} disabled={busy || (saved && !onRemove)} onClick={() => saved ? onRemove?.(moment) : onSave(moment)}
          aria-label={saved ? `Remove bookmark: ${moment.title}` : `Bookmark: ${moment.title}`} title={saved ? 'Remove bookmark' : 'Bookmark'}><BookmarkIcon filled={saved} /></button>
        <button type="button" className="pl-around-icon" disabled={busy} onClick={onClose} aria-label="Close Moment preview" title="Close">×</button>
      </div>
    </header>
    {removed && !saved ? <div className="pl-around-undo"><span role="status">Bookmark removed.</span>
      <button type="button" className="pl-button" disabled={busy || !onUndo} onClick={onUndo}>Undo</button></div> : null}
    {framed ? <SavedFrame moment={moment} src={frame} sampled={sampled} context={data} onError={() => setFailedFrame(frame)} /> : null}
    <div className="pl-around-body">
      {data && seconds !== null ? <AroundChart context={data} seconds={seconds} clip={clip}
        aside={!framed && top ? `${top.name} ×${top.count.toLocaleString()}` : null}
        onPick={at => setClip(clip ? centreClipWindow(clip, at) : null)} />
        : !data ? <p className="pl-muted" role="status">{context?.kind === 'loading' ? 'Moment stats are loading.' : 'Moment stats are unavailable; missing values are not zero.'}</p> : null}
      {clip ? <>
        <div className="pl-around-ctl">
          <p className="pl-around-start" role="status">{timestamp(clip.start)}<small>{clip.length} s</small></p>
          <div className="pl-around-segs">
            <span className="pl-around-seg" role="group" aria-label="Move the window">
              <button type="button" onClick={() => setClip(nudgeClipWindow(clip, -CLIP_NUDGE_SECONDS))}>−15 s</button>
              <button type="button" onClick={() => setClip(nudgeClipWindow(clip, CLIP_NUDGE_SECONDS))}>+15 s</button></span>
            <span className="pl-around-seg" role="group" aria-label="Clip length">{CLIP_LENGTHS.map(length =>
              <button key={length} type="button" aria-pressed={clip.length === length} onClick={() => setClip(resizeClipWindow(clip, length))}>{length} s</button>)}</span>
          </div>
        </div>
        <p className="pl-around-hint">Twitch makes the clip, up to 60 s.</p>
      </> : data ? <><MomentStats context={data} compact /><MomentEmotes context={data} compact /></> : null}
      {error ? <p className="pl-error" role="alert">{error}</p> : null}
      {clip && clipUrl ? <div className="pl-around-actions">
        <a ref={clipLink} className="pl-button pl-around-twitch" href={clipUrl} target="_blank" rel="noopener noreferrer">Clip on Twitch <span aria-hidden="true">↗</span></a>
        <button type="button" className="pl-button" onClick={() => void copy()}>Copy link</button>
        <button type="button" className="pl-button pl-around-ghost" onClick={() => { focusNext.current = 'clip'; setClip(null) }}>Cancel</button>
      </div> : <div className="pl-around-actions">
        {watch ? <a className="pl-button pl-primary" href={watch} target="_blank" rel="noopener noreferrer" onClick={onOpenLink}><span aria-hidden="true">{'▶︎'}</span> Watch</a>
          : <button type="button" className="pl-button" disabled aria-describedby={`${id}-watch-reason`}>Watch</button>}
        {canClip ? <button ref={clipButton} type="button" className="pl-button" onClick={() => { focusNext.current = 'link'; setClip(defaultClipWindow(seconds)) }}><span aria-hidden="true">{'✂︎'}</span> Clip</button> : null}
        {analysisUrl ? <a className="pl-button pl-around-ghost" href={analysisUrl} target="_blank" rel="noopener noreferrer">Analysis <span aria-hidden="true">↗</span></a> : null}
      </div>}
      {copied ? <p className="pl-muted" role="status">{copied}</p> : null}
      {!watch && !clip ? <p id={`${id}-watch-reason`} className="pl-muted">{moment.availability === 'unresolved' ? 'No verified archive link. This does not mean Twitch is still processing it.' : 'The source cannot currently be played.'}</p> : null}
    </div>
  </LibraryDialog>
}
