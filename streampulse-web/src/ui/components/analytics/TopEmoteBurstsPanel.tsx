import type { FigmaEmoteBurst } from '../../../lib/figmaSessionAnalytics'
import type { HubEmote } from '../../../lib/publicHub'
import { withComputedBurstShare } from '../../../lib/emoteShare'
import { resolveBurstEmote } from '../../../lib/pulseMomentsUtils'
import { EmoteRankRow, emoteRankRowProps } from './EmoteRankRow'

export interface TopEmoteBurstsPanelProps {
  bursts: FigmaEmoteBurst[]
  emoteLookup?: Map<string, HubEmote>
  variant?: 'default' | 'pulse-live'
  emptyHint?: string
  maxRows?: number
  className?: string
  /** When set, rows are clickable for chart plotting (session dashboards only). */
  selectedCode?: string
  onSelectBurst?: (burst: FigmaEmoteBurst) => void
  /** Bursts without peakOffsetSeconds cannot anchor on the chart. */
  plotDisabledHint?: string
}

export function TopEmoteBurstsPanel({
  bursts,
  emoteLookup,
  variant = 'default',
  emptyHint,
  maxRows,
  className = '',
  selectedCode,
  onSelectBurst,
  plotDisabledHint = 'No peak anchor from backend for this burst yet.',
}: TopEmoteBurstsPanelProps) {
  const isLive = variant === 'pulse-live'
  const plotEnabled = Boolean(onSelectBurst)
  const ranked = withComputedBurstShare(bursts).slice(0, maxRows ?? bursts.length)
  const maxCount = Math.max(...ranked.map((b) => b.count), 1)
  const title = isLive ? 'Selected minute emotes' : 'Top emote bursts'

  return (
    <section
      className={`figma-panel figma-panel--bursts${isLive ? ' pulse-moments__bursts figma-panel--scope-minute' : ''}${className ? ` ${className}` : ''}`}
      aria-label={title}
    >
      <header>
        <h3>{title}</h3>
        {isLive && ranked.length > 0 ? (
          <p className="pulse-moments__bursts-subtitle">Emote breakdown (by share)</p>
        ) : null}
      </header>
      {ranked.length === 0 ? (
        <div className="pulse-moments__bursts-body pulse-moments__bursts-body--empty">
          <p className="muted">
            {emptyHint ??
              (isLive
                ? 'Select a reacted minute to inspect the emotes that drove that spike.'
                : 'Burst rows come from backend recap and peak emote stacks.')}
          </p>
        </div>
      ) : (
        <div className={isLive ? 'pulse-moments__burst-table-wrap' : undefined}>
          {isLive ? (
            <div
              className="pulse-moments__burst-table-head emote-rank-row"
              data-rank="true"
              aria-hidden="true"
            >
              <span>#</span>
              <span>Emote</span>
              <span>Count</span>
              <span>Share</span>
            </div>
          ) : null}
          <ul className={`emote-rank-list pulse-moments__bursts-body${isLive ? ' pulse-moments__burst-list' : ''}${plotEnabled ? ' emote-rank-list--plot' : ''}`}>
            {ranked.map((burst, index) => {
              const emote = resolveBurstEmote(burst, emoteLookup ?? new Map())
              const active = selectedCode === burst.code
              const canPlot = plotEnabled && Number.isFinite(burst.peakOffsetSeconds)
              const rowKey = `${burst.code}-${burst.peakOffset ?? burst.count}-${index}`
              const content = (
                <EmoteRankRow
                  rank={index + 1}
                  name={emote.name}
                  imageUrl={emote.imageUrl}
                  provider={emote.provider}
                  showProvider={false}
                  count={burst.count}
                  sharePct={burst.sharePct}
                  shareEstimated={burst.shareEstimated}
                  barPct={(burst.count / maxCount) * 100}
                  suffix={!isLive && burst.peakOffset ? <small>@ {burst.peakOffset}</small> : null}
                />
              )

              if (plotEnabled) {
                return (
                  <li key={rowKey}>
                    <button
                      type="button"
                      data-rank="true"
                      className={`emote-rank-row emote-rank-row--plot${active ? ' is-active' : ''}${!canPlot ? ' is-disabled' : ''}`}
                      aria-pressed={active}
                      disabled={!canPlot}
                      title={canPlot ? `Plot ${burst.code} on chart` : plotDisabledHint}
                      onClick={() => onSelectBurst?.(burst)}
                    >
                      {content}
                    </button>
                  </li>
                )
              }

              return (
                <li key={rowKey} {...emoteRankRowProps({ rank: true })}>
                  {content}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </section>
  )
}
