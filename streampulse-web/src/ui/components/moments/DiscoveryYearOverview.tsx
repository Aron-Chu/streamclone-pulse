import { useEffect, useRef, useState } from 'react'
import { fetchDiscoveryYear, type DiscoveryYear } from '../../../lib/discoveryYear'
import { discoveryDayLabel } from '../../../lib/discoveryDayLabel'
import { discoveryOverviewYears, type DiscoveryMeasure, type DiscoveryPresentation } from '../../../lib/discoveryPresentation'
import { PulseSelect } from '../common/PulseSelect'

const measureLabels = { detections: 'detected moments', chatMessages: 'chat messages', emoteUses: 'emote uses' }
interface YearResult { year: string; data?: DiscoveryYear; error?: string }

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
  const startOffset = (new Date(year + '-01-01T00:00:00Z').getUTCDay() + 6) % 7
  const columns = Math.ceil((startOffset + days.length) / 7)
  function move(from: number, delta: number) {
    const last = days.findIndex(day => day.state === 'future')
    const next = days[Math.max(0, Math.min(last < 0 ? days.length - 1 : last - 1, from + delta))]
    if (next && next.state !== 'future') { setFocused(next.day); buttons.current.get(next.day)?.focus() }
  }
  return <section className="discovery-year__row" aria-label={year + ' activity'}>
    <header className="discovery-year__row-heading"><h3>{year}</h3><p><strong>{measured.reduce((sum, day) => sum + (day[metric] ?? 0), 0).toLocaleString()}</strong> {measureLabels[metric]} · {measured.length} measured {measured.length === 1 ? 'day' : 'days'}</p></header>
    <div className="discovery-year__scroll" aria-label="Scrollable year heatmap">
      <div className="discovery-year__labels" style={{ gridTemplateColumns: 'repeat(' + columns + ', var(--discovery-cell-size))' }} aria-hidden="true">{days.filter(day => day.day.endsWith('-01')).map(day => <span key={day.day} style={{ gridColumn: Math.floor((startOffset + days.indexOf(day)) / 7) + 1 }}>{new Date(day.day + 'T00:00:00Z').toLocaleString(undefined, { month: 'short', timeZone: 'UTC' })}</span>)}</div>
      <div className="discovery-year__plot"><div className="discovery-year__weekdays" aria-hidden="true">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => <span key={day}>{day}</span>)}</div>
        <div className="discovery-year__grid" style={{ gridTemplateColumns: 'repeat(' + columns + ', var(--discovery-cell-size))' }} aria-label="UTC year activity days">
          {Array.from({ length: startOffset }, (_, i) => <span key={'pad-' + i} aria-hidden="true" />)}
          {days.map((day, i) => <button type="button" key={day.day} ref={element => { if (element) buttons.current.set(day.day, element); else buttons.current.delete(day.day) }}
            disabled={day.state === 'future'} tabIndex={active?.day === day.day ? 0 : -1} aria-label={discoveryDayLabel(day)} title={discoveryDayLabel(day)} aria-pressed={selectedDay === day.day}
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

export function DiscoveryYearOverview({ presentation, creator, onChange, onDay, returnDay, selectedDay }: {
  presentation: DiscoveryPresentation; creator: string
  returnDay?: string
  selectedDay?: string
  onChange: (values: Record<string, string | null>) => void; onDay: (day: string) => void
}) {
  const { year, years: count, measure: metric } = presentation
  const years = discoveryOverviewYears(year, count)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{ key: string; results?: YearResult[] }>({ key: '' })
  const [date, setDate] = useState('')
  const key = JSON.stringify([year, count, creator])
  useEffect(() => {
    const abort = new AbortController()
    setState({ key }); setDate('')
    // At most three bounded reads, sequentially, sharing cancellation. Commit together
    // so the comparison scale cannot change beneath a focused day as requests finish.
    void (async () => {
      // StrictMode may clean up immediately after setup. Do not send a redundant
      // first-year request for an already disposed activation.
      await Promise.resolve()
      const results: YearResult[] = []
      for (const selectedYear of discoveryOverviewYears(year, count)) {
        if (abort.signal.aborted) return
        try { results.push({ year: selectedYear, data: await fetchDiscoveryYear(selectedYear, creator, abort.signal) }) }
        catch { results.push({ year: selectedYear, error: 'Year overview is unavailable on this server. Month browsing remains separate.' }) }
      }
      if (!abort.signal.aborted) setState({ key, results })
    })()
    return () => abort.abort()
  }, [key, year, count, creator, attempt])
  const results = state.key === key ? state.results : undefined
  const available = (results ?? []).flatMap(result => result.data && result.data.state !== 'unavailable' ? [result.data] : [])
  const days = available.flatMap(data => data.days)
  const measured = days.filter(day => day.state === 'measured')
  const max = Math.max(1, ...measured.map(day => day[metric] ?? 0))
  const today = new Date().toISOString().slice(0, 10)
  const canOpenDate = days.some(day => day.day === date && day.state !== 'future')
  return <section className="discovery-year" aria-label="Year activity overview">
    <div className="discovery-calendar__controls">
      <label>{count === 3 ? 'Through year (UTC)' : 'Year (UTC)'}<PulseSelect ariaLabel="Activity year" triggerAriaLabel="Activity year" value={year} onChange={value => onChange({ year: value })} options={Array.from({ length: new Date().getUTCFullYear() - 2010 }, (_, i) => { const value = String(new Date().getUTCFullYear() - i); return { value, label: value } })} /></label>
      <label>Measure<PulseSelect ariaLabel="Year activity measure" triggerAriaLabel="Year activity measure" value={metric} onChange={value => onChange({ measure: value })} options={[{ value: 'detections', label: 'Detected moments' }, { value: 'chatMessages', label: 'Chat messages' }, { value: 'emoteUses', label: 'Emote uses' }]} /></label>
      <details className="discovery-year__options"><summary>More calendar options</summary><div className="discovery-year__options-body">
      <label>Years shown<PulseSelect ariaLabel="Years shown" triggerAriaLabel="Years shown" value={String(count)} onChange={value => onChange({ years: value })} options={[{ value: '1', label: 'One year' }, { value: '3', label: 'Up to three years' }]} /></label>
      <form onSubmit={event => { event.preventDefault(); if (canOpenDate) onDay(date) }}>
        <label>Jump to day<input type="date" aria-label="Year overview day" required min={years[0] + '-01-01'} max={year === today.slice(0, 4) ? today : year + '-12-31'} value={date} onChange={event => setDate(event.target.value)} /></label><button type="submit" disabled={!canOpenDate}>Open day</button>
      </form>
      </div></details>
    </div>
    {!results ? <p role="status">Loading stored year activity…</p> : <>
      {results.map(result => result.error ? <section key={result.year} className="discovery-year__row" aria-label={result.year + ' activity'}><h3>{result.year}</h3><p role="status">{result.error}</p></section>
        : result.data?.state === 'unavailable' ? <section key={result.year} className="discovery-year__row" aria-label={result.year + ' activity'}><h3>{result.year}</h3><p role="status">No indexed activity is available for this year and creator scope. Missing history is not a quiet year.</p></section>
         : result.data ? <YearHeatmap key={key + ':' + result.year} data={result.data} metric={metric} scaleMax={max} onDay={onDay} returnDay={returnDay} selectedDay={selectedDay} /> : null)}
      {available.length > 0 ? <div className="discovery-year__legend" aria-label={'Less to more ' + measureLabels[metric]}><span>Less</span>{[0, 1, 2, 3, 4].map(level => <i key={level} data-level={level} aria-hidden="true" />)}<span>More {measureLabels[metric]}</span><span className="discovery-year__legend-scope">Partial coverage · Dashed cells: no measurement</span></div> : null}
      {results.some(result => result.error) ? <button type="button" onClick={() => setAttempt(a => a + 1)}>Retry year overview</button> : null}
      {available.length > 0 ? <details className="discovery-year__coverage"><summary>About these measurements</summary><p className="moments-muted">Shared scale across loaded years. Totals are not adjusted for coverage. Missing history is not zero activity or a quiet year. Reaction activity is not a watchability score. Public activity, not your viewing history.</p></details> : null}
    </>}
  </section>
}
