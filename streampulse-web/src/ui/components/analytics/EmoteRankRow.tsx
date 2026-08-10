import type { ReactNode } from 'react'
import { EmoteImg } from './EmoteImg'
import { SharePctDisplay } from './SharePctDisplay'
import { compact, providerCssVarKey, providerLabel } from './hubFormat'

export interface EmoteRankRowProps {
  name: string
  count: number
  imageUrl?: string
  rank?: number
  provider?: string | null
  /** Provider pill is hidden on single-provider or space-constrained lists. */
  showProvider?: boolean
  sharePct?: number
  shareEstimated?: boolean
  /** 0-100 bar fill. Omit to render the share number without a bar. */
  barPct?: number
  suffix?: ReactNode
}

/**
 * Cells for one emote leaderboard row. Rendered into a wrapper that carries
 * `emote-rank-row` (an `li`, or a `button` when the row is clickable) so every
 * emote list in the console shares one grid, one thumbnail, and one bar.
 */
export function EmoteRankRow({
  name,
  count,
  imageUrl,
  rank,
  provider,
  showProvider = true,
  sharePct,
  shareEstimated,
  barPct,
  suffix,
}: EmoteRankRowProps) {
  return (
    <>
      {rank != null ? (
        <span className="emote-rank-row__rank tnum" aria-hidden="true">
          {rank}
        </span>
      ) : null}
      <span className="emote-rank-row__emote">
        <EmoteImg src={imageUrl} name={name} fallbackClassName="emote-rank-row__fallback" />
        <span className="emote-rank-row__name" title={name}>
          {name}
        </span>
        {suffix}
      </span>
      {showProvider ? (
        <span className="emote-rank-row__provider-slot">
          {provider ? (
            <span className="emote-rank-row__provider" data-provider={providerCssVarKey(provider)}>
              {providerLabel(provider)}
            </span>
          ) : null}
        </span>
      ) : null}
      <span className="emote-rank-row__count tnum">{compact(count)}</span>
      <span className="emote-rank-row__share-cell">
        {barPct != null ? (
          <span className="emote-rank-row__bar" aria-hidden="true">
            <i style={{ width: `${Math.max(0, Math.min(100, barPct))}%` }} />
          </span>
        ) : null}
        <SharePctDisplay
          sharePct={sharePct ?? 0}
          shareEstimated={shareEstimated}
          className="emote-rank-row__share"
        />
      </span>
    </>
  )
}

/** Wrapper class + column hints for one `EmoteRankRow`. */
export function emoteRankRowProps(options: { rank?: boolean; provider?: boolean } = {}) {
  return {
    className: 'emote-rank-row',
    'data-rank': options.rank ? 'true' : undefined,
    'data-provider-col': options.provider ? 'true' : undefined,
  } as const
}
