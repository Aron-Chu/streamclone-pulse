import type { CSSProperties } from 'react'
import type { AnalyticsTopEmote } from '../../apiTypes.ts'
import { parseEmoteKey } from '../../emoteUtils.ts'
import { useEdgeFade } from '../../hooks/useSessionColumnFill.ts'
import { count, getEmoteImageUrl } from '../../utils/consoleFormat.ts'
import { ConsoleEmoteImg } from './ConsoleEmoteImg.tsx'
import { EmoteProviderBadge } from './ConsoleBits.tsx'
import { emoteChartColorForKey, emoteChipSelectionStyle } from './chartTheme.ts'

const GRID = 'grid grid-cols-[minmax(0,1fr)_4.5rem_3.5rem] gap-2'

export function TopEmoteTable({
  emotes,
  selected,
  plottedKeys,
  onSelect,
  embedded = false,
}: {
  emotes: AnalyticsTopEmote[]
  /** User toggled selection (may be empty while auto-plot fills chart). */
  selected: Set<string>
  /** Keys currently drawn on the chart, in stable plot order (matches chart line colors). */
  plottedKeys: string[]
  onSelect: (key: string) => void
  embedded?: boolean
}) {
  const fadeRef = useEdgeFade<HTMLDivElement>()
  const plottedSet = new Set(plottedKeys)
  if (!emotes.length) {
    return (
      <div
        className={`grid min-h-44 place-items-center text-center ${
          embedded ? 'px-3 py-4' : 'rounded border border-white/10 bg-white/[0.035]'
        }`}
      >
        <div>
          <div className="text-sm font-semibold text-zinc-300">No emotes counted</div>
          <div className="mt-1 text-xs text-zinc-500">
            Collected chat has not matched known emotes yet.
          </div>
        </div>
      </div>
    )
  }
  const rows = emotes.slice(0, 20).map((emote) => {
    const imageUrl = getEmoteImageUrl(emote)
    const isSelected = selected.has(emote.key)
    const isPlotted = plottedSet.has(emote.key)
    const plotColor = isPlotted ? emoteChartColorForKey(emote.key, plottedKeys) : undefined
    const chipStyle = emoteChipSelectionStyle(plotColor, { selected: isSelected, plotted: isPlotted })
    const provider = emote.provider || parseEmoteKey(emote.key).provider
    return (
      <button
        key={emote.key}
        type="button"
        onClick={() => onSelect(emote.key)}
        // d3-v2 session-original: a row is a toggle; pressed = plotted on the chart.
        aria-pressed={isPlotted}
        data-emote-row
        className={`${GRID} min-h-11 w-full items-center border-b border-white/5 px-2 py-1.5 text-left text-xs last:border-b-0 transition hover:bg-white/[0.06]`}
        style={{
          '--c': plotColor,
          backgroundColor: chipStyle.backgroundColor,
          color: chipStyle.color,
          boxShadow: isPlotted && plotColor ? `inset 0 0 0 1px ${chipStyle.borderColor}` : undefined,
        } as CSSProperties}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-black/30 p-0.5">
            <ConsoleEmoteImg
              src={imageUrl}
              name={emote.name}
              className="max-h-full max-w-full object-contain"
              fallbackClassName="inline-flex h-4 w-4 items-center justify-center rounded bg-white/10 text-xs font-black text-zinc-400"
            />
          </span>
          <span className="truncate font-semibold" title={emote.name}>
            {emote.name}
          </span>
        </span>
        <span className="flex shrink-0 items-center">
          {provider && provider !== 'unknown' ? (
            <EmoteProviderBadge provider={provider} />
          ) : (
            <span className="text-xs text-zinc-600">—</span>
          )}
        </span>
        <span className="shrink-0 text-right font-mono text-xs font-semibold tabular-nums text-zinc-400">
          {count(emote.count)}
        </span>
      </button>
    )
  })
  const header = (
    <div className={`${GRID} border-b border-white/10 px-2 py-1.5 text-xs font-semibold text-zinc-400`} data-emote-table-header>
      <span>Emote</span>
      <span>Provider</span>
      <span className="text-right">Uses</span>
    </div>
  )
  if (!embedded) {
    return (
      <div className="overflow-hidden rounded border border-white/10 bg-white/[0.035]">
        {header}
        {rows}
      </div>
    )
  }
  // Embedded in the session tabs: a tip, then a header that stays put while
  // the rows scroll under it. From 1280 px the list fills its tab (CSS).
  return (
    <div className="ssp-et-w" data-emote-table>
      <p className="m-0 px-2 pb-1 pt-2 text-xs font-semibold text-zinc-400">Select an emote to plot it on the chart</p>
      <div className="ssp-et sc-console-scroll">
        {header}
        <div ref={fadeRef} className="ssp-et-b sc-console-scroll" data-emote-table-body>
          {rows}
        </div>
      </div>
    </div>
  )
}
