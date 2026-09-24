import type { CSSProperties, ReactNode } from 'react'
import { theme } from './theme.ts'

export interface PulseSectionCardProps {
  title?: string
  subtitle?: string
  titleTone?: 'default' | 'muted'
  /** Heading level for callers that provide a higher-level page heading. */
  headingLevel?: 2 | 3
  meta?: ReactNode
  /** Stack controls below the heading for narrow sidebar cards. */
  stackMeta?: boolean
  children: ReactNode
  style?: CSSProperties
  className?: string
}

export function PulseSectionCard({
  title,
  subtitle,
  titleTone = 'default',
  headingLevel = 3,
  meta,
  stackMeta = false,
  children,
  style,
  className,
}: PulseSectionCardProps) {
  const classes = ['pulse-section-card', className].filter(Boolean).join(' ')
  return (
    <section className={classes} style={{ ...styles.card, ...style }}>
      {title ? (
        <div
          style={stackMeta ? { ...styles.heading, ...styles.headingStacked } : styles.heading}
          data-pulse-section-heading={stackMeta ? 'stacked' : 'inline'}
        >
          <div style={styles.headingMain}>
            {headingLevel === 2 ? (
              <h2 style={titleTone === 'muted' ? styles.titleMuted : styles.title}>{title}</h2>
            ) : (
              <h3 style={titleTone === 'muted' ? styles.titleMuted : styles.title}>{title}</h3>
            )}
            {subtitle ? <p style={styles.subtitle}>{subtitle}</p> : null}
          </div>
          {meta ? (
            <div
              style={stackMeta ? { ...styles.meta, ...styles.metaStacked } : styles.meta}
              data-pulse-section-meta="true"
            >
              {meta}
            </div>
          ) : null}
        </div>
      ) : null}
      {children}
    </section>
  )
}

const styles: Record<string, CSSProperties> = {
  card: {
    background: 'rgba(9, 9, 11, 0.6)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: 12,
    display: 'grid',
    gap: 12,
    marginBottom: 14,
    padding: 16,
  },
  heading: {
    alignItems: 'flex-start',
    display: 'flex',
    gap: 8,
    justifyContent: 'space-between',
    minWidth: 0,
    rowGap: 6,
    flexWrap: 'wrap',
  },
  headingStacked: {
    display: 'grid',
    gap: 6,
    gridTemplateColumns: 'minmax(0, 1fr)',
  },
  headingMain: {
    display: 'grid',
    flex: '1 1 180px',
    gap: 2,
    minWidth: 0,
  },
  title: {
    color: theme.textPrimary,
    fontSize: 13,
    fontWeight: 900,
    letterSpacing: '0.04em',
    margin: 0,
    textTransform: 'uppercase',
  },
  titleMuted: {
    color: theme.textMuted,
    fontSize: 11,
    fontWeight: 900,
    letterSpacing: '0.05em',
    margin: 0,
    textTransform: 'uppercase',
  },
  subtitle: {
    color: theme.textMuted,
    fontSize: 11,
    fontWeight: 600,
    lineHeight: 1.35,
    margin: 0,
  },
  meta: {
    alignItems: 'center',
    color: theme.textMuted,
    display: 'flex',
    flex: '0 1 auto',
    flexWrap: 'wrap',
    gap: 6,
    fontSize: 11,
    fontWeight: 700,
    justifyContent: 'flex-end',
    maxWidth: '100%',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    textAlign: 'right',
    whiteSpace: 'normal',
  },
  metaStacked: {
    flex: '1 1 100%',
    justifyContent: 'flex-start',
    maxWidth: '100%',
    textAlign: 'left',
  },
}
