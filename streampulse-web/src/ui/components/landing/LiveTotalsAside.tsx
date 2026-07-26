import { useEffect, useState } from 'react'
import { formatApproximate, formatRelativeTime } from '../../../lib/formatStats'
import { fetchPublicStats, type PublicStats } from '../../../lib/publicApi'
import { useCountUp } from './useCountUp'
import { useInView } from './useInView'

const STAT_FIELDS: { key: keyof PublicStats; label: string; accent: string }[] = [
  { key: 'chatMessagesProcessed', label: 'Chat messages processed', accent: 'var(--sc-chart-2)' },
  { key: 'emotesIndexed', label: 'Emotes indexed', accent: 'var(--sc-chart-5)' },
  { key: 'streamsTracked', label: 'Streams tracked', accent: 'var(--sc-chart-1)' },
  { key: 'vodsAnalyzed', label: 'VODs analyzed', accent: 'var(--sc-chart-3)' },
]

function StatCell({
  label,
  target,
  accent,
  active,
}: {
  label: string
  target: number
  accent: string
  active: boolean
}) {
  const value = useCountUp(target, active)
  return (
    <li className="sl-total" style={{ ['--acc' as string]: `hsl(${accent})` }}>
      <span className="sl-total__n">{formatApproximate(value)}</span>
      <small>{label}</small>
      <span className="sl-total__spark" aria-hidden="true" />
    </li>
  )
}

/**
 * Horizontal "live corpus totals" band. Animated count-up when scrolled into
 * view; degrades to a quiet message if the public stats endpoint is unavailable.
 */
export function LiveTotalsAside() {
  const { ref, inView } = useInView()
  const [stats, setStats] = useState<PublicStats | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    void fetchPublicStats()
      .then((result) => {
        if (!cancelled) setStats(result.data)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <section className="sl-totals" ref={ref} aria-labelledby="live-totals-title">
      <div className="sl-totals__head">
        <h3 id="live-totals-title">Live corpus totals</h3>
        <span className="sl-totals__meta">
          {failed ? (
            'Totals are catching up — refresh shortly.'
          ) : stats ? (
            <>
              <span className="sl-dot" aria-hidden="true" />
              Updated {formatRelativeTime(stats.updatedAt)} · approximate
            </>
          ) : (
            <>
              <span className="sl-dot" aria-hidden="true" />
              Loading live totals…
            </>
          )}
        </span>
      </div>
      <ol className="sl-totals__row">
        {STAT_FIELDS.map(({ key, label, accent }) => (
          <StatCell
            key={key}
            label={label}
            accent={accent}
            active={inView && Boolean(stats)}
            target={stats ? (stats[key] as number) : 0}
          />
        ))}
      </ol>
    </section>
  )
}
