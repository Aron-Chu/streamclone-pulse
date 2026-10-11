import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useReducedMotion } from './motion/useReducedMotion.ts'
import type { ExtensionEmote, ExtensionRollup } from '../shared/messages.ts'
import {
  emoteActivityInRollups,
  emoteSelectionKey,
  type EmoteWindowActivity,
} from './chatActivityEmotes.ts'
import { emoteChartColor } from './chartTheme.ts'
import { PulseEmoteImg } from './PulseEmoteImg.tsx'
import { formatCount } from './mostReacted.ts'
import { theme } from './theme.ts'

const INITIAL_VISIBLE_EMOTES = 12

export interface SevenTvEmotePanelProps {
  expanded: boolean
  onToggleExpanded: () => void
  backendUrl: string
  /** Active chart-window rollups — plottability is derived from non-zero minute values. */
  rollups: ExtensionRollup[]
  topEmotes: ExtensionEmote[]
  selectedKeys: string[]
  onToggleEmote: (emote: ExtensionEmote) => void
  /** Remove plotted emote series without changing the selected chart bucket. */
  onClearPlots?: () => void
  selectedOffsetSeconds: number | null
  sidebarCompact?: boolean
  /** Kept for the chart/recap call sites; picker chips use a neutral treatment. */
  selectedPlotColors?: Record<string, string>
  maxSelected?: number
  /** True while chart-window rollups are still loading. */
  rollupsLoading?: boolean
}

function activityHint(activity: EmoteWindowActivity, maxSelected: number, atCap: boolean): string {
  if (activity === 'loading') return 'Loading activity for this window'
  if (activity === 'none') return 'No activity in this window'
  if (atCap) return `Max ${maxSelected} emotes on chart`
  return 'Toggle chart line'
}

export function SevenTvEmotePanel({
  expanded,
  onToggleExpanded,
  backendUrl,
  rollups,
  topEmotes,
  selectedKeys,
  onToggleEmote,
  onClearPlots,
  sidebarCompact = false,
  maxSelected = 6,
  rollupsLoading = false,
}: SevenTvEmotePanelProps) {
  const [showAll, setShowAll] = useState(false)
  const reducedMotion = useReducedMotion()
  useEffect(() => {
    if (!expanded) setShowAll(false)
  }, [expanded])

  const activityByKey = useMemo(() => {
    const map = new Map<string, EmoteWindowActivity>()
    for (const emote of topEmotes) {
      const key = emoteSelectionKey(emote)
      map.set(key, emoteActivityInRollups(rollups, emote, { loading: rollupsLoading }))
    }
    return map
  }, [topEmotes, rollups, rollupsLoading])

  const selectionLimit = Math.max(1, Math.trunc(maxSelected))
  const availableKeys = useMemo(
    () => new Set(topEmotes.map(emote => emoteSelectionKey(emote))),
    [topEmotes],
  )
  const normalizedSelectedKeys = useMemo(
    () => selectedKeys.filter(key => availableKeys.has(key)).slice(0, selectionLimit),
    [availableKeys, selectedKeys, selectionLimit],
  )
  const selectedKeySet = useMemo(() => new Set(normalizedSelectedKeys), [normalizedSelectedKeys])
  // The collapsed control previews the actual leaders, not six anonymous
  // selection dots. Plot selection remains manual and is still capped below.
  const previewEmotes = topEmotes.slice(0, 3)
  const previewNames = previewEmotes.map(emote => emote.name).join(' · ')
  const selectedCount = normalizedSelectedKeys.length
  const atCap = selectedCount >= selectionLimit
  const hiddenCount = Math.max(0, topEmotes.length - INITIAL_VISIBLE_EMOTES)
  const visibleEmotes = showAll ? topEmotes : topEmotes.slice(0, INITIAL_VISIBLE_EMOTES)

  if (topEmotes.length === 0) return null

  function handleChipActivate(emote: ExtensionEmote, activity: EmoteWindowActivity): void {
    if (activity !== 'active') return
    const key = emoteSelectionKey(emote)
    const selected = selectedKeySet.has(key)
    if (!selected && atCap) return
    onToggleEmote(emote)
  }

  return (
    <div className="pulse-seven-tv-panel">
      <div className="pulse-seven-tv-head">
        <button
          type="button"
          className="pulse-seven-tv-toggle"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          aria-controls="pulse-emote-picker-list"
        >
          <span className="pulse-seven-tv-label">
            Plot on chart · {selectedCount}/{selectionLimit}
          </span>
          {!expanded && previewEmotes.length > 0 ? (
            <span
              className="pulse-seven-tv-preview"
              title={`Top emotes: ${previewNames}`}
              aria-label={`Top emotes: ${previewNames}`}
            >
              {previewEmotes.map(emote => {
                const selIdx = normalizedSelectedKeys.indexOf(emoteSelectionKey(emote))
                const lineColor = selIdx >= 0 ? emoteChartColor(selIdx) : 'rgba(255, 255, 255, 0.12)'
                return (
                  <span
                    key={emoteSelectionKey(emote)}
                    data-emote-picker-preview-image="true"
                    className="pulse-seven-tv-preview-emote"
                    style={{ borderColor: lineColor }}
                  >
                    <PulseEmoteImg
                      emote={emote}
                      backendUrl={backendUrl}
                      width={18}
                      height={18}
                      style={styles.previewImg}
                    />
                  </span>
                )
              })}
            </span>
          ) : null}
          <span
            className={`pulse-seven-tv-chevron${reducedMotion ? ' is-reduced' : ''}`}
            data-emote-picker-chevron
            data-expanded={expanded ? 'true' : 'false'}
            style={{ transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)' }}
            aria-hidden="true"
          >
            ▾
          </span>
        </button>
        {selectedCount > 0 ? (
          <button
            type="button"
            data-emote-picker-clear
            className="pulse-seven-tv-clear"
            aria-label="Clear plotted emotes"
            title="Remove all plotted emote lines"
            onClick={event => {
              event.stopPropagation()
              onClearPlots?.()
            }}
          >
            Clear
          </button>
        ) : null}
      </div>

      <div
        className={`pulse-seven-tv-body${reducedMotion ? ' is-reduced' : ''}`}
        data-emote-picker-body
        data-expanded={expanded ? 'true' : 'false'}
        aria-hidden={!expanded}
      >
        <div className="pulse-seven-tv-body-inner">
          <div
            id="pulse-emote-picker-list"
            className="pulse-emote-picker-grid"
            data-emote-picker-grid
            role="listbox"
            aria-label={`Plot on chart · ${selectedCount} of ${selectionLimit} selected`}
            aria-multiselectable="true"
          >
            {visibleEmotes.map(emote => {
              const key = emoteSelectionKey(emote)
              const selected = selectedKeySet.has(key)
              const activity = activityByKey.get(key) ?? 'none'
              const plottable = activity === 'active'
              const disabled = !plottable || (!selected && atCap)
              const hint = activityHint(activity, selectionLimit, !selected && atCap)
              return (
                <button
                  type="button"
                  key={key}
                  role="option"
                  aria-selected={selected}
                  aria-disabled={disabled}
                  aria-label={`${emote.name}, ${formatCount(emote.count)} uses. ${hint}`}
                  disabled={disabled}
                  tabIndex={expanded ? 0 : -1}
                  className={`pulse-seven-tv-chip${sidebarCompact ? ' is-compact' : ''}${selected ? ' pulse-seven-tv-chip-active' : ''}${disabled ? ' pulse-seven-tv-chip-disabled' : ''}`}
                  style={selected ? (() => {
                    const selIdx = normalizedSelectedKeys.indexOf(key)
                    const lineColor = selIdx >= 0 ? emoteChartColor(selIdx) : '#a78bfa'
                    return {
                      background: `${lineColor}22`,
                      borderColor: `${lineColor}f2`,
                      boxShadow: `0 0 0 1px ${lineColor}cc, 0 0 10px ${lineColor}33`,
                    }
                  })() : undefined}
                  title={`${emote.name} · ${formatCount(emote.count)} uses · ${hint}`}
                  onClick={() => handleChipActivate(emote, activity)}
                >
                  <PulseEmoteImg
                    emote={emote}
                    backendUrl={backendUrl}
                    width={sidebarCompact ? 20 : 22}
                    height={sidebarCompact ? 20 : 22}
                    style={styles.chipImg}
                  />
                  <span className="pulse-seven-tv-count">
                    {activity === 'loading' ? '…' : formatCount(emote.count)}
                  </span>
                  {selected ? (() => {
                    const selIdx = normalizedSelectedKeys.indexOf(key)
                    const lineColor = selIdx >= 0 ? emoteChartColor(selIdx) : theme.textMuted
                    return (
                      <span
                        className="pulse-seven-tv-swatch"
                        style={{ background: lineColor, boxShadow: `0 0 5px ${lineColor}55` }}
                        aria-hidden="true"
                        title={`Chart line: ${lineColor}`}
                      />
                    )
                  })() : null}
                </button>
              )
            })}
          </div>
          {hiddenCount > 0 ? (
            <button
              type="button"
              data-emote-picker-more
              className="pulse-seven-tv-more"
              aria-expanded={showAll}
              tabIndex={expanded ? 0 : -1}
              onClick={() => setShowAll(current => !current)}
            >
              {showAll ? 'Show fewer' : `+${hiddenCount} more`}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

// Static layout lives in shadow.css (.pulse-seven-tv-*, .pulse-emote-picker-grid);
// only the per-emote line colours, the chevron turn and the image boxes stay inline.
const styles: Record<string, CSSProperties> = {
  previewImg: { display: 'block', flexShrink: 0, objectFit: 'contain' },
  chipImg: { display: 'block', flexShrink: 0, objectFit: 'contain' },
}
