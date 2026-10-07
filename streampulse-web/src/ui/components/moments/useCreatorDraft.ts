import { useEffect, useRef, useState, type ChangeEvent, type FocusEvent, type KeyboardEvent } from 'react'
import { useLocation } from 'react-router-dom'

/** Pause after the last keystroke before a typed creator login is applied. */
export const CREATOR_COMMIT_DELAY_MS = 300

/**
 * Keeps a typed creator login local and applies it once the reader pauses,
 * presses Enter or leaves the field, so partial logins never become history
 * entries or ranked reads. Outside navigation (Reset, Clear filters, Back) wins,
 * even when it leaves the applied login unchanged.
 */
export function useCreatorDraft(committed: string, commit: (login: string) => void) {
  const locationKey = useLocation().key
  const [draft, setDraft] = useState(committed)
  const timer = useRef<number>()
  // The login this field sent that has not landed in the URL yet.
  const sent = useRef<string | null>(null)
  const latest = useRef({ committed, commit })
  latest.current = { committed, commit }
  useEffect(() => {
    // Our own commit landing must not overwrite keys typed since it was sent.
    if (sent.current !== null && committed === sent.current) { sent.current = null; return }
    sent.current = null
    window.clearTimeout(timer.current)
    setDraft(committed)
  }, [committed, locationKey])
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const apply = (value: string) => {
    window.clearTimeout(timer.current)
    if (value === latest.current.committed) return
    sent.current = value
    latest.current.commit(value)
  }
  return {
    value: draft,
    onChange: (event: ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value.toLowerCase()
      setDraft(value)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => apply(value), CREATOR_COMMIT_DELAY_MS)
    },
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => { if (event.key === 'Enter') apply(event.currentTarget.value.toLowerCase()) },
    onBlur: (event: FocusEvent<HTMLInputElement>) => apply(event.currentTarget.value.toLowerCase()),
  }
}
