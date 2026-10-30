/**
 * "Emote overlays" under the session chart: a bar with the plotted emotes that opens a wide panel of the
 * stream's top emotes as chips (picture, name, uses). Back on the session page on 2026-10-21 (Aron: "why cant
 * we just use the old one where it was a dropdwon that was wide and filled with emotes"), in place of the
 * "Emotes on chart · Add emote" checklist.
 *
 * Plotted keys can come from the minute rollups ("seventv:LOL:LOL") while the list comes from the summary
 * ("seventv:<id>:LOL"). The chart matches the two by provider and name (pulse-charts chartSeries
 * resolveEmoteMinuteCount); so does this panel, so a 7TV and a BTTV "Clap" stay two emotes.
 */
import { useId, useState, type CSSProperties } from 'react'
import {
  MAX_PLOTTED_EMOTES,
  count,
  emoteChartColorForKey,
  emoteLegendSwatchStyle,
} from '@streampulse/pulse-charts'
import { sameEmoteKey } from '@streampulse/pulse-core'
import type { AnalyticsTopEmote } from '../../apiTypes.ts'
import { parseEmoteKey } from '../../emoteUtils.ts'
import { getEmoteImageUrl } from '../../utils/consoleFormat.ts'
import { emoteChipSelectionStyle } from './chartTheme.ts'
import { ConsoleEmoteImg } from './ConsoleEmoteImg.tsx'

export interface PlotOnChartStripProps {
  topEmotes: AnalyticsTopEmote[]
  plottedKeys: string[]
  onToggleEmote: (key: string) => void
  onClear?: () => void
  onReset?: () => void
  maxPlotted?: number
}

export function PlotOnChartStrip({
  topEmotes,
  plottedKeys,
  onToggleEmote,
  onClear,
  onReset,
  maxPlotted = MAX_PLOTTED_EMOTES,
}: PlotOnChartStripProps) {
  const [expanded, setExpanded] = useState(false)
  const selectorId = useId()
  const emoteOf = (key: string) => topEmotes.find(emote => emote.key === key) ?? topEmotes.find(emote => sameEmoteKey(key, emote.key))
  const plottedKeyOf = (emote: AnalyticsTopEmote) =>
    plottedKeys.find(key => key === emote.key) ?? plottedKeys.find(key => sameEmoteKey(key, emote.key))
  const hasControls = Boolean(onClear || onReset)
  if (topEmotes.length === 0 && !hasControls) return null

  const plottedCount = plottedKeys.length

  return (
    <div className="relative" data-chart-overlay-selector>
      <button
        type="button"
        data-chart-overlay-toggle=""
        onClick={() => setExpanded(value => !value)}
        aria-expanded={expanded}
        aria-controls={selectorId}
        aria-label={`Emote overlays, ${plottedCount} active, ${Math.max(0, maxPlotted - plottedCount)} slots left, ${expanded ? 'collapse' : 'manage'}`}
        className="flex min-h-9 w-full items-center gap-2 rounded border border-slate-400/15 bg-slate-400/[0.04] px-2.5 py-1.5 text-left transition hover:border-slate-300/25 hover:bg-slate-400/[0.07]"
      >
        <span className="shrink-0 text-xs font-black uppercase tracking-wide text-slate-300">
          Emote overlays
        </span>
        <span className="shrink-0 rounded bg-slate-300/10 px-1.5 py-0.5 text-xs font-black uppercase tracking-wide text-slate-400">
          {plottedCount} active
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
          {plottedKeys.slice(0, maxPlotted).map(key => {
            const emote = emoteOf(key)
            const name = emote?.name ?? parseEmoteKey(key).name
            const color = emoteChartColorForKey(key, plottedKeys)
            return (
              <span
                key={key}
                className="sc-ov-pop inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border bg-slate-950/40"
                style={{ borderColor: `${color}80` }}
                title={name}
                data-chart-overlay-plotted={key}
              >
                <ConsoleEmoteImg
                  src={emote ? getEmoteImageUrl(emote) : undefined}
                  name={name}
                  className="h-4 w-4 object-contain"
                  fallbackClassName="inline-flex h-4 w-4 items-center justify-center text-xs font-black text-slate-400"
                />
              </span>
            )
          })}
          {plottedCount === 0 ? (
            <span className="truncate text-xs font-semibold text-slate-500">Aggregate Emotes/min only</span>
          ) : null}
        </span>
        <span className="shrink-0 text-xs font-black uppercase text-slate-300">
          {expanded ? 'Collapse' : 'Manage'}
        </span>
        <span aria-hidden="true" className="shrink-0 text-xs text-slate-500">{expanded ? '−' : '+'}</span>
      </button>
      {expanded ? (
        // The wheel zooms the chart over the closed bar (it is part of the card) but scrolls over the open panel.
        <div
          id={selectorId}
          className="sc-reveal mt-1 rounded border border-slate-400/15 bg-slate-950/75 p-2.5 shadow-lg"
          data-chart-wheel-exempt=""
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-slate-400">
              Individual traces use the compact lane · up to {maxPlotted}
            </span>
            <div className="flex items-center gap-1">
              {onClear ? (
                <button
                  type="button"
                  onClick={onClear}
                  aria-label="Clear emote lanes"
                  disabled={plottedCount === 0}
                  className="rounded border border-slate-400/15 px-2 py-0.5 text-xs font-black uppercase text-slate-500 transition hover:border-slate-300/25 hover:text-slate-300 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Clear
                </button>
              ) : null}
              {onReset ? (
                <button
                  type="button"
                  onClick={onReset}
                  aria-label="Restore default emote lanes"
                  className="rounded border border-slate-400/15 px-2 py-0.5 text-xs font-black uppercase text-slate-500 transition hover:border-slate-300/25 hover:text-slate-300"
                >
                  Restore defaults
                </button>
              ) : null}
            </div>
          </div>
          <div className="flex max-h-36 flex-wrap content-start gap-1.5 overflow-y-auto pr-1">
        {topEmotes.length > 0 ? topEmotes.map((emote, index) => {
          const imageUrl = getEmoteImageUrl(emote)
          const plottedKey = plottedKeyOf(emote)
          const isPlotted = plottedKey != null
          const plotColor = plottedKey != null ? emoteChartColorForKey(plottedKey, plottedKeys) : undefined
          const chipStyle = emoteChipSelectionStyle(plotColor, { selected: isPlotted, plotted: isPlotted })
          const atCap = !isPlotted && plottedCount >= maxPlotted
          return (
            <button
              key={emote.key}
              type="button"
              data-chart-overlay-chip={emote.key}
              onClick={() => onToggleEmote(plottedKey ?? emote.key)}
              disabled={atCap}
              title={
                atCap
                  ? `Max ${maxPlotted} emotes on chart`
                  : `${emote.name}: ${count(emote.count)} total uses — click to ${isPlotted ? 'hide' : 'show'} on chart`
              }
              className="sc-ov-chip inline-flex min-w-0 max-w-40 items-center gap-1 rounded-full border px-2 py-1 text-xs font-black transition disabled:cursor-not-allowed disabled:opacity-45"
              style={{
                '--i': index,
                borderColor: chipStyle.borderColor,
                backgroundColor: chipStyle.backgroundColor,
                color: chipStyle.color,
                boxShadow: isPlotted && plotColor ? `inset 2px 0 0 ${plotColor}` : undefined,
              } as CSSProperties}
              aria-pressed={isPlotted}
              aria-label={`${isPlotted ? 'Unplot' : 'Plot'} ${emote.name} on chart`}
            >
              {isPlotted && plotColor ? (
                <span style={emoteLegendSwatchStyle(plotColor)} aria-hidden="true" />
              ) : null}
              <ConsoleEmoteImg
                src={imageUrl}
                name={emote.name}
                className="h-4 w-4 shrink-0 object-contain"
                fallbackClassName="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded bg-white/10 text-xs font-black text-zinc-400"
              />
              <span className="truncate">{emote.name}</span>
              <span
                className="shrink-0 font-bold tabular-nums"
                style={{ color: isPlotted ? plotColor : undefined }}
              >
                {count(emote.count)}
              </span>
            </button>
          )
        }) : (
          <span className="px-0.5 py-1 text-xs font-semibold text-slate-500">
            No individual emotes are available for this stream.
          </span>
        )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
