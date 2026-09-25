import { finishStroke, type SupporterFinishId } from './supporterFinish.ts'

export type SupporterBadgeTenure = 'new' | '3m' | '6m' | '12m' | '24m'
export const SUPPORTER_BADGE_TENURES = [
  { id: 'new', months: 0, label: 'New' },
  { id: '3m', months: 3, label: '3 months' },
  { id: '6m', months: 6, label: '6 months' },
  { id: '12m', months: 12, label: '12 months' },
  { id: '24m', months: 24, label: '24 months' },
] as const satisfies ReadonlyArray<{ id: SupporterBadgeTenure; months: number; label: string }>

export function supporterBadgeTenureForMonths(months: number): SupporterBadgeTenure {
  const normalized = Number.isFinite(months) ? Math.max(0, Math.floor(months)) : 0
  let selected: (typeof SUPPORTER_BADGE_TENURES)[number] = SUPPORTER_BADGE_TENURES[0]
  for (const option of SUPPORTER_BADGE_TENURES) {
    if (option.months <= normalized) selected = option
  }
  return selected.id
}

// Each stage gains a more recognizable silhouette and a rank detail. The badge
// remains a crisp 18px mark in chat: no filters, glow, or oversized footprint.
const GEMS: Record<SupporterBadgeTenure, { edge: string; points: string; rank: string; crown?: string }> = {
  new: { edge: '#55f5c3', points: '4,2 14,2 16,4 16,14 14,16 4,16 2,14 2,4', rank: 'M7 14 H11' },
  '3m': { edge: '#59d9ff', points: '9,1.5 16.5,5 16.5,13 9,16.5 1.5,13 1.5,5', rank: 'M5.5 14 H12.5' },
  '6m': { edge: '#cc9cff', points: '5,1.5 13,1.5 17,7 14,16 4,16 1,7', rank: 'M5 14 H7.5 M10.5 14 H13' },
  '12m': { edge: '#ffe16b', points: '5,3 7,3 9,1 11,3 13,3 17,7 14,16 4,16 1,7', rank: 'M4.5 14 H6 M7.5 14 H10.5 M12 14 H13.5' },
  '24m': { edge: '#ff85be', points: '1.5,5.5 4.5,5.5 5.5,2.5 8,3.5 9,1 10,3.5 12.5,2.5 13.5,5.5 16.5,5.5 15,10 16,13.5 12.5,16.5 5.5,16.5 2,13.5 3,10', rank: 'M4.5 14 H13.5', crown: 'M4.5 5.5 L5.5 2.5 L8 3.5 L9 1 L10 3.5 L12.5 2.5 L13.5 5.5' },
}

export function SupporterBadge({ tenure = 'new', finish = null, size = 18 }: {
  tenure?: SupporterBadgeTenure
  finish?: SupporterFinishId | null
  size?: number
}) {
  const gem = GEMS[tenure]
  return <svg width={size} height={size} viewBox="0 0 18 18" style={{ flex: 'none', verticalAlign: 'middle' }} aria-hidden="true" focusable="false" data-supporter-badge={tenure} data-supporter-finish={finish ?? undefined}>
    <polygon points={gem.points} fill="#08080a" stroke={finish ? finishStroke(finish) : gem.edge} strokeWidth="1.5" strokeLinejoin="round" />
    {gem.crown ? <path d={gem.crown} fill="none" stroke="#ffe8a6" strokeWidth="1.1" strokeLinejoin="round" strokeLinecap="round" /> : null}
    <path d={gem.rank} fill="none" stroke={gem.edge} strokeWidth="1.5" strokeLinecap="round" />
    <path d="M4.5 10 H6.5 L8 6 L10 11.5 L11.5 8 L13.5 10" fill="none" stroke="#ffffff" strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
  </svg>
}
