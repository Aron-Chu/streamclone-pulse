import type { FigmaEmoteBurst } from '../../../lib/figmaSessionAnalytics'
import type { HubEmote } from '../../../lib/publicHub'
import { withComputedBurstShare } from '../../../lib/emoteShare'
import { resolveBurstEmote } from '../../../lib/pulseMomentsUtils'
import { compact, providerLabel } from './hubFormat'
import { EmoteImg } from './EmoteImg'
import { SharePctDisplay } from './SharePctDisplay'

export interface TopEmoteBurstsPanelProps {
  bursts: FigmaEmoteBurst[]
  emoteLookup?: Map<string, HubEmote>
  variant?: 'default' | 'pulse-live'
  emptyHint?: string
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
  selectedCode,
  onSelectBurst,
  plotDisabledHint = 'No peak anchor from backend for this burst yet.',
}: TopEmoteBurstsPanelProps) {
  const isLive = variant === 'pulse-live'
  const plotEnabled = Boolean(onSelectBurst)
  const ranked = withComputedBurstShare(bursts)
  const maxCount = Math.max(...ranked.map((b) => b.count), 1)

  return (
    <section
      className={`figma-panel figma-panel--bursts${isLive ? ' pulse-moments__bursts figma-panel--scope-minute' : ''}`}
      aria-label="Top emote bursts"
    >
      <header>
        <h3>{isLive ? 'Selected minute emotes' : 'Top emote bursts'}</h3>
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
            <div className="pulse-moments__burst-table-head" aria-hidden="true">
              <span>#</span>
              <span>Emote</span>
              <span>Share</span>
              <span>Count</span>
              <span>%</span>
            </div>
          ) : null}
          <ul className={`figma-burst-list${isLive ? ' pulse-moments__burst-list' : ''}${plotEnabled ? ' figma-burst-list--plot' : ''} pulse-moments__bursts-body`}>
            {ranked.map((burst, index) => {
              const emote = resolveBurstEmote(burst, emoteLookup ?? new Map())
              const width = Math.max(8, Math.round((burst.count / maxCount) * 100))
              const active = selectedCode === burst.code
              const canPlot = plotEnabled && Number.isFinite(burst.peakOffsetSeconds)
              const rowKey = `${burst.code}-${burst.peakOffset ?? burst.count}-${index}`
              const content = (
                <>
                  <span className="pulse-moments__burst-rank">{index + 1}</span>
                  <span className="pulse-moments__burst-emote">
                    <EmoteImg src={emote.imageUrl} name={emote.name} fallbackClassName="pulse-moments__burst-emote-fallback" />
                    <span title={emote.name}>{emote.name}</span>
                    {emote.provider && !isLive ? <small>{providerLabel(emote.provider)}</small> : null}
                  </span>
                  {isLive ? (
                    <span className="pulse-moments__burst-bar" aria-hidden="true">
                      <span style={{ width: `${width}%` }} />
                    </span>
                  ) : null}
                  <span className="pulse-moments__burst-count">{compact(burst.count)}</span>
                  <SharePctDisplay
                    sharePct={burst.sharePct}
                    shareEstimated={burst.shareEstimated}
                    className="pulse-moments__burst-share"
                  />
                  {!isLive && burst.peakOffset ? <small>@ {burst.peakOffset}</small> : null}
                </>
              )

              if (plotEnabled) {
                return (
                  <li key={rowKey}>
                    <button
                      type="button"
                      className={`figma-burst-list__plot-btn${active ? ' is-active' : ''}${!canPlot ? ' is-disabled' : ''}`}
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

              return <li key={rowKey}>{content}</li>
            })}
          </ul>
        </div>
      )}
    </section>
  )
}
