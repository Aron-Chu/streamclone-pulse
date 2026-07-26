import { BACKEND_SHARE_TITLE, ESTIMATED_SHARE_TITLE, formatSharePctLabel } from '../../../lib/emoteShare'

export interface SharePctDisplayProps {
  sharePct: number
  shareEstimated?: boolean
  className?: string
}

export function SharePctDisplay({ sharePct, shareEstimated = false, className }: SharePctDisplayProps) {
  const label = formatSharePctLabel(sharePct)
  if (label === '—') return null
  const title = shareEstimated ? ESTIMATED_SHARE_TITLE : `${label} — ${BACKEND_SHARE_TITLE}`
  return (
    <small
      className={className ?? 'figma-burst-list__share'}
      title={title}
      aria-label={shareEstimated ? `${label} estimated share` : `${label} share of emote sends in window`}
    >
      {label}
      {shareEstimated ? (
        <abbr className="figma-burst-list__share-est" title={ESTIMATED_SHARE_TITLE}>
          est.
        </abbr>
      ) : null}
    </small>
  )
}
