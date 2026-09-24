import { useLayoutEffect, useMemo, useRef } from 'react'
import { useConsoleMotion } from '../../hooks/useConsoleMotion.ts'
import type { AnalyticsMinuteRollup, AnalyticsTopEmote, PulseRecapMoment } from '../../apiTypes.ts'
import type { ReplayHeatmapDetailPoint, ReplayHeatmapPoint } from '../../types/heatmap.ts'
import { buildSelectedMomentDisplay } from '../../utils/selectedMomentDisplay.ts'
import type { VodLinkState } from '../../utils/twitchVodUrl.ts'
import { count, getEmoteImageUrl } from '../../utils/consoleFormat.ts'
import { ConsoleEmoteImg } from './ConsoleEmoteImg.tsx'
import { minuteEmoteTotal } from './chartRollupUtils.ts'

export interface SelectedMomentCompactCardProps {
  rollup: AnalyticsMinuteRollup
  rollups: AnalyticsMinuteRollup[]
  startedAt?: string
  vodLinkState: VodLinkState
  topEmotesCatalog?: AnalyticsTopEmote[]
  heatmapPoint?: ReplayHeatmapPoint | null
  heatmapDetail?: ReplayHeatmapDetailPoint | null
  onOpenAnalytics?: () => void
  onClear?: () => void
  recapMoment?: PulseRecapMoment | null
  gameName?: string | null
  vodAlignSeconds?: number | null
  vodDurationSeconds?: number | null
}

/** Shared selection detail attached beneath the session chart. */
export function SelectedMomentCompactCard({
  rollup,
  rollups,
  startedAt,
  vodLinkState,
  topEmotesCatalog,
  heatmapPoint,
  heatmapDetail,
  onOpenAnalytics,
  onClear,
  recapMoment,
  gameName,
  vodAlignSeconds,
  vodDurationSeconds,
}: SelectedMomentCompactCardProps) {
  const stripRef = useRef<HTMLDivElement>(null)
  const { motionEnabled } = useConsoleMotion()
  useLayoutEffect(() => {
    const strip = stripRef.current
    if (!motionEnabled || !strip?.animate) return
    const animation = strip.animate(
      [{ opacity: 0.25, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }],
      { duration: 320, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
    )
    return () => animation.cancel()
  }, [rollup.minuteTs, startedAt, motionEnabled])
  const display = useMemo(
    () =>
      buildSelectedMomentDisplay({
        rollup,
        rollups,
        startedAt,
        vodLinkState,
        topEmotesCatalog,
        heatmapPoint,
        heatmapDetail,
        recapMoment,
        gameName,
        vodAlignSeconds,
        vodDurationSeconds,
      }),
    [
      gameName,
      heatmapDetail,
      heatmapPoint,
      recapMoment,
      rollup,
      rollups,
      startedAt,
      topEmotesCatalog,
      vodAlignSeconds,
      vodDurationSeconds,
      vodLinkState,
    ],
  )

  const { scoreModel } = display
  const facts: Array<{ label: string; value: string; tone?: string }> = []
  if (display.gameName) facts.push({ label: 'Game', value: display.gameName, tone: 'text-orange-200' })
  facts.push({
    label: 'Score',
    value: scoreModel.label,
    tone: scoreModel.estimated ? 'text-amber-200' : 'text-emerald-300',
  })
  if (scoreModel.confidence !== null) {
    facts.push({ label: 'Confidence', value: `${Math.round(scoreModel.confidence * 100)}%` })
  }

  return (
    <div
      ref={stripRef}
      className="min-w-0 border-t border-white/10 px-3 py-3"
      role="region"
      aria-label={`Selected moment at ${display.offsetStr || scoreModel.reasonLabel}`}
      data-selected-moment-card
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
        <div className="flex min-w-0 flex-col gap-1">
          {display.offsetStr ? (
             <span className="font-mono text-base font-semibold tabular-nums text-zinc-100">{display.offsetStr}</span>
          ) : null}
          <span className="text-xs text-zinc-400">Selected minute</span>
        </div>
        <dl className="m-0 flex flex-wrap gap-6">
          {[{ label: 'chat / min', value: rollup.chatCount == null ? '—' : count(rollup.chatCount) }, { label: 'emotes / min', value: count(minuteEmoteTotal(rollup)) }, { label: scoreModel.estimated ? 'estimated score' : 'signal score', value: scoreModel.label }].map(stat => (
            <div key={stat.label} className="flex flex-col-reverse gap-1 border-l border-white/10 pl-5">
              <dt className="text-xs text-zinc-400">{stat.label}</dt>
              <dd className="m-0 font-mono text-base font-semibold tabular-nums text-zinc-100">{stat.value}</dd>
            </div>
          ))}
        </dl>
        {/* A minimum width lets this column wrap as a block instead of one word per
            line; the VOD state is omitted when the jump button beside it says it. */}
        <div className="min-w-[9rem] flex-1 border-l border-white/10 pl-5">
          <strong className="text-sm text-zinc-100">{scoreModel.reasonLabel}</strong>
          {display.gameName ? <p className="m-0 text-xs text-zinc-400">{display.gameName}</p> : null}
          {display.vodUrl ? null : <p className="m-0 text-xs text-zinc-400">{vodLinkState.label}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {display.vodUrl ? (
            <a
              href={display.vodUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="Open this source on Twitch in a new tab"
              className="inline-flex min-h-11 items-center gap-1.5 rounded border border-violet-400/25 bg-violet-500/10 px-3 py-1 text-xs font-bold text-violet-100 no-underline transition-colors hover:border-violet-300/40 hover:bg-violet-500/20 hover:no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-300"
            >
              <span aria-hidden="true">↗</span>
              {display.vodJumpOffsetStr ? `Jump to VOD · ${display.vodJumpOffsetStr}` : 'Open full VOD'}
            </a>
          ) : (
            <span title={vodLinkState.detail} className="text-xs font-semibold text-zinc-500">
              {vodLinkState.status === 'linked' ? 'Timestamp unavailable' : vodLinkState.label}
            </span>
          )}
          {onClear ? (
            <button
              type="button"
              onClick={onClear}
              title="Clear this selected minute (Esc)"
              aria-label="Clear selected moment"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded text-xl text-zinc-500 transition hover:bg-white/[0.06] hover:text-zinc-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-300"
            >
              <span aria-hidden="true">×</span>
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/10 pt-3">
        <span className="text-xs text-zinc-400">Top emotes · uses in selected minute</span>
      {display.momentEmotes.length > 0 ? (
        <ul className="m-0 flex flex-wrap list-none items-center gap-x-3 gap-y-1 p-0" aria-label="Selected moment emotes">
          {display.momentEmotes.map(emote => (
            <li key={emote.key} className="flex items-center gap-1.5" title={`${emote.name}: ${count(emote.count)}`}>
              <ConsoleEmoteImg
                src={getEmoteImageUrl(emote)}
                name={emote.name}
                className="h-[18px] w-[18px] object-contain"
                fallbackClassName="inline-flex h-[18px] w-[18px] items-center justify-center rounded bg-white/10 text-xs font-black text-zinc-400"
              />
               <span className="sr-only">{emote.name}</span>
              <span className="text-xs font-bold tabular-nums text-zinc-500">{count(emote.count)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      </div>

      <details className="mt-1 text-xs text-zinc-400" onToggle={event => {
        const details = event.currentTarget
        if (!motionEnabled || !details.open) return
        details.querySelectorAll<HTMLElement>(':scope > :not(summary)').forEach(content => {
          content.animate?.([{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 220, easing: 'ease-out' })
        })
      }}>
        <summary className="w-fit cursor-pointer py-1 font-semibold hover:text-zinc-200">Details</summary>
        <div className="flex flex-wrap gap-x-3 gap-y-1 py-1">
          {facts.map(fact => (
            <span key={fact.label}>
              {fact.label}: <strong className={fact.tone ?? 'text-zinc-200'}>{fact.value}</strong>
            </span>
          ))}
        </div>

      {scoreModel.detailComponents.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {scoreModel.detailComponents.slice(0, 4).map(component => (
            <span
              key={component.key}
              className="rounded border border-white/10 bg-white/[0.035] px-1.5 py-0.5 text-xs font-bold text-zinc-500"
            >
              {component.key.replace(/_/g, ' ')}{' '}
              <strong className="text-zinc-300">{Math.round(component.weightedScore)}</strong>
            </span>
          ))}
        </div>
      ) : null}
      {onOpenAnalytics ? (
        <button type="button" onClick={onOpenAnalytics} className="min-h-11 px-2 font-bold text-zinc-200 hover:bg-white/[0.06]">Open Analytics</button>
      ) : null}
      </details>

      {!display.vodUrl && vodLinkState.detail ? (
        <p className="mt-2 text-xs font-semibold leading-snug text-zinc-600">{vodLinkState.detail}</p>
      ) : null}

    </div>
  )
}
