import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { currentDiscoveryMonth, type DiscoveryCatalogue, type DiscoveryScope } from '../../../lib/discoveryCatalogue'
import { discoveryDayLabel } from '../../../lib/discoveryDayLabel'
import { DiscoveryYearOverview } from './DiscoveryYearOverview'
import type { DiscoveryPresentation } from '../../../lib/discoveryPresentation'
export { discoveryDayLabel } from '../../../lib/discoveryDayLabel'
import './discovery-calendar.css'

function CollectionTimestamp({ value }: { value: string | null }) {
  return value
    ? <time dateTime={value}>{new Date(value).toLocaleString()}</time>
    : <span>Unavailable</span>
}

export function DiscoveryCalendar({ scope, data, loading, presentation, onPresentationChange, onChange, onRecent }: {
  scope: DiscoveryScope; data?: DiscoveryCatalogue; loading: boolean
  presentation: DiscoveryPresentation; onPresentationChange: (values: Record<string, string | null>) => void
  onChange: (values: Record<string, string | null>) => void; onRecent: () => void
}) {
  const [creator, setCreator] = useState(scope.creator)
  const reviewedDay = useRef<{ creator: string; day: string }>()
  const { mode, measure: metric } = presentation
  useEffect(() => setCreator(scope.creator), [scope.creator])
  const month = /^\d{4}-\d{2}$/.test(scope.month) ? scope.month : currentDiscoveryMonth()
  const start = new Date(`${month}-01T00:00:00Z`)
  const valid = Number.isFinite(start.getTime())
  const offset = valid ? (start.getUTCDay() + 6) % 7 : 0
  function move(delta: number) {
    if (!valid) return
    const next = new Date(start); next.setUTCMonth(next.getUTCMonth() + delta)
    onChange({ month: next.toISOString().slice(0, 7), day: null })
  }
  const max = Math.max(1, ...((data?.days ?? []).map(day => day[metric] ?? 0)))
  const selected = data?.days.find(day => day.day === scope.day)
  const metricLabel = { detections: 'Detected moments', chatMessages: 'Chat messages', emoteUses: 'Emote uses' }[metric]
  const measuredDays = data?.days.filter(day => day.state === 'measured') ?? []
  const total = measuredDays.reduce((sum, day) => sum + (day[metric] ?? 0), 0)
  const compact = (value: number) => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value)
  return <section className="discovery-calendar" aria-label="Browse measured activity by day">
    <div className="discovery-calendar__heading"><div><h2>{scope.creator ? `@${scope.creator}` : 'Stored activity'}</h2><p>Browse by day · {scope.creator ? 'Creator history' : 'Across indexed tracked streams'} · UTC</p></div><button type="button" onClick={onRecent}>Return to recent feed</button></div>
    <div className="discovery-calendar__modes" aria-label="Activity calendar layout"><button type="button" aria-pressed={mode === 'month'} onClick={() => onPresentationChange({ calendar: null })}>Month detail</button><button type="button" aria-pressed={mode === 'year'} onClick={() => onPresentationChange({ calendar: 'year' })}>Year overview</button></div>
    {mode === 'month' && loading && !data ? <p role="status">Checking stored activity…</p> : null}
    <div className={`discovery-calendar__body${mode === 'year' ? ' discovery-calendar__body--overview' : ''}`}><div className="discovery-calendar__scope">
    <details className="discovery-calendar__creator" open={scope.creator ? undefined : true}><summary>Change creator</summary>
    <form className="discovery-calendar__controls" onSubmit={event => { event.preventDefault(); onChange({ creator: creator.trim().toLowerCase() || null, day: null }) }}>
      <label>Creator <input aria-label="Browse creator login" value={creator} onChange={event => setCreator(event.target.value)} maxLength={25} pattern="[A-Za-z0-9_]*" placeholder="All indexed creators" /></label>
      <button type="submit">Apply creator</button>{scope.creator ? <button type="button" onClick={() => onChange({ creator: null, day: null })}>All creators</button> : null}
    </form></details>
    {mode === 'month' ? <label className="discovery-calendar__month-input">Month (UTC) <input type="month" aria-label="Browse month UTC" value={scope.month} min="2011-01" max={currentDiscoveryMonth()} onChange={event => onChange({ month: event.target.value, day: null })} /></label> : null}
    {mode === 'month' && data && data.state !== 'unavailable' ? <div className="discovery-calendar__summary">
      <label>Calendar measure <select aria-label="Calendar measure" value={metric} onChange={event => onPresentationChange({ measure: event.target.value })}><option value="detections">Detected moments</option><option value="chatMessages">Chat messages</option><option value="emoteUses">Emote uses</option></select></label>
      <p><strong>{total.toLocaleString()}</strong> {metricLabel.toLowerCase()} · whole month<br />{measuredDays.length} days with indexed measurements</p>
      <p className="moments-muted">Counts and shading use the same measure. Darker means less activity, not worse clips. A dash means no measurement or a future day—not zero.</p>
      <details><summary>About this collection</summary><p className="moments-muted">Indexed broadcasts only; coverage can be partial. Category, search and sort narrow loaded results, not calendar totals. Reaction counts are not a watchability rating.</p></details>
    </div> : null}
    </div>
    {mode === 'month' && data?.state === 'unavailable' ? <p role="status">No stored discovery projection is available for this scope. This does not mean no activity occurred.</p> : null}
    {mode === 'month' && data && data.state !== 'unavailable' ? <>
      <div className="discovery-calendar__activity">
      <div className="discovery-calendar__month"><button type="button" aria-label="Previous activity month" title="Previous activity month" disabled={month <= '2011-01'} onClick={() => move(-1)}><ChevronLeft size={16} aria-hidden="true" /></button><strong>{valid ? start.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }) : month}</strong><button type="button" aria-label="Next activity month" title="Next activity month" disabled={month >= currentDiscoveryMonth()} onClick={() => move(1)}><ChevronRight size={16} aria-hidden="true" /></button><button type="button" onClick={() => onChange({ day: null })} aria-pressed={!scope.day}>Whole month</button></div>
      <div className="discovery-calendar__days" aria-label="UTC activity days" aria-busy={loading}>
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => <span className="discovery-calendar__weekday" key={day}>{day}</span>)}
        {Array.from({ length: offset }, (_, i) => <span key={`pad-${i}`} aria-hidden="true" />)}
        {data.days.map(day => <button key={day.day} type="button" disabled={day.state === 'future'} aria-label={discoveryDayLabel(day)} title={discoveryDayLabel(day)} aria-pressed={scope.day === day.day}
          data-state={day.state} data-level={day.state === 'measured' ? Math.ceil(((day[metric] ?? 0) / max) * 4) : undefined}
          onClick={() => onChange({ day: day.day })}><span>{Number(day.day.slice(-2))}</span><small title={`${metricLabel}: ${day[metric]?.toLocaleString() ?? 'unavailable'}`}>{day.state === 'measured' ? compact(day[metric] ?? 0) : '—'}</small></button>)}
      </div>
      </div>
    </> : null}</div>
    {mode === 'year' ? <DiscoveryYearOverview presentation={presentation} creator={scope.creator} onChange={onPresentationChange}
      selectedDay={scope.day}
      returnDay={reviewedDay.current?.creator === scope.creator ? reviewedDay.current.day : undefined}
      onDay={day => { reviewedDay.current = { creator: scope.creator, day }; onChange({ month: day.slice(0, 7), day, calendar: 'year' }) }} /> : null}
    {data && data.state !== 'unavailable' ? <section className="discovery-calendar__collection-status" aria-label="Collection status">
      <details><summary><span className="discovery-calendar__state" data-state={data.state}>{data.state === 'stale' ? 'May be stale' : 'Stored results ready'}</span> · Indexed tracked broadcasts · partial coverage</summary>
        <dl>
          <div><dt>Oldest projector check in scope</dt><dd><CollectionTimestamp value={data.projectionUpdatedAt} /></dd></div>
          <div><dt>Latest supplied measured time</dt><dd><CollectionTimestamp value={data.dataThrough} /></dd></div>
        </dl>
        <p className="moments-muted">Latest supplied measured time is not a claim of contiguous or complete coverage.</p>
      </details>
    </section> : null}
    {data && data.state !== 'unavailable' ? <>
      {selected ? <p role="status" className="discovery-calendar__selection">{discoveryDayLabel(selected)}</p> : null}
      {data.state === 'stale' ? <p role="status">Stored results may be stale. Oldest projection check: {data.projectionUpdatedAt ? new Date(data.projectionUpdatedAt).toLocaleString() : 'unavailable'}.</p> : null}
    </> : null}
  </section>
}
