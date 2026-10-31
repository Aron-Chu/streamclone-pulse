/**
 * The hub activity readout row (`.lr`, d3-v2 hub.html #lr): the hub's lead
 * figures at rest ("Now": the newest closed bucket and the window peaks) and
 * the hovered bar while the pointer or the keyboard cursor is on one. It never
 * shows the selected bar; the bucket card holds the selection (plan §1.4).
 *
 * Values are the served bucket totals over the bucket length (per minute) and
 * the max over the served points. Nothing here scores or estimates.
 */
import { useSyncExternalStore, type ReactNode } from 'react'
import type { SpBar, SpHoverStore } from '@streampulse/pulse-charts/spchart'
import type { HubBucketEmote } from '../../../lib/publicHub'
import { emoteDisplaySrc } from '../../../lib/emoteAssetUrl'
import { formatHubCardInt, hubCardClock, hubCardClockRange } from '../../../lib/hubBucketCardModel'
import { barTopEmotes, barViewerChannels, emotesLowerBoundIn, sortedTopEmotes, type HubActivitySpModel } from './hubActivitySpModel'

export type HubReadoutSeries = { chat: boolean; emotes: boolean; viewers: boolean }

export interface HubReadoutPeak {
  value: string
  at: string
}

export interface HubReadoutView {
  mode: 'now' | 'hover'
  time: string
  time2: string
  chat: string
  chatPeak: HubReadoutPeak | null
  emotes: string
  emotesPeak: HubReadoutPeak | null
  viewers: string
  /** "N live" (≈ when it is a mean over several buckets), or ''. */
  live: string
  viewers2: string
  top: HubBucketEmote[]
  top2: string
}

/** A leading "≥" when the figure is only a minimum (plan §1.5; the card's mark). */
const atLeast = (lowerBound: boolean, text: string) => (lowerBound && text !== '—' ? `≥${text}` : text)

const dateShort = (ms: number) => new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' })

function liveText(live: number, approximate: boolean): string {
  return `${approximate ? '≈' : ''}${formatHubCardInt(live)} live`
}

/** What the row shows at rest (bar null) or over a bar. `saved`: a saved copy is on screen, so the rest time says "Saved", not "Now" (S1, 10-28). */
export function hubReadoutView(model: HubActivitySpModel, bar: SpBar | null, saved = false): HubReadoutView | null {
  if (bar) {
    const channels = barViewerChannels(model, bar.fromIndex, bar.toIndex)
    const top = barTopEmotes(model, bar.fromIndex, bar.toIndex, 3)
    return {
      mode: 'hover',
      time: hubCardClockRange(bar.startMs, bar.endMs),
      time2: dateShort(bar.startMs),
      chat: formatHubCardInt(bar.chat),
      chatPeak: null,
      emotes: atLeast(emotesLowerBoundIn(model, bar.fromIndex, bar.toIndex), formatHubCardInt(bar.emotes)),
      emotesPeak: null,
      viewers: formatHubCardInt(bar.viewers),
      live: channels ? liveText(channels.live, channels.members > 1) : '',
      viewers2: bar.viewers == null ? 'Not a full sample' : '',
      top,
      top2: top.map((emote) => emote.name).join(' · '),
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
    live: latest.live != null ? liveText(latest.live, false) : '',
    viewers2: pv ? `peak ${formatHubCardInt(pv.value)} · ${hubCardClock(pv.t)}${pv.live != null ? ` · ${formatHubCardInt(pv.live)} live` : ''}` : '',
    top: topEmote && topEmote.count > 0 ? [topEmote] : [],
    top2: 'top emote',
  }
}

function emoteImage(emote: HubBucketEmote, emoteImages?: ReadonlyMap<string, string> | null): ReactNode {
  const src = emoteDisplaySrc(emote.imageUrl || emoteImages?.get(emote.name.toLowerCase()), 24)
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
}

const noHit = () => null

export function HubActivityReadout({ model, hover, series, emoteImages, saved = false }: HubActivityReadoutProps) {
  const hit = useSyncExternalStore(hover.subscribe, hover.get, noHit)
  const view = hubReadoutView(model, hit?.bar ?? null, saved)
  if (!view) return <div className="lr hx-chart-header__readout" data-hub-readout="" aria-hidden="true" />
  const slot = (key: keyof HubReadoutSeries) => (series[key] ? 'slot' : 'slot off')
  const single = view.mode === 'now' ? view.top[0] : null
  return (
    <div className="lr hx-chart-header__readout" data-hub-readout="" data-hub-readout-mode={view.mode} aria-live="polite" aria-atomic="true">
      <div className="slot tm">
        <span className="l1">{view.time}</span>
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
