/**
 * The d3-v5 hub's bar lock (L1, bar-lock board 2026-11-01; was R5-8 option A's
 * card): a click on an activity bar locks it, and the lock reads like the emote
 * lock, under the chart at every width. One header row (the time, its day and
 * bar size, ‹ ›, Zoom to bar and Clear), then the bar's busiest chats in two
 * columns of three and its top emotes on the right. No boxes, no capitals. The
 * bar's numbers sit in the readout above the chart (R1).
 *
 * One store holds the selection (hubBucketSelection): the chart draws the
 * sliding band and this lock reads the same snapshot. ‹ › step bars at the
 * chart's level, Zoom to bar zooms the chart, Esc or Clear unlocks, and focus
 * goes back to the plot when it was in the lock. The busiest chats are one
 * hub/moments read per server bucket (≤5, 2 at a time, cached for the tab); a
 * bar stepped past drops its queued reads and any late answer. Each row opens
 * its minute in Moments.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import { BUCKET_MOMENTS_CACHE_EMPTY_MS } from '../../../../lib/bucketMomentsCache'
import { sanitizeEmoteImageUrl } from '../../../../lib/emoteAssetUrl'
import { loadHubIntervalMoments, planHubInterval, readHubIntervalMoments, type HubIntervalMomentsState, type HubIntervalRequest } from '../../../../lib/hubIntervalMoments'
import type { HubApiWindow } from '../../../../lib/hubWindows'
import type { HubActivityPoint, HubLivePulseMoment } from '../../../../lib/publicHub'
import { clearHubBucketSelection, getHubChartBridge, hubBucketSelectionStore, selectHubBucket } from '../../../../lib/hubBucketSelection'
import { HubV5Avatar } from './HubV5Avatar'
import { HubV5Icon } from './HubV5Icon'
import { buildHubV5BarCard, hubV5BarChats, hubV5BarClock, HUB_V5_BAR_CHATS, type HubV5BarCardModel, type HubV5BarEmote } from './hubV5BarCardModel'
import { formatHubInt, momentHref, momentRowKey } from './hubV5Model'
import './hub-v5-bar-card.css'

/** The mockup's leave transition (bucket-card.js close). */
const LEAVE_MS = 140

const reducedMotion = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** A fresh lock that lands wholly below the window scrolls up just enough to show it, never past the top of the plot. */
function reveal(card: HTMLElement) {
  const r = card.getBoundingClientRect()
  if (r.top < window.innerHeight - 48) return
  const plot = getHubChartBridge()?.plotElement()?.getBoundingClientRect()
  const dy = Math.min(r.bottom - window.innerHeight + 16, plot ? plot.top - 64 : Number.POSITIVE_INFINITY)
  if (dy > 0) window.scrollBy({ top: dy, behavior: reducedMotion() ? 'auto' : 'smooth' })
}

/** An emote picture that fails to load, or whose URL is not an allowlisted https one, becomes the quiet two-letter placeholder. */
function EmoteImage({ emote }: { emote: HubV5BarEmote }) {
  const [failed, setFailed] = useState(false)
  const src = sanitizeEmoteImageUrl(emote.imageUrl ?? undefined)
  if (!src || failed) return <span className="hbk-noimg" aria-hidden="true">{emote.name.slice(0, 2) || '?'}</span>
  return <img src={src} alt="" width={24} height={24} decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
}

function step(dir: -1 | 1) {
  const selection = hubBucketSelectionStore.getSnapshot().selection
  const next = selection ? getHubChartBridge()?.stepBar?.(selection.t, dir) : null
  if (next) selectHubBucket({ ...next, source: selection!.source })
}

/** Whether ‹ or › has a bar to go to; at either end of the chart the button says it is off. */
function canStep(t: number, dir: -1 | 1): boolean {
  return getHubChartBridge()?.stepBar?.(t, dir) != null
}

function zoom(model: HubV5BarCardModel) {
  getHubChartBridge()?.zoomToMs?.(model.t, model.end)
}

/* ---------- the busiest chats read ---------- */

const LOADING: HubIntervalMomentsState = { status: 'loading', bucketsRead: 0, bucketsTotal: 1 }

interface BarRead {
  state: HubIntervalMomentsState | null
  /** The bar was still filling in (the newest bar, or history behind) while this answer was on screen. */
  early: boolean
  retry: () => void
}

/** An answer that names no stream. */
const listsNone = (s: HubIntervalMomentsState | null) => s != null && (s.status === 'empty' || (s.status === 'ready' && !hubV5BarChats(s.rows).length))

/**
 * The bar's hub/moments read: the tab cache first (no loading flash), else one
 * load whose queued reads and answers are dropped when the bar changes. An
 * answer belongs to its request, so a bar locked again or stepped back to reads
 * the tab cache afresh. A bar a poll grew keeps its rows while the new bucket
 * reads. An empty answer read while the bar was still filling in stays "not in
 * yet", and is read again once the bar is done and that answer has left the tab
 * cache. Retry waits out the server's Retry-After before it reads again.
 */
function useBarRead(request: HubIntervalRequest | null, slot: string, pending: boolean): BarRead {
  const cached = useMemo(() => (request ? readHubIntervalMoments(request) : null), [request])
  const [got, setGot] = useState<{ req: HubIntervalRequest; s: HubIntervalMomentsState; at: number } | null>(null)
  const [again, setAgain] = useState<{ req: HubIntervalRequest; n: number; notBefore: number } | null>(null)
  const attempt = again?.req === request ? again : null
  const n = attempt?.n ?? 0
  const notBefore = attempt?.notBefore ?? 0
  useEffect(() => {
    if (!request || (n === 0 && readHubIntervalMoments(request))) return undefined
    const ctrl = new AbortController()
    const put = (s: HubIntervalMomentsState) => { if (!ctrl.signal.aborted) setGot({ req: request, s, at: Date.now() }) }
    const timer = window.setTimeout(() => {
      loadHubIntervalMoments(request, { signal: ctrl.signal, onProgress: put })
        .then(put, (error: unknown) => put({ status: 'error', error, retryAfterMs: null, bucketsRead: 0, bucketsTotal: 1 }))
    }, Math.max(0, notBefore - Date.now()))
    return () => {
      window.clearTimeout(timer)
      ctrl.abort()
    }
  }, [request, n, notBefore])

  const current = got?.req === request ? got : null
  const fresh = current ? current.s : cached
  const kept = useRef<{ slot: string; s: HubIntervalMomentsState } | null>(null)
  if (fresh && fresh.status !== 'loading') kept.current = fresh.status === 'ready' && !listsNone(fresh) ? { slot, s: fresh } : null
  const state = (!fresh || fresh.status === 'loading') && kept.current?.slot === slot ? kept.current.s : fresh

  const early = useRef<{ req: HubIntervalRequest | null; on: boolean; at: number }>({ req: null, on: false, at: 0 })
  if (early.current.req !== request) early.current = { req: request, on: pending, at: Date.now() }
  else if (pending && !early.current.on) early.current = { req: request, on: true, at: Date.now() }
  const emptyEarly = early.current.on && listsNone(state)
  const due = emptyEarly && !pending ? Math.max(current?.at ?? 0, early.current.at) + BUCKET_MOMENTS_CACHE_EMPTY_MS : null
  useEffect(() => {
    if (due == null || !request) return undefined
    const timer = window.setTimeout(() => {
      early.current = { req: request, on: false, at: Date.now() }
      setGot({ req: request, s: LOADING, at: Date.now() })
      setAgain({ req: request, n: n + 1, notBefore: 0 })
    }, Math.max(0, due - Date.now()))
    return () => window.clearTimeout(timer)
  }, [due, request, n])

  const retry = () => {
    if (!request) return
    const wait = current?.s.status === 'error' && current.s.retryAfterMs != null ? current.at + current.s.retryAfterMs : 0
    setGot({ req: request, s: LOADING, at: Date.now() })
    setAgain({ req: request, n: n + 1, notBefore: wait })
  }
  return { state, early: emptyEarly, retry }
}

type ChatsView =
  | { kind: 'none' }
  | { kind: 'loading' }
  | { kind: 'rows'; rows: HubLivePulseMoment[] }
  | { kind: 'note'; note: string; retry?: boolean; zoom?: boolean }

function chatsView(model: HubV5BarCardModel, request: HubIntervalRequest | null, state: HubIntervalMomentsState | null, early: boolean): ChatsView {
  if (!request) return { kind: 'none' }
  const plan = planHubInterval(request)
  if (plan.kind === 'zoom-in') {
    return plan.reason === 'long-window'
      ? { kind: 'note', note: 'Set the time window to 7 days or less to see streams.' }
      : { kind: 'note', note: 'Zoom in to list streams.', zoom: true }
  }
  if (!state || state.status === 'loading') return { kind: 'loading' }
  if (state.status === 'error') return { kind: 'note', note: 'Couldn’t load the streams for this bar.', retry: true }
  if (state.status === 'unavailable') return { kind: 'note', note: 'Couldn’t load the streams for this bar.' }
  const rows = state.status === 'ready' ? hubV5BarChats(state.rows) : []
  if (rows.length) return { kind: 'rows', rows }
  return { kind: 'note', note: early ? 'The streams for this bar aren’t in yet.' : 'No streams were listed for this bar.' }
}

/** What the status line adds after "… locked." */
function chatsSay(view: ChatsView): string {
  if (view.kind === 'loading') return 'Loading the streams for this bar.'
  if (view.kind === 'note') return view.note
  if (view.kind === 'rows') return `${view.rows.length} busiest ${view.rows.length === 1 ? 'chat' : 'chats'} listed.`
  return ''
}

function chatAria(m: HubLivePulseMoment, top: boolean): string {
  const name = m.displayName || m.login
  const when = m.at != null ? ` at ${hubV5BarClock(m.at)}` : ''
  return `${name}, ${m.category || 'No category'}, ${formatHubInt(m.chatPerMin)} chat a minute${when}${top ? ', one of the hub’s top moments' : ''}. Opens that minute in Moments.`
}

function ChatRow({ m, i, top, avatars }: { m: HubLivePulseMoment; i: number; top: boolean; avatars?: ReadonlyMap<string, string> }) {
  const login = m.login as string
  const name = m.displayName || login
  const te = m.topEmotes?.[0]
  const teSrc = te ? sanitizeEmoteImageUrl(te.imageUrl ?? undefined) : null
  return (
    <li style={{ animationDelay: `${i * 18}ms` }}>
      <Link to={momentHref(m)} className="hbk-r" aria-label={chatAria(m, top)}>
        <span className="hbk-i">{i + 1}</span>
        <HubV5Avatar login={login} name={name} src={m.profileImageUrl || avatars?.get(login) || avatars?.get(login.toLowerCase())} size={24} />
        <span className="hbk-n">
          <span>{name}</span>
          <small>{m.category || 'No category'}{top ? <> · <span className="hbk-mo">Top moment</span></> : null}</small>
        </span>
        <span className="hbk-te">
          {te && typeof te.name === 'string' ? (
            <>
              {teSrc
                ? <img src={teSrc} alt="" title={te.name} width={20} height={20} decoding="async" referrerPolicy="no-referrer" />
                : <span className="hbk-tn" title={te.name}>{te.name}</span>}
              <span className="hbk-tc">{` ×${formatHubInt(te.count)}`}</span>
            </>
          ) : null}
        </span>
        <span className="hbk-v">{formatHubInt(m.chatPerMin)}/min</span>
        <span className="hbk-at">{m.at != null ? `▶ ${hubV5BarClock(m.at)}` : ''}</span>
      </Link>
    </li>
  )
}

function Chats({ model, view, onRetry, avatars }: { model: HubV5BarCardModel; view: ChatsView; onRetry: () => void; avatars?: ReadonlyMap<string, string> }) {
  const subRef = useRef<HTMLParagraphElement>(null)
  if (view.kind === 'none') return null
  // Retry and the note's Zoom to bar leave with the note: focus stays on the list's heading.
  const keepFocus = (act: () => void) => () => {
    subRef.current?.focus({ preventScroll: true })
    act()
  }
  return (
    <div className="hbk-chats" aria-busy={view.kind === 'loading' || undefined}>
      <p className="hbk-sub" ref={subRef} tabIndex={-1}><b>Busiest chats</b> · in this bar, by chat a minute</p>
      {view.kind === 'loading' ? (
        <ol className="hbk-rows" aria-hidden="true">
          {Array.from({ length: HUB_V5_BAR_CHATS }, (_, i) => <li key={i} className="hbk-ph" />)}
        </ol>
      ) : view.kind === 'rows' ? (
        <ol className="hbk-rows" key={model.key}>
          {view.rows.map((m, i) => (
            <ChatRow key={momentRowKey(m)} m={m} i={i} top={model.hubMoments.has((m.login as string).toLowerCase())} avatars={avatars} />
          ))}
        </ol>
      ) : (
        <p className="hbk-none">
          {view.note}
          {view.retry ? <button type="button" className="hbk-lk" onClick={keepFocus(onRetry)}>Retry</button> : null}
          {view.zoom ? <button type="button" className="hbk-lk" onClick={keepFocus(() => zoom(model))}><HubV5Icon name="zoom" />Zoom to bar</button> : null}
        </p>
      )}
    </div>
  )
}

function Emotes({ model }: { model: HubV5BarCardModel }) {
  const p = model.providers
  const soFar = model.soFar ? ' so far' : ''
  return (
    <div className="hbk-emo">
      <p className="hbk-sub"><b>Top emotes</b> · {model.topEmotes.length ? `a minute${soFar}` : model.topEmotesNote}</p>
      {model.topEmotes.length ? (
        <ol className="hbk-erows">
          {model.topEmotes.map((emote) => (
            <li key={emote.key} className="hbk-e" title={emote.title}>
              <EmoteImage emote={emote} />
              <span className="hbk-en">{emote.name}</span>
              <span className="hbk-v">{emote.rateText}</span>
            </li>
          ))}
        </ol>
      ) : null}
      {p ? (
        <p className="hbk-prov" title="The minutes data splits out 7TV only. Twitch, BTTV and FFZ are in other.">
          7TV <b>{formatHubInt(p.sevenTv)}</b> · other <b>{formatHubInt(p.other)}</b> a minute{soFar}
        </p>
      ) : null}
    </div>
  )
}

function Lock({ model, view, onRetry, titleId, avatars }: { model: HubV5BarCardModel; view: ChatsView; onRetry: () => void; titleId: string; avatars?: ReadonlyMap<string, string> }) {
  return (
    <>
      <div className="hbk-h">
        <span className="hbk-ti">
          <i className="hbk-mk" aria-hidden="true" />
          <h2 className="hbk-t" id={titleId}><span className="hv5-vh">Locked bar, </span>{model.title}</h2>
          <span className="hbk-day">
            {model.day} · {model.minutes}-min bar{model.soFar ? ' · so far' : ''}{model.gap ? ' · Not measured' : ''}
          </span>
          <span className="hbk-step">
            <button type="button" className="hv5-ib" data-act="prev" aria-label="Previous bar" title="Previous bar" aria-disabled={!canStep(model.t, -1)} onClick={() => step(-1)}><HubV5Icon name="left" /></button>
            <button type="button" className="hv5-ib" data-act="next" aria-label="Next bar" title="Next bar" aria-disabled={!canStep(model.t, 1)} onClick={() => step(1)}><HubV5Icon name="right" /></button>
          </span>
        </span>
        <span className="hbk-act">
          <button type="button" className="hbk-btn hbk-zoom" data-act="zoom" onClick={() => zoom(model)}><HubV5Icon name="zoom" />Zoom to bar</button>
          <button type="button" className="hbk-btn hbk-clear" data-act="close" title="Clear (Esc)" onClick={clearHubBucketSelection}>
            Clear<span aria-hidden="true"> ✕</span>
          </button>
        </span>
      </div>
      {model.gap ? (
        <div className="hbk-gap">
          <div className="hbk-hatch" aria-hidden="true" />
          {model.reason ? <p className="hbk-none">{model.reason}</p> : null}
        </div>
      ) : (
        <>
          <div className={view.kind === 'none' ? 'hbk-g hbk-g--emotes' : 'hbk-g'}>
            <Chats model={model} view={view} onRetry={onRetry} avatars={avatars} />
            <Emotes model={model} />
          </div>
          {model.notes.length ? <ul className="hbk-notes">{model.notes.map((note) => <li key={note}>{note}</li>)}</ul> : null}
        </>
      )}
    </>
  )
}

export interface HubV5BarCardProps {
  /** The points the chart draws (`selectHubChartActivityInputs(hub).points`). */
  points: readonly HubActivityPoint[]
  bucketMinutes: number
  /** The hub's detected moments (`livePulseMoments`): they mark their channel's row. */
  moments: readonly HubLivePulseMoment[]
  avatars?: ReadonlyMap<string, string>
  /** The hub/moments window and its server bucket (the emote lock's); without a window the lock lists no streams. */
  intervalWindow?: HubApiWindow
  intervalBucketMinutes?: number
  /** "24-hour history is behind right now": an empty read means the bar isn't in yet. */
  historyBehind?: string | null
}

export function HubV5BarCard({ points, bucketMinutes, moments, avatars, intervalWindow, intervalBucketMinutes, historyBehind }: HubV5BarCardProps) {
  const selection = useSyncExternalStore(
    hubBucketSelectionStore.subscribe,
    hubBucketSelectionStore.getSnapshot,
    hubBucketSelectionStore.getServerSnapshot,
  ).selection
  const model = useMemo(
    () => (selection ? buildHubV5BarCard({ points, bucketMinutes, t: selection.t, endT: selection.endT, barMinutes: selection.barMinutes, moments }) : null),
    [selection, points, bucketMinutes, moments],
  )

  // A selection the points no longer hold (a new window) unlocks, band and all.
  useEffect(() => {
    if (selection && !model) clearHubBucketSelection()
  }, [selection, model])

  // The enter/leave state lives in a child: React 18 loses a store snapshot when a
  // component that reads the store also sets state while it renders.
  return (
    <BarCardView
      model={model}
      avatars={avatars}
      intervalWindow={intervalWindow}
      intervalBucketMinutes={intervalBucketMinutes ?? bucketMinutes}
      behind={Boolean(historyBehind)}
    />
  )
}

function BarCardView({ model, avatars, intervalWindow, intervalBucketMinutes, behind }: {
  model: HubV5BarCardModel | null
  avatars?: ReadonlyMap<string, string>
  intervalWindow?: HubApiWindow
  intervalBucketMinutes: number
  behind: boolean
}) {
  // The unlocked lock stays for its 140 ms fade (0 under reduced motion), so focus can go back to the plot.
  const [prevModel, setPrevModel] = useState(model)
  const [leaving, setLeaving] = useState<HubV5BarCardModel | null>(null)
  const [entering, setEntering] = useState(false)
  if (model !== prevModel) {
    setPrevModel(model)
    if (model) {
      setLeaving(null)
      if (!prevModel && !reducedMotion()) setEntering(true)
    } else if (prevModel) {
      setLeaving(prevModel)
      setEntering(false)
    }
  }
  const shown = model ?? leaving

  // The busiest chats read for the locked bar; a gap bar reads nothing. The newest bar, and every bar while history
  // is behind, is still filling in.
  const t = model?.t
  const end = model?.end
  const readable = model != null && !model.gap && intervalWindow != null
  const request = useMemo<HubIntervalRequest | null>(
    () => (readable && t != null && end != null ? { t, endT: end, activityWindow: intervalWindow!, bucketMinutes: intervalBucketMinutes } : null),
    [readable, t, end, intervalWindow, intervalBucketMinutes],
  )
  const read = useBarRead(request, model?.key ?? '', Boolean(model?.newest) || behind)
  const liveView = model ? chatsView(model, request, read.state, read.early) : null
  // The leaving lock keeps the rows it showed while it fades.
  const lastView = useRef<ChatsView>({ kind: 'none' })
  if (liveView) lastView.current = liveView
  const view = liveView ?? lastView.current

  const cardRef = useRef<HTMLElement>(null)
  const openRef = useRef(false)
  useLayoutEffect(() => {
    const wasOpen = openRef.current
    openRef.current = model != null
    const card = cardRef.current
    if (model && !wasOpen && card) reveal(card)
    if (!model && wasOpen && card?.contains(document.activeElement)) getHubChartBridge()?.focusPlot?.()
  }, [model])

  useEffect(() => {
    if (!entering) return undefined
    const id = window.requestAnimationFrame(() => setEntering(false))
    return () => window.cancelAnimationFrame(id)
  }, [entering])
  useEffect(() => {
    if (!leaving) return undefined
    const id = window.setTimeout(() => setLeaving(null), reducedMotion() ? 0 : LEAVE_MS)
    return () => window.clearTimeout(id)
  }, [leaving])

  // Esc unlocks from anywhere but a text field; an open Top moments row closes first.
  const isOpen = model != null
  useEffect(() => {
    if (!isOpen) return undefined
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const target = event.target as Element | null
      if (target?.closest?.('input, textarea, select, [contenteditable="true"]')) return
      event.preventDefault()
      clearHubBucketSelection()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen])

  // One status line says each change, after the swap: "9:30 to 9:36 PM locked. 6 busiest chats listed."
  // A bar already said says only what its list did since; a poll that grows or trims it says nothing new.
  const key = model?.key ?? null
  const range = model?.range ?? ''
  const gap = model?.gap ?? false
  const listSay = liveView ? (gap ? 'Not measured.' : chatsSay(liveView)) : ''
  const [said, setSaid] = useState('')
  const saidRef = useRef<{ key: string | null; list: string }>({ key: null, list: '' })
  useEffect(() => {
    if (!key) {
      saidRef.current = { key: null, list: '' }
      setSaid('')
      return undefined
    }
    const first = saidRef.current.key !== key
    if (!first && listSay === saidRef.current.list) return undefined
    const text = first ? `${range} locked.${listSay ? ` ${listSay}` : ''}` : listSay
    const id = window.setTimeout(() => {
      saidRef.current = { key, list: listSay }
      setSaid(text)
    }, 30)
    return () => window.clearTimeout(id)
  }, [key, range, listSay])

  const state = model ? (entering ? 'enter' : 'open') : 'leave'
  const titleId = 'hv5-hbk-t'
  return (
    <div id="bk" className="hv5-bk" data-hub-bar-card-host="">
      <div className="hv5-vh" aria-live="polite" aria-atomic="true" data-hub-bar-card-live="">{said}</div>
      {shown ? (
        <section
          ref={cardRef}
          className={`hbk${state === 'enter' ? ' hbk-enter' : state === 'leave' ? ' hbk-leave' : ''}`}
          role="region"
          aria-labelledby={titleId}
          data-scope="hub"
          data-hub-bar-card={state}
          data-hub-bar-chats={shown.gap ? 'gap' : view.kind === 'note' ? 'note' : view.kind}
          data-gap={shown.gap ? '' : undefined}
        >
          <Lock model={shown} view={view} onRetry={read.retry} titleId={titleId} avatars={avatars} />
        </section>
      ) : null}
    </div>
  )
}
