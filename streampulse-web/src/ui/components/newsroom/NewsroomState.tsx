import { AlertCircle, Radio, RefreshCw } from 'lucide-react'
import type { ReactNode } from 'react'
import { newsroomReasonCopy } from '../../../lib/newsroom'

export type NewsroomVisualState = 'loading' | 'empty' | 'stale' | 'unavailable' | 'error'

export interface NewsroomStateProps {
  state: NewsroomVisualState
  reason?: string
  onRetry?: () => void
  children?: ReactNode
}

export function NewsroomState({ state, reason, onRetry, children }: NewsroomStateProps) {
  const reasonCopy = newsroomReasonCopy(reason)
  if (state === 'stale') {
    return (
      <div className="newsroom-state newsroom-state--stale" role="status">
        <AlertCircle aria-hidden="true" />
        <span>{reasonCopy || 'Showing the last verified Newsroom update while fresh data reconnects.'}</span>
        {onRetry ? <button type="button" onClick={onRetry}><RefreshCw aria-hidden="true" />Retry</button> : null}
      </div>
    )
  }
  if (state === 'loading') {
    return (
      <div className="newsroom-state newsroom-state--loading" role="status" aria-label="Loading Pulse Newsroom">
        <span className="newsroom-state__skeleton" aria-hidden="true" />
        <span className="newsroom-state__skeleton newsroom-state__skeleton--short" aria-hidden="true" />
      </div>
    )
  }
  if (state === 'empty') {
    return (
      <div className="newsroom-state newsroom-state--empty" role="status">
        <Radio aria-hidden="true" />
        <div><strong>Quiet now</strong><p>{reasonCopy || 'No verified stream story is developing in this window.'}</p></div>
        {children}
      </div>
    )
  }
  return (
    <div className={`newsroom-state newsroom-state--${state}`} role="alert">
      <AlertCircle aria-hidden="true" />
      <div>
        <strong>{state === 'unavailable' ? 'Pulse Newsroom unavailable' : 'Could not load Pulse Newsroom'}</strong>
        <p>{reasonCopy || 'Verified stories are temporarily unavailable. Global Activity remains available.'}</p>
      </div>
      {onRetry ? <button type="button" onClick={onRetry}><RefreshCw aria-hidden="true" />Retry</button> : null}
      {children}
    </div>
  )
}
