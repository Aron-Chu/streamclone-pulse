import type { HubEmote } from '../../../lib/publicHub'
import type { HubEmoteWithShare } from '../../../lib/emoteShare'
import { Skeleton } from '../../primitives'
import { EmoteImg } from './EmoteImg'
import { EmoteProviderIcon } from './EmoteProviderIcon'
import { SharePctDisplay } from './SharePctDisplay'
import { compact, emoteProviderColor, providerCssVarKey, providerLabel } from './hubFormat'

function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, value))
}

export type HubTopEmotesLayout = 'table' | 'leaderboard' | 'inspector'

export interface HubTopEmotesTableProps {
  emotes: HubEmote[]
  loading?: boolean
  maxRows?: number
  className?: string
  compactHead?: boolean
  layout?: HubTopEmotesLayout
  /** Stretch rows to fill a flex parent (sidebar inspector). */
  fill?: boolean
}

export function HubTopEmotesTable({
  emotes,
  loading = false,
  maxRows = 12,
  className = '',
  compactHead = false,
  layout = 'table',
  fill = false,
}: HubTopEmotesTableProps) {
  const top = emotes.slice(0, maxRows)
  const max = top.reduce((acc, e) => Math.max(acc, e.count), 0) || 1

  if (loading && emotes.length === 0) {
    return (
      <div
        className={`hub-top-emotes-table hub-top-emotes-table--loading${className ? ` ${className}` : ''}`}
        aria-busy="true"
      >
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} height={28} radius="0.35rem" />
        ))}
      </div>
    )
  }

  if (top.length === 0) {
    return (
      <p className={`hub-top-emotes-table__empty muted${className ? ` ${className}` : ''}`}>
        No emote traffic in the current window.
      </p>
    )
  }

  if (layout === 'inspector') {
    return (
      <ul
        className={`hub-top-emotes-inspector${fill ? ' hub-top-emotes-inspector--fill' : ''}${className ? ` ${className}` : ''}`}
        role="list"
        aria-label="Top emotes ranked by use count"
      >
        {top.map((emote, index) => {
          const rank = index + 1
          return (
            <li
              key={`${emote.provider ?? 'emote'}-${emote.name}-${index}`}
              data-rank={rank}
            >
              <span className="hub-top-emotes-inspector__rank tnum" aria-hidden="true">
                {rank}
              </span>
              <span className="figma-emote-chip hub-top-emotes-inspector__chip">
                <EmoteImg
                  src={emote.imageUrl}
                  name={emote.name}
                  width={18}
                  height={18}
                  fallbackClassName="figma-emote-chip__fallback"
                />
                <span className="hub-top-emotes-inspector__chip-text">
                  <span className="hub-top-emotes-inspector__chip-name" title={emote.name}>
                    {emote.name}
                  </span>
                  {emote.provider ? (
                    <span
                      className="pulse-moments__inspector-provider hub-top-emotes-inspector__provider"
                      data-provider={providerCssVarKey(emote.provider)}
                    >
                      {providerLabel(emote.provider)}
                    </span>
                  ) : null}
                </span>
              </span>
              <span className="hub-top-emotes-inspector__count tnum">{compact(emote.count)}</span>
              <span className="hub-top-emotes-inspector__share-cell">
                <span className="hub-top-emotes-inspector__bar" aria-hidden="true">
                  <i style={{ width: `${clampPct((emote.count / max) * 100)}%` }} />
                </span>
                <SharePctDisplay
                  sharePct={emote.sharePct}
                  shareEstimated={(emote as HubEmoteWithShare).shareEstimated}
                  className="hub-top-emotes-inspector__share"
                />
              </span>
            </li>
          )
        })}
      </ul>
    )
  }

  if (layout === 'leaderboard') {
    return (
      <ul
        className={`figma-burst-list figma-burst-list--ranked figma-burst-list--sidebar hub-top-emotes-sidebar${fill ? ' hub-top-emotes-sidebar--fill' : ''}${className ? ` ${className}` : ''}`}
        role="list"
        aria-label="Top emotes ranked by use count"
      >
        {top.map((emote, index) => (
          <li key={`${emote.provider ?? 'emote'}-${emote.name}-${index}`}>
            <span className="figma-emote-chip">
              <EmoteImg src={emote.imageUrl} name={emote.name} fallbackClassName="figma-emote-chip__fallback" />
              <span title={emote.name}>{emote.name}</span>
            </span>
            <span
              className="figma-burst-list__provider"
              data-provider={providerCssVarKey(emote.provider)}
            >
              {providerLabel(emote.provider)}
            </span>
            <span className="figma-burst-list__count">{compact(emote.count)}</span>
            <SharePctDisplay
              sharePct={emote.sharePct}
              shareEstimated={(emote as HubEmoteWithShare).shareEstimated}
            />
          </li>
        ))}
      </ul>
    )
  }

  return (
    <div className={`hub-top-emotes-table-wrap${className ? ` ${className}` : ''}`}>
      <table className="hub-top-emotes-table" aria-label="Top emotes ranked by use count">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Emote</th>
            {!compactHead ? <th scope="col">Provider</th> : null}
            <th scope="col">Uses</th>
            <th scope="col">Share</th>
          </tr>
        </thead>
        <tbody>
          {top.map((emote, index) => {
            const providerKey = providerCssVarKey(emote.provider)
            const barColor = emoteProviderColor(emote.provider)
            return (
              <tr
                key={`${emote.provider ?? 'emote'}-${emote.name}-${index}`}
                data-provider={providerKey}
              >
                <td className="hub-top-emotes-table__rank tnum">{index + 1}</td>
                <td className="hub-top-emotes-table__emote">
                  <span className="hub-top-emotes-table__cell">
                    <span className="hub-top-emotes-table__thumb" aria-hidden="true">
                      <EmoteImg src={emote.imageUrl} name={emote.name} width={20} height={20} />
                    </span>
                    <span className="hub-top-emotes-table__name" title={emote.name}>
                      {emote.name}
                    </span>
                    {compactHead ? (
                      <EmoteProviderIcon provider={emote.provider} size={14} className="hub-top-emotes-table__inline-provider" />
                    ) : null}
                  </span>
                </td>
                {!compactHead ? (
                  <td className="hub-top-emotes-table__provider">
                    <EmoteProviderIcon provider={emote.provider} size={16} />
                  </td>
                ) : null}
                <td className="hub-top-emotes-table__uses tnum">{compact(emote.count)}</td>
                <td className="hub-top-emotes-table__share">
                  <span className="hub-top-emotes-table__bar" aria-hidden="true">
                    <i
                      style={{
                        width: `${clampPct((emote.count / max) * 100)}%`,
                        background: barColor,
                      }}
                    />
                  </span>
                  <span className="tnum">
                    {emote.sharePct > 0 ? `${emote.sharePct.toFixed(1)}%` : '—'}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
