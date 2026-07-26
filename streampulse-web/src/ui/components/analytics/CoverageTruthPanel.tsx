import type { HubFeaturedCoverageRow } from '../../../lib/publicHub'

export interface CoverageTruthPanelProps {
  rows: HubFeaturedCoverageRow[]
}

export function CoverageTruthPanel({ rows }: CoverageTruthPanelProps) {
  return (
    <section className="figma-panel figma-panel--coverage" aria-label="Coverage truth">
      <header><h3>Coverage truth</h3></header>
      {rows.length === 0 ? (
        <p className="muted">Coverage diagnostics appear when a qualifying session is featured.</p>
      ) : (
        <ul className="figma-coverage-list">
          {rows.map((row) => (
            <li key={row.label} className={row.ok ? 'ok' : 'warn'}>
              <span>{row.label}</span>
              <strong>{row.value}</strong>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
