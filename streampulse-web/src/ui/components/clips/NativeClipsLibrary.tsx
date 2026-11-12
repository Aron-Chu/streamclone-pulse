import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search } from 'lucide-react'
import {
  NATIVE_CLIPS_SEARCH_MAX, clipsNotOn, lookupNativeClips,
  type NativeClip, type NativeClipsPeriod, type NativeClipsSort,
} from '../../../lib/nativeClips'
import { useClipList, type ClipListQuery } from '../../../lib/nativeClipsList'
import { removeSavedClip, useSavedClips, type SavedClip } from '../../../lib/savedNativeClips'
import { FOLLOWS_FAILED, connectTwitchFollows, forgetTwitchFollows, useTwitchFollows } from '../../../lib/twitchFollows'
import { MomentSelect } from '../moments/MomentSelect'
import { ClipCard } from './NativeClipCard'
import { GameArt, Notice } from './NativeClipParts'
import './native-clips.css'

const PERIODS: NativeClipsPeriod[] = ['24h', '7d', '30d']
const PERIOD_LABEL: Record<NativeClipsPeriod, string> = { '24h': '24 hours', '7d': '7 days', '30d': '30 days' }
const SORT_LABEL: Record<NativeClipsSort, string> = { newest: 'Newest', views: 'Most viewed', reaction: 'Biggest reaction' }
const SORT_DEFINITION: Record<NativeClipsSort, string> = {
  newest: 'Most recently made first.',
  views: 'Lifetime views on Twitch as we last checked them. Older clips have had longer to collect views.',
  reaction: 'How far chat rose above its usual pace for that stream. It measures chat, not whether the clip is good.',
}
/** Your follows reads pages until it has this many clips to show, or runs out of pages. */
const FOLLOWS_WANT = 24
const FOLLOWS_PAGES = 6
const FOLLOWS_PAGE_SIZE = 48

export type ClipsShow = 'all' | 'follows' | 'saved'

/** The library's filters, kept in the page address so Back and a shared link return to the same grid. */
export function readClipsFilters(params: URLSearchParams) {
  const show: ClipsShow = params.get('show') === 'follows' ? 'follows' : params.get('show') === 'saved' ? 'saved' : 'all'
  const period = (PERIODS as string[]).includes(params.get('period') ?? '') ? params.get('period') as NativeClipsPeriod : '7d'
  const sort = (params.get('sort') ?? '') in SORT_LABEL ? params.get('sort') as NativeClipsSort : 'newest'
  const game = /^[0-9]{1,20}$/.test(params.get('game') ?? '') ? params.get('game')! : null
  const q = (params.get('q') ?? '').trim().slice(0, NATIVE_CLIPS_SEARCH_MAX)
  return { show, period, sort, game, q }
}

/** The list a filter set reads. Your follows reads bigger pages and filters them here. */
export function clipsListQuery(f: ReturnType<typeof readClipsFilters>): ClipListQuery {
  return { period: f.period, sort: f.sort, game: f.game, q: f.q, mix: true, ...(f.show === 'follows' ? { limit: FOLLOWS_PAGE_SIZE } : {}) }
}

/** Saved clips read fresh by id. null: the library no longer lists it. Missing from the map: not read yet. */
function useSavedLookup(saved: SavedClip[], enabled: boolean, attempt: number) {
  const [found, setFound] = useState<ReadonlyMap<string, NativeClip | null>>(new Map())
  const [state, setState] = useState<'idle' | 'loading' | 'failed' | 'off'>('idle')
  const missing = enabled ? saved.filter(item => !found.has(item.id)).map(item => item.id).join(',') : ''
  useEffect(() => {
    if (!missing) return
    const controller = new AbortController()
    const ids = missing.split(',')
    setState('loading')
    lookupNativeClips(ids, controller.signal).then(
      clips => {
        if (controller.signal.aborted) return
        const byId = new Map(clips.map(clip => [clip.id, clip]))
        setFound(prev => new Map([...prev, ...ids.map(id => [id, byId.get(id) ?? null] as const)]))
        setState('idle')
      },
      error => { if (!controller.signal.aborted) setState(clipsNotOn(error) ? 'off' : 'failed') },
    )
    return () => { controller.abort(); setState(s => (s === 'loading' ? 'idle' : s)) }
  }, [missing, attempt])
  return { found, state }
}

/** Arrow keys between cards in a wrapping grid. Cards carry `data-nav`; only the active one is in the tab order. */
function moveFocus(container: HTMLElement | null, key: string) {
  if (!container) return false
  const items = [...container.querySelectorAll<HTMLElement>('[data-nav]')]
  const index = items.indexOf(document.activeElement as HTMLElement)
  if (index < 0) return false
  let target: HTMLElement | undefined
  if (key === 'Home') target = items[0]
  else if (key === 'End') target = items[items.length - 1]
  else if (key === 'ArrowRight') target = items[index + 1]
  else if (key === 'ArrowLeft') target = items[index - 1]
  else if (key === 'ArrowDown' || key === 'ArrowUp') {
    const here = items[index].getBoundingClientRect()
    const down = key === 'ArrowDown'
    const rows = items.filter(el => (down ? el.getBoundingClientRect().top > here.top + 4 : el.getBoundingClientRect().top < here.top - 4))
    if (!rows.length) return false
    const tops = rows.map(el => el.getBoundingClientRect().top)
    const rowTop = down ? Math.min(...tops) : Math.max(...tops)
    target = rows
      .filter(el => Math.abs(el.getBoundingClientRect().top - rowTop) < 4)
      .sort((a, b) => Math.abs(a.getBoundingClientRect().left - here.left) - Math.abs(b.getBoundingClientRect().left - here.left))[0]
  }
  if (!target) return false
  for (const el of items) el.tabIndex = el === target ? 0 : -1
  target.focus()
  target.scrollIntoView?.({ block: 'nearest' })
  return true
}

function SkeletonGrid({ count = 8 }: { count?: number }) {
  return (
    <div className="nc-grid" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => <div key={i} className="nc-skel"><span /><span /><span /></div>)}
    </div>
  )
}

/** Games seen on any clip this visit, so a game's chip keeps its name and picture when its clips aren't loaded. */
const gamesSeen = new Map<string, { name: string; boxArtUrl: string }>()

/**
 * The Clips tab on Moments: Twitch clips StreamPulse made when chat reacted
 * strongly. Chips pick whose clips and which game; each card opens the clip's
 * own page, and Back returns here.
 */
export default function NativeClipsLibrary({ onOpenMoments }: { onOpenMoments: () => void }) {
  const [params, setParams] = useSearchParams()
  const filters = readClipsFilters(params)
  const { show, period, sort, game, q } = filters
  const saved = useSavedClips()
  const follows = useTwitchFollows()
  const [search, setSearch] = useState(q)
  const [attempt, setAttempt] = useState(0)
  const [status, setStatus] = useState('')
  const gridRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const setFilter = (changes: Record<string, string | null>) => {
    setParams(prev => {
      const next = new URLSearchParams(prev)
      for (const [key, value] of Object.entries(changes)) if (value == null) next.delete(key); else next.set(key, value)
      return next
    }, { replace: true, preventScrollReset: true })
  }

  // Search waits for a pause in typing; the address keeps the last search, not every key.
  useEffect(() => {
    const value = search.trim()
    if (value === q) return
    const timer = window.setTimeout(() => setFilter({ q: value || null }), 250)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, q])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName)) return
      if (!searchRef.current) return
      event.preventDefault()
      searchRef.current.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const followsReady = follows.status === 'ready'
  const followsOn = follows.status !== 'off'
  const listWanted = show === 'all' || (show === 'follows' && followsReady)
  const list = useClipList(clipsListQuery(filters), listWanted, attempt)
  const lookup = useSavedLookup(saved.items, show === 'saved', attempt)
  const page = list.page
  const followed = followsReady ? new Set(follows.follows.logins) : null
  const shown = show === 'follows' ? (followed ? list.items.filter(clip => followed.has(clip.channel.login)) : []) : list.items
  const pagesRead = Math.ceil(list.items.length / FOLLOWS_PAGE_SIZE)
  const followsReading = show === 'follows' && followsReady && list.current && !list.loading && list.more !== 'failed'
    && shown.length < FOLLOWS_WANT && pagesRead < FOLLOWS_PAGES && !!page?.nextCursor

  // Your follows filters here, so it reads a few pages before it says nothing matched.
  const { loadMore, more } = list
  useEffect(() => {
    if (followsReading && more === 'idle') loadMore()
  }, [followsReading, more, loadMore])

  for (const clip of list.items) if (clip.game && (clip.game.boxArtUrl || !gamesSeen.has(clip.game.id))) gamesSeen.set(clip.game.id, clip.game)
  const games = page ? (game && !page.games.some(g => g.id === game) ? [{ id: game, name: gamesSeen.get(game)?.name ?? 'This game', count: 0 }, ...page.games] : page.games) : []
  const filtersOn = Boolean(game || q)
  const clearFilters = () => { setSearch(''); setFilter({ game: null, q: null }) }
  const listFrom = list.key + (show === 'follows' ? '#follows' : '')

  const definition = show === 'saved' ? 'Saved in this browser only. Not synced to the extension or your account.'
    : show === 'follows' && followsReady
      ? `Clips from channels you follow on Twitch, among the newest ${list.items.length.toLocaleString()} clips StreamPulse made in the last ${PERIOD_LABEL[period]}. Only this tab keeps your follows, and they are never sent to StreamPulse.`
      : [SORT_DEFINITION[sort],
        sort === 'views' && page?.unranked ? `${page.unranked.toLocaleString()} ${page.unranked === 1 ? 'clip has' : 'clips have'} no view count from Twitch yet and ${page.unranked === 1 ? 'is' : 'are'} left out of this order.` : '',
        page?.truncated ? 'The library keeps the newest 5,000 clips, so older ones in this period aren’t listed.' : '',
      ].filter(Boolean).join(' ')

  const grid = (children: ReactNode, busy = false) => (
    <div className="nc-grid" ref={gridRef} role="list" aria-label={show === 'saved' ? 'Saved clips' : show === 'follows' ? 'Clips from channels you follow' : 'Clips'} aria-busy={busy || undefined} data-busy={busy || undefined}
      onKeyDown={event => { if (moveFocus(gridRef.current, event.key)) event.preventDefault() }}>
      {children}
    </div>
  )
  const retry = <button type="button" className="nc-btn" onClick={() => setAttempt(n => n + 1)}>Try again</button>
  const notOn = <Notice title="Clips aren’t switched on yet" body="The clip library isn’t available here yet. Moments still lists every chat peak."
    action={<button type="button" className="nc-btn" onClick={onOpenMoments}>Open Moments</button>} />
  const listFailed = <Notice alert title="Clips didn’t load." body="The clip list didn’t answer. Your saved clips are still in this browser." action={retry} />

  let results: ReactNode
  if (show === 'saved') {
    if (!saved.items.length) results = <Notice title="Nothing saved yet" body="Use Save on any clip to keep it here." />
    else if (lookup.state === 'off') results = notOn
    else if (lookup.state === 'failed') results = <Notice alert title="Saved clips didn’t load." body="The clip list didn’t answer. Your saved clips are still in this browser." action={retry} />
    else {
      let n = 0
      results = grid(saved.items.map(item => {
        const clip = lookup.found.get(item.id)
        if (clip) return <ClipCard key={clip.id} clip={clip} from="saved" navIndex={n++} onStatus={setStatus} />
        if (clip === undefined) return <div key={item.id} className="nc-skel" role="listitem" aria-label="Loading saved clip"><span /><span /><span /></div>
        return (
          <article key={item.id} className="nc-card nc-card-gone" role="listitem">
            <div className="nc-thumb nc-thumb-missing"><span className="nc-thumb-gone">Not in the library any more</span></div>
            <span className="nc-card-text">
              <span className="nc-card-title">{item.title || 'Saved clip'}</span>
              {item.channel ? <span className="nc-card-channel">{item.channel}</span> : null}
              <button type="button" className="nc-link" onClick={() => { removeSavedClip(item.id); setStatus('Removed from saved clips.') }}>Remove</button>
            </span>
          </article>
        )
      }), lookup.state === 'loading')
    }
  } else if (show === 'follows' && !followsReady) {
    const reading = follows.status === 'opening' || follows.status === 'reading'
    results = (
      <Notice
        alert={follows.status === 'failed'}
        title={reading ? 'Reading your follows…' : follows.status === 'failed' ? FOLLOWS_FAILED[follows.why] : 'See clips from channels you follow'}
        body={reading
          ? (follows.status === 'reading' && follows.read ? `${follows.read.toLocaleString()}${follows.total ? ` of ${follows.total.toLocaleString()}` : ''} channels so far.` : 'Twitch is checking it’s you.')
          : 'Twitch asks you first. Then this tab reads which channels you follow and shows their clips here. Only this tab keeps the list, and it is never sent to StreamPulse.'}
        action={reading || (follows.status === 'failed' && follows.why === 'storage') ? undefined
          : <button type="button" className="nc-btn nc-btn-strong" onClick={connectTwitchFollows}>{follows.status === 'failed' ? 'Try again' : 'Show my Twitch follows'}</button>}
      />
    )
  } else if (list.error === 'off') results = notOn
  else if (list.error === 'failed') results = listFailed
  else if (!page || !list.current) results = <SkeletonGrid />
  else if (!shown.length) {
    if (list.loading || followsReading || (show === 'follows' && more === 'loading')) results = <SkeletonGrid />
    else if (show === 'follows' && more === 'failed') {
      results = <Notice alert title="More clips didn’t load." body="StreamPulse was looking for clips from channels you follow and the clip list stopped answering." action={<button type="button" className="nc-btn" onClick={loadMore}>Try again</button>} />
    } else if (show === 'follows') {
      results = <Notice title="No clips from channels you follow"
        body={`None of the newest ${list.items.length.toLocaleString()} clips in the last ${PERIOD_LABEL[period]} come from a channel you follow. StreamPulse only clips channels in the pilot.`}
        action={filtersOn ? <button type="button" className="nc-btn" onClick={clearFilters}>Clear filters</button>
          : period !== '30d' ? <button type="button" className="nc-btn" onClick={() => setFilter({ period: '30d' })}>Look at 30 days</button> : undefined} />
    } else results = filtersOn
      ? <Notice title="No clips match" body={`Nothing in the last ${PERIOD_LABEL[period]} matches these filters.`} action={<button type="button" className="nc-btn" onClick={clearFilters}>Clear filters</button>} />
      : <Notice title="No clips yet" body={`Nothing was clipped in the last ${PERIOD_LABEL[period]}. StreamPulse makes a clip only when chat reacts strongly on a channel in the pilot. Moments still lists every chat peak.`}
        action={<button type="button" className="nc-btn" onClick={onOpenMoments}>Open Moments</button>} />
  } else results = grid(shown.map((clip, i) => <ClipCard key={clip.id} clip={clip} from={listFrom} navIndex={i} onStatus={setStatus} />), list.loading)

  const canLoadMore = show !== 'saved' && listWanted && page?.nextCursor && list.current && shown.length > 0 && !followsReading
  const chip = (on: boolean, label: ReactNode, onClick: () => void, key?: string) => (
    <button key={key} type="button" className="nc-chip" aria-pressed={on} onClick={onClick}>{label}</button>
  )

  return (
    <div className="nc-library">
      <div className="nc-bar">
        <div className="nc-chips" role="group" aria-label="Show clips">
          {chip(show === 'all', 'All', () => setFilter({ show: null }))}
          {followsOn ? chip(show === 'follows', 'Your follows', () => setFilter({ show: 'follows' })) : null}
          {chip(show === 'saved', <>Saved{saved.items.length ? <span className="nc-num"> {saved.items.length}</span> : null}</>, () => setFilter({ show: 'saved' }))}
          {show !== 'saved' && games.length > 1 ? (
            <>
              <span className="nc-chips-sep" aria-hidden="true" />
              {games.map(g => chip(game === g.id, (
                <>
                  <GameArt game={{ name: g.name, boxArtUrl: gamesSeen.get(g.id)?.boxArtUrl ?? '' }} size="xs" />
                  {g.name}
                </>
              ), () => setFilter({ game: game === g.id ? null : g.id }), g.id))}
            </>
          ) : null}
        </div>
        {show !== 'saved' ? (
          <div className="nc-bar-end">
            <label className="nc-search">
              <Search size={15} aria-hidden="true" />
              <span className="sr-only">Search clips by title, channel or game</span>
              <input ref={searchRef} type="search" placeholder="Search clips" maxLength={NATIVE_CLIPS_SEARCH_MAX} value={search} onChange={event => setSearch(event.target.value)} />
              <kbd aria-hidden="true">/</kbd>
            </label>
            <div className="nc-select">
              <MomentSelect aria-label="Made in the last" value={period} onValueChange={value => setFilter({ period: value === '7d' ? null : value })}>
                {PERIODS.map(p => <option key={p} value={p}>{PERIOD_LABEL[p]}</option>)}
              </MomentSelect>
            </div>
            <div className="nc-select">
              <MomentSelect aria-label="Sort clips" value={sort} onValueChange={value => setFilter({ sort: value === 'newest' ? null : value })}>
                {(Object.keys(SORT_LABEL) as NativeClipsSort[]).map(s => <option key={s} value={s}>{SORT_LABEL[s]}</option>)}
              </MomentSelect>
            </div>
          </div>
        ) : null}
      </div>
      <p className="nc-definition">
        {definition}
        {show === 'follows' && followsReady ? <> <button type="button" className="nc-link" onClick={forgetTwitchFollows}>Forget my follows</button></> : null}
      </p>
      {saved.warning ? <p className="nc-warning" role="status">{saved.warning}</p> : null}
      <p className="sr-only" role="status" aria-live="polite">{status}</p>

      {results}
      {canLoadMore ? (
        <div className="nc-more">
          <button type="button" className="nc-btn" disabled={list.more === 'loading'} onClick={list.loadMore}>{list.more === 'loading' ? 'Loading…' : 'Load more clips'}</button>
          {list.more === 'failed' ? <span className="nc-muted" role="status">More clips didn’t load. Try again.</span> : null}
        </div>
      ) : null}
    </div>
  )
}
