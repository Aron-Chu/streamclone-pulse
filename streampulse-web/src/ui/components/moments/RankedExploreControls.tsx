import { RotateCcw, RefreshCw } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { RankedDiscovery } from '../../../lib/discoveryCatalogue'
import { MomentCategoryBrowser } from './MomentCategoryBrowser'
import { MomentSelect } from './MomentSelect'

export function RankedExploreControls({ params, data, loading, retained, error, invalid, onChange, onReset, onRefresh }: {
  params: URLSearchParams; data?: RankedDiscovery; loading: boolean; retained: boolean; error: string; invalid: boolean;
  onChange: (values: Record<string, string | null>) => void; onReset: () => void; onRefresh: () => void;
}) {
  const today = (data?.asOf ?? new Date().toISOString()).slice(0, 10)
  const period = params.get('period') || 'today'
  const selected = params.get('categoryMissing') === 'true' ? '__unknown__' : params.get('category') || ''
  return <section className="moments-explore" aria-label="Explore filters">
    <div className="moments-explore-toolbar">
      <div className="moments-filter-field"><span>Period</span><MomentSelect aria-label="Period" value={period} onValueChange={value => onChange({ period: value, from: value === 'custom' ? today : null, to: value === 'custom' ? today : null })}>
        <option value="today">Today</option><option value="yesterday">Yesterday</option><option value="week">This week</option><option value="custom">Custom range</option>
      </MomentSelect></div>
      {period === 'custom' ? <><label>From (UTC)<input aria-label="From (UTC)" type="date" max={today} value={params.get('from') || ''} onChange={e => onChange({ from: e.target.value })} /></label>
        <label>Through (UTC, inclusive)<input aria-label="Through (UTC, inclusive)" type="date" max={today} value={params.get('to') || ''} onChange={e => onChange({ to: e.target.value })} /></label></> : null}
      <label>Creator<input aria-label="Exact creator login" type="search" maxLength={25} value={params.get('creator') || ''} onChange={e => onChange({ creator: e.target.value.toLowerCase() || null })} placeholder="All creators" /></label>
      <div className="moments-filter-field"><span>Sort</span><MomentSelect aria-label="Ranked order" value="top" onValueChange={() => {}}><option value="top">Top</option></MomentSelect></div>
      <button type="button" onClick={onReset}><RotateCcw size={16} aria-hidden="true" />Reset Explore</button>
      <button type="button" disabled={loading || invalid} onClick={onRefresh}><RefreshCw size={16} aria-hidden="true" />Reload collection</button>
    </div>
    {data ? <p className="moments-muted" role="status">{retained ? 'Previous snapshot retained' : 'Snapshot'}: {data.asOf} · {data.from} through {new Date(Date.parse(data.to) - 86400000).toISOString().slice(0, 10)} UTC · {data.creator || 'All creators'} · {data.categoryMissing ? 'Unknown category' : data.category || 'All categories'} · {data.freshness === 'stale' ? 'Index delayed' : 'Index ready'}</p> : <p className="moments-muted">UTC calendar days · Up to 31 days inclusive</p>}
    {data ? <p className="moments-muted">{data.coverage.state === 'partial' ? 'Partial measurement' : 'No indexed measurement'} · {data.coverage.indexedStreams.toLocaleString()} indexed streams · {data.coverage.measuredMinutes.toLocaleString()} measured stream-minutes{data.dataThrough ? ` · Data through ${data.dataThrough}` : ''}</p> : null}
    <MomentCategoryBrowser facets={data?.facets ?? []} selected={selected} onSelect={category => onChange({ category: category && category !== '__unknown__' ? category : null, categoryMissing: category === '__unknown__' ? 'true' : null })} />
    {data ? <p className="moments-muted" aria-label="Selection eligibility">
      {data.eligibility.totalDetections.toLocaleString()} matching detections · {data.items.length.toLocaleString()} of {data.eligibility.rankedDetections.toLocaleString()} ranked loaded
      {data.eligibility.excludedDetections > 0 ? <> · <span title="Excluded detections do not have an eligible, trusted score for this ranking.">{data.eligibility.excludedDetections.toLocaleString()} excluded from comparable ranking</span></> : null}
    </p> : null}
    {loading && !data ? <p role="status">Loading ranked categories and moments...</p> : null}
    {error ? <section className="moments-notice" role="status"><h2>{invalid ? 'Check Explore filters' : 'Ranked moments unavailable'}</h2><p>{error}</p>
      {!invalid ? <div className="moments-actions"><Link to="/analytics/moments?view=latest">Browse Latest moments</Link><Link to="/analytics">Open live activity</Link></div> : null}
    </section> : null}
  </section>
}
