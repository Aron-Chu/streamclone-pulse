import { useState } from 'react'
import type { CSSProperties } from 'react'
import type { ExtensionEmote, ExtensionRollup } from '../shared/messages.ts'
import { emoteSelectionKey } from './chatActivityEmotes.ts'
import { hexToRgba } from './chartTheme.ts'
import { PulseEmoteImg } from './PulseEmoteImg.tsx'
import { formatCount } from './mostReacted.ts'
import { theme } from './theme.ts'

const VISIBLE_CHIP_LIMIT = 5

export interface SevenTvEmotePanelProps {
  expanded: boolean
  onToggleExpanded: () => void
  backendUrl: string
  rollups: ExtensionRollup[]
  topEmotes: ExtensionEmote[]
  selectedKeys: string[]
  onToggleEmote: (emote: ExtensionEmote) => void
  selectedOffsetSeconds: number | null
  sidebarCompact?: boolean
  selectedPlotColors?: Record<string, string>
  maxSelected?: number
}

export function SevenTvEmotePanel({
  expanded,
  onToggleExpanded,
  backendUrl,
  topEmotes,
  selectedKeys,
  onToggleEmote,
  sidebarCompact = false,
  selectedPlotColors,
  maxSelected = 4,
}: SevenTvEmotePanelProps) {
  const [showAllChips, setShowAllChips] = useState(false)

  if (topEmotes.length === 0) return null

  const selectedEmotes = topEmotes.filter(emote => selectedKeys.includes(emoteSelectionKey(emote)))
  const previewEmotes = topEmotes.slice(0, 3)
  const previewNames = previewEmotes.map(emote => emote.name).join(' · ')
  const visibleEmotes = showAllChips ? topEmotes : topEmotes.slice(0, VISIBLE_CHIP_LIMIT)
  const hiddenCount = Math.max(0, topEmotes.length - VISIBLE_CHIP_LIMIT)

  return (
    <div className="pulse-seven-tv-panel" style={styles.panel}>
      <button
        type="button"
        className="pulse-seven-tv-toggle"
        style={styles.toggle}
        onClick={onToggleExpanded}
        aria-expanded={expanded}
      >
        <span style={styles.toggleLabel}>Plot on chart (0–{maxSelected})</span>
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
        {selectedEmotes.length > 0 ? (
          <span style={styles.toggleFocus}>{selectedEmotes.length}/{maxSelected} on chart</span>
        ) : null}
        <span style={styles.chevron} aria-hidden="true">
          {expanded ? '▾' : '▸'}
        </span>
      </button>

      {expanded ? (
        <div style={styles.body}>
          <div className="pulse-no-scrollbar" style={styles.rowList}>
            {visibleEmotes.map((emote, index) => {
              const key = emoteSelectionKey(emote)
              const selected = selectedKeys.includes(key)
              const plotColor = selected ? selectedPlotColors?.[key] : undefined
              const usePlotColor = Boolean(selected && plotColor)
              return (
                <button
                  type="button"
                  key={key}
                  className={
                    usePlotColor ? 'pulse-seven-tv-row' : `pulse-seven-tv-row${selected ? ' pulse-seven-tv-row-active' : ''}`
                  }
                  style={{
                    ...styles.row,
                    ...(index % 2 === 1 && !usePlotColor ? styles.rowAlt : null),
                    ...(sidebarCompact ? styles.rowCompact : null),
                    ...(usePlotColor
                      ? {
                          background: hexToRgba(plotColor!, 0.12),
                          borderColor: plotColor,
                        }
                      : null),
                  }}
                  aria-pressed={selected}
                  title={
                    !selected && selectedKeys.length >= maxSelected
                      ? `Max ${maxSelected} emotes on chart`
                      : `${emote.name} · ${formatCount(emote.count)} uses · toggle chart line`
                  }
                  onClick={() => onToggleEmote(emote)}
                >
                  <PulseEmoteImg
                    emote={emote}
                    backendUrl={backendUrl}
                    width={sidebarCompact ? 20 : 22}
                    height={sidebarCompact ? 20 : 22}
                    style={styles.rowImg}
                  />
                  <span style={styles.rowName}>{emote.name}</span>
                  <span
                    style={{
                      ...styles.rowCount,
                      ...(usePlotColor ? { color: plotColor } : null),
                    }}
                  >
                    {formatCount(emote.count)}
                  </span>
                </button>
              )
            })}
          </div>
          {hiddenCount > 0 && !showAllChips ? (
            <button type="button" style={styles.moreButton} onClick={() => setShowAllChips(true)}>
              More ({hiddenCount})
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  panel: {
    background: 'rgba(17, 17, 23, 0.72)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
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
  toggleFocus: {
    color: theme.textMuted,
    flexShrink: 0,
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: '0.03em',
    textTransform: 'uppercase',
  },
  chevron: { color: theme.accentSoft, flexShrink: 0, fontSize: 11, fontWeight: 900, marginLeft: 'auto' },
  body: {
    borderTop: '1px solid rgba(255, 255, 255, 0.06)',
    display: 'grid',
    gap: 6,
    padding: '6px 8px 8px',
  },
  rowList: {
    display: 'grid',
    gap: 4,
    maxHeight: 180,
    overflowY: 'auto',
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
  rowImg: { display: 'block', objectFit: 'contain' },
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
  moreButton: {
    background: 'transparent',
    border: 0,
    color: theme.accentSoft,
    cursor: 'pointer',
    fontSize: 10,
    fontWeight: 800,
    justifySelf: 'start',
    padding: 0,
    textTransform: 'uppercase',
  },
}
