import { useMemo, type CSSProperties, type KeyboardEvent } from 'react'
import type { ExtensionEmote, ExtensionRollup } from '../shared/messages.ts'
import {
  emoteActivityInRollups,
  emoteSelectionKey,
  type EmoteWindowActivity,
} from './chatActivityEmotes.ts'
import { hexToRgba } from './chartTheme.ts'
import { PulseEmoteImg } from './PulseEmoteImg.tsx'
import { formatCount } from './mostReacted.ts'
import { theme } from './theme.ts'

/** Stable list viewport: ~6 compact rows before scroll; full catalog (≤24) stays mounted. */
export const EMOTE_PICKER_SCROLL_MAX_HEIGHT_PX = 168

export interface SevenTvEmotePanelProps {
  expanded: boolean
  onToggleExpanded: () => void
  backendUrl: string
  /** Active chart-window rollups — plottability is derived from non-zero minute values. */
  rollups: ExtensionRollup[]
  topEmotes: ExtensionEmote[]
  selectedKeys: string[]
  onToggleEmote: (emote: ExtensionEmote) => void
  selectedOffsetSeconds: number | null
  sidebarCompact?: boolean
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
  sidebarCompact = false,
  selectedPlotColors,
  maxSelected = 6,
  rollupsLoading = false,
}: SevenTvEmotePanelProps) {
  const activityByKey = useMemo(() => {
    const map = new Map<string, EmoteWindowActivity>()
    for (const emote of topEmotes) {
      const key = emoteSelectionKey(emote)
      map.set(key, emoteActivityInRollups(rollups, emote, { loading: rollupsLoading }))
    }
    return map
  }, [topEmotes, rollups, rollupsLoading])

  if (topEmotes.length === 0) return null

  const selectedEmotes = topEmotes.filter(emote => selectedKeys.includes(emoteSelectionKey(emote)))
  const previewEmotes =
    selectedEmotes.length > 0
      ? selectedEmotes.slice(0, maxSelected)
      : topEmotes.slice(0, Math.min(6, maxSelected))
  const previewNames = previewEmotes.map(emote => emote.name).join(' · ')
  const selectedCount = selectedKeys.length
  const atCap = selectedCount >= maxSelected
  const showOverflowCue = topEmotes.length > 6

  function handleRowActivate(emote: ExtensionEmote, activity: EmoteWindowActivity): void {
    if (activity !== 'active') return
    const key = emoteSelectionKey(emote)
    const selected = selectedKeys.includes(key)
    if (!selected && atCap) return
    onToggleEmote(emote)
  }

  function handleRowKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    emote: ExtensionEmote,
    activity: EmoteWindowActivity,
  ): void {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    handleRowActivate(emote, activity)
  }

  return (
    <div className="pulse-seven-tv-panel" style={styles.panel}>
      <button
        type="button"
        className="pulse-seven-tv-toggle"
        style={styles.toggle}
        onClick={onToggleExpanded}
        aria-expanded={expanded}
        aria-controls="pulse-emote-picker-list"
      >
        <span style={styles.toggleLabel}>
          Plot emotes · {selectedCount}/{maxSelected}
        </span>
        {!expanded && previewEmotes.length > 0 ? (
          <span style={styles.togglePreview} title={previewNames}>
            {previewEmotes.map(emote => (
              <PulseEmoteImg
                key={emoteSelectionKey(emote)}
                emote={emote}
                backendUrl={backendUrl}
                width={18}
                height={18}
                style={styles.previewImg}
              />
            ))}
          </span>
        ) : null}
        <span style={styles.chevron} aria-hidden="true">
          {expanded ? '▾' : '▸'}
        </span>
      </button>

      {expanded ? (
        <div style={styles.body}>
          <div
            id="pulse-emote-picker-list"
            className="pulse-emote-picker-scroll"
            style={styles.rowList}
            data-emote-picker-scroll
            role="listbox"
            aria-label={`Plot emotes · ${selectedCount} of ${maxSelected} selected`}
            aria-multiselectable="true"
          >
            {topEmotes.map((emote, index) => {
              const key = emoteSelectionKey(emote)
              const selected = selectedKeys.includes(key)
              const activity = activityByKey.get(key) ?? 'none'
              const plottable = activity === 'active'
              const disabled = !plottable || (!selected && atCap)
              const plotColor = selected ? selectedPlotColors?.[key] : undefined
              const usePlotColor = Boolean(selected && plotColor)
              const hint = activityHint(activity, maxSelected, !selected && atCap)
              return (
                <button
                  type="button"
                  key={key}
                  role="option"
                  aria-selected={selected}
                  aria-disabled={disabled}
                  disabled={disabled}
                  tabIndex={0}
                  className={
                    usePlotColor
                      ? 'pulse-seven-tv-row'
                      : `pulse-seven-tv-row${selected ? ' pulse-seven-tv-row-active' : ''}${
                          disabled ? ' pulse-seven-tv-row-disabled' : ''
                        }`
                  }
                  style={{
                    ...styles.row,
                    ...(index % 2 === 1 && !usePlotColor ? styles.rowAlt : null),
                    ...(sidebarCompact ? styles.rowCompact : null),
                    ...(disabled ? styles.rowDisabled : null),
                    ...(usePlotColor
                      ? {
                          background: hexToRgba(plotColor!, 0.12),
                          borderColor: plotColor,
                        }
                      : null),
                  }}
                  title={`${emote.name} · ${formatCount(emote.count)} uses · ${hint}`}
                  onClick={() => handleRowActivate(emote, activity)}
                  onKeyDown={event => handleRowKeyDown(event, emote, activity)}
                >
                  <PulseEmoteImg
                    emote={emote}
                    backendUrl={backendUrl}
                    width={sidebarCompact ? 20 : 22}
                    height={sidebarCompact ? 20 : 22}
                    style={{
                      ...styles.rowImg,
                      ...(disabled ? styles.rowImgDisabled : null),
                    }}
                  />
                  <span style={styles.rowName}>{emote.name}</span>
                  <span
                    style={{
                      ...styles.rowCount,
                      ...(usePlotColor ? { color: plotColor } : null),
                      ...(activity === 'none' ? styles.rowCountMuted : null),
                    }}
                  >
                    {activity === 'loading'
                      ? '…'
                      : activity === 'none'
                        ? 'No activity'
                        : formatCount(emote.count)}
                  </span>
                </button>
              )
            })}
          </div>
          {showOverflowCue ? (
            <div style={styles.overflowCue} aria-hidden="true">
              Scroll for more
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  panel: {
    background: 'rgba(17, 17, 23, 0.72)',
    border: '1px solid rgba(103, 232, 249, 0.1)',
    borderRadius: 10,
    marginTop: 8,
    overflow: 'hidden',
  },
  toggle: {
    alignItems: 'center',
    background: 'transparent',
    border: 0,
    color: theme.textPrimary,
    cursor: 'pointer',
    display: 'flex',
    gap: 8,
    padding: '8px 10px',
    textAlign: 'left',
    width: '100%',
  },
  toggleLabel: {
    color: theme.textMuted,
    flexShrink: 0,
    fontSize: 9,
    fontWeight: 800,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
  },
  togglePreview: {
    alignItems: 'center',
    display: 'inline-flex',
    flex: 1,
    gap: 5,
    minWidth: 0,
  },
  previewImg: { display: 'block', flexShrink: 0, objectFit: 'contain' },
  chevron: { color: theme.accentSoft, flexShrink: 0, fontSize: 11, fontWeight: 900, marginLeft: 'auto' },
  body: {
    borderTop: '1px solid rgba(255, 255, 255, 0.06)',
    display: 'grid',
    gap: 4,
    padding: '6px 8px 8px',
  },
  rowList: {
    display: 'grid',
    gap: 4,
    maxHeight: EMOTE_PICKER_SCROLL_MAX_HEIGHT_PX,
    overflowY: 'auto',
    overscrollBehavior: 'contain',
  },
  overflowCue: {
    color: theme.textMuted,
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: '0.04em',
    opacity: 0.75,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  row: {
    alignItems: 'center',
    background: 'rgba(255, 255, 255, 0.04)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: 8,
    color: theme.textPrimary,
    cursor: 'pointer',
    display: 'grid',
    gap: 8,
    gridTemplateColumns: '22px 1fr auto',
    padding: '7px 10px',
    textAlign: 'left',
    width: '100%',
  },
  rowCompact: {
    gap: 6,
    gridTemplateColumns: '20px 1fr auto',
    padding: '5px 8px',
  },
  rowAlt: {
    background: 'rgba(255, 255, 255, 0.02)',
    border: '1px solid rgba(255, 255, 255, 0.06)',
  },
  rowDisabled: {
    cursor: 'not-allowed',
    opacity: 0.55,
  },
  rowImg: { display: 'block', objectFit: 'contain' },
  rowImgDisabled: { opacity: 0.65 },
  rowName: {
    color: theme.textPrimary,
    fontSize: 11,
    fontWeight: 800,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  rowCount: {
    color: theme.accentSoft,
    fontSize: 10,
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 800,
    minWidth: 28,
    textAlign: 'right',
  },
  rowCountMuted: {
    color: theme.textMuted,
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: '0.02em',
    textTransform: 'none',
  },
}
