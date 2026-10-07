import { RefreshCw, X } from 'lucide-react'
import { useRef } from 'react'
import { Link } from 'react-router-dom'
import type { RankedDiscovery } from '../../../lib/discoveryRanked'
import { historyRecentWindow } from '../../../lib/discoveryRanked'
import type { DiscoveryDay } from '../../../lib/discoveryCatalogue'
import { DiscoveryYearOverview } from './DiscoveryYearOverview'
import { useCreatorDraft } from './useCreatorDraft'
import './discovery-calendar.css'

export function HistoryExplorerControls({ params, now, indexedRetentionStart, certifiedThroughExclusive, retentionCheckedAt, days, data, loading, error, invalid, retained, onChange, onRefresh }: {
  params: URLSearchParams; now: Date; indexedRetentionStart?: string; certifiedThroughExclusive?: string; retentionCheckedAt?: string; days?: DiscoveryDay[]; data?: RankedDiscovery; loading: boolean; error: string; invalid: boolean; retained: boolean;
  onChange: (values: Record<string, string | null>, options?: { replace?: boolean }) => void; onRefresh: () => void;
}) {
  const creator = params.get('scope') === 'creator' || (!params.has('scope') && params.get('collection') === 'history') ? params.get('creator') || '' : ''
  const creatorDraft = useCreatorDraft(creator, login => onChange({ scope: login ? 'creator' : null, creator: login || null }, { replace: true }))
  const checkedRange = indexedRetentionStart && certifiedThroughExclusive ? { creator, recent: historyRecentWindow(now, indexedRetentionStart, certifiedThroughExclusive),
    days: error ? undefined : days, certifiedAsOf: retentionCheckedAt, checkedAt: (retentionCheckedAt || data?.asOf || '').replace('T', ' ').slice(0, 16) } : undefined
  // Once a range has been shown the controls stay mounted, and the last checked
  // calendar stays in place while a new creator's range is checked, so the open
  // Filters panel and its focused field never remount or move under the reader.
  // An unavailable range ends that: a later retry does not bring the old calendar back.
  const filtersShown = useRef(false)
  const lastRange = useRef(checkedRange)
  if (checkedRange) filtersShown.current = true
  if (checkedRange || !loading) lastRange.current = checkedRange
  const retainedRange = !checkedRange && loading ? lastRange.current : undefined
  const shown = checkedRange ?? retainedRange
  const unavailableNotice = <div className="moments-notice" role="status"><h3>{loading ? 'Checking certified dates…' : 'History unavailable'}</h3>
    <p>{loading ? 'Checking the certified retained range before loading a date.' : error || 'No verified retained UTC day is available yet.'}</p>
    {!loading ? <button type="button" data-keeps-selection onClick={onRefresh}>Retry history</button> : null}
    <Link to="/analytics/moments?view=recent">Browse Latest moments</Link>
  </div>
  if (!shown && !filtersShown.current) return <section className="discovery-calendar moments-history" aria-label="Global moment history">
    <div className="moments-history__header"><h2>{creator ? '@' + creator : 'Global moments'}</h2><span className="moments-muted">Certified dates unavailable</span></div>
    {unavailableNotice}
  </section>
  const day = params.get('day') || ''
  const month = params.get('month') || ''
  const heading = shown ? shown.creator : creator
  return <section className="discovery-calendar moments-history" aria-label="Global moment history">
    <div className="moments-history__header">
      <h2>{heading ? '@' + heading : 'Global moments'}</h2>
      <span className="moments-muted">{shown ? `Certified range checked ${shown.checkedAt} UTC · Completed dates ${shown.recent.from}–${shown.recent.latestDay} · Partial measurement` : 'Certified dates unavailable'}</span>
    </div>
    {!shown ? unavailableNotice : shown.days ? <DiscoveryYearOverview presentation={{ mode: 'year', year: shown.recent.latestDay.slice(0, 4), years: 1, measure: 'detections' }} creator={shown.creator} compact selectedDay={day}
      visibleFrom={shown.recent.from} visibleTo={shown.recent.latestDay} certifiedDays={shown.days} certifiedAsOf={shown.certifiedAsOf}
      onChange={onChange} onDay={selected => onChange({ year: null, day: selected === day ? null : selected })} />
      : <p role="status">{invalid
        ? 'Certified calendar hidden for this unsupported selection. Open recent volume history to reset the filter.'
        : 'Certified calendar hidden until this ranking is verified again.'}</p>}
    <div className="moments-history__ranking">
      <span className="moments-muted">Order: observed IRC chat/min</span>
      <span className="moments-muted">{day || (month ? `Month ${month} · date filter` : 'Recent date range')}{day ? <button type="button" aria-label="Clear day selection" title="Recent date range" onClick={() => onChange({ day: null, year: null, month: null })}><X size={16} /></button> : null}</span>
      <button type="button" data-keeps-selection disabled={loading} aria-label="Refresh rankings" title="Refresh rankings" onClick={onRefresh}><RefreshCw size={16} /></button>
    </div>
    <p className="moments-muted">Observed IRC chat per detected moment’s minute · indexed completed broadcasts only</p>
    <details className="moments-history__filters"><summary>Filters{creator || params.get('category') || params.get('categoryMissing') === 'true' ? ' · active' : ''}</summary>
      <div className="discovery-calendar__controls">
        <label>Creator<input aria-label="History creator" {...creatorDraft} maxLength={25} placeholder="All creators" /></label>
        <label>Day (UTC)<input aria-label="History day" type="date" min={shown?.recent.from} max={shown?.recent.latestDay} value={day} onChange={event => onChange({ year: null, day: event.target.value || null })} /></label>
        <label>Category<select aria-label="History category" value={params.get('categoryMissing') === 'true' ? '__unknown__' : params.get('category') || ''} onChange={event => onChange({ category: event.target.value && event.target.value !== '__unknown__' ? event.target.value : null, categoryMissing: event.target.value === '__unknown__' ? 'true' : null })}>
          <option value="">All categories</option>
          {params.get('categoryMissing') === 'true' && !data?.facets.some(f => f.categoryMissing) ? <option value="__unknown__">Unknown</option> : null}
          {params.get('category') && !data?.facets.some(f => f.category === params.get('category')) ? <option>{params.get('category')}</option> : null}
          {data?.facets.map(facet => <option key={facet.categoryMissing ? '__unknown__' : facet.category} value={facet.categoryMissing ? '__unknown__' : facet.category}>{facet.category}</option>)}
        </select></label>
        <button type="button" onClick={() => onChange({ creator: null, scope: null, category: null, categoryMissing: null, year: null, day: null })}>Clear filters</button>
      </div>
    </details>
    {retainedRange ? <p role="status">Checking certified dates…</p> : null}
    {retained && data ? <p role="status">Previous volume ranking retained while this selection is unavailable or loading: {data.from} to {data.to} (exclusive), {data.creator || 'global'}.</p> : null}
    {checkedRange && error ? <div className="moments-notice" role="status"><h3>Rankings unavailable</h3><p>{error}</p><button type="button" data-keeps-selection disabled={loading} onClick={onRefresh}>Retry rankings</button>{invalid ? <button type="button" onClick={() => onChange({ year: null, month: null, day: null, sort: 'volume' })}>Open recent volume history</button> : null}<Link to="/analytics/moments?view=recent">Browse Latest moments</Link></div> : null}
    {data && !retained ? <p className="moments-muted">{data.coverage.state === 'none' ? 'No indexed measurement in this selection' : `${data.eligibility.rankedDetections.toLocaleString()} ranked detected moments · ${data.coverage.indexedStreams.toLocaleString()} indexed completed broadcasts · Partial measurement`}{data.freshness === 'stale' ? ' · Index delayed' : ''}</p> : null}
  </section>
}
