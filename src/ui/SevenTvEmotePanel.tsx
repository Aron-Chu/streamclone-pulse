import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { ExtensionEmote, ExtensionRollup } from '../shared/messages.ts'
import {
  emoteActivityInRollups,
  emoteSelectionKey,
  type EmoteWindowActivity,
} from './chatActivityEmotes.ts'
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
  sidebarCompact = false,
  maxSelected = 6,
  rollupsLoading = false,
}: SevenTvEmotePanelProps) {
  const [showAll, setShowAll] = useState(false)
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

  if (topEmotes.length === 0) return null

  const selectedEmotes = topEmotes.filter(emote => selectedKeys.includes(emoteSelectionKey(emote)))
  const previewEmotes =
    selectedEmotes.length > 0
      ? selectedEmotes.slice(0, maxSelected)
      : topEmotes.slice(0, Math.min(6, maxSelected))
  const previewNames = previewEmotes.map(emote => emote.name).join(' · ')
  const selectedCount = selectedKeys.length
  const atCap = selectedCount >= maxSelected
  const hiddenCount = Math.max(0, topEmotes.length - INITIAL_VISIBLE_EMOTES)
  const visibleEmotes = showAll ? topEmotes : topEmotes.slice(0, INITIAL_VISIBLE_EMOTES)

  function handleChipActivate(emote: ExtensionEmote, activity: EmoteWindowActivity): void {
    if (activity !== 'active') return
    const key = emoteSelectionKey(emote)
    const selected = selectedKeys.includes(key)
    if (!selected && atCap) return
    onToggleEmote(emote)
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
          Plot on chart · {selectedCount}/{maxSelected}
        </span>
        {!expanded && previewEmotes.length > 0 ? (
          <span style={styles.togglePreview} title={previewNames} aria-hidden="true">
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
        <span
          className="pulse-seven-tv-chevron"
          data-emote-picker-chevron
          data-expanded={expanded ? 'true' : 'false'}
          style={{
            ...styles.chevron,
            transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
          }}
          aria-hidden="true"
        >
          ▾
        </span>
      </button>

      <div
        className="pulse-seven-tv-body"
        data-emote-picker-body
        data-expanded={expanded ? 'true' : 'false'}
        aria-hidden={!expanded}
        style={{ ...styles.body, ...(expanded ? styles.bodyExpanded : null) }}
      >
        <div>
          <div
            id="pulse-emote-picker-list"
            className="pulse-emote-picker-grid"
            style={styles.chipGrid}
            data-emote-picker-grid
            role="listbox"
            aria-label={`Plot on chart · ${selectedCount} of ${maxSelected} selected`}
            aria-multiselectable="true"
          >
            {visibleEmotes.map(emote => {
              const key = emoteSelectionKey(emote)
              const selected = selectedKeys.includes(key)
              const activity = activityByKey.get(key) ?? 'none'
              const plottable = activity === 'active'
              const disabled = !plottable || (!selected && atCap)
              const hint = activityHint(activity, maxSelected, !selected && atCap)
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
                  className={`pulse-seven-tv-chip${selected ? ' pulse-seven-tv-chip-active' : ''}${disabled ? ' pulse-seven-tv-chip-disabled' : ''}`}
                  style={{
                    ...styles.chip,
                    ...(sidebarCompact ? styles.chipCompact : null),
                    ...(selected ? styles.chipSelected : null),
                    ...(disabled ? styles.chipDisabled : null),
                  }}
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
                  <span style={styles.chipCount}>
                    {activity === 'loading' ? '…' : formatCount(emote.count)}
                  </span>
                  {selected ? <span style={styles.chipCheck} aria-hidden="true">✓</span> : null}
                </button>
              )
            })}
          </div>
          {hiddenCount > 0 ? (
            <button
              type="button"
              data-emote-picker-more
              className="pulse-seven-tv-more"
              style={styles.moreButton}
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
  chevron: {
    color: theme.accentSoft,
    flexShrink: 0,
    fontSize: 11,
    fontWeight: 900,
    marginLeft: 'auto',
    transition: 'transform .18s cubic-bezier(.2,0,0,1)',
  },
  body: {
    borderTop: '1px solid rgba(255, 255, 255, 0.06)',
    display: 'grid',
    gap: 7,
    maxHeight: 0,
    opacity: 0,
    overflow: 'hidden',
    padding: '7px 8px 8px',
    pointerEvents: 'none',
    transform: 'translateY(-4px)',
    transition: 'max-height .18s cubic-bezier(.2,0,0,1), opacity .18s cubic-bezier(.2,0,0,1), transform .18s cubic-bezier(.2,0,0,1)',
  },
  bodyExpanded: { maxHeight: 480, opacity: 1, pointerEvents: 'auto', transform: 'translateY(0)' },
  chipGrid: {
    alignItems: 'center',
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    minWidth: 0,
  },
  chip: {
    alignItems: 'center',
    background: 'rgba(255, 255, 255, 0.045)',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    borderRadius: 999,
    color: theme.textPrimary,
    cursor: 'pointer',
    display: 'inline-flex',
    flex: '0 1 auto',
    gap: 5,
    justifyContent: 'center',
    minHeight: 30,
    minWidth: 58,
    padding: '3px 8px 3px 5px',
  },
  chipCompact: { minHeight: 28, minWidth: 54, padding: '3px 7px 3px 4px' },
  chipSelected: {
    background: 'rgba(139, 92, 246, 0.18)',
    borderColor: 'rgba(196, 181, 253, 0.95)',
    boxShadow: '0 0 0 1px rgba(167, 139, 250, 0.78), 0 0 12px rgba(139, 92, 246, 0.2)',
  },
  chipDisabled: { cursor: 'not-allowed', opacity: 0.48 },
  chipImg: { display: 'block', flexShrink: 0, objectFit: 'contain' },
  chipCount: {
    color: theme.textSecondary,
    fontSize: 10,
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 800,
    lineHeight: 1,
  },
  chipCheck: { color: '#ddd6fe', fontSize: 11, fontWeight: 900, lineHeight: 1 },
  moreButton: {
    background: 'rgba(139, 92, 246, 0.1)',
    border: '1px solid rgba(167, 139, 250, 0.35)',
    borderRadius: 999,
    color: '#c4b5fd',
    cursor: 'pointer',
    fontSize: 9,
    fontWeight: 800,
    justifySelf: 'center',
    padding: '5px 10px',
  },
}
