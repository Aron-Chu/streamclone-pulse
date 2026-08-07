import type { CSSProperties } from 'react'
import { theme } from './theme.ts'

function SkeletonBlock({ style }: { style?: CSSProperties }) {
  return <div className="pulse-shimmer" style={{ ...styles.block, ...style }} aria-hidden="true" />
}

export function RecapSkeleton() {
  return (
    <div style={styles.wrap} aria-busy="true" aria-label="Loading stream recap">
      <SkeletonBlock style={styles.hero} />
      <div style={styles.statBand}>
        <SkeletonBlock style={styles.stat} />
        <SkeletonBlock style={styles.stat} />
      </div>
      <SkeletonBlock style={styles.highlight} />
      <div style={styles.emoteRow}>
        {Array.from({ length: 4 }, (_, index) => (
          <SkeletonBlock key={index} style={styles.emoteCell} />
        ))}
      </div>
      <div style={styles.momentList}>
        {Array.from({ length: 3 }, (_, index) => (
          <SkeletonBlock key={index} style={styles.momentRow} />
        ))}
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: { display: 'grid', gap: 10 },
  block: {
    background: 'var(--pulse-surface-hover-fill, rgba(255, 255, 255, 0.06))',
    borderRadius: 10,
    minHeight: 12,
  },
  hero: { height: 132 },
  statBand: { display: 'grid', gap: 8, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
  stat: { height: 56 },
  highlight: { height: 44 },
  emoteRow: { display: 'grid', gap: 6, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
  emoteCell: { height: 36 },
  momentList: { display: 'grid', gap: 6 },
  momentRow: { height: 40 },
}
