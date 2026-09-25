import { useEffect, useRef, useState } from 'react'
import { fetchDiscoveryYear, type DiscoveryYear } from '../../../lib/discoveryYear'
import { apiClient } from '../../../lib/apiClient'
import { normalizeDiscoveryCatalogue, type DiscoveryDay } from '../../../lib/discoveryCatalogue'
import { discoveryErrorMessage } from '../../../lib/discoveryError'
import { discoveryDayLabel } from '../../../lib/discoveryDayLabel'
import { discoveryOverviewYears, type DiscoveryMeasure, type DiscoveryPresentation } from '../../../lib/discoveryPresentation'
import { DiscoveryIntensityLegend, discoveryMeasureLabels } from './DiscoveryIntensityLegend'

const measureLabels = discoveryMeasureLabels
interface YearResult { year: string; data?: DiscoveryYear; error?: string }

const DAY_MS = 86_400_000

// History shows at most 30 retained UTC dates. A span around February can
// touch three months; never turn an arbitrary URL range into unbounded reads.
function recentWindowMonths(from: string, to: string): string[] | null {
  const start = Date.parse(`${from}T00:00:00Z`)
  const end = Date.parse(`${to}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)
    || !Number.isFinite(start) || !Number.isFinite(end)
    || new Date(start).toISOString().slice(0, 10) !== from || new Date(end).toISOString().slice(0, 10) !== to
    || end < start || (end - start) / DAY_MS >= 30) return null
  const months: string[] = []
  const cursor = new Date(Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, 1))
  for (let i = 0; i < 3; i++) {
    const month = cursor.toISOString().slice(0, 7)
    months.push(month)
    if (month === to.slice(0, 7)) return months
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  }
  return null
}

async function fetchRecentActivity(from: string, to: string, months: string[], creator: string, signal: AbortSignal): Promise<DiscoveryYear> {
  const days: DiscoveryYear['days'] = []
  let state: DiscoveryYear['state'] = 'ready'
  let asOf = ''
  let dataThrough: string | null = null
  let projectionUpdatedAt: string | null = null
  for (const month of months) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    const query = new URLSearchParams({ month, limit: '1' })
    if (creator) query.set('login', creator)
    const { data } = await apiClient<unknown>(`/v1/public/discovery?${query}`, { signal, timeoutMs: 8000, maxResponseBytes: 150_000 })
    const summary = normalizeDiscoveryCatalogue(data, { month, creator, day: '' })
    if (summary.state === 'unavailable') return { year: `${from}–${to}`, days: [], state: 'unavailable', asOf: summary.asOf, dataThrough: null, projectionUpdatedAt: null }
    if (summary.state === 'stale') state = 'stale'
    asOf = summary.asOf
    dataThrough = summary.dataThrough
    projectionUpdatedAt = summary.projectionUpdatedAt
    days.push(...summary.days.filter(day => day.day >= from && day.day <= to))
  }
  return { year: `${from}–${to}`, days, state, asOf, dataThrough, projectionUpdatedAt }
}

/** One roving keyboard stop per year; missing days remain inspectable, future days do not. */
function YearHeatmap({ data, metric, scaleMax, onDay, returnDay, selectedDay }: {
  data: DiscoveryYear; metric: DiscoveryMeasure; scaleMax: number; onDay: (day: string) => void; returnDay?: string; selectedDay?: string
}) {
  const [focused, setFocused] = useState('')
  const [preview, setPreview] = useState('')
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const { days, year } = data
  useEffect(() => {
    const day = days.find(day => day.day === returnDay && day.state !== 'future')
    if (day) { setFocused(day.day); buttons.current.get(day.day)?.focus({ preventScroll: true }) }
  }, [days, returnDay])
  const measured = days.filter(day => day.state === 'measured')
  const active = days.find(day => day.day === focused) ?? measured[0] ?? days.find(day => day.state !== 'future')
  const inspect = days.find(day => day.day === preview) ?? active
  const startOffset = (new Date((days[0]?.day ?? year + '-01-01') + 'T00:00:00Z').getUTCDay() + 6) % 7
  const columns = Math.ceil((startOffset + days.length) / 7)
  function move(from: number, delta: number) {
    const last = days.findIndex(day => day.state === 'future')
    const next = days[Math.max(0, Math.min(last < 0 ? days.length - 1 : last - 1, from + delta))]
    if (next && next.state !== 'future') { setFocused(next.day); buttons.current.get(next.day)?.focus() }
  }
  return <section className="discovery-year__row" aria-label={year + ' activity'}>
    <header className="discovery-year__row-heading"><h3>{year}</h3><p><strong>{measured.reduce((sum, day) => sum + (day[metric] ?? 0), 0).toLocaleString()}</strong> {measureLabels[metric]} · {measured.length} measured {measured.length === 1 ? 'day' : 'days'}</p></header>
    <div className="discovery-year__scroll" aria-label="Scrollable year heatmap">
      <div className="discovery-year__labels" style={{ gridTemplateColumns: 'repeat(' + columns + ', var(--discovery-cell-size))' }} aria-hidden="true">{days.filter((day, index) => index === 0 || day.day.endsWith('-01')).map(day => <span key={day.day} style={{ gridColumn: Math.floor((startOffset + days.indexOf(day)) / 7) + 1 }}>{new Date(day.day + 'T00:00:00Z').toLocaleString(undefined, { month: 'short', timeZone: 'UTC' })}</span>)}</div>
      <div className="discovery-year__plot"><div className="discovery-year__weekdays" aria-hidden="true">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => <span key={day}>{day}</span>)}</div>
        <div className="discovery-year__grid" style={{ gridTemplateColumns: 'repeat(' + columns + ', var(--discovery-cell-size))' }} aria-label="UTC year activity days">
          {Array.from({ length: startOffset }, (_, i) => <span key={'pad-' + i} aria-hidden="true" />)}
          {days.map((day, i) => <button type="button" key={day.day} ref={element => { if (element) buttons.current.set(day.day, element); else buttons.current.delete(day.day) }}
            disabled={day.state === 'future'} tabIndex={active?.day === day.day ? 0 : -1} aria-pressed={selectedDay === day.day} aria-label={discoveryDayLabel(day)} title={discoveryDayLabel(day)}
            data-state={day.state} data-level={day.state === 'measured' ? Math.ceil((day[metric] ?? 0) / scaleMax * 4) : undefined}
            onMouseEnter={() => setPreview(day.day)} onMouseLeave={() => setPreview('')} onFocus={() => { setFocused(day.day); setPreview('') }} onClick={() => onDay(day.day)}
            onKeyDown={event => { const delta = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7, Home: -i, End: days.length - 1 - i }[event.key]; if (delta !== undefined) { event.preventDefault(); move(i, delta) } }} />)}
        </div>
      </div>
    </div>
    <p className="discovery-year__readout">{inspect ? discoveryDayLabel(inspect) : 'Focus a day for its measured evidence.'}</p>
    {data.state === 'stale' ? <p role="status">Stored year activity may be stale.</p> : null}
  </section>
}

export function DiscoveryYearOverview({ presentation, creator, onChange, onDay, returnDay, compact = false, selectedDay, visibleFrom, visibleTo, certifiedDays, certifiedAsOf }: {
  presentation: DiscoveryPresentation; creator: string
  returnDay?: string
  compact?: boolean; selectedDay?: string
  visibleFrom?: string; visibleTo?: string
  /** History only: bounded days verified by the ranked availability endpoint. */
  certifiedDays?: DiscoveryDay[]; certifiedAsOf?: string
  onChange: (values: Record<string, string | null>) => void; onDay: (day: string) => void
}) {
  const { year, years: count, measure: metric } = presentation
  const recentMonths = visibleFrom && visibleTo ? recentWindowMonths(visibleFrom, visibleTo) : null
  const recentWindowInvalid = Boolean((visibleFrom || visibleTo) && !recentMonths)
  const years = discoveryOverviewYears(year, count)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{ key: string; results?: YearResult[] }>({ key: '' })
  const [date, setDate] = useState('')
  const key = JSON.stringify([year, count, creator, visibleFrom, visibleTo, certifiedAsOf])
  useEffect(() => {
    const abort = new AbortController()
    if (certifiedDays && visibleFrom && visibleTo && certifiedAsOf) {
      setState({ key, results: [{ year: 'Recent dates', data: { year: `${visibleFrom}–${visibleTo}`,
        days: certifiedDays, state: 'ready', asOf: certifiedAsOf, dataThrough: null, projectionUpdatedAt: null } }] })
      setDate('')
      return () => abort.abort()
    }
    setState({ key }); setDate('')
    // At most three bounded reads, sequentially, sharing cancellation. Commit together
    // so the comparison scale cannot change beneath a focused day as requests finish.
    void (async () => {
      // StrictMode may clean up immediately after setup. Do not send a redundant
      // first-year request for an already disposed activation.
      await Promise.resolve()
      const results: YearResult[] = []
      if (recentWindowInvalid) {
        if (!abort.signal.aborted) setState({ key, results: [{ year: 'Recent dates', error: 'The recent date range could not be verified.' }] })
        return
      }
      const periods = recentMonths ? ['Recent dates'] : years
      for (const selectedYear of periods) {
        if (abort.signal.aborted) return
        try {
          const data = recentMonths && visibleFrom && visibleTo
            ? await fetchRecentActivity(visibleFrom, visibleTo, recentMonths, creator, abort.signal)
            : await fetchDiscoveryYear(selectedYear, creator, abort.signal)
          results.push({ year: selectedYear, data })
        }
        catch (error) { results.push({ year: selectedYear, error: discoveryErrorMessage(error) }) }
      }
      if (!abort.signal.aborted) setState({ key, results })
    })()
    return () => abort.abort()
  }, [key, creator, attempt, certifiedDays, certifiedAsOf, visibleFrom, visibleTo])
  const results = state.key === key ? state.results : undefined
  const available = (results ?? []).flatMap(result => result.data && result.data.state !== 'unavailable' ? [result.data] : [])
  const days = available.flatMap(data => data.days)
  const measured = days.filter(day => day.state === 'measured')
  const max = Math.max(1, ...measured.map(day => day[metric] ?? 0))
  const today = new Date().toISOString().slice(0, 10)
  const canOpenDate = days.some(day => day.day === date && day.state !== 'future')
  return <section className="discovery-year" aria-label={visibleFrom ? 'Recent activity overview' : 'Year activity overview'}>
    {!compact ? <div className="discovery-calendar__controls">
      <label>{count === 3 ? 'Through year (UTC)' : 'Year (UTC)'}<select aria-label="Activity year" value={year} onChange={event => onChange({ year: event.target.value })}>{Array.from({ length: new Date().getUTCFullYear() - 2010 }, (_, i) => String(new Date().getUTCFullYear() - i)).map(y => <option key={y}>{y}</option>)}</select></label>
      <label>Years shown<select aria-label="Years shown" value={count} onChange={event => onChange({ years: event.target.value })}><option value="1">One year</option><option value="3">Up to three years</option></select></label>
      <label>Measure<select aria-label="Year activity measure" value={metric} onChange={event => onChange({ measure: event.target.value })}><option value="detections">Detected moments</option><option value="chatMessages">Chat messages</option><option value="emoteUses">Emote uses</option></select></label>
      <form onSubmit={event => { event.preventDefault(); if (canOpenDate) onDay(date) }}>
        <label>Jump to day<input type="date" aria-label="Year overview day" required min={years[0] + '-01-01'} max={year === today.slice(0, 4) ? today : year + '-12-31'} value={date} onChange={event => setDate(event.target.value)} /></label><button type="submit" disabled={!canOpenDate}>Open day</button>
      </form>
    </div> : null}
    {!compact ? <p className="moments-muted">{creator ? '@' + creator : 'Across indexed tracked streams'} · {years.length > 1 ? years[0] + '–' + year : year} · UTC · public activity, not your viewing history</p> : null}
    {!results ? <p role="status">Loading stored activity…</p> : <>
      {available.length > 0 ? <>
        <DiscoveryIntensityLegend measure={metric} />
        {!compact ? <p className="moments-muted">One color scale across loaded years; totals are not adjusted for coverage. Dashed cells have no measurements. Missing history is not zero activity or a quiet year. Reaction activity is not a watchability score.</p> : null}
      </> : null}
      {results.map(result => result.error ? <section key={result.year} className="discovery-year__row" aria-label={result.year + ' activity'}><h3>{result.year}</h3><p role="status">{result.error}</p></section>
        : result.data?.state === 'unavailable' ? <section key={result.year} className="discovery-year__row" aria-label={result.year + ' activity'}><h3>{result.year}</h3><p role="status">No indexed activity is available for this {recentMonths ? 'recent range' : 'year'} and creator scope. Missing history is not a quiet {recentMonths ? 'range' : 'year'}.</p></section>
        : result.data ? <YearHeatmap key={key + ':' + result.year} data={result.data} metric={metric} scaleMax={max} onDay={onDay} returnDay={returnDay} selectedDay={selectedDay} /> : null)}
      {results.some(result => result.error) ? <button type="button" onClick={() => setAttempt(a => a + 1)}>Retry year overview</button> : null}
      {!compact && available.length > 0 ? <p className="moments-muted">Arrow keys move by day/week; Enter opens a day. On small screens, scroll a heatmap or use Jump to day. Coverage is partial.</p> : null}
    </>}
  </section>
}
