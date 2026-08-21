import { useMemo, type CSSProperties } from 'react'
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

export interface SevenTvEmotePanelProps {
  backendUrl: string
  /** Active chart-window rollups; options without activity stay visibly unavailable. */
  rollups: ExtensionRollup[]
  topEmotes: ExtensionEmote[]
  selectedKeys: string[]
  onToggleEmote: (emote: ExtensionEmote) => void
  selectedPlotColors?: Record<string, string>
  maxSelected?: number
  rollupsLoading?: boolean
  readOnly?: boolean
}

function activityHint(activity: EmoteWindowActivity, maxSelected: number, atCap: boolean): string {
  if (activity === 'loading') return 'Loading activity for this range'
  if (activity === 'none') return 'No activity in this range'
  if (atCap) return `Maximum ${maxSelected} emotes plotted`
  return 'Toggle chart line'
}

export function SevenTvEmotePanel({
  backendUrl,
  rollups,
  topEmotes,
  selectedKeys,
  onToggleEmote,
  selectedPlotColors,
  maxSelected = 6,
  rollupsLoading = false,
  readOnly = false,
}: SevenTvEmotePanelProps) {
  const activityByKey = useMemo(() => {
    const map = new Map<string, EmoteWindowActivity>()
    for (const emote of topEmotes) {
      map.set(
        emoteSelectionKey(emote),
        emoteActivityInRollups(rollups, emote, { loading: rollupsLoading }),
      )
    }
    return map
  }, [topEmotes, rollups, rollupsLoading])

  const railEmotes = useMemo(() => {
    const selected = topEmotes.filter(emote => selectedKeys.includes(emoteSelectionKey(emote)))
    const available = topEmotes.filter(emote => !selectedKeys.includes(emoteSelectionKey(emote)))
    return [...selected, ...available].slice(0, Math.min(6, maxSelected))
  }, [maxSelected, selectedKeys, topEmotes])

  if (railEmotes.length === 0) return null

  const selectedCount = selectedKeys.length
  const atCap = selectedCount >= maxSelected

  return (
    <div className="pulse-seven-tv-panel" style={styles.panel} data-plot-emote-rail="compact">
      <div style={styles.heading}>
        <span style={styles.label}>Plot emotes</span>
        <span style={styles.count} aria-label={`${selectedCount} of ${maxSelected} emotes plotted`}>
          {selectedCount}/{maxSelected}
        </span>
      </div>
      <div style={styles.rail} role="group" aria-label="Emotes plotted on chart">
        {railEmotes.map(emote => {
          const key = emoteSelectionKey(emote)
          const selected = selectedKeys.includes(key)
          const activity = activityByKey.get(key) ?? 'none'
          const disabled = readOnly || activity !== 'active' || (!selected && atCap)
          const plotColor = selectedPlotColors?.[key] ?? theme.accentSoft
          const hint = readOnly
            ? 'Chart controls unavailable in preview'
            : activityHint(activity, maxSelected, !selected && atCap)

          return (
            <button
              type="button"
              key={key}
              className={`pulse-seven-tv-option${selected ? ' pulse-seven-tv-option-selected' : ''}`}
              style={{
                ...styles.option,
                ...(selected
                  ? {
                      background: hexToRgba(plotColor, 0.16),
                      borderColor: plotColor,
                      boxShadow: `0 0 0 1px ${hexToRgba(plotColor, 0.2)}, inset 0 -2px 0 ${plotColor}`,
                    }
                  : null),
                ...(disabled ? styles.optionDisabled : null),
              }}
              data-plot-emote-state={selected ? 'selected' : 'available'}
              aria-label={`${emote.name}, ${formatCount(emote.count)} uses. ${hint}`}
              aria-pressed={selected}
              disabled={disabled}
              title={`${emote.name} · ${formatCount(emote.count)} uses · ${hint}`}
              onClick={() => onToggleEmote(emote)}
            >
              <PulseEmoteImg
                emote={emote}
                backendUrl={backendUrl}
                width={22}
                height={22}
                decorative
                showHoverPreview
                hoverPreviewPlacement="above"
                style={styles.emoteImg}
              />
              {selected ? <span style={styles.selectedMark} aria-hidden="true">✓</span> : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  panel: {
    alignItems: 'center',
    background: 'rgba(27, 28, 34, 0.82)',
    border: '1px solid rgba(255, 255, 255, 0.09)',
    borderRadius: 8,
    display: 'grid',
    gap: 8,
    gridTemplateColumns: 'auto minmax(0, 1fr)',
    marginTop: 8,
    overflow: 'visible',
    padding: '7px 8px 7px 10px',
  },
  heading: { display: 'grid', gap: 2, minWidth: 62 },
  label: {
    color: theme.textMuted,
    fontSize: 9,
    fontWeight: 800,
    letterSpacing: '0.05em',
    lineHeight: 1.1,
    textTransform: 'uppercase',
  },
  count: {
    color: theme.textSecondary,
    fontSize: 9,
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 750,
  },
  rail: {
    alignItems: 'center',
    display: 'flex',
    gap: 5,
    justifyContent: 'space-evenly',
    minWidth: 0,
    width: '100%',
  },
  option: {
    alignItems: 'center',
    background: 'rgba(255, 255, 255, 0.045)',
    border: '1px solid rgba(255, 255, 255, 0.13)',
    borderRadius: 999,
    color: theme.textPrimary,
    cursor: 'pointer',
    display: 'grid',
    flex: '0 0 34px',
    height: 34,
    isolation: 'isolate',
    justifyItems: 'center',
    padding: 5,
    position: 'relative',
    width: 34,
  },
  optionDisabled: { cursor: 'not-allowed', opacity: 0.42 },
  emoteImg: { display: 'block', objectFit: 'contain' },
  selectedMark: {
    alignItems: 'center',
    background: '#f8fafc',
    borderRadius: 999,
    bottom: -2,
    color: '#111217',
    display: 'flex',
    fontSize: 7,
    fontWeight: 950,
    height: 11,
    justifyContent: 'center',
    position: 'absolute',
    right: -2,
    width: 11,
  },
}
