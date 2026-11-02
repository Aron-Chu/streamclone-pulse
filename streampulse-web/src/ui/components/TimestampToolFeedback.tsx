import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { openTimestampFeedback, subscribeAnalyticsPreference, timestampFeedbackAvailable } from '../../lib/productAnalytics'
import type { TimestampFeedbackChoice, TimestampFeedbackSession } from '../../lib/timestampFeedback'
import { Button } from '../primitives'
import './TimestampToolFeedback.css'

export function TimestampToolFeedback({ returnFocus }: { returnFocus: () => void }) {
  const available = useSyncExternalStore(subscribeAnalyticsPreference, timestampFeedbackAvailable, () => false)
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'unavailable' | 'submitted' | 'dismissed'>('idle')
  const [session, setSession] = useState<TimestampFeedbackSession | null>(null)
  const [choice, setChoice] = useState<TimestampFeedbackChoice | null>(null)
  const [locked, setLocked] = useState(false)
  const [sendFailed, setSendFailed] = useState(false)
  const request = useRef<AbortController | null>(null)
  const generation = useRef(0)
  const heading = useRef<HTMLHeadingElement>(null)
  const answered = useRef(false)

  useEffect(() => {
    if (available) return
    generation.current += 1
    request.current?.abort()
    request.current = null
    setSession(null)
    if (!answered.current) { setState('idle'); setChoice(null); setLocked(false); setSendFailed(false) }
  }, [available])
  useEffect(() => () => { generation.current += 1; request.current?.abort(); request.current = null }, [])
  useEffect(() => {
    if (state === 'ready' && session) { session.shown(); heading.current?.focus() }
  }, [state, session])

  async function open() {
    if (!timestampFeedbackAvailable() || answered.current || request.current) return
    const turn = ++generation.current
    const controller = new AbortController()
    request.current = controller
    setState('loading')
    const next = await openTimestampFeedback(controller.signal).catch(() => null)
    if (turn !== generation.current || controller.signal.aborted || !timestampFeedbackAvailable()) {
      if (request.current === controller) { controller.abort(); request.current = null }
      return
    }
    // Keep the signal alive for the displayed session, so withdrawal and
    // unmount invalidate its send methods as well as the initial lookup.
    if (!next && request.current === controller) request.current = null
    setSession(next)
    setState(next ? 'ready' : 'unavailable')
  }
  function close() {
    session?.dismiss()
    request.current?.abort()
    request.current = null
    answered.current = true
    setState('dismissed')
    returnFocus()
  }
  if (!available || state === 'dismissed') return null
  if (state === 'submitted') return <p className="timestamp-feedback__thanks" role="status">Thanks for the feedback.</p>
  return <section className="timestamp-feedback" aria-label="Anonymous tool feedback">
    {state !== 'ready' ? <>
      <p>A quick, optional question about this tool. Your link and entered timestamp are excluded.</p>
      <Button variant="secondary" disabled={state === 'loading'} onClick={open}>
        {state === 'loading' ? 'Loading feedback…' : 'Give anonymous feedback'}
      </Button>
      {state === 'unavailable' ? <p role="status">Feedback is unavailable right now. You can keep using the tool.</p> : null}
    </> : session ? <form onSubmit={event => {
      event.preventDefault()
      if (!choice) return
      setLocked(true)
      if (session.submit(choice)) {
        answered.current = true
        setState('submitted')
        returnFocus()
      } else setSendFailed(true)
    }}>
      <h3 ref={heading} tabIndex={-1}>One optional question</h3>
      <fieldset disabled={locked}>
        <legend>{session.question}</legend>
        {session.choices.map(value => <label key={value}>
          <input type="radio" name="timestamp-feedback" value={value} checked={choice === value}
            onChange={() => { if (!locked) setChoice(value) }} />{value}
        </label>)}
      </fieldset>
      <p>Send feedback shares your selected answer with StreamPulse in PostHog. We also count opening and closing this question.
        No account, link or entered timestamp is sent.</p>
      {sendFailed ? <p role="status">Your feedback could not be sent. Retry your selected answer or close this question.</p> : null}
      <div className="timestamp-feedback__actions">
        <Button type="submit" disabled={!choice}>{sendFailed ? 'Retry feedback' : 'Send feedback'}</Button>
        <Button variant="ghost" onClick={close}>Not now</Button>
      </div>
    </form> : null}
  </section>
}
