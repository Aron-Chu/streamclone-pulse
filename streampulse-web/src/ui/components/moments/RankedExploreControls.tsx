import { RotateCcw, RefreshCw } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { RankedDiscovery } from '../../../lib/discoveryCatalogue'
import { MomentCategoryBrowser } from './MomentCategoryBrowser'
import { MomentSelect } from './MomentSelect'

export function RankedExploreControls({ params, indexedRetentionStart, certifiedThroughExclusive, retentionCheckedAt, data, loading, retained, error, invalid, notDeployed = false, onChange, onReset, onRefresh }: {
  params: URLSearchParams; now: Date; indexedRetentionStart?: string; certifiedThroughExclusive?: string; retentionCheckedAt?: string; data?: RankedDiscovery; loading: boolean; retained: boolean; error: string; invalid: boolean;
  /** The server has no ranked route at all (404); a temporary outage keeps the filters. */
  notDeployed?: boolean;
  onChange: (values: Record<string, string | null>) => void; onReset: () => void; onRefresh: () => void;
}) {
  const latestDay = certifiedThroughExclusive ? new Date(Date.parse(certifiedThroughExclusive) - 86_400_000).toISOString().slice(0, 10) : ''
  const period = params.get('period') || 'latest'
  const selected = params.get('categoryMissing') === 'true' ? '__unknown__' : params.get('category') || ''
  const checkedAt = (retentionCheckedAt || data?.asOf || '').replace('T', ' ').slice(0, 16)
  // On a server without ranked Explore, filters cannot change anything; keep only the retry.
  const unavailable = notDeployed && !data && !indexedRetentionStart && !loading && !invalid
  return <section className="moments-explore" aria-label="Explore filters">
    <div className="moments-explore-toolbar">
      {unavailable ? null : <><div className="moments-filter-field"><span>Period</span><MomentSelect aria-label="Period" value={period} onValueChange={value => onChange({ period: value, from: value === 'custom' ? latestDay : null, to: value === 'custom' ? latestDay : null })}>
        <option value="latest">Latest sealed day</option><option value="last7">Up to 7 sealed days</option><option value="custom">Custom range</option>
        {!['latest', 'last7', 'custom'].includes(period) ? <option value={period} disabled>Open or unsupported period</option> : null}
      </MomentSelect></div>
      {period === 'custom' ? <><label>From (UTC)<input aria-label="From (UTC)" type="date" min={indexedRetentionStart} max={latestDay} value={params.get('from') || ''} onChange={e => onChange({ from: e.target.value })} /></label>
        <label>Through (UTC, inclusive)<input aria-label="Through (UTC, inclusive)" type="date" min={indexedRetentionStart} max={latestDay} value={params.get('to') || ''} onChange={e => onChange({ to: e.target.value })} /></label></> : null}
      <label>Creator<input aria-label="Exact creator login" type="search" maxLength={25} value={params.get('creator') || ''} onChange={e => onChange({ creator: e.target.value.toLowerCase() || null })} placeholder="All creators" /></label>
      <span className="moments-muted">Order: observed IRC chat/min</span>
      <button type="button" onClick={onReset}><RotateCcw size={16} aria-hidden="true" />Reset Explore</button></>}
      <button type="button" disabled={loading || invalid} onClick={onRefresh}><RefreshCw size={16} aria-hidden="true" />Reload collection</button>
    </div>
    {data ? <p className="moments-muted" role="status">{retained ? 'Previous snapshot retained' : 'Snapshot'}: {data.asOf} · {data.from} through {new Date(Date.parse(data.to) - 86400000).toISOString().slice(0, 10)} UTC · {data.creator || 'All creators'} · {data.categoryMissing ? 'Unknown category' : data.category || 'All categories'} · Certified dates {indexedRetentionStart}–{latestDay}; checked {checkedAt} UTC · {data.freshness === 'stale' ? 'Index delayed' : 'Index ready'}</p> : indexedRetentionStart ? <p className="moments-muted">{`Certified dates ${indexedRetentionStart}–${latestDay} UTC · Checked ${checkedAt} UTC · Partial measurement`} · Up to 30 days inclusive</p>
      : loading ? <p className="moments-muted">Checking certified dates before loading a collection · Up to 30 days inclusive</p> : null}
    {data ? <p className="moments-muted">{data.coverage.state === 'partial' ? 'Partial measurement' : 'No indexed measurement'} · {data.coverage.indexedStreams.toLocaleString()} indexed completed broadcasts · {data.coverage.measuredMinutes.toLocaleString()} measured stream-minutes{data.dataThrough ? ` · Data through ${data.dataThrough}` : ''}</p> : null}
    {data ? <MomentCategoryBrowser facets={data.facets} selected={selected} onSelect={category => onChange({ category: category && category !== '__unknown__' ? category : null, categoryMissing: category === '__unknown__' ? 'true' : null })} /> : null}
    {data ? <p className="moments-muted" aria-label="Selection eligibility">
      {data.eligibility.totalDetections.toLocaleString()} matching detections · {data.items.length.toLocaleString()} of {data.eligibility.rankedDetections.toLocaleString()} ranked loaded
      {data.eligibility.excludedDetections > 0 ? <> · <span title="Excluded detections lack a verified IRC volume for this ranking.">{data.eligibility.excludedDetections.toLocaleString()} excluded from volume ranking</span></> : null}
    </p> : null}
    {loading && !data ? <p role="status">Checking indexed dates and loading ranked moments...</p> : null}
    {error ? <section className="moments-notice" role="status"><h2>{invalid ? 'Check Explore filters' : 'Ranked moments unavailable'}</h2><p>{error}</p>
      {!invalid ? <div className="moments-actions"><Link to="/analytics/moments?view=latest">Browse Latest moments</Link><Link to="/analytics">Open live activity</Link></div> : null}
    </section> : null}
  </section>
}
