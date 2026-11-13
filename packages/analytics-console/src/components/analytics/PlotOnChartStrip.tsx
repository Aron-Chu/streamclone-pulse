/**
 * "Emotes on chart" keeps the current named, removable tokens and Add emote action, opening a wide panel of the
 * stream's top emotes as chips (picture, name, uses). Back on the session page on 2026-10-21 (Aron: "why cant
 * we just use the old one where it was a dropdwon that was wide and filled with emotes"), in place of the
 * narrow checklist. The words and direct removal remain unchanged during current-master integration.
 *
 * Plotted keys can come from the minute rollups ("seventv:LOL:LOL") while the list comes from the summary
 * ("seventv:<id>:LOL"). The chart matches the two by provider and name (pulse-charts chartSeries
 * resolveEmoteMinuteCount); so does this panel, so a 7TV and a BTTV "Clap" stay two emotes.
 */
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from 'react'
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
  const addRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const close = useCallback((restoreFocus: boolean) => {
    setExpanded(false)
    if (restoreFocus) addRef.current?.focus()
  }, [])
  useEffect(() => {
    if (!expanded) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      const active = document.activeElement
      close(Boolean(active && (panelRef.current?.contains(active) || active === addRef.current)))
    }
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (target && (panelRef.current?.contains(target) || addRef.current?.contains(target))) return
      close(false)
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onDown, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', onDown, true)
    }
  }, [close, expanded])
  const emoteOf = (key: string) => topEmotes.find(emote => emote.key === key) ?? topEmotes.find(emote => sameEmoteKey(key, emote.key))
  const plottedKeyOf = (emote: AnalyticsTopEmote) =>
    plottedKeys.find(key => key === emote.key) ?? plottedKeys.find(key => sameEmoteKey(key, emote.key))
  const hasControls = Boolean(onClear || onReset)
  if (topEmotes.length === 0 && !hasControls) return null

  const plottedCount = plottedKeys.length

  return (
    <div className="relative" data-chart-overlay-selector>
      <div className="flex min-h-9 w-full flex-wrap items-center gap-2 rounded border border-slate-400/15 bg-slate-400/[0.04] px-2.5 py-1.5" data-session-emotes-on-chart="">
        <span className="shrink-0 text-xs font-bold text-slate-300">Emotes on chart</span>
        {plottedKeys.slice(0, maxPlotted).map(key => {
          const emote = emoteOf(key)
          const name = emote?.name ?? parseEmoteKey(key).name
          const color = emoteChartColorForKey(key, plottedKeys)
          return (
            <span key={key} className="inline-flex min-h-11 min-w-0 max-w-full items-center gap-1 rounded border px-1.5 py-0.5 text-xs" style={{ borderColor: `${color}80`, color }} title={name} data-chart-overlay-plotted={key} data-session-emote-token={key}>
              <ConsoleEmoteImg src={emote ? getEmoteImageUrl(emote) : undefined} name={name} className="sc-ov-pop h-4 w-4 object-contain" fallbackClassName="sc-ov-pop inline-flex h-4 w-4 items-center justify-center text-xs font-bold text-slate-400" />
              <span className="max-w-32 truncate">{name}</span>
              <button type="button" aria-label={`Remove ${name} from the chart`} data-session-emote-remove={key} className="relative grid h-5 w-5 shrink-0 place-items-center rounded text-xs" onClick={() => { onToggleEmote(key); addRef.current?.focus() }}>×</button>
            </span>
          )
        })}
        <button ref={addRef} type="button" data-chart-overlay-toggle="" data-session-emote-add="" onClick={() => setExpanded(value => !value)} aria-expanded={expanded} aria-controls={selectorId} className="inline-flex min-h-11 min-w-24 shrink-0 items-center gap-1 rounded border border-slate-400/15 px-2 py-1 text-xs font-bold text-slate-300">
          <span aria-hidden="true">+</span>Add emote
        </button>
      </div>
      {expanded ? (
        // The wheel zooms the chart over the closed bar (it is part of the card) but scrolls over the open panel.
        <div
          ref={panelRef}
          id={selectorId}
          role="group"
          aria-label="Emotes on chart"
          onBlur={event => {
            const next = event.relatedTarget as Node | null
            if (next && !panelRef.current?.contains(next) && next !== addRef.current) close(false)
          }}
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
                  className="rounded border border-slate-400/15 px-2 py-0.5 text-xs font-semibold text-slate-400 transition hover:border-slate-300/25 hover:text-slate-300 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Clear
                </button>
              ) : null}
              {onReset ? (
                <button
                  type="button"
                  onClick={onReset}
                  aria-label="Restore default emote lanes"
                  className="rounded border border-slate-400/15 px-2 py-0.5 text-xs font-semibold text-slate-400 transition hover:border-slate-300/25 hover:text-slate-300"
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
          <span className="px-0.5 py-1 text-xs font-semibold text-slate-400">
            No individual emotes are available for this stream.
          </span>
        )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
