import { useEffect, useId, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  Check,
  CheckCircle2,
  CircleSlash2,
  Clock3,
  Copy,
  ExternalLink,
  LoaderCircle,
  Sparkles,
  TriangleAlert,
} from 'lucide-react'
import type {
  ScreenerEvidence,
  ScreenerMetricComparison,
  ScreenerMetricState,
} from '../../../lib/channelScreenerContract'
import { compact } from './hubFormat'
import './analytics-truth.css'

const STATE_COPY: Record<ScreenerMetricState, { label: string; icon: typeof CheckCircle2 }> = {
  ready: { label: 'Measured', icon: CheckCircle2 },
  new_activity: { label: 'New activity', icon: Sparkles },
  warming: { label: 'Warming', icon: Clock3 },
  partial: { label: 'Partial', icon: TriangleAlert },
  unavailable: { label: 'Unavailable', icon: CircleSlash2 },
}

export function screenerReasonCopy(reason: string | undefined): string | undefined {
  const code = reason?.trim()
  if (!code) return undefined
  const known: Record<string, string> = {
    stream_identity_unavailable: 'Stream identity unavailable',
    history_query_unavailable: 'History comparison temporarily unavailable',
    irc_unbound: 'IRC is not bound to this stream',
    irc_not_bound: 'IRC is not bound to this stream',
    rollup_unavailable: 'Minute rollups unavailable',
    current_window_partial: 'The latest five-minute window is incomplete',
    current_window_incomplete: 'The latest five-minute window is incomplete',
    baseline_warming: 'This broadcast is still building its measured average',
    baseline_insufficient: 'This broadcast is still building its measured average',
    baseline_partial: 'Earlier stream coverage is incomplete',
    baseline_coverage_insufficient: 'Earlier stream coverage is incomplete',
    event_minute_partial: 'The detected event minute is incomplete',
  }
  if (known[code]) return known[code]
  const human = code.replace(/[_-]+/g, ' ')
  return `${human.charAt(0).toUpperCase()}${human.slice(1)}`
}

export interface MetricStateBadgeProps {
  state: ScreenerMetricState
  reason?: string
  compact?: boolean
}

export function MetricStateBadge({ state, reason, compact: compactMode }: MetricStateBadgeProps) {
  const meta = STATE_COPY[state]
  const Icon = meta.icon
  const reasonText = screenerReasonCopy(reason)
  return (
    <span
      className={`metric-state-badge metric-state-badge--${state}`}
      title={reasonText}
      aria-label={reasonText ? `${meta.label}: ${reasonText}` : meta.label}
    >
      <Icon size={12} aria-hidden="true" />
      {compactMode ? <span className="visually-hidden">{meta.label}</span> : meta.label}
    </span>
  )
}

function rateLabel(value: number | undefined, unit: string): string {
  return value == null || !Number.isFinite(value) ? '—' : `${compact(value)}${unit}`
}

function changeLabel(
  comparison: ScreenerMetricComparison,
  presentation: 'percentage' | 'multiplier' | 'absolute',
): string | null {
  if (comparison.state === 'new_activity') return 'New activity from a zero baseline'
  if (comparison.state !== 'ready') return null
  if (presentation === 'percentage' && comparison.changePct != null && Number.isFinite(comparison.changePct)) {
    return `${comparison.changePct > 0 ? '+' : ''}${Math.round(comparison.changePct)}%`
  }
  if (presentation === 'multiplier' && comparison.multiplier != null && Number.isFinite(comparison.multiplier)) {
    return `${comparison.multiplier.toFixed(comparison.multiplier >= 10 ? 0 : 1)}×`
  }
  if (comparison.absoluteDeltaPerMin != null && Number.isFinite(comparison.absoluteDeltaPerMin)) {
    return `${comparison.absoluteDeltaPerMin > 0 ? '+' : ''}${compact(comparison.absoluteDeltaPerMin)}/min`
  }
  return null
}

export interface PairedRateBarsProps {
  current?: number
  baseline?: number
  currentLabel?: string
  baselineLabel?: string
  unit?: string
  tone?: 'chat' | 'emotes' | 'neutral'
  compact?: boolean
}

export function PairedRateBars({
  current,
  baseline,
  currentLabel = 'Latest 5 min',
  baselineLabel = 'Stream average',
  unit = '/min',
  tone = 'neutral',
  compact: compactMode,
}: PairedRateBarsProps) {
  const safeCurrent = current != null && Number.isFinite(current) ? Math.max(0, current) : null
  const safeBaseline = baseline != null && Number.isFinite(baseline) ? Math.max(0, baseline) : null
  const max = Math.max(safeCurrent ?? 0, safeBaseline ?? 0)
  const width = (value: number | null) => value == null || max <= 0 ? 0 : Math.max(2, (value / max) * 100)
  const aria = `${currentLabel}: ${rateLabel(safeCurrent ?? undefined, unit)}; ${baselineLabel}: ${rateLabel(safeBaseline ?? undefined, unit)}`
  return (
    <div
      className={`paired-rate-bars paired-rate-bars--${tone}${compactMode ? ' paired-rate-bars--compact' : ''}`}
      role="img"
      aria-label={aria}
    >
      {[
        { label: currentLabel, value: safeCurrent, kind: 'current' },
        { label: baselineLabel, value: safeBaseline, kind: 'baseline' },
      ].map((row) => (
        <div className="paired-rate-bars__row" key={row.kind}>
          <span className="paired-rate-bars__label">{row.label}</span>
          <span className="paired-rate-bars__track" aria-hidden="true">
            <i className={`paired-rate-bars__fill paired-rate-bars__fill--${row.kind}`} style={{ width: `${width(row.value)}%` }} />
          </span>
          <strong>{rateLabel(row.value ?? undefined, unit)}</strong>
        </div>
      ))}
    </div>
  )
}

export interface MetricComparisonProps {
  label: string
  comparison: ScreenerMetricComparison
  unit?: string
  tone?: PairedRateBarsProps['tone']
  compact?: boolean
  presentation?: 'percentage' | 'multiplier' | 'absolute'
  currentLabel?: string
  baselineLabel?: string
}

export function MetricComparison({
  label,
  comparison,
  unit = '/min',
  tone = 'neutral',
  compact: compactMode,
  presentation = tone === 'emotes' ? 'multiplier' : 'percentage',
  currentLabel = 'Latest 5 min',
  baselineLabel = 'Stream average',
}: MetricComparisonProps) {
  const status = changeLabel(comparison, presentation)
  const reasonCode = comparison.reason?.trim()
  const reason = screenerReasonCopy(reasonCode)
  const measuring = comparison.state === 'warming'
    ? comparison.currentMeasuredMinutes < comparison.currentExpectedMinutes
      ? `Measuring ${comparison.currentMeasuredMinutes}/${comparison.currentExpectedMinutes} current min`
      : `Building stream average ${comparison.baselineMeasuredMinutes}/${comparison.baselineExpectedMinutes} min`
    : comparison.state === 'partial'
      ? `${comparison.currentMeasuredMinutes}/${comparison.currentExpectedMinutes} current min · ${comparison.baselineMeasuredMinutes}/${comparison.baselineExpectedMinutes} baseline min`
      : null
  return (
    <section className={`metric-comparison${compactMode ? ' metric-comparison--compact' : ''}`} aria-label={`${label} activity comparison`}>
      <header className="metric-comparison__head">
        <strong>{label}</strong>
        <MetricStateBadge state={comparison.state} reason={reason} compact={compactMode} />
      </header>
      {comparison.state === 'ready' || comparison.state === 'new_activity' ? (
        <>
          <PairedRateBars
            current={comparison.currentPerMin}
            baseline={comparison.baselinePerMin}
            unit={unit}
            tone={tone}
            compact={compactMode}
            currentLabel={currentLabel}
            baselineLabel={baselineLabel}
          />
          {status ? <p className="metric-comparison__delta">{status}</p> : null}
        </>
      ) : (
        <>
          {comparison.currentMeasuredMinutes > 0 || comparison.baselineMeasuredMinutes > 0 ? (
            <p className="metric-comparison__observed">
              Observed rates · {currentLabel} {comparison.currentMeasuredMinutes > 0 ? rateLabel(comparison.currentPerMin, unit) : 'unsampled'}
              {' · '}{baselineLabel} {comparison.baselineMeasuredMinutes > 0 ? rateLabel(comparison.baselinePerMin, unit) : 'unsampled'}
            </p>
          ) : null}
          <p className="metric-comparison__reason" role="status">
            {reason || measuring || 'Comparison evidence is unavailable.'}
            {reason && measuring ? ` · ${measuring}` : ''}
          </p>
        </>
      )}
    </section>
  )
}

export interface EvidenceSummaryProps {
  evidence: ScreenerEvidence
  currentMeasuredMinutes?: number
  currentExpectedMinutes?: number
  baselineMeasuredMinutes?: number
  baselineExpectedMinutes?: number
  baselineCoveragePct?: number
  defaultOpen?: boolean
  label?: string
  diagnosticReason?: string
}

function ageLabel(seconds: number | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return 'age unavailable'
  if (seconds < 60) return `${Math.round(seconds)}s old`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m old`
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h old`
  return `${Math.round(seconds / 86400)}d old`
}

export function EvidenceSummary({
  evidence,
  currentMeasuredMinutes,
  currentExpectedMinutes,
  baselineMeasuredMinutes,
  baselineExpectedMinutes,
  baselineCoveragePct,
  defaultOpen = false,
  label = 'Coverage evidence',
  diagnosticReason,
}: EvidenceSummaryProps) {
  const detailsId = useId()
  return (
    <details className="evidence-summary" open={defaultOpen}>
      <summary aria-controls={detailsId}>{label}</summary>
      <dl id={detailsId} className="evidence-summary__grid">
        <div><dt>IRC</dt><dd>{evidence.ircBound ? 'Bound' : 'Not bound'}</dd></div>
        <div><dt>Chat last 5m</dt><dd>{evidence.chatObservedLast5m ? 'Observed' : 'Not observed'}</dd></div>
        <div><dt>Minute rollups</dt><dd>{evidence.rollupAvailable ? 'Available' : 'Unavailable'}</dd></div>
        <div><dt>Metadata</dt><dd>{ageLabel(evidence.metadataAgeSeconds)}</dd></div>
        {currentMeasuredMinutes != null && currentExpectedMinutes != null ? (
          <div><dt>Current window</dt><dd>{currentMeasuredMinutes}/{currentExpectedMinutes} min</dd></div>
        ) : null}
        {baselineMeasuredMinutes != null && baselineExpectedMinutes != null ? (
          <div><dt>Stream baseline</dt><dd>{baselineMeasuredMinutes}/{baselineExpectedMinutes} min</dd></div>
        ) : null}
        {baselineCoveragePct != null ? (
          <div><dt>Baseline coverage</dt><dd>{Math.round(baselineCoveragePct)}%</dd></div>
        ) : null}
        {diagnosticReason ? (
          <div><dt>Diagnostic code</dt><dd><code>{diagnosticReason}</code></dd></div>
        ) : null}
      </dl>
    </details>
  )
}

export interface MomentActionRowProps {
  analyticsHref?: string
  watchHref?: string
  watchLabel?: 'Watch live' | 'Watch VOD'
  copyHref?: string
  compact?: boolean
}

type CopyState = 'idle' | 'success' | 'error'

function copyWithSelectionFallback(text: string): boolean {
  const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.readOnly = true
  textarea.setAttribute('aria-hidden', 'true')
  Object.assign(textarea.style, {
    position: 'fixed',
    inset: '0 auto auto -9999px',
    opacity: '0',
    pointerEvents: 'none',
  })
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  textarea.setSelectionRange(0, text.length)
  try {
    return typeof document.execCommand === 'function' && document.execCommand('copy')
  } catch {
    return false
  } finally {
    textarea.remove()
    activeElement?.focus()
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator.clipboard?.writeText === 'function') {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Permission and embedded-browser failures fall through to a selection copy.
  }
  return copyWithSelectionFallback(text)
}

export function MomentActionRow({
  analyticsHref,
  watchHref,
  watchLabel = 'Watch live',
  copyHref,
  compact: compactMode,
}: MomentActionRowProps) {
  const [copyState, setCopyState] = useState<CopyState>('idle')
  const copyStatusId = useId()
  useEffect(() => {
    if (copyState === 'idle') return
    const id = window.setTimeout(
      () => setCopyState('idle'),
      copyState === 'success' ? 1800 : 4000,
    )
    return () => window.clearTimeout(id)
  }, [copyState])
  const copy = async () => {
    if (!copyHref) return
    const copied = await copyText(new URL(copyHref, window.location.href).toString())
    setCopyState(copied ? 'success' : 'error')
  }
  return (
    <div className={`moment-action-row${compactMode ? ' moment-action-row--compact' : ''}`} aria-label="Moment actions">
      {analyticsHref ? (
        <Link className="moment-action-row__action moment-action-row__action--primary" to={analyticsHref}>Analytics</Link>
      ) : (
        <span className="moment-action-row__action is-disabled" aria-disabled="true">Analytics unavailable</span>
      )}
      {watchHref ? (
        <a className="moment-action-row__action" href={watchHref} target="_blank" rel="noreferrer">
          {watchLabel}<ExternalLink size={11} aria-hidden="true" />
        </a>
      ) : (
        <span className="moment-action-row__action is-disabled" aria-disabled="true">Replay unavailable</span>
      )}
      <button
        type="button"
        className="moment-action-row__action"
        disabled={!copyHref}
        onClick={copy}
        aria-describedby={copyState === 'idle' ? undefined : copyStatusId}
      >
        {copyState === 'success' ? <Check size={11} aria-hidden="true" /> : <Copy size={11} aria-hidden="true" />}
        {copyState === 'success' ? 'Copied' : copyState === 'error' ? 'Copy failed' : 'Copy link'}
      </button>
      {copyState !== 'idle' ? (
        <span id={copyStatusId} className="visually-hidden" role="status" aria-live="polite">
          {copyState === 'success'
            ? 'Link copied to clipboard.'
            : 'Could not copy the link. Open Analytics and copy the address from the browser.'}
        </span>
      ) : null}
    </div>
  )
}

export type MarketPanelState = 'ready' | 'loading' | 'empty' | 'partial' | 'unavailable' | 'error'

export interface MarketPanelFrameProps {
  title: string
  state: MarketPanelState
  description?: string
  children?: ReactNode
  onRetry?: () => void
}

export function MarketPanelFrame({ title, state, description, children, onRetry }: MarketPanelFrameProps) {
  const content = state === 'ready' || state === 'partial'
  return (
    <section className={`market-panel-frame market-panel-frame--${state}`} aria-label={title} aria-busy={state === 'loading'}>
      <header><h3>{title}</h3>{state === 'partial' ? <MetricStateBadge state="partial" /> : null}</header>
      {state === 'loading' ? (
        <div className="market-panel-frame__state"><LoaderCircle className="market-panel-frame__spinner" aria-hidden="true" />Loading measured market data…</div>
      ) : content ? children : (
        <div className="market-panel-frame__state" role={state === 'error' ? 'alert' : 'status'}>
          {state === 'error' ? <TriangleAlert aria-hidden="true" /> : <CircleSlash2 aria-hidden="true" />}
          <span>{description || (state === 'empty' ? 'No qualifying rows in this window.' : 'This measured market view is unavailable.')}</span>
          {state === 'error' && onRetry ? <button type="button" onClick={onRetry}>Retry</button> : null}
        </div>
      )}
    </section>
  )
}
