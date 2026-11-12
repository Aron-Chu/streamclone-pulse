/**
 * "Emotes on chart" (d3-v2 session-original.html .po-eo, 2026-10-15, Aron:
 * "plot on chart should be on the bottom like in prod", then "make the plot on
 * chart less vibe codey"): one plain line under the chart. Each plotted emote
 * in its trace colour with a remove ×, then "Add emote", a checklist of the
 * stream's top emotes. Up to MAX_PLOTTED_EMOTES at once; the limit note shows
 * only at the limit. Same selection as the console's emote plot (toggled one
 * key at a time), so the Emotes tab rows and this line stay in step.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type FocusEvent as ReactFocusEvent } from 'react'
import { MAX_PLOTTED_EMOTES } from '@streampulse/pulse-charts'
import { sameEmoteKey } from '@streampulse/pulse-core'
import type { AnalyticsTopEmote } from '../../api.ts'
import { parseEmoteKey } from '../../emoteUtils.ts'
import { getEmoteImageUrl } from '../../utils/consoleFormat.ts'
import { ConsoleEmoteImg } from './ConsoleEmoteImg.tsx'
import { fullInt } from './sessionSpChartModel.ts'

const swatch = (color: string | null): CSSProperties => ({ ['--c' as string]: color ?? 'transparent' })

export function SessionEmotesOnChart({
  topEmotes,
  plotted,
  colorOf,
  onToggle,
}: {
  topEmotes: readonly AnalyticsTopEmote[]
  /** Plotted emote keys, in plot (colour) order. */
  plotted: readonly string[]
  colorOf(key: string): string
  onToggle(key: string): void
}) {
  const [open, setOpen] = useState(false)
  const lineRef = useRef<HTMLDivElement>(null)
  const addRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const panelId = useId()
  const full = plotted.length >= MAX_PLOTTED_EMOTES
  // Plotted keys can come from the minute rollups ("seventv:LOL:LOL") while the
  // list comes from the summary ("seventv:<id>:LOL"). The chart matches the two
  // by provider and name (pulse-charts chartSeries resolveEmoteMinuteCount); so
  // does this line, so a 7TV and a BTTV "Clap" stay two emotes.
  const byKey = new Map(topEmotes.map(emote => [emote.key, emote]))
  const emoteOf = (key: string) => byKey.get(key) ?? topEmotes.find(emote => sameEmoteKey(key, emote.key))
  const plottedKeyOf = (emote: AnalyticsTopEmote) =>
    plotted.find(key => key === emote.key) ?? plotted.find(key => sameEmoteKey(key, emote.key))
  const close = useCallback((focus: boolean) => {
    setOpen(false)
    if (focus) addRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      const active = document.activeElement
      close(!!active && (panelRef.current?.contains(active) || active === addRef.current))
    }
    const onDown = (event: PointerEvent) => {
      const t = event.target as Node | null
      if (t && (panelRef.current?.contains(t) || addRef.current?.contains(t))) return
      close(false)
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onDown, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', onDown, true)
    }
  }, [close, open])

  // Under the button, kept inside the line.
  useLayoutEffect(() => {
    const panel = panelRef.current, add = addRef.current, line = lineRef.current
    if (!open || !panel || !add || !line) return
    panel.style.left = Math.max(0, Math.min(add.offsetLeft, line.clientWidth - panel.offsetWidth)) + 'px'
  }, [open, plotted.length])

  const onPanelBlur = (event: ReactFocusEvent<HTMLDivElement>) => {
    const to = event.relatedTarget as Node | null
    if (to && !panelRef.current?.contains(to) && to !== addRef.current) close(false)
  }

  if (!topEmotes.length && !plotted.length) return null
  return (
    <div ref={lineRef} className="ssc-eo" data-session-emotes-on-chart="">
      <span className="ssc-eo-t">Emotes on chart</span>
      {plotted.map(key => {
        const emote = emoteOf(key)
        const name = emote?.name ?? parseEmoteKey(key).name
        return (
          <span key={key} className="ssc-eo-tok" style={swatch(colorOf(key))} data-session-emote-token={key}>
            <i className="ssc-eo-sw" aria-hidden="true" />
            {emote ? <ConsoleEmoteImg src={getEmoteImageUrl(emote)} name={name} width={16} height={16} className="ssc-eo-img" fallbackClassName="ssc-eo-img ssc-img-fb" /> : null}
            <span className="ssc-eo-c">{name}</span>
            <button
              type="button"
              className="ssc-eo-x"
              aria-label={'Remove ' + name + ' from the chart'}
              data-session-emote-remove={key}
              onClick={() => {
                onToggle(key)
                addRef.current?.focus()
              }}
            >
              ×
            </button>
          </span>
        )
      })}
      {topEmotes.length ? (
        <button
          ref={addRef}
          type="button"
          className="ssc-qb ssc-eo-add"
          aria-expanded={open}
          aria-controls={panelId}
          data-session-emote-add=""
          onClick={() => (open ? close(false) : setOpen(true))}
        >
          <span aria-hidden="true">+</span>
          Add emote
        </button>
      ) : null}
      <div
        ref={panelRef}
        id={panelId}
        className="ssc-panel ssc-eo-p"
        role="group"
        aria-label="Emotes on chart"
        data-chart-wheel-exempt=""
        hidden={!open}
        onBlur={onPanelBlur}
      >
        <div className="ssc-eo-l">
          {topEmotes.map(emote => {
            const on = plottedKeyOf(emote)
            return (
              <label key={emote.key} style={swatch(on ? colorOf(on) : null)}>
                <input
                  type="checkbox"
                  checked={on != null}
                  disabled={on == null && full}
                  data-session-emote={emote.key}
                  onChange={() => onToggle(on ?? emote.key)}
                />
                <i className="ssc-eo-sw" aria-hidden="true" />
                <ConsoleEmoteImg src={getEmoteImageUrl(emote)} name={emote.name} width={16} height={16} className="ssc-eo-img" fallbackClassName="ssc-eo-img ssc-img-fb" />
                <span className="ssc-eo-c">{emote.name}</span>
                <span className="ssc-eo-n">{fullInt(emote.count)}</span>
              </label>
            )
          })}
        </div>
        {full ? <p className="ssc-eo-max">Up to {MAX_PLOTTED_EMOTES} at once</p> : null}
      </div>
    </div>
  )
}
