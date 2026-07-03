export interface HubFreshnessCaptionProps {
  updatedAgo?: string
  className?: string
}

export function HubFreshnessCaption({ updatedAgo, className }: HubFreshnessCaptionProps) {
  if (!updatedAgo) return null
  return (
    <span className={`hub-freshness-caption${className ? ` ${className}` : ''}`}>
      As of {updatedAgo}
    </span>
  )
}
