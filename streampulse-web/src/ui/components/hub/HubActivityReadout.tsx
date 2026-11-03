/**
 * The hub activity readout row (`.lr`, d3-v2 hub.html #lr): the hovered bar
 * while the pointer or the keyboard cursor is on one; at rest the locked bar
 * with its mark and "· locked" (R1, bar-lock board 2026-11-01), else the hub's
 * lead figures ("Now": the newest closed bucket and the window peaks). The bar
 * lock under the chart lists the locked bar's chats and emotes, not its numbers.
 *
 * Values are the served bucket totals over the bucket length (per minute) and
 * the max over the served points. Nothing here scores or estimates.
 */
import { useSyncExternalStore, type ReactNode } from 'react'
import type { SpBar, SpHoverStore } from '@streampulse/pulse-charts/spchart'
import type { HubBucketEmote } from '../../../lib/publicHub'
import { formatHubCardInt, hubCardClock, hubCardClockRange } from '../../../lib/hubBucketCardModel'
import { barTopEmotes, barViewerChannels, emotesLowerBoundIn, sortedTopEmotes, type HubActivitySpModel } from './hubActivitySpModel'

export type HubReadoutSeries = { chat: boolean; emotes: boolean; viewers: boolean }

export interface HubReadoutPeak {
  value: string
  at: string
}

export interface HubReadoutView {
  mode: 'now' | 'hover' | 'lock'
  time: string
  time2: string
  chat: string
  chatPeak: HubReadoutPeak | null
  emotes: string
  emotesPeak: HubReadoutPeak | null
  viewers: string
  /** "N of M live" (≈ when it is a mean over several buckets), or ''. */
  live: string
  viewers2: string
  top: HubBucketEmote[]
  top2: string
}

/** A leading "≥" when the figure is only a minimum (plan §1.5; the card's mark). */
const atLeast = (lowerBound: boolean, text: string) => (lowerBound && text !== '—' ? `≥${text}` : text)

const dateShort = (ms: number) => new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' })

function liveText(live: number, roster: number | null, approximate: boolean): string {
  return `${approximate ? '≈' : ''}${formatHubCardInt(live)}${roster != null ? ` of ${formatHubCardInt(roster)}` : ''} live`
}

/** The locked bar [startMs, endMs) and the chart's bar for it (null over a gap, which the chart draws no bar for). */
export interface HubReadoutLock {
  startMs: number
  endMs: number
  bar: SpBar | null
}

function barView(model: HubActivitySpModel, bar: SpBar, mode: 'hover' | 'lock'): HubReadoutView {
  const channels = barViewerChannels(model, bar.fromIndex, bar.toIndex)
  const top = barTopEmotes(model, bar.fromIndex, bar.toIndex, 3)
  return {
    mode,
    time: hubCardClockRange(bar.startMs, bar.endMs),
    time2: `${dateShort(bar.startMs)}${mode === 'lock' ? ' · locked' : ''}`,
    chat: formatHubCardInt(bar.chat),
    chatPeak: null,
    emotes: atLeast(emotesLowerBoundIn(model, bar.fromIndex, bar.toIndex), formatHubCardInt(bar.emotes)),
    emotesPeak: null,
    viewers: formatHubCardInt(bar.viewers),
    live: channels ? liveText(channels.live, channels.roster, channels.members > 1) : '',
    viewers2: bar.viewers == null ? 'Not a full sample' : '',
    top,
    top2: top.map((emote) => emote.name).join(' · '),
  }
}

/**
 * What the row shows over a bar, else at rest: the locked bar when there is one, else "Now". `saved`: a saved copy is
 * on screen, so the rest time says "Saved", not "Now" (S1, 10-28). Hovering the locked bar keeps its mark.
 */
export function hubReadoutView(model: HubActivitySpModel, bar: SpBar | null, saved = false, locked: HubReadoutLock | null = null): HubReadoutView | null {
  if (bar) return barView(model, bar, locked && bar.startMs === locked.startMs && bar.endMs === locked.endMs ? 'lock' : 'hover')
  if (locked?.bar) return barView(model, locked.bar, 'lock')
  if (locked) {
    // A bar the chart did not measure: its time, never zeros.
    return {
      mode: 'lock',
      time: hubCardClockRange(locked.startMs, locked.endMs),
      time2: `${dateShort(locked.startMs)} · locked`,
      chat: '—',
      chatPeak: null,
      emotes: '—',
      emotesPeak: null,
      viewers: '—',
      live: '',
      viewers2: 'Not measured',
      top: [],
      top2: '',
    }
  }
  const latest = model.latest
  if (!latest) return null
  const peak = (p: { value: number; t: number; index: number } | null, lowerBound = false): HubReadoutPeak | null =>
    p ? { value: atLeast(lowerBound && model.emotesLowerBound[p.index] === 1, formatHubCardInt(p.value)), at: hubCardClock(p.t) } : null
  const pv = model.peakViewers
  const topEmote = sortedTopEmotes(latest.point)[0]
  return {
    mode: 'now',
    time: saved ? 'Saved' : 'Now',
    time2: hubCardClockRange(latest.t, latest.t + model.bucketMs),
    chat: formatHubCardInt(latest.chat),
    chatPeak: peak(model.peakChat),
    emotes: atLeast(model.emotesLowerBound[latest.index] === 1, formatHubCardInt(latest.emotes)),
    emotesPeak: peak(model.peakEmotes, true),
    viewers: formatHubCardInt(latest.viewers),
    live: latest.live != null ? liveText(latest.live, latest.roster, false) : '',
    viewers2: pv ? `peak ${formatHubCardInt(pv.value)} · ${hubCardClock(pv.t)}${pv.live != null ? ` · ${formatHubCardInt(pv.live)} live` : ''}` : '',
    top: topEmote && topEmote.count > 0 ? [topEmote] : [],
    top2: 'top emote',
  }
}

function emoteImage(emote: HubBucketEmote, emoteImages?: ReadonlyMap<string, string> | null): ReactNode {
  const src = emote.imageUrl || emoteImages?.get(emote.name.toLowerCase())
  if (!src) return null
  return <img key={emote.name} src={src} alt={emote.name} width={24} height={24} decoding="async" referrerPolicy="no-referrer" />
}

function PeakLine({ peak }: { peak: HubReadoutPeak | null }) {
  if (!peak) return null
  return <>peak {peak.value}<span className="pt"> · {peak.at}</span></>
}

export interface HubActivityReadoutProps {
  model: HubActivitySpModel
  hover: SpHoverStore
  series: HubReadoutSeries
  emoteImages?: ReadonlyMap<string, string> | null
  /** A saved copy is on screen: the rest time reads "Saved". */
  saved?: boolean
  /** The locked bar, which the row holds at rest (R1). */
  locked?: HubReadoutLock | null
}

const noHit = () => null

export function HubActivityReadout({ model, hover, series, emoteImages, saved = false, locked = null }: HubActivityReadoutProps) {
  const hit = useSyncExternalStore(hover.subscribe, hover.get, noHit)
  const view = hubReadoutView(model, hit?.bar ?? null, saved, locked)
  if (!view) return <div className="lr hx-chart-header__readout" data-hub-readout="" aria-hidden="true" />
  const slot = (key: keyof HubReadoutSeries) => (series[key] ? 'slot' : 'slot off')
  const single = view.mode === 'now' ? view.top[0] : null
  // The lock's own status line says each lock and step, so the row stays quiet while it holds the locked bar.
  return (
    <div
      className="lr hx-chart-header__readout"
      data-hub-readout=""
      data-hub-readout-mode={view.mode}
      aria-live={view.mode === 'lock' ? 'off' : 'polite'}
      aria-atomic="true"
    >
      <div className="slot tm">
        <span className="l1">{view.mode === 'lock' ? <span><i className="mk" aria-hidden="true" />{view.time}</span> : view.time}</span>
        <span className="l2">{view.time2}</span>
      </div>
      <div className={slot('chat')} data-k="chat">
        <span className="l1"><span className="fig">{view.chat}</span><span className="u"><i className="sw chat" aria-hidden="true" />chat/min</span></span>
        <span className="l2"><PeakLine peak={view.chatPeak} /></span>
      </div>
      <div className={slot('emotes')} data-k="emotes">
        <span className="l1"><span className="fig">{view.emotes}</span><span className="u"><i className="sw emotes" aria-hidden="true" />emotes/min</span></span>
        <span className="l2"><PeakLine peak={view.emotesPeak} /></span>
      </div>
      <div className={slot('viewers')} data-k="viewers">
        <span className="l1">
          <span className="fig">{view.viewers}</span>
          <span className="u"><i className="sw viewers" aria-hidden="true" />viewers (sample)</span>
          {view.live ? <span className="u lv">{view.live}</span> : null}
        </span>
        <span className="l2">{view.viewers2}</span>
      </div>
      <div className="slot te">
        <span className="l1">
          {single ? (
            <>
              {emoteImage(single, emoteImages)}
              <span>{single.name}</span>
              <span className="t2">{formatHubCardInt(single.count)}</span>
            </>
          ) : view.top.length ? (
            view.top.map((emote) => emoteImage(emote, emoteImages))
          ) : (
            '—'
          )}
        </span>
        <span className="l2">{view.top2}</span>
      </div>
    </div>
  )
}
