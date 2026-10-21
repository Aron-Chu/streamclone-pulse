import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AnalyticsFigmaShell } from '../../analytics/AnalyticsFigmaShell'
import {
  appendMomentsFeed, isMomentsFeedItem, loadMomentsFeed, loadMomentsFeedItem, loadMomentsFeedRest, mergeMomentsFeed, momentsFeedIdFromLegacy,
  momentsFeedIdParts, MOMENTS_WINDOW_MS, pollMomentsFeed, type MomentMetricKind, type MomentsFeedItem, type MomentsFeedSnapshot,
} from '../../../../lib/momentsFeed'
import {
  actOf, ariaOf, avatarImage, boxArtImage, checkMoment, clk, fx, groupsOf, int, liveFrameImage, SORTS, sparkBars, STALE_MS, streamTime, streamWhere,
  updatedText, when, type CheckedMoment,
} from '../../../../lib/momentsChecked'
import { loadMomentVod, momentVodCache } from '../../../../lib/momentsFeedVod'
import { broadcastTimelineHref } from '../../../../lib/momentsNavigation'
import { headerClear, watchHeaderClear } from './headerClear'
import { MomentDetail } from './MomentDetail'
import { MomentAct } from './MomentAct'
import { ReplayGlyph, SearchGlyph } from './glyphs'
import './moments-checked.css'

/** Polls bring the newest page every 45 s (the feed's demo cadence; its edge cache holds a page for 30 s). */
const POLL_MS = 45_000
const SAVED_KEY = 'sp-moments-checked-saved'
const SAVED_MAX = 200
/** Latest: the moments that hold up or partly do, newest first (moments-r4 B2: no verdict tiers, filters or orders). Saved: this browser's. */
type MomentsTab = 'latest' | 'saved'

function useMatch(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window.matchMedia !== 'function') return () => undefined
      const mq = window.matchMedia(query)
      mq.addEventListener?.('change', onChange)
      return () => mq.removeEventListener?.('change', onChange)
    },
    () => typeof window.matchMedia === 'function' && window.matchMedia(query).matches,
    () => false,
  )
}

/** Saved moments are kept whole, in this browser, so one stays after it leaves the 12-hour feed. */
function readSaved(): Map<string, MomentsFeedItem> {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(SAVED_KEY) || '[]')
    return new Map((Array.isArray(raw) ? raw : []).filter(isMomentsFeedItem).map(item => [item.id, item]))
  } catch {
    return new Map()
  }
}
function writeSaved(saved: Map<string, MomentsFeedItem>) {
  try { window.localStorage.setItem(SAVED_KEY, JSON.stringify([...saved.values()].slice(-SAVED_MAX))) } catch { /* private window: this visit only */ }
}

const ini = (name: string) => name.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase() || '?'

/**
 * /analytics/moments behind VITE_PUBLIC_MOMENTS_FEED (design: moments-r2,
 * 2026-10-16, laid out as moments-r4 B2, 2026-10-21: the list with a picture
 * per row, the open moment beside it from 900 px). Reads /v1/public/moments; every verdict, check and baseline is
 * the backend's. The list draws from the feed's first page while the rest load
 * behind it. When the feed is not there (404 while the backend flag is off) or
 * the first page fails, the page is the current one, unchanged.
 */
export default function MomentsCheckedPage({ fallback }: { fallback: ReactNode }) {
  const [state, setState] = useState<{ status: 'loading' } | ({ status: 'ready' } & Initial) | { status: 'failed' }>({ status: 'loading' })
  useEffect(() => {
    const controller = new AbortController()
    const readAt = Date.now()
    loadMomentsFeed(readAt, controller.signal).then(
      snap => setState({ status: 'ready', snap, at: Date.now(), readAt }),
      () => { if (!controller.signal.aborted) setState({ status: 'failed' }) })
    return () => controller.abort()
  }, [])
  if (state.status === 'failed') return <>{fallback}</>
  return <AnalyticsFigmaShell hideSidebar>
    <CheckedMoments key={state.status} initial={state.status === 'ready' ? state : null} />
  </AnalyticsFigmaShell>
}

/** The first page, when it came, and the time its read asked from (the later pages ask the same). */
interface Initial { snap: MomentsFeedSnapshot; at: number; readAt: number }

function CheckedMoments({ initial }: { initial: Initial | null }) {
  const wide = useMatch('(min-width: 900px)')
  const phone = useMatch('(max-width: 719px)')
  const motion = !useMatch('(prefers-reduced-motion: reduce)')
  const loaded = initial != null

  const query = useMemo(() => new URLSearchParams(window.location.search), [])
  const deepId = query.get('m') ?? momentsFeedIdFromLegacy(query.get('login'), query.get('stream'), query.get('offset'))
  const [items, setItems] = useState<MomentsFeedItem[]>(() => initial?.snap.items ?? [])
  const [loadedAt, setLoadedAt] = useState(() => initial?.at ?? Date.now())
  const [feedStale, setFeedStale] = useState(() => initial?.snap.stale ?? false)
  /** A deep link to a moment the first page did not bring: looked up by id; until it answers, no other moment opens. */
  const [deepWait, setDeepWait] = useState<'no' | 'pending' | 'gone' | 'failed'>(() => (initial && deepId && !initial.snap.items.some(item => item.id === deepId) ? 'pending' : 'no'))
  const [view, setView] = useState<MomentsTab>(() => (query.get('view') === 'saved' ? 'saved' : 'latest'))
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<string | null>(() => (deepId && initial?.snap.items.some(item => item.id === deepId) ? deepId : null))
  const [opened, setOpened] = useState<{ key: string | null; lk: number | null; metric: MomentMetricKind | null }>({ key: null, lk: null, metric: null })
  const [saved, setSaved] = useState(readSaved)
  /** Moments a poll brought while the pointer or focus was in the list: they wait behind the pill. */
  const [held, setHeld] = useState<Set<string>>(() => new Set())
  /** Moments that just arrived: they slide in once. */
  const [arrived, setArrived] = useState<Set<string>>(() => new Set())
  const [replay, setReplay] = useState<{ vnow: number; end: number } | null>(null)
  /** During a replay, moments after this time are not shown yet. */
  const [shownUntil, setShownUntil] = useState<number | null>(null)
  const [clock, setClock] = useState(() => Date.now())
  const [said, setSaid] = useState('')

  const mainRef = useRef<HTMLElement>(null)
  const listRef = useRef<HTMLOListElement>(null)
  const listWrapRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const dotRef = useRef<HTMLSpanElement>(null)
  const playRef = useRef<((rel: number | null) => void) | null>(null)
  const holding = useRef(false)
  const flipFrom = useRef<Map<string, number> | null>(null)
  const keep = useRef<{ key: string; y0: number } | null>(null)
  const focusAfter = useRef<{ row?: string; scrollTo?: string } | null>(deepId && sel ? { scrollTo: deepId } : null)
  const lastOpen = useRef<string | null>(null)
  const vods = useMemo(() => momentVodCache(item => loadMomentVod(item, new AbortController().signal)), [])

  const now = replay ? replay.vnow : clock
  const nowMinute = Math.floor(now / 60_000) * 60_000
  const pool = useMemo(() => items.map(item => checkMoment(item, nowMinute)), [items, nowMinute])
  const byKey = useMemo(() => new Map(pool.map(m => [m.key, m])), [pool])
  // a saved moment that has left the feed: shown under Saved only, as an ended stream
  const savedOnly = useMemo(() => (view === 'saved' ? [...saved.values()].filter(item => !byKey.has(item.id)).map(item => checkMoment({ ...item, streamLive: false }, nowMinute)) : []),
    [view, saved, byKey, nowMinute])
  const find = (key: string) => byKey.get(key) ?? savedOnly.find(m => m.key === key) ?? null

  const qq = q.trim().toLowerCase()
  // Latest leaves out what didn't hold up, except the open moment (a deep link, or a held minute's "a moment here").
  const passes = (m: CheckedMoment) =>
    (view === 'saved' ? saved.has(m.key) : m.item.verdict !== 'bad' || m.key === sel) && (!qq || m.find.includes(qq))
  const shown = (m: CheckedMoment) => (shownUntil == null || m.at <= shownUntil) && !held.has(m.key)
  const list = [...pool, ...savedOnly].filter(m => shown(m) && passes(m)).sort(SORTS.new)
  const groups = groupsOf(list)
  const selKey = sel != null && list.some(m => m.key === sel) ? sel : wide && list[0] && deepWait === 'no' ? list[0].key : null
  const selM = selKey ? find(selKey) : null
  const openSid = selM?.sid ?? null
  const lk = opened.key === selKey ? opened.lk : null
  const metric = opened.key === selKey ? opened.metric : null
  const pillN = [...held].filter(key => { const m = byKey.get(key); return m != null && passes(m) }).length

  const latest = useRef({ items, held, replay, selKey, passes, pool })
  latest.current = { items, held, replay, selKey, passes, pool }

  const say = (text: string) => { setSaid(''); window.setTimeout(() => setSaid(text), 30) }
  const rowEl = (key: string) => byData(listRef.current, '.mk-r', 'key', key)
  /** The clicked row stays where it was while things open and close around it. */
  const keepPut = (key: string) => {
    const el = key ? rowEl(key) : null
    keep.current = el ? { key, y0: el.getBoundingClientRect().top } : null
  }
  const captureFlip = () => {
    const tops = new Map<string, number>()
    for (const li of listRef.current?.querySelectorAll<HTMLElement>(':scope > li.mk-g') ?? []) tops.set(li.dataset.sid ?? '', li.getBoundingClientRect().top)
    flipFrom.current = tops
  }
  const writeUrl = (key: string | null) => {
    try {
      const url = new URL(window.location.href)
      for (const legacy of ['login', 'stream', 'offset', 'moment']) url.searchParams.delete(legacy)
      if (key) url.searchParams.set('m', key)
      else url.searchParams.delete('m')
      window.history.replaceState(window.history.state, '', url)
    } catch { /* no history */ }
  }

  const select = (key: string | null, o: { keep?: boolean; focus?: boolean; from?: string } = {}) => {
    const next = !wide && key != null && selKey === key && !o.keep ? null : key // narrow: a second click closes it
    keepPut(next ?? o.from ?? '')
    setDeepWait(w => (w === 'pending' ? w : 'no'))
    setSel(next)
    setOpened({ key: next, lk: null, metric: null })
    writeUrl(next)
    if (o.focus && next) focusAfter.current = { row: next }
    const m = next ? find(next) : null
    if (m) say(ariaOf(m, now))
  }
  const openFromDetail = (key: string) => {
    if (find(key)) select(key, { keep: true, focus: true })
  }
  const closeDetail = () => {
    const key = selKey
    keepPut(key ?? '')
    setSel(null)
    writeUrl(null)
    if (key) focusAfter.current = { row: key }
  }
  const toggleSave = (key: string) => {
    const m = find(key)
    if (!m) return
    const next = new Map(saved)
    if (next.has(key)) next.delete(key)
    else next.set(key, m.item)
    setSaved(next)
    writeSaved(next)
    say(next.has(key) ? 'Saved' : 'Removed from Saved')
  }
  const copyLink = async (key: string) => {
    const url = new URL(window.location.href)
    url.searchParams.set('m', key)
    try { await navigator.clipboard.writeText(url.href) } catch { /* the button still says Copied, as the mockup does */ }
  }
  const ping = () => {
    const dot = dotRef.current
    if (!motion || !dot) return
    dot.classList.remove('ping')
    void dot.offsetWidth
    dot.classList.add('ping')
  }
  /** Rows a poll brought: with the top of the list on screen they slide in and the rest glide down; further down, the rows you are looking at stay put. */
  const arrive = (keys: string[]) => {
    setArrived(new Set(keys))
    if ((listWrapRef.current?.getBoundingClientRect().top ?? 0) >= 0) captureFlip()
    else keepPut(latest.current.selKey ?? '')
  }
  const release = (jump: boolean) => {
    const keys = [...latest.current.held]
    setHeld(new Set())
    const r = latest.current.replay
    setShownUntil(r ? r.vnow : null)
    if (jump) {
      setArrived(new Set(keys))
      captureFlip()
      listWrapRef.current?.scrollIntoView({ block: 'start', behavior: motion ? 'smooth' : 'auto' })
    } else arrive(keys)
  }
  const setHolding = (on: boolean) => {
    holding.current = on
    if (!on && (latest.current.held.size || (latest.current.replay == null && shownUntil != null))) release(false)
  }

  // a deep link to a moment the first page did not bring: one lookup by id
  useEffect(() => {
    if (deepWait !== 'pending' || !deepId) return
    const controller = new AbortController()
    loadMomentsFeedItem(deepId, controller.signal).then(item => {
      if (!item) { setDeepWait('gone'); return }
      setItems(prev => (prev.some(x => x.id === item.id) ? prev : [...prev, item]))
      setSel(item.id)
      setDeepWait('no')
      focusAfter.current = { scrollTo: item.id }
    }, () => { if (!controller.signal.aborted) setDeepWait('failed') })
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // the later pages, one at a time behind the drawn first one; a page that fails leaves what has loaded
  useEffect(() => {
    if (!initial?.snap.nextCursor) return
    const controller = new AbortController()
    void loadMomentsFeedRest(initial.readAt, initial.snap.nextCursor, (page, fresh) => {
      if (fresh) onPoll.current(page) // a new snapshot came out between pages: its first page, as a poll brings it
      else setItems(prev => appendMomentsFeed(prev, page.items))
    }, controller.signal)
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // the portal's header: every sticky top, scroll margin and scroll offset clears it
  useLayoutEffect(() => (mainRef.current ? watchHeaderClear(mainRef.current) : undefined), [])

  // "updated … ago" and the rows' times tick every 10 s
  useEffect(() => {
    const id = window.setInterval(() => setClock(Date.now()), 10_000)
    return () => window.clearInterval(id)
  }, [])

  // polls: the newest page, merged; new moments wait behind the pill while you read
  const onPoll = useRef<(snap: MomentsFeedSnapshot) => void>(() => undefined)
  onPoll.current = (snap) => {
    const { items: merged, added } = mergeMomentsFeed(latest.current.items, snap.items)
    const cutoff = Date.now() - MOMENTS_WINDOW_MS - 10 * 60_000
    setItems(merged.filter(item => item.minuteStart >= cutoff || item.id === latest.current.selKey || saved.has(item.id)))
    setLoadedAt(Date.now())
    setClock(Date.now())
    setFeedStale(snap.stale)
    if (!added.length) return
    if (holding.current) setHeld(prev => new Set([...prev, ...added]))
    else arrive(added)
    ping()
  }
  useEffect(() => {
    if (!loaded || replay) return
    let controller: AbortController | null = null
    const id = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return
      controller?.abort()
      controller = new AbortController()
      // a failed poll keeps what the page holds; "updated … ago" greys after 3 min
      pollMomentsFeed(Date.now(), controller.signal).then(snap => onPoll.current(snap), () => undefined)
    }, POLL_MS)
    return () => { window.clearInterval(id); controller?.abort() }
  }, [loaded, replay])

  // Replay: the last hour as the polls brought it, one 45 s poll every half second
  const step = useRef<() => void>(() => undefined)
  step.current = () => {
    const r = latest.current.replay
    if (!r) return
    const next = Math.min(r.end, r.vnow + 45_000)
    const came = latest.current.pool.filter(m => m.at > r.vnow && m.at <= next && latest.current.passes(m)).map(m => m.key)
    if (holding.current) { if (came.length) setHeld(prev => new Set([...prev, ...came])) } // nothing moves while you read
    else { setShownUntil(next); if (came.length) arrive(came) }
    if (came.length) ping()
    if (next >= r.end) stopReplay(true)
    else setReplay({ ...r, vnow: next })
  }
  useEffect(() => {
    if (!replay) return
    const id = window.setInterval(() => step.current(), motion ? 500 : 1500)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replay == null, motion])
  const startReplay = () => {
    const end = Date.now()
    setReplay({ vnow: end - 60 * 60_000, end })
    setShownUntil(end - 60 * 60_000)
    setHeld(new Set())
  }
  const stopReplay = (done: boolean) => {
    setReplay(null)
    setClock(Date.now())
    if (!holding.current || !done) { setShownUntil(null); setHeld(new Set()) }
  }

  // keys: J/K or ↑ ↓ move, S saves, P plays, / searches, Esc closes (narrow)
  const onKey = useRef<(e: KeyboardEvent) => void>(() => undefined)
  onKey.current = (e) => {
    if (e.defaultPrevented) return
    const t = e.target as HTMLElement
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName || '') || t.isContentEditable
    if (!(t === document.body || mainRef.current?.contains(t))) return
    if (e.key === '/' && !typing) { e.preventDefault(); searchRef.current?.focus(); return }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return
    const keys = [...(listRef.current?.querySelectorAll<HTMLElement>('.mk-r[data-key]') ?? [])].map(b => b.dataset.key ?? '')
    const i = selKey ? keys.indexOf(selKey) : -1
    if (e.key === 'j' || e.key === 'ArrowDown') { if (keys.length) { e.preventDefault(); select(keys[Math.min(keys.length - 1, i + 1)], { keep: true, focus: true }) } }
    else if (e.key === 'k' || e.key === 'ArrowUp') { if (keys.length) { e.preventDefault(); select(keys[Math.max(0, i < 0 ? 0 : i - 1)], { keep: true, focus: true }) } }
    else if (e.key === 's' && selKey) toggleSave(selKey)
    else if (e.key === 'p' && selKey) playRef.current?.(lk)
    else if (e.key === 'Escape' && selKey && !wide) closeDetail()
  }
  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKey.current(e)
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  useLayoutEffect(() => {
    const tops = flipFrom.current
    flipFrom.current = null
    if (tops && motion) {
      for (const li of listRef.current?.querySelectorAll<HTMLElement>(':scope > li.mk-g') ?? []) {
        const y = tops.get(li.dataset.sid ?? '')
        if (y == null || typeof li.animate !== 'function') continue
        const d = y - li.getBoundingClientRect().top
        if (Math.abs(d) > 1) li.animate([{ transform: `translateY(${d.toFixed(1)}px)` }, { transform: 'none' }], { duration: 240, easing: 'cubic-bezier(.2,0,0,1)' })
      }
    }
    const k = keep.current
    keep.current = null
    if (k) {
      const el = rowEl(k.key)
      if (el) { const d = el.getBoundingClientRect().top - k.y0; if (Math.abs(d) > 1) window.scrollBy(0, d) }
    }
    const f = focusAfter.current
    if (f) {
      focusAfter.current = null
      if (f.row) { const el = rowEl(f.row); if (el) { el.focus({ preventScroll: true }); inView(el, motion) } }
      if (f.scrollTo) { const el = rowEl(f.scrollTo); if (el) window.scrollBy(0, el.getBoundingClientRect().top - (wide ? window.innerHeight / 3 : headerClear() + 12)) } // narrow: the row under the header, its detail below
    }
    lastOpen.current = openSid
  })
  useEffect(() => {
    if (!arrived.size) return
    const id = window.setTimeout(() => setArrived(new Set()), 700)
    return () => window.clearTimeout(id)
  }, [arrived])

  const detail = (m: CheckedMoment) => <MomentDetail key={m.key} m={m} pool={pool} now={now} metric={metric} lk={lk}
    setMetric={value => setOpened(o => ({ key: m.key, metric: value, lk: o.key === m.key ? o.lk : null }))}
    setLk={value => setOpened(o => ({ key: m.key, lk: value, metric: o.key === m.key ? o.metric : null }))}
    saved={saved.has(m.key)} onSave={() => toggleSave(m.key)} onCopy={() => copyLink(m.key)} onOpen={openFromDetail} onClose={closeDetail}
    motion={motion} phone={phone} say={say} playRef={playRef} vods={vods} />
  const row = (m: CheckedMoment, more: number, sub: boolean) => <Row m={m} more={more} sub={sub} now={now} current={selKey === m.key}
    onSelect={() => select(m.key, { from: m.key })} />

  const stale = !replay && (feedStale || clock - loadedAt > STALE_MS)
  const deepAt = deepId ? momentsFeedIdParts(deepId) : null
  const gone = deepWait === 'gone' || deepWait === 'failed'
    ? <p className="mk-gone" role="status">{deepWait === 'gone' ? 'That moment is no longer here.' : 'That moment couldn’t be loaded.'}
      {deepAt ? <> <Link to={broadcastTimelineHref(deepAt.login, deepAt.streamId, '/analytics/moments', deepAt.offsetSeconds)}>Open it on the stream’s page</Link></> : null}</p>
    : null
  const fresh = !loaded ? null
    : replay ? <span className="mk-rpl">Replay: <b>{clk(replay.vnow)}</b>, one poll every 45 s</span> : updatedText(clock - loadedAt)

  return <main ref={mainRef} id="analytics-main" className={`mk${motion ? '' : ' no-motion'}`} tabIndex={-1}>
    <header className="mk-head">
      <h1>Moments</h1>
      <p className="mk-lede">Big reactions in live chat. Each one beat its own stream’s last 15 minutes.</p>
    </header>

    <div className="mk-bar" role="search" aria-label="Filter moments">
      <div className="mk-seg" role="group" aria-label="Which moments">
        <button type="button" aria-pressed={view === 'latest'} onClick={() => setView('latest')}>Latest</button>
        <button type="button" aria-pressed={view === 'saved'} onClick={() => setView('saved')}>Saved ({saved.size})</button>
      </div>
      <label className="mk-srch"><SearchGlyph />
        <input ref={searchRef} type="search" placeholder="Channel, game or emote" aria-label="Search channels, games or emotes" autoComplete="off" value={q} onChange={e => setQ(e.target.value)} />
      </label>
      <span className="mk-bar-sp" />
      <p className={`mk-fresh${stale ? ' stale' : ''}${replay ? ' replaying' : ''}`}><span className="mk-dot" ref={dotRef} aria-hidden="true" /><span>{fresh}</span></p>
      <button className="mk-rp" type="button" aria-pressed={replay != null} disabled={!loaded} onClick={() => (replay ? stopReplay(false) : startReplay())}>
        <ReplayGlyph /><span>{replay ? 'Stop replay' : 'Replay the last hour'}</span>
      </button>
    </div>

    <div className="mk-grid">
      <section className="mk-col" aria-label="Moments">
        <div className="mk-listwrap" ref={listWrapRef}
          onPointerEnter={() => setHolding(true)} onPointerLeave={() => setHolding(false)}
          onFocus={() => setHolding(true)} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHolding(false) }}>
          <button className="mk-pill" type="button" hidden={!pillN} onClick={() => release(true)}>{pillN} new ↑</button>
          {wide ? null : gone}
          <ol className="mk-list" ref={listRef}>
            {loaded && !groups.length ? <li className="mk-empty">{view === 'saved' ? 'Nothing saved yet. Save a moment and it stays here, in this browser.' : 'No moments match.'}</li> : null}
            {groups.map(g => {
              const lead = g[0], open = openSid === lead.sid && g.length > 1
              const opening = open && motion && lastOpen.current !== lead.sid
              const inline = !wide && selM ? selM : null
              return <li key={lead.sid} className={`mk-g${arrived.has(lead.key) ? ' new' : ''}`} data-sid={lead.sid} data-vd={lead.item.verdict}>
                {row(lead, g.length - 1, false)}
                {inline && inline.key === lead.key ? <div className="mk-slot">{detail(inline)}</div> : null}
                {open ? <ol className={`mk-sub${opening ? ' opening' : ''}`} aria-label={`Earlier moments from ${lead.name}`}>
                  {g.slice(1).map((m, j) => <Fragment key={m.key}>
                    <li className="mk-g" data-vd={m.item.verdict} style={{ ['--i' as string]: Math.min(j, 8) }}>{row(m, 0, true)}</li>
                    {inline && inline.key === m.key ? <li className="mk-slot">{detail(inline)}</li> : null}
                  </Fragment>)}
                </ol> : null}
              </li>
            })}
          </ol>
        </div>
      </section>
      <aside className="mk-det" aria-label="Selected moment">{wide && selM ? detail(selM) : wide ? gone : null}</aside>
    </div>
    <div className="mk-vh" aria-live="polite">{said}</div>
  </main>
}

/** The element under root matching sel whose data-<field> is value (ids go in no selector). */
const byData = (root: HTMLElement | null, sel: string, field: string, value: string) =>
  [...(root?.querySelectorAll<HTMLElement>(sel) ?? [])].find(el => el.dataset[field] === value) ?? null

function inView(el: HTMLElement, motion: boolean) {
  const r = el.getBoundingClientRect(), top = headerClear()
  if (r.top < top) window.scrollBy({ top: r.top - top - 8, behavior: motion ? 'smooth' : 'auto' })
  else if (r.bottom > window.innerHeight - 8) window.scrollBy({ top: r.bottom - window.innerHeight + 8, behavior: motion ? 'smooth' : 'auto' })
}

/** One row (moments-r4 B2: r2's row with a picture): picture · who + what / × + when + game · the minutes · viewers. */
function Row({ m, more, sub, now, current, onSelect }: { m: CheckedMoment; more: number; sub: boolean; now: number; current: boolean; onSelect: () => void }) {
  const item = m.item, box = boxArtImage(item)
  const full = `${new Date(m.at).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })} · ${streamTime(m, null)} ${streamWhere(null)}`
  const bits: Array<{ key: string; sep?: string; node: ReactNode }> = []
  if (m.rowX != null) bits.push({ key: 'x', node: <span className="mk-r-x"><b>{fx(m.rowX)}</b> the 15 min before</span> })
  else if (m.why) bits.push({ key: 'why', node: <span className="mk-r-why">{m.why}</span> })
  bits.push({ key: 'at', node: <time dateTime={new Date(m.at).toISOString()} title={full}>{when(m.at, now)}</time> })
  if (!sub) {
    if (item.category) bits.push({ key: 'g', sep: 's-g', node: <span className="mk-r-g">{box ? <img src={box} alt="" width={12} height={16} loading="lazy" /> : null}<span>{item.category.name}</span></span> })
    if (more) bits.push({ key: 'more', sep: 's-m', node: <span className="mk-r-more">+{more} earlier</span> })
  }
  const kindColour = m.kind === 'emotes' ? 'var(--mk-emotes)' : 'var(--mk-chat)'
  return <button className="mk-r" type="button" data-key={m.key} aria-current={current} aria-label={ariaOf(m, now, sub ? 0 : more)} onClick={onSelect}>
    {sub ? null : <Thumb m={m} />}
    <span className="mk-r-tx">
      <span className="mk-r-l1">{sub ? null : <span className="mk-r-nm">{m.name}</span>}<MomentAct act={actOf(item)} /></span>
      <span className="mk-r-l2">{bits.map((b, i) => <Fragment key={b.key}>{i ? <span className={`mk-sep${b.sep ? ` ${b.sep}` : ''}`} aria-hidden="true">·</span> : null}{b.node}</Fragment>)}</span>
    </span>
    <span className="mk-r-sp"><svg viewBox="0 0 72 28" aria-hidden="true">
      {sparkBars(m).map((b, i) => <rect key={i} x={b.x.toFixed(2)} y={b.y.toFixed(1)} width={b.w.toFixed(2)} height={b.h.toFixed(1)} rx="0.5"
        fill={b.tone === 'mo' ? 'var(--mk-accent)' : kindColour} opacity={b.tone === 'mo' ? 1 : b.tone === 'in' ? 0.5 : 0.28} />)}
    </svg></span>
    <span className="mk-r-v">{item.viewers != null ? <><b>{int(item.viewers)}</b><span>watched</span></> : null}</span>
  </button>
}

/** The row's picture: the stream's live frame while it is live, else its game's art, blurred, under the channel's avatar. */
function Thumb({ m }: { m: CheckedMoment }) {
  const item = m.item
  const [failed, setFailed] = useState(false)
  const frame = item.streamLive && !failed ? liveFrameImage(item) : undefined
  if (frame) return <span className="mk-r-th"><img className="mk-r-th-f" src={frame} alt="" width={96} height={54} loading="lazy" onError={() => setFailed(true)} /></span>
  const box = boxArtImage(item), avatar = avatarImage(item)
  return <span className="mk-r-th">
    {box ? <img className="mk-r-th-bx" src={box} alt="" loading="lazy" /> : null}
    {avatar ? <img className="mk-r-th-av" src={avatar} alt="" width={28} height={28} loading="lazy" /> : <span className="mk-ini">{ini(m.name)}</span>}
  </span>
}
