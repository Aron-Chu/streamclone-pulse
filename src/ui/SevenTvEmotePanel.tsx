import type { CSSProperties } from 'react'
import { formatHeatOffset } from '@streamclone/pulse-core'
import type { ExtensionEmote, ExtensionRollup } from '../shared/messages.ts'
import {
  buildSelectedEmoteSeries,
  emoteOverlayColor,
  emoteSelectionKey,
  maxSeriesValue,
} from './chatActivityEmotes.ts'
import { PulseEmoteImg } from './PulseEmoteImg.tsx'
import { formatCount } from './mostReacted.ts'
import { theme } from './theme.ts'

export interface SevenTvEmotePanelProps {
  expanded: boolean
  onToggleExpanded: () => void
  backendUrl: string
  rollups: ExtensionRollup[]
  topEmotes: ExtensionEmote[]
  selectedKeys: string[]
  onToggleEmote: (emote: ExtensionEmote) => void
  selectedOffsetSeconds: number | null
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US', {
    notation: value >= 10_000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(value)
}

export function SevenTvEmotePanel({
  expanded,
  onToggleExpanded,
  backendUrl,
  rollups,
  topEmotes,
  selectedKeys,
  onToggleEmote,
  selectedOffsetSeconds,
}: SevenTvEmotePanelProps) {
  if (topEmotes.length === 0) return null

  const selectedEmotes = topEmotes.filter(emote => selectedKeys.includes(emoteSelectionKey(emote)))
  const previewNames = topEmotes.slice(0, 3).map(emote => emote.name).join(' · ')

  return (
    <div className="pulse-seven-tv-panel" style={styles.panel}>
      <button
        type="button"
        className="pulse-seven-tv-toggle"
        style={styles.toggle}
        onClick={onToggleExpanded}
        aria-expanded={expanded}
      >
        <span style={styles.toggleLabel}>7TV emotes</span>
        {!expanded && previewNames ? (
          <span style={styles.togglePreview}>{previewNames}</span>
        ) : null}
        {selectedEmotes.length > 0 ? (
          <span style={styles.toggleFocus}>{selectedEmotes.length} on chart</span>
        ) : null}
        <span style={styles.chevron} aria-hidden="true">
          {expanded ? '▾' : '▸'}
        </span>
      </button>

      {expanded ? (
        <div style={styles.body}>
          {selectedOffsetSeconds != null ? (
            <p style={styles.sliceNote}>
              Chart slice · {formatHeatOffset(selectedOffsetSeconds)} — selected emotes plot as lines on the chart above
            </p>
          ) : (
            <p style={styles.sliceNote}>Click emotes to add or remove their lines on the chat activity chart above</p>
          )}

          {selectedEmotes.length > 0 ? (
            <div style={styles.legendRow}>
              {selectedEmotes.map((emote, index) => {
                const series = buildSelectedEmoteSeries(rollups, emote)
                const peak = maxSeriesValue(series)
                const color = emoteOverlayColor(index)
                return (
                  <span key={emoteSelectionKey(emote)} className="pulse-seven-tv-legend" style={styles.legendChip}>
                    <span style={{ ...styles.legendDot, background: color }} aria-hidden="true" />
                    <span style={styles.legendName}>{emote.name}</span>
                    <span style={styles.legendMeta}>
                      max {formatNumber(peak)}
                      {index === 0 ? ' · focus' : ''}
                    </span>
                  </span>
                )
              })}
            </div>
          ) : null}

          <div className="pulse-no-scrollbar" style={styles.pillRow}>
            {topEmotes.map(emote => {
              const key = emoteSelectionKey(emote)
              const selected = selectedKeys.includes(key)
              const selectedIndex = selectedKeys.indexOf(key)
              const activeColor = selectedIndex >= 0 ? emoteOverlayColor(selectedIndex) : undefined
              return (
                <button
                  type="button"
                  key={key}
                  className={`pulse-seven-tv-pill${selected ? ' pulse-seven-tv-pill-active' : ''}`}
                  style={{
                    ...styles.pill,
                    ...(selected && activeColor
                      ? {
                          borderColor: `${activeColor}88`,
                          boxShadow: `inset 0 0 0 1px ${activeColor}33`,
                        }
                      : {}),
                  }}
                  aria-pressed={selected}
                  title={`${emote.name} · ${formatCount(emote.count)} uses · toggle chart line`}
                  onClick={() => onToggleEmote(emote)}
                >
                  <PulseEmoteImg
                    emote={emote}
                    backendUrl={backendUrl}
                    width={22}
                    height={22}
                    style={styles.pillImg}
                  />
                  <span style={styles.pillName}>{emote.name}</span>
                  <span style={styles.pillCount}>{formatCount(emote.count)}</span>
                </button>
              )
            })}
          </div>
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
    padding: '9px 12px',
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
    color: theme.textSecondary,
    flex: 1,
    fontSize: 10,
    fontWeight: 700,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  toggleFocus: {
    color: theme.rank1,
    flexShrink: 0,
    fontSize: 9,
    fontWeight: 800,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  },
  chevron: { color: theme.accentSoft, flexShrink: 0, fontSize: 11, fontWeight: 900 },
  body: {
    borderTop: '1px solid rgba(255, 255, 255, 0.06)',
    display: 'grid',
    gap: 10,
    padding: '10px 12px 12px',
  },
  sliceNote: {
    color: theme.textMuted,
    fontSize: 10,
    fontWeight: 600,
    lineHeight: 1.35,
    margin: 0,
  },
  legendRow: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  legendChip: {
    alignItems: 'center',
    background: 'rgba(255, 255, 255, 0.04)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: 999,
    display: 'inline-flex',
    gap: 6,
    padding: '4px 8px',
  },
  legendDot: { borderRadius: 999, flexShrink: 0, height: 8, width: 8 },
  legendName: { color: theme.textPrimary, fontSize: 10, fontWeight: 800 },
  legendMeta: { color: theme.textMuted, fontSize: 9, fontWeight: 700, textTransform: 'uppercase' },
  pillRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    maxHeight: 112,
    overflowY: 'auto',
  },
  pill: {
    alignItems: 'center',
    background: 'rgba(255, 255, 255, 0.04)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: 8,
    color: theme.textPrimary,
    cursor: 'pointer',
    display: 'inline-flex',
    flexShrink: 0,
    gap: 6,
    padding: '5px 8px',
  },
  pillImg: { display: 'block', objectFit: 'contain' },
  pillName: { fontSize: 11, fontWeight: 800, maxWidth: 72, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  pillCount: { color: theme.accentSoft, fontSize: 10, fontVariantNumeric: 'tabular-nums', fontWeight: 800 },
}
