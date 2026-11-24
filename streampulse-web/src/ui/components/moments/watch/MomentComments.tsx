import { useEffect, useId, useRef, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import {
  addStreamComment, deleteStreamComment, listStreamComments, reportStreamComment, wholeSecondUtc, MomentFeedbackError,
  type MomentFeedback, type StreamComment,
} from '../../../../lib/momentFeedback'
import { REPORT_REASONS, SignInPrompt } from '../../clips/NativeClipFeedback'
import { ChannelAvatar, formatAgo, formatCount } from '../../clips/NativeClipParts'
import './moment-watch.css'

const MAX_CODE_POINTS = 280
const MAX_LINES = 3
// Control characters other than newline, bidi overrides/isolates, and the invisible code points
// (U+200B, U+200E, U+200F, U+061C, U+FEFF, U+2060 to U+2064, U+2028, U+2029): the backend refuses
// them, on the raw text before any trim. They go before the trim here too, so a leading or trailing
// one is never left for trim() to hide. ZWJ (U+200D) and tag characters (U+E0020 to U+E007F) stay.
const REFUSED = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u061c\u200b\u200e\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g

/** Typing-time normalisation: CRLF becomes LF, refused characters go, and a run of newlines becomes one (no blank line). */
const light = (value: string) => value.replace(/\r\n?/g, '\n').replace(REFUSED, '').replace(/\n(?:[^\S\n]*\n)+/g, '\n')
/** What is counted and sent, in the backend's order: NFC, then trim. */
const cleaned = (value: string) => light(value).normalize('NFC').trim()
const runes = (value: string) => [...value].length
const within = (value: string) => value.split('\n').length <= MAX_LINES && runes(value) <= MAX_CODE_POINTS

/**
 * What the textarea keeps, or null to refuse the change. The caps run on the cleaned text (so a
 * blank line at either end costs nothing, and a character NFC expands counts as what it becomes).
 * A draft that fits is kept as typed, ends untrimmed. One that doesn't is refused when it was typed
 * (the draft and the caret stay as they were), and cut to the cleaned text's first 3 lines and
 * 280 code points when it was pasted, or when the browser doesn't say how it came.
 */
function typed(value: string, inputType: string | undefined): string | null {
  const next = light(value)
  if (within(cleaned(next))) return next
  if (typeof inputType === 'string' && inputType !== 'insertFromPaste') return null
  let cut = cleaned(next).split('\n').slice(0, MAX_LINES).join('\n')
  while (!within(cleaned(cut))) cut = [...cut].slice(0, MAX_CODE_POINTS).join('')
  return cleaned(cut)
}

/** "Try again in 42 s.", "in 5 min.", "in 3 h.": always rounded up, so the wait is never understated. */
function waitText(seconds: number): string {
  if (seconds < 120) return `Try again in ${Math.ceil(seconds)} s.`
  if (seconds < 7200) return `Try again in ${Math.ceil(seconds / 60)} min.`
  return `Try again in ${Math.ceil(seconds / 3600)} h.`
}

const writeError = (error: unknown) => error instanceof MomentFeedbackError ? error : null

/**
 * One thread on the stream's timeline, shown under the Moment: newest first, 1 to 280
 * characters and at most 3 lines, no replies and no likes. Each comment is pinned to a second.
 * `onPins` reports the loaded comments' times (ms, sorted, once each); `onTotal` the new total.
 * `onNeedSignIn(needsLink)`: `true` asks for the Twitch link, `false` for the sign-in.
 */
export function MomentComments({ streamId, window: span, at, clampAt, onAt, feedback, returnTo, label, onPins, onTotal, onNeedSignIn, onStatus }: {
  streamId: string
  window: { from: string; to: string }
  /** The second picked on the strip, in ms. */
  at: number
  /** Moves a time into the seconds a comment may sit at, by the clock now (it moves while the stream is live). */
  clampAt: (ms: number) => number
  onAt: (ms: number) => void
  feedback: MomentFeedback
  /** The page the sign-in comes back to. */
  returnTo: string
  /** The "40:22" for a time in ms. */
  label: (ms: number) => string
  onPins: (ms: number[]) => void
  onTotal: (total: number) => void
  onNeedSignIn: (needsLink: boolean) => void
  onStatus: (message: string) => void
}) {
  const { signedIn, canWrite } = feedback.you
  const [items, setItems] = useState<StreamComment[] | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [total, setTotal] = useState<number | null>(null)
  const [load, setLoad] = useState<'idle' | 'loading' | 'failed'>('loading')
  const [attempt, setAttempt] = useState(0)
  const [draft, setDraft] = useState('')
  const [posting, setPosting] = useState(false)
  const [postError, setPostError] = useState('')
  // The comment being asked about: 'delete' asks first, 'report' offers the reasons.
  const [asking, setAsking] = useState<{ id: string; kind: 'delete' | 'report' } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [reported, setReported] = useState<ReadonlySet<string>>(new Set())
  const inputId = useId()
  const hintId = useId()
  const title = useRef<HTMLHeadingElement>(null)
  const rows = useRef(new Map<string, HTMLLIElement>())
  // The read this thread currently shows; bumped when it changes or goes, so no late answer reaches a callback.
  const generation = useRef(0)
  const more = useRef<AbortController | null>(null)
  const itemsNow = useRef<StreamComment[] | null>(null)
  itemsNow.current = items
  const callbacks = useRef({ onPins, onTotal })
  callbacks.current = { onPins, onTotal }
  // Where focus goes after the next render: the h2, a comment's row, a panel, or the button that opened one.
  const focusNext = useRef<{ to: 'title' } | { to: 'row'; id: string } | { to: 'panel'; id: string } | { to: 'opener'; id: string; kind: 'delete' | 'report' } | null>(null)
  const changed = useRef(false)

  const who = `${signedIn}:${canWrite}`
  useEffect(() => {
    const controller = new AbortController()
    const mine = ++generation.current
    more.current?.abort()
    setLoad('loading')
    setItems(null)
    setCursor(null)
    setTotal(null)
    setAsking(null)
    listStreamComments(streamId, span.from, span.to, undefined, controller.signal).then(
      result => {
        if (controller.signal.aborted || mine !== generation.current) return
        // A comment posted while the first page was on its way stays on top, and counts once.
        const ids = new Set(result.items.map(item => item.id))
        const early = (itemsNow.current ?? []).filter(item => !ids.has(item.id))
        setItems([...early, ...result.items])
        setCursor(result.nextCursor ?? null)
        setTotal(result.total + early.length)
        setLoad('idle')
      },
      () => { if (!controller.signal.aborted && mine === generation.current) setLoad('failed') },
    )
    return () => { controller.abort(); more.current?.abort(); generation.current++ }
  }, [streamId, span.from, span.to, attempt, who])

  // The strip's pins follow the visible comments; none once the thread goes.
  useEffect(() => {
    callbacks.current.onPins(items ? [...new Set(items.map(item => Date.parse(item.at)))].sort((a, b) => a - b) : [])
  }, [items])
  useEffect(() => () => callbacks.current.onPins([]), [])
  // A signed-out viewer has no draft to keep.
  useEffect(() => { if (!canWrite) { setDraft(''); setPostError('') } }, [canWrite])

  const shown = total ?? feedback.comments.total
  // One change to the count: a functional update, reported once the new total is rendered.
  const bump = (delta: number) => {
    changed.current = true
    setTotal(current => Math.max(0, (current ?? feedback.comments.total) + delta))
  }
  useEffect(() => {
    if (!changed.current || total === null) return
    changed.current = false
    callbacks.current.onTotal(total)
  }, [total])

  useEffect(() => {
    const next = focusNext.current
    if (!next) return
    // A render from before the press can still have its effects to run when the press comes (a busy
    // machine): a panel and its opener wait for the render that shows them.
    if (next.to === 'panel' && asking?.id !== next.id) return
    if (next.to === 'opener' && asking !== null) return
    focusNext.current = null
    if (next.to === 'title') title.current?.focus()
    else if (next.to === 'row') rows.current.get(next.id)?.focus()
    else if (next.to === 'panel') rows.current.get(next.id)?.querySelector<HTMLElement>('[data-panel]')?.focus()
    else rows.current.get(next.id)?.querySelector<HTMLElement>(`[data-act="${next.kind}"]`)?.focus()
  })

  /** True when the error was one the thread answers by asking for sign-in or the Twitch link. */
  const needsAccount = (error: unknown): boolean => {
    const e = writeError(error)
    if (e && e.status === 401) { onNeedSignIn(false); return true }
    if (e && e.status === 403 && e.code === 'twitch_required') { onNeedSignIn(true); return true }
    return false
  }
  /** A 404 comment_not_found: the comment is gone, so it leaves the list and the count. */
  const gone = (error: unknown, comment: StreamComment): boolean => {
    const e = writeError(error)
    if (!e || e.status !== 404 || e.code !== 'comment_not_found') return false
    setItems(current => (current ?? []).filter(item => item.id !== comment.id))
    setAsking(null)
    bump(-1)
    onStatus('That comment is no longer here.')
    focusNext.current = { to: 'title' }
    return true
  }

  const showMore = async () => {
    if (!cursor || load === 'loading') return
    const mine = generation.current
    const controller = new AbortController()
    more.current?.abort()
    more.current = controller
    setLoad('loading')
    try {
      const result = await listStreamComments(streamId, span.from, span.to, cursor, controller.signal)
      if (controller.signal.aborted || mine !== generation.current) return
      setItems(current => {
        const seen = new Set((current ?? []).map(item => item.id))
        return [...(current ?? []), ...result.items.filter(item => !seen.has(item.id))]
      })
      setCursor(result.nextCursor ?? null)
      setLoad('idle')
    } catch {
      if (!controller.signal.aborted && mine === generation.current) setLoad('failed')
    }
  }

  const text = cleaned(draft)
  const count = runes(text)
  const post = async () => {
    if (!canWrite) { onNeedSignIn(signedIn); return }
    if (!text || posting) return
    const mine = generation.current
    setPosting(true)
    setPostError('')
    try {
      const comment = await addStreamComment(streamId, wholeSecondUtc(clampAt(at)), text)
      if (mine !== generation.current) return
      setItems(current => [comment, ...(current ?? []).filter(item => item.id !== comment.id)])
      bump(1)
      setDraft('')
      onStatus('Comment posted.')
    } catch (error) {
      if (mine !== generation.current) return
      const e = writeError(error)
      if (needsAccount(error)) return
      if (e && e.status === 429) {
        setPostError(e.retryAfterSeconds ? `Too many comments for now. ${waitText(e.retryAfterSeconds)}` : 'Too many comments for now. Try again in a little while.')
      } else if (e && e.code === 'invalid_at') {
        setPostError('That time isn’t in the stream. Pick another time.')
      } else if (e && e.code === 'invalid_comment') {
        setPostError('That comment can’t be posted as written. Edit it, then post.')
      } else {
        // The aria-live hint says it once.
        setPostError('Your comment didn’t post. Try again.')
      }
    } finally { if (mine === generation.current) setPosting(false) }
  }

  const openPanel = (comment: StreamComment, kind: 'delete' | 'report') => {
    focusNext.current = { to: 'panel', id: comment.id }
    setAsking({ id: comment.id, kind })
  }
  const cancel = (comment: StreamComment, kind: 'delete' | 'report') => {
    focusNext.current = { to: 'opener', id: comment.id, kind }
    setAsking(null)
  }
  const remove = async (comment: StreamComment) => {
    const mine = generation.current
    setBusy(comment.id)
    try {
      await deleteStreamComment(comment.id)
      if (mine !== generation.current) return
      setItems(current => (current ?? []).filter(item => item.id !== comment.id))
      setAsking(null)
      bump(-1)
      onStatus('Comment deleted.')
      focusNext.current = { to: 'title' }
    } catch (error) {
      if (mine !== generation.current) return
      if (!gone(error, comment) && !needsAccount(error)) onStatus('Your comment didn’t delete. Try again.')
    } finally { if (mine === generation.current) setBusy(null) }
  }
  const report = async (comment: StreamComment, reason: (typeof REPORT_REASONS)[number]['value']) => {
    const mine = generation.current
    setBusy(comment.id)
    try {
      await reportStreamComment(comment.id, reason)
      if (mine !== generation.current) return
      setReported(current => new Set(current).add(comment.id))
      setAsking(null)
      onStatus('Reported. Thanks.')
      focusNext.current = { to: 'row', id: comment.id }
    } catch (error) {
      if (mine !== generation.current) return
      if (!gone(error, comment) && !needsAccount(error)) onStatus('Your report didn’t send. Try again.')
    } finally { if (mine === generation.current) setBusy(null) }
  }

  const here = label(at)
  return (
    <section className="nc-comments mw-comments" aria-labelledby="mw-comments-title">
      <div className="nc-comments-head">
        <h2 id="mw-comments-title" ref={title} tabIndex={-1} className="nc-section-title mw-comments-title">
          {shown === 1 ? '1 comment' : `${formatCount(shown)} comments`}
        </h2>
      </div>
      <p className="mw-comments-sub">Pinned between {label(Date.parse(span.from))} and {label(Date.parse(span.to))} · newest first</p>

      {canWrite ? (
        <form className="nc-add" onSubmit={event => { event.preventDefault(); void post() }}>
          <span className="mw-add-chip">
            at {here}
            <button type="button" aria-label="Pick another second on the strip" onClick={() => document.getElementById('mw-second')?.focus()}>
              <SlidersHorizontal size={14} aria-hidden="true" />
            </button>
          </span>
          <label htmlFor={inputId} className="sr-only">Your comment</label>
          <textarea id={inputId} className="nc-add-input" rows={2} placeholder={`Add a comment at ${here}`} value={draft}
            aria-invalid={!!postError} aria-describedby={hintId}
            onChange={event => {
              const field = event.target
              const next = typed(field.value, (event.nativeEvent as { inputType?: string }).inputType)
              if (next === null) {
                // Refused: React puts the old draft back; the caret goes back to where the refused key was typed.
                const caret = Math.max(0, (field.selectionStart ?? 0) - (field.value.length - draft.length))
                queueMicrotask(() => { try { field.setSelectionRange(caret, caret) } catch { /* the field has gone */ } })
                return
              }
              setDraft(next)
              setPostError('')
            }}
            onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void post() } }} />
          <div className="nc-add-foot">
            <span id={hintId} className={postError ? 'nc-add-error' : 'nc-muted'} aria-live="polite">
              {postError || <span className="mw-count">{count}/{MAX_CODE_POINTS}</span>}
            </span>
            <span className="nc-add-actions">
              <button type="submit" className="nc-btn nc-btn-strong" disabled={posting || !text}>{posting ? 'Posting…' : 'Comment'}</button>
            </span>
          </div>
        </form>
      ) : (
        <SignInPrompt returnTo={returnTo} signedIn={signedIn} canWrite={canWrite}
          signedOutText="Sign in with Twitch to rate Moments and comment." linkText="Link your Twitch account to rate or comment." />
      )}

      {items === null && load !== 'failed' ? (
        <div className="nc-comment-list" aria-hidden="true">{Array.from({ length: 3 }, (_, i) => <div key={i} className="nc-skel nc-skel-comment"><span /><span /></div>)}</div>
      ) : items === null ? (
        <p className="nc-muted" role="status">Comments didn’t load. <button type="button" className="nc-link" onClick={() => setAttempt(n => n + 1)}>Try again</button></p>
      ) : !items.length ? (
        <p className="nc-muted">No comments here yet.</p>
      ) : (
        <ul className="nc-comment-list" role="list">
          {items.map(comment => {
            const ms = Date.parse(comment.at)
            const panel = asking?.id === comment.id ? asking.kind : null
            const isBusy = busy === comment.id
            return (
              <li key={comment.id} className="mw-comment" tabIndex={-1}
                ref={node => { if (node) rows.current.set(comment.id, node); else rows.current.delete(comment.id) }}>
                <ChannelAvatar channel={{ id: '', ...comment.author }} size={36} />
                <div className="mw-comment-main">
                  <div className="nc-comment-who">
                    <span className="nc-strong">{comment.author.displayName}</span>
                    {comment.mine ? <span className="nc-muted">(you)</span> : null}
                    <button type="button" className="mw-comment-at" aria-label={`at ${label(ms)}, show on the strip`}
                      onClick={() => { onAt(ms); rows.current.get(comment.id)?.focus() }}>at {label(ms)}</button>
                    <time className="nc-muted" dateTime={new Date(comment.createdAt).toISOString()}>{formatAgo(comment.createdAt)}</time>
                  </div>
                  <p className="nc-comment-body">{comment.body}</p>
                  {panel === 'delete' ? (
                    <div className="mw-reasons" role="group" aria-label="Delete your comment?" data-panel tabIndex={-1}
                      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); cancel(comment, 'delete') } }}>
                      <p>Delete your comment?</p>
                      <button type="button" className="mw-act" disabled={isBusy} onClick={() => void remove(comment)}>{isBusy ? 'Deleting…' : 'Delete'}</button>
                      <button type="button" className="mw-act" disabled={isBusy} onClick={() => cancel(comment, 'delete')}>Cancel</button>
                    </div>
                  ) : panel === 'report' ? (
                    <div className="mw-reasons" role="group" aria-label="Why report it?" data-panel tabIndex={-1}
                      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); cancel(comment, 'report') } }}>
                      <p>Why report it?</p>
                      {REPORT_REASONS.map(reason => (
                        <button key={reason.value} type="button" className="mw-act" disabled={isBusy} onClick={() => void report(comment, reason.value)}>{reason.label}</button>
                      ))}
                      <button type="button" className="mw-act" disabled={isBusy} onClick={() => cancel(comment, 'report')}>Cancel</button>
                    </div>
                  ) : (
                    <div className="mw-comment-actions">
                      {comment.mine ? (
                        signedIn ? <button type="button" className="mw-act" data-act="delete" onClick={() => openPanel(comment, 'delete')}>Delete</button> : null
                      ) : comment.reportedByYou || reported.has(comment.id) ? (
                        <span className="nc-muted">Reported. Thanks.</span>
                      ) : signedIn ? (
                        <button type="button" className="mw-act" data-act="report" onClick={() => openPanel(comment, 'report')}>Report</button>
                      ) : null}
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {items !== null && load === 'failed' ? <p className="nc-muted" role="status">More comments didn’t load.</p> : null}
      {items !== null && cursor ? (
        <button type="button" className="nc-btn" disabled={load === 'loading'} onClick={() => void showMore()}>{load === 'loading' ? 'Loading…' : 'Show more comments'}</button>
      ) : null}
    </section>
  )
}
