import { finishStroke, type SupporterFinishId } from './supporterFinish.ts'
import { SUPPORTER_CREST_GEMS, SUPPORTER_CREST_PULSE_PATH, SUPPORTER_TENURES, supporterTenureForMonths, type SupporterTenure } from '../shared/supporterPaint.ts'

export type SupporterBadgeTenure = SupporterTenure
export const SUPPORTER_BADGE_TENURES = SUPPORTER_TENURES
export const supporterBadgeTenureForMonths = supporterTenureForMonths

// Each stage gains a more recognizable silhouette and a rank detail. The badge
// remains a crisp 18px mark in chat: no filters, glow, or oversized footprint.
// The panel header draws the same art from the stylesheet.
export function SupporterBadge({ tenure = 'new', finish = null, size = 18 }: {
  tenure?: SupporterBadgeTenure
  finish?: SupporterFinishId | null
  size?: number
}) {
  const gem = SUPPORTER_CREST_GEMS[tenure]
  return <svg width={size} height={size} viewBox="0 0 18 18" style={{ flex: 'none', verticalAlign: 'middle' }} aria-hidden="true" focusable="false" data-supporter-badge={tenure} data-supporter-finish={finish ?? undefined}>
    <polygon points={gem.points} fill="#08080a" stroke={finish ? finishStroke(finish) : gem.edge} strokeWidth="1.5" strokeLinejoin="round" />
    {gem.crown ? <path d={gem.crown} fill="none" stroke="#ffe8a6" strokeWidth="1.1" strokeLinejoin="round" strokeLinecap="round" /> : null}
    <path d={gem.rank} fill="none" stroke={gem.edge} strokeWidth="1.5" strokeLinecap="round" />
    <path d={SUPPORTER_CREST_PULSE_PATH} fill="none" stroke="#ffffff" strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
  </svg>
}
