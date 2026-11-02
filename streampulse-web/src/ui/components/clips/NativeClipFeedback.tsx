import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { MoreVertical, ThumbsDown, ThumbsUp } from 'lucide-react'
import {
  COMMENT_MAX, clipFeedbackErrorText, commentProblem, deleteClipComment, loadClipComments, loadClipFeedback,
  postClipComment, reportClipComment, setClipReview, ClipFeedbackError,
  type ClipComment, type ClipFeedback, type ClipVerdict, type ReportReason,
} from '../../../lib/clipFeedback'
import { accountBillingSignInHref } from '../../../lib/accountBillingReturn'
import { currentAccountTag, useAccountSession } from '../../../lib/accountSession'
import { clipPagePath } from '../../../lib/nativeClips'
import { ChannelAvatar, formatAgo, formatCount } from './NativeClipParts'


export type FeedbackState =
  | { status: 'loading' | 'off' | 'failed' }
  | { status: 'ready'; feedback: ClipFeedback }

/**
 * A clip's reviews and comment count, read once per clip and per Try again.
 * `reread` reads it again (after the account changes, for example).
 */
export function useClipFeedback(clipId: string) {
  const [state, setState] = useState<FeedbackState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  // Who is looking decides `you` (signed in, can write, your review), so a
  // sign-in, sign-out or account switch in any tab reads it again.
  const session = useAccountSession()
  const viewer = session.status === 'checking' ? null : session.status === 'signed_out' ? 'out' : `in:${currentAccountTag() ?? ''}`
  const seen = useRef(viewer)
  useEffect(() => {
    if (viewer === null || viewer === seen.current) return
    const known = seen.current !== null
    seen.current = viewer
    if (known) setAttempt(n => n + 1)
  }, [viewer])
  useEffect(() => {
    const controller = new AbortController()
    loadClipFeedback(clipId, controller.signal).then(
      feedback => { if (!controller.signal.aborted) setState({ status: 'ready', feedback }) },
      error => { if (!controller.signal.aborted) setState({ status: error instanceof ClipFeedbackError && error.status === 404 ? 'off' : 'failed' }) },
    )
    return () => controller.abort()
  }, [clipId, attempt])
  return {
    state,
    set: (feedback: ClipFeedback) => setState({ status: 'ready', feedback }),
    reread: () => setAttempt(n => n + 1),
  }
}

/** The share line for the description, from 10 reviews; null before then. */
export function worthShareText(feedback: ClipFeedback | null): string | null {
  const { share, total } = feedback?.reviews ?? {}
  if (share == null || total == null) return null
  return `${Math.round(share * 100)}% worth watching (${formatCount(total)} reviews)`
}

/** Shown in place when a signed-out viewer presses Worth watching, Skip or Add a comment. */
export function SignInPrompt({ clipId, canWrite, signedIn }: { clipId: string; canWrite: boolean; signedIn: boolean }) {
  return (
    <div className="nc-signin" role="status">
      <span>{signedIn && !canWrite ? 'Link your Twitch account to review and comment.' : 'Reviews and comments are read-only until you sign in with Twitch.'}</span>
      <Link className="nc-btn nc-pill nc-pill-light" to={signedIn ? '/account/settings' : accountBillingSignInHref(clipPagePath(clipId))}>{signedIn ? 'Link Twitch' : 'Sign in with Twitch'}</Link>
    </div>
  )
}

/**
 * P1: Worth watching N | Skip. The Skip count is never shown. Pressing your
 * own choice again takes it back.
 */
export function ReviewSplit({ feedback, onChange, onNeedSignIn, onStatus }: {
  feedback: ClipFeedback
  onChange: (next: ClipFeedback) => void
  onNeedSignIn: () => void
  onStatus: (message: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const mine = feedback.you.verdict
  const press = async (choice: ClipVerdict) => {
    if (!feedback.you.canWrite) { onNeedSignIn(); return }
    if (busy) return
    setBusy(true)
    try {
      const next = await setClipReview(feedback.clipId, mine === choice ? null : choice)
      onChange(next)
      onStatus(next.you.verdict === 'worth' ? 'You said worth watching.' : next.you.verdict === 'skip' ? 'You said skip.' : 'Your review is removed.')
    } catch (error) {
      if (error instanceof ClipFeedbackError && error.status === 401) onNeedSignIn()
      onStatus(clipFeedbackErrorText(error))
    } finally { setBusy(false) }
  }
  return (
    <span className="nc-split" role="group" aria-label="Your review" aria-busy={busy}>
      <button type="button" aria-pressed={mine === 'worth'} disabled={busy} onClick={() => void press('worth')}>
        <ThumbsUp size={16} aria-hidden="true" />
        Worth watching<span className="nc-num">{feedback.reviews.worth ? ` ${formatCount(feedback.reviews.worth)}` : ''}</span>
      </button>
      <button type="button" aria-pressed={mine === 'skip'} disabled={busy} onClick={() => void press('skip')}>
        <ThumbsDown size={16} aria-hidden="true" />
        Skip
      </button>
    </span>
  )
}

const REASONS: { value: ReportReason; label: string }[] = [
  { value: 'spam', label: 'Spam' },
  { value: 'abuse', label: 'Abuse or harassment' },
  { value: 'other', label: 'Something else' },
]

/** The ⋮ menu on a comment: Delete on your own, Report on anyone else's. */
function CommentMenu({ comment, canWrite, onDelete, onReported, onNeedSignIn, onStatus }: {
  comment: ClipComment
  canWrite: boolean
  onDelete: () => Promise<void>
  onReported: () => void
  onNeedSignIn: () => void
  onStatus: (message: string) => void
}) {
  const [open, setOpen] = useState<'closed' | 'menu' | 'report' | 'delete'>('closed')
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const toggle = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  useEffect(() => {
    if (open === 'closed') return
    const onDown = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) setOpen('closed') }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen('closed')
      toggle.current?.focus()
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])
  useEffect(() => {
    if (open !== 'closed') box.current?.querySelector<HTMLButtonElement>('.nc-menu-panel button')?.focus()
  }, [open])

  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    try { await work(); setOpen('closed') }
    catch (error) {
      if (error instanceof ClipFeedbackError && error.status === 401) onNeedSignIn()
      onStatus(clipFeedbackErrorText(error))
    } finally { setBusy(false) }
  }
  const pick = (next: 'report' | 'delete') => {
    if (!canWrite) { setOpen('closed'); onNeedSignIn(); return }
    setOpen(next)
  }

  return (
    <div className="nc-menu" ref={box}>
      <button ref={toggle} type="button" className="nc-icon-btn" aria-label={`More for ${comment.author.displayName}'s comment`} aria-expanded={open !== 'closed'} aria-controls={panelId}
        onClick={() => setOpen(open === 'closed' ? 'menu' : 'closed')}>
        <MoreVertical size={18} aria-hidden="true" />
      </button>
      {open === 'closed' ? null : (
        <div className="nc-menu-panel" id={panelId}>
          {open === 'menu' ? (
            comment.mine ? <button type="button" onClick={() => pick('delete')}>Delete</button>
              : comment.reportedByYou ? <p className="nc-muted">You reported this.</p>
                : <button type="button" onClick={() => pick('report')}>Report</button>
          ) : open === 'delete' ? (
            <>
              <p>Delete your comment?</p>
              <button type="button" disabled={busy} onClick={() => void run(async () => { await onDelete(); onStatus('Comment deleted.') })}>{busy ? 'Deleting…' : 'Delete'}</button>
              <button type="button" disabled={busy} onClick={() => setOpen('closed')}>Cancel</button>
            </>
          ) : (
            <>
              <p>Why report it?</p>
              {REASONS.map(reason => (
                <button key={reason.value} type="button" disabled={busy} onClick={() => void run(async () => {
                  await reportClipComment(comment.id, reason.value)
                  onReported()
                  onStatus('Thanks. The comment is reported.')
                })}>{reason.label}</button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** C1: comments under the description, newest first, 280 characters, no replies or likes. */
export function ClipComments({ feedback, onTotal, onNeedSignIn, onStatus }: {
  feedback: ClipFeedback
  onTotal: (delta: number) => void
  onNeedSignIn: () => void
  onStatus: (message: string) => void
}) {
  const clipId = feedback.clipId
  const canWrite = feedback.you.canWrite
  const [items, setItems] = useState<ClipComment[] | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [load, setLoad] = useState<'idle' | 'loading' | 'failed'>('loading')
  const [attempt, setAttempt] = useState(0)
  const [draft, setDraft] = useState('')
  const [writing, setWriting] = useState(false)
  const [posting, setPosting] = useState(false)
  const [postError, setPostError] = useState('')
  const inputId = useId()
  const errorId = useId()

  // The first page, again whenever the account changes what "mine" means.
  const who = `${feedback.you.signedIn}:${canWrite}`
  useEffect(() => {
    const controller = new AbortController()
    setLoad('loading')
    loadClipComments(clipId, null, controller.signal).then(
      page => { if (!controller.signal.aborted) { setItems(page.items); setCursor(page.nextCursor); setLoad('idle') } },
      () => { if (!controller.signal.aborted) setLoad('failed') },
    )
    return () => controller.abort()
  }, [clipId, attempt, who])
  // A signed-out viewer has no draft to keep.
  useEffect(() => { if (!canWrite) { setDraft(''); setWriting(false) } }, [canWrite])

  const more = async () => {
    if (!cursor || load === 'loading') return
    setLoad('loading')
    try {
      const page = await loadClipComments(clipId, cursor)
      setItems(current => {
        const seen = new Set((current ?? []).map(item => item.id))
        return [...(current ?? []), ...page.items.filter(item => !seen.has(item.id))]
      })
      setCursor(page.nextCursor)
      setLoad('idle')
    } catch { setLoad('failed') }
  }

  const problem = draft.trim() ? commentProblem(draft) : null
  const left = COMMENT_MAX - [...draft.trim()].length
  const post = async () => {
    if (!canWrite) { onNeedSignIn(); return }
    const issue = commentProblem(draft)
    if (issue) { setPostError(issue); return }
    setPosting(true)
    setPostError('')
    try {
      const comment = await postClipComment(clipId, draft.trim().normalize('NFC'))
      setItems(current => [comment, ...(current ?? []).filter(item => item.id !== comment.id)])
      onTotal(1)
      setDraft('')
      setWriting(false)
      onStatus('Comment posted.')
    } catch (error) {
      if (error instanceof ClipFeedbackError && error.status === 401) onNeedSignIn()
      setPostError(clipFeedbackErrorText(error))
    } finally { setPosting(false) }
  }

  const total = feedback.comments.total
  return (
    <section className="nc-comments" aria-labelledby="nc-comments-title">
      <div className="nc-comments-head">
        <h2 id="nc-comments-title" className="nc-section-title">{total === 1 ? '1 comment' : `${formatCount(total)} comments`}</h2>
        <span className="nc-muted">Newest first</span>
      </div>

      {canWrite ? (
        <form className="nc-add" onSubmit={event => { event.preventDefault(); void post() }}>
          <label htmlFor={inputId} className="sr-only">Add a comment</label>
          <textarea id={inputId} className="nc-add-input" rows={writing ? 3 : 1} placeholder="Add a comment" value={draft}
            maxLength={COMMENT_MAX + 40} aria-invalid={!!(problem || postError)} aria-describedby={errorId}
            onFocus={() => setWriting(true)}
            onChange={event => { setDraft(event.target.value); setPostError('') }}
            onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void post() } }} />
          {writing ? (
            <div className="nc-add-foot">
              <span id={errorId} className={problem || postError ? 'nc-add-error' : 'nc-muted'} aria-live="polite">
                {postError || problem || `${left} left`}
              </span>
              <span className="nc-add-actions">
                <button type="button" className="nc-btn" disabled={posting} onClick={() => { setDraft(''); setWriting(false); setPostError('') }}>Cancel</button>
                <button type="submit" className="nc-btn nc-btn-strong" disabled={posting || !draft.trim() || !!problem}>{posting ? 'Posting…' : 'Comment'}</button>
              </span>
            </div>
          ) : <span id={errorId} hidden />}
        </form>
      ) : (
        <button type="button" className="nc-add nc-add-closed" onClick={onNeedSignIn}>Add a comment</button>
      )}

      {items === null && load === 'loading' ? (
        <div className="nc-comment-list" aria-hidden="true">{Array.from({ length: 3 }, (_, i) => <div key={i} className="nc-skel nc-skel-comment"><span /><span /></div>)}</div>
      ) : items === null ? (
        <p className="nc-muted" role="status">Comments didn’t load. <button type="button" className="nc-link" onClick={() => setAttempt(n => n + 1)}>Try again</button></p>
      ) : !items.length ? (
        <p className="nc-muted">No comments yet.</p>
      ) : (
        <ul className="nc-comment-list">
          {items.map(comment => (
            <li key={comment.id} className="nc-comment">
              <ChannelAvatar channel={{ id: '', ...comment.author }} size={36} />
              <div className="nc-comment-main">
                <div className="nc-comment-who">
                  <span className="nc-strong">{comment.author.displayName}</span>
                  <time className="nc-muted" dateTime={new Date(comment.createdAt).toISOString()}>{formatAgo(comment.createdAt)}</time>
                </div>
                <p className="nc-comment-body">{comment.body}</p>
              </div>
              <CommentMenu comment={comment} canWrite={canWrite} onNeedSignIn={onNeedSignIn} onStatus={onStatus}
                onDelete={async () => {
                  await deleteClipComment(comment.id)
                  setItems(current => (current ?? []).filter(item => item.id !== comment.id))
                  onTotal(-1)
                }}
                onReported={() => setItems(current => (current ?? []).map(item => item.id === comment.id ? { ...item, reportedByYou: true } : item))} />
            </li>
          ))}
        </ul>
      )}
      {items !== null && load === 'failed' ? <p className="nc-muted" role="status">More comments didn’t load.</p> : null}
      {items !== null && cursor ? (
        <button type="button" className="nc-btn" disabled={load === 'loading'} onClick={() => void more()}>{load === 'loading' ? 'Loading…' : 'Show more comments'}</button>
      ) : null}
    </section>
  )
}
