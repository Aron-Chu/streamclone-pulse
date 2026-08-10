import type { HubEmote } from '../../../lib/publicHub'
import type { HubEmoteWithShare } from '../../../lib/emoteShare'
import { Skeleton } from '../../primitives'
import { EmoteImg } from './EmoteImg'
import { EmoteProviderIcon } from './EmoteProviderIcon'
import { EmoteRankRow, emoteRankRowProps } from './EmoteRankRow'
import { compact, emoteProviderColor, providerCssVarKey } from './hubFormat'

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
        className={`hub-top-emotes-inspector emote-rank-list${fill ? ' hub-top-emotes-inspector--fill' : ''}${className ? ` ${className}` : ''}`}
        role="list"
        aria-label="Top emotes ranked by use count"
      >
        {top.map((emote, index) => (
          <li
            key={`${emote.provider ?? 'emote'}-${emote.name}-${index}`}
            {...emoteRankRowProps({ rank: true, provider: true })}
          >
            <EmoteRankRow
              rank={index + 1}
              name={emote.name}
              imageUrl={emote.imageUrl}
              provider={emote.provider}
              count={emote.count}
              sharePct={emote.sharePct}
              shareEstimated={(emote as HubEmoteWithShare).shareEstimated}
              barPct={(emote.count / max) * 100}
            />
          </li>
        ))}
      </ul>
    )
  }

  if (layout === 'leaderboard') {
    return (
      <ul
        className={`hub-top-emotes-sidebar emote-rank-list${fill ? ' hub-top-emotes-sidebar--fill' : ''}${className ? ` ${className}` : ''}`}
        role="list"
        aria-label="Top emotes ranked by use count"
      >
        {top.map((emote, index) => (
          <li
            key={`${emote.provider ?? 'emote'}-${emote.name}-${index}`}
            {...emoteRankRowProps({ rank: true, provider: true })}
          >
            <EmoteRankRow
              rank={index + 1}
              name={emote.name}
              imageUrl={emote.imageUrl}
              provider={emote.provider}
              count={emote.count}
              sharePct={emote.sharePct}
              shareEstimated={(emote as HubEmoteWithShare).shareEstimated}
              barPct={(emote.count / max) * 100}
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
