import type { HubEmote } from '../../../lib/publicHub'
import { withComputedSharePct } from '../../../lib/emoteShare'
import { compact, providerCssVarKey, providerLabel } from './hubFormat'
import { EmoteImg } from './EmoteImg'
import { SharePctDisplay } from './SharePctDisplay'
import '../hub/hub.css'

export interface TopEmotesPanelProps {
  emotes: HubEmote[]
  windowLabel: string
  className?: string
  updatedAgo?: string
}

export function TopEmotesPanel({ emotes, windowLabel, className, updatedAgo }: TopEmotesPanelProps) {
  const ranked = withComputedSharePct(emotes)
  const seen = new Set<string>()
  const deduped = ranked.filter((emote) => {
    const key = `${emote.provider ?? 'emote'}-${emote.name.toLowerCase()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return (
    <aside
      className={`figma-panel figma-panel--scope-global${className ? ` ${className}` : ''}`}
      aria-label="Top emotes"
    >
      <div className="figma-panel__head">
        <span className="figma-panel__head-label">Top emotes — across tracked channels</span>
        <span className="figma-panel__head-meta">
          {windowLabel}
          {updatedAgo ? ` · as of ${updatedAgo}` : ''}
        </span>
      </div>
      {ranked.length === 0 ? (
        <div className="figma-panel__body muted">
          Top emotes appear when the public hub has provider rollups for this window.
        </div>
      ) : (
        <ul className="figma-burst-list figma-burst-list--ranked figma-burst-list--sidebar">
          {deduped.slice(0, 12).map((emote) => (
            <li key={`${emote.provider ?? 'emote'}-${emote.name}`}>
              <span className="figma-emote-chip">
                <EmoteImg src={emote.imageUrl} name={emote.name} fallbackClassName="figma-emote-chip__fallback" />
                <span>{emote.name}</span>
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
                shareEstimated={emote.shareEstimated}
              />
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
