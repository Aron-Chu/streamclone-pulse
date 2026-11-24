/**
 * Front page chat band, "Fastest chats" (board artifacts/chat-now-board-20261122, ★ 1A 2A 3A, 11-22): the five
 * busiest live chats by the Hub's Busiest now, between the hero and the demo. Ticks run through each bar at that
 * chat's pace; rows slide when the minute's read lands. On a wide screen with a mouse, pointing at a row opens
 * Twitch's own chat for it beside the list; until then, from the keyboard, without a mouse, with data saver, or when
 * Twitch does not load, the panel plays the chat as board option D's column of blank lines at its pace. Rules in landingChatNowModel.ts; styles
 * in landing.css (.sl-cn-*).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { PublicHub } from '../../../lib/publicHub'
import { useMatchMedia } from '../../hooks/useMatchMedia'
import { HubV5Avatar } from '../hub/v5/HubV5Avatar'
import { busiestAria, type HubBusiestRow } from '../hub/v5/hubV5Model'
import {
  CHAT_NOW_HUB_HREF,
  CHAT_NOW_ROWS,
  CHAT_PEEK_DRAW_MS,
  CHAT_PEEK_FADE_MS,
  CHAT_PEEK_SETTLE_MS,
  CHAT_PEEK_TIMEOUT_MS,
  CHAT_PEEK_WIDE_QUERY,
  CHAT_COLUMN_LINES,
  CHAT_LINE_EMOTES_MAX,
  chatBarPct,
  chatColumnLine,
  chatEmotesPerMessage,
  chatMessagesPerLine,
  chatNowBand,
  chatPeekAllowed,
  chatTicks,
  subscribeChatPeek,
  twitchChatEmbedUrl,
} from './landingChatNowModel'

const REDUCE = '(prefers-reduced-motion: reduce)'
/** The row slide measures before paint in the browser; the prerender has no rows to measure (and React warns there). */
const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect
const EASE = 'cubic-bezier(0.2, 0.7, 0.2, 1)'

/** A figure that swaps from one real reading to the next: the old one slides out, the new one in, nothing in between. */
function Swap({ text, still }: { text: string; still: boolean }) {
  const seq = useRef(0)
  const [items, setItems] = useState(() => [{ k: 0, t: text, out: false }])
  const last = useRef(text)
  useEffect(() => {
    if (last.current === text) return
    last.current = text
    seq.current += 1
    const k = seq.current
    if (still) { setItems([{ k, t: text, out: false }]); return }
    setItems((cur) => [...cur.slice(-1).map((i) => ({ ...i, out: true })), { k, t: text, out: false }])
    const id = window.setTimeout(() => setItems((cur) => cur.filter((i) => !i.out)), 400)
    return () => window.clearTimeout(id)
  }, [text, still])
  return (
    <span className="sl-cn-sw">
      {items.map((i) => <span key={i.k} className={i.out ? 'out' : items.length > 1 ? 'in' : undefined}>{i.t}</span>)}
    </span>
  )
}

/** A small stable number per channel, so a channel's bar lengths repeat the same way (they are only for looks). */
function seedOf(login: string): number {
  let h = 2166136261
  for (let i = 0; i < login.length; i += 1) h = Math.imul(h ^ login.charCodeAt(i), 16777619)
  return (h >>> 0) || 1
}

function nextRandom(rnd: { v: number }): number {
  rnd.v = (Math.imul(rnd.v, 1103515245) + 12345) >>> 0
  return (rnd.v >>> 8) / 0x1000000
}

/**
 * One line at the bottom of the column: a blank bar for the message (its length is only for looks), then its emotes
 * as blank squares, `emotes` a line on average (a fraction becomes one more square that often). The oldest line goes.
 */
function addLine(col: HTMLElement, rnd: { v: number }, emotes: number, animate: boolean) {
  const line = document.createElement('span')
  line.className = animate ? 'sl-cn-ln n' : 'sl-cn-ln'
  const k = Math.min(CHAT_LINE_EMOTES_MAX, Math.floor(emotes) + (nextRandom(rnd) < emotes % 1 ? 1 : 0))
  const bar = document.createElement('i')
  bar.style.width = `${k ? 16 + nextRandom(rnd) * 36 : 28 + nextRandom(rnd) * 58}%`
  line.append(bar)
  for (let i = 0; i < k; i += 1) line.append(document.createElement('b'))
  col.append(line)
  while (col.childElementCount > CHAT_COLUMN_LINES) col.firstElementChild?.remove()
}

/**
 * Board option D, "Replay the minute", for a live chat (Aron 11-22: Twitch's chat when it loads, D when it does not).
 * The chat as a column: each counted message comes in at the bottom as a blank bar at the chat's measured pace and
 * pushes the others up, its emotes as blank squares after it at the chat's measured emote rate. No words and no emote
 * pictures: StreamPulse does not keep the words, and the hub has no emotes per live channel. Past CHAT_LINES_MAX_PER_S
 * a second each line stands for several messages and the caption says how many. The column opens full; with reduced
 * motion it stays as it opened.
 */
function ChatColumn({ login, perMin, emotes, run, still }: { login: string; perMin: number; emotes: number; run: boolean; still: boolean }) {
  const col = useRef<HTMLDivElement>(null)
  const rnd = useRef({ v: 1 })
  const has = perMin > 0
  const perLine = chatMessagesPerLine(perMin)
  const emotesRef = useRef(emotes * perLine)
  // a layout effect before the fill below, so a new chat's column opens at that chat's emote rate
  useBrowserLayoutEffect(() => { emotesRef.current = emotes * perLine }, [emotes, perLine])
  // a new chat: the column opens full, as the chat looks when you arrive (before paint, so it never shows empty)
  useBrowserLayoutEffect(() => {
    const el = col.current
    if (!el) return
    el.replaceChildren()
    if (!has) return
    rnd.current = { v: seedOf(login) }
    for (let i = 0; i < CHAT_COLUMN_LINES; i += 1) addLine(el, rnd.current, emotesRef.current, false)
  }, [login, has])
  // new lines at the chat's pace; none off screen, under Twitch's chat, or with reduced motion
  useEffect(() => {
    const el = col.current
    if (!el || !has || !run || still) return
    const perS = perMin / 60 / perLine
    let acc = 0
    let last = performance.now()
    let raf = requestAnimationFrame(function step(t) {
      acc += Math.min(0.25, Math.max(0, t - last) / 1000) * perS
      last = t
      while (acc >= 1) { addLine(el, rnd.current, emotesRef.current, true); acc -= 1 }
      raf = requestAnimationFrame(step)
    })
    return () => cancelAnimationFrame(raf)
  }, [has, perMin, perLine, run, still])
  return <div className="sl-cn-col" ref={col} aria-hidden="true" />
}

interface Frame { login: string; name: string; ready: boolean }

/** Focus from the keyboard, not the focus a click gives a link on the way to opening it. */
function keyboardFocus(el: Element): boolean {
  try { return el.matches(':focus-visible') } catch { return true }
}

function ChatPeek({ row, emotes, allowed, pointed, onScreen, still }: { row: HubBusiestRow; emotes: number; allowed: boolean; pointed: boolean; onScreen: boolean; still: boolean }) {
  // The frames in the panel, oldest first: while a new chat loads, the one before it stays under it (dimmed) until the new
  // one fades in over it, so moving from chat to chat never drops to the column in between.
  const [frames, setFrames] = useState<Frame[]>([])
  const [failed, setFailed] = useState<string | null>(null)
  const framesRef = useRef<Frame[]>([])
  useEffect(() => { framesRef.current = frames }, [frames])
  // Twitch loads for a row pointed at only: keyboard focus shows the column and never pulls Twitch's frame into the Tab order
  const want = allowed && pointed ? row.login : null
  const wantRef = useRef(want)
  useEffect(() => { wantRef.current = want }, [want])
  const name = row.displayName

  // one draw wait per frame, so a frame reloading under the new one never cancels the new one's
  const drawn = useRef(new Map<string, number>())
  useEffect(() => () => { for (const id of drawn.current.values()) window.clearTimeout(id) }, [])
  useEffect(() => {
    setFailed(null)
    if (!want) { setFrames([]); return }
    setFrames((fs) => {
      const mine = fs.find((f) => f.login === want)
      if (mine?.ready) return [mine]
      const under = fs.filter((f) => f.ready && f.login !== want).slice(-1)
      return [...under, mine ?? { login: want, name, ready: false }]
    })
    const id = window.setTimeout(() => {
      const f = framesRef.current.find((x) => x.login === want)
      if (f && !f.ready) { setFrames([]); setFailed(want) }
    }, CHAT_PEEK_TIMEOUT_MS)
    return () => window.clearTimeout(id)
    // the name only labels a new frame; a new name for the same chat does not reload it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [want])

  // the frame's chat has drawn: it fades in and the one under it goes; a frame for a chat no longer wanted goes at once
  const later = (key: string, ms: number, run: () => void) => {
    window.clearTimeout(drawn.current.get(key))
    drawn.current.set(key, window.setTimeout(() => { drawn.current.delete(key); run() }, ms))
  }
  const drew = (login: string) => later(login, CHAT_PEEK_DRAW_MS, () => {
    if (login !== wantRef.current) {
      setFrames((fs) => fs.filter((f) => f.login !== login || f.ready))
      return
    }
    setFrames((fs) => fs.map((f) => (f.login === login ? { ...f, ready: true } : f)))
    // the frame under it goes once the new one has faded in over it
    later(`${login} under`, CHAT_PEEK_FADE_MS, () => {
      if (login === wantRef.current) setFrames((fs) => fs.filter((f) => f.login === login))
    })
  })

  const on = frames.some((f) => f.login === row.login && f.ready)
  // any drawn frame over the column, the dimmed one under a loading chat included: the column holds still under it
  const covered = frames.some((f) => f.ready)
  const hint = failed === row.login
    ? 'Twitch’s chat didn’t load.'
    : allowed && !pointed ? 'Point at a chat to open Twitch’s live chat here.' : null
  const [host] = useState(() => (typeof window === 'undefined' ? '' : window.location.hostname))

  return (
    <aside className="sl-cn-peek" aria-label={`${row.displayName} chat`}>
      <div className="sl-cn-peek-h">
        <HubV5Avatar login={row.login} name={row.displayName} src={row.avatar} size={24} />
        <b>{row.displayName}</b>
        <span>chat</span>
        <span className="sl-cn-peek-st">{on ? <><i className="sl-cn-dot" aria-hidden="true" />Live on Twitch</> : `${row.fig}/min`}</span>
      </div>
      <div className="sl-cn-peek-b">
        <ChatColumn login={row.login} perMin={row.perMin} emotes={emotes} run={onScreen && !covered} still={still} />
        <div className="sl-cn-pcap">
          <p>{chatColumnLine(row.perMin, emotes)}</p>
          {hint ? <p className="sl-cn-hint">{hint}</p> : null}
        </div>
        {frames.map((f) => (
          <iframe
            key={f.login}
            className="sl-cn-if"
            src={twitchChatEmbedUrl(f.login, host)}
            title={`${f.name} chat on Twitch`}
            tabIndex={-1}
            data-on={f.ready ? '' : undefined}
            data-old={f.login !== row.login ? '' : undefined}
            sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms allow-storage-access-by-user-activation"
            onLoad={() => drew(f.login)}
          />
        ))}
      </div>
    </aside>
  )
}

export interface LandingChatNowProps {
  hub: Pick<PublicHub, 'liveChannels' | 'generatedAt'> | null
  /** The first read is still on its way and nothing is cached: row shapes hold the place. */
  loading: boolean
}

export function LandingChatNow({ hub, loading }: LandingChatNowProps) {
  // the clock moves on its own too, so "right now" stops being said once the counts pass 3 minutes
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => { setNowMs(Date.now()) }, [hub])
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [])
  const band = useMemo(() => chatNowBand(hub, nowMs), [hub, nowMs])
  const rows = band?.rows
  const wide = useMatchMedia(CHAT_PEEK_WIDE_QUERY)
  const still = useMatchMedia(REDUCE)
  const allowed = useSyncExternalStore(subscribeChatPeek, () => chatPeekAllowed(), () => false)

  // the prerendered page has no answer yet: row shapes there would stay forever without JavaScript
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  // ticks and the chat column stop while the band is off screen
  const [sec, setSec] = useState<HTMLElement | null>(null)
  const [onScreen, setOnScreen] = useState(true)
  useEffect(() => {
    if (!sec || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => setOnScreen(e.isIntersecting), { rootMargin: '120px 0px' })
    io.observe(sec)
    return () => io.disconnect()
  }, [sec])

  // 2A: the row pointed at, or reached with the keyboard, for a moment becomes the panel's chat; it stays until another
  // is picked. Only a row pointed at loads Twitch's chat.
  const [picked, setPicked] = useState<{ row: HubBusiestRow; pointed: boolean } | null>(null)
  const settle = useRef(0)
  useEffect(() => () => window.clearTimeout(settle.current), [])
  const pick = (row: HubBusiestRow, pointed: boolean) => {
    if (!wide) return
    window.clearTimeout(settle.current)
    settle.current = window.setTimeout(() => setPicked({ row, pointed }), CHAT_PEEK_SETTLE_MS)
  }
  const unpick = () => window.clearTimeout(settle.current)
  const peekRow = rows ? (picked ? rows.find((r) => r.login === picked.row.login) ?? picked.row : rows[0]) : null

  // rows slide from where they were to where the new read puts them; a new row fades in
  const list = useRef<HTMLOListElement>(null)
  const tops = useRef<Map<string, number> | null>(null)
  const lastWide = useRef(wide)
  const order = rows?.map((r) => r.login).join(' ') ?? ''
  useBrowserLayoutEffect(() => {
    const ol = list.current
    if (!ol) { tops.current = null; return }
    const next = new Map<string, number>()
    const items = Array.from(ol.children) as HTMLElement[]
    for (const li of items) next.set(li.dataset.login ?? '', li.offsetTop)
    const was = lastWide.current === wide ? tops.current : null
    lastWide.current = wide
    if (was && !still && typeof ol.animate === 'function') {
      for (const li of items) {
        const before = was.get(li.dataset.login ?? '')
        const now = next.get(li.dataset.login ?? '') ?? 0
        if (before == null) li.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 500, easing: 'ease' })
        else if (before !== now) li.animate([{ transform: `translateY(${before - now}px)` }, { transform: 'none' }], { duration: 700, easing: EASE })
      }
    }
    tops.current = next
  }, [order, wide, still])

  if (!rows && !(mounted && loading && !hub)) return null
  const shapes = !rows
  const maxPerMin = rows?.[0]?.perMin ?? 0
  const peek = mounted && wide
  return (
    <section
      ref={setSec}
      className="sl-cn"
      aria-labelledby="sl-cn-title"
      aria-busy={shapes || undefined}
      data-off={onScreen ? undefined : ''}
      data-state={band?.state}
    >
      <div className="sl-container sl-cn-in">
        <div className="sl-cn-head">
          <h2 id="sl-cn-title">{band?.title ?? 'Fastest chats'}</h2>
          <p>{band?.sub ?? 'Chat messages per minute in the live channels StreamPulse reads'}</p>
        </div>
        <Link className="sl-cn-more" to={CHAT_NOW_HUB_HREF}>Open the Hub<ArrowRight size={16} aria-hidden="true" /></Link>
        <div className="sl-cn-body" data-peek={peek ? '' : undefined}>
          {shapes ? (
            <>
              <div className="sl-cn-list" aria-hidden="true">
                {Array.from({ length: CHAT_NOW_ROWS }, (_, i) => <div key={i} className="sl-cn-skel" />)}
              </div>
              {peek ? <div className="sl-cn-peek sl-cn-peek-wait" aria-hidden="true" /> : null}
            </>
          ) : (
            <>
              <ol className="sl-cn-list" ref={list} aria-labelledby="sl-cn-title">
                {rows!.map((row) => {
                  const ticks = chatTicks(row.perMin)
                  return (
                    <li key={row.login} data-login={row.login}>
                      <Link
                        className="sl-cn-row"
                        to={row.href}
                        data-sel={peek && peekRow?.login === row.login ? '' : undefined}
                        onMouseEnter={() => pick(row, true)}
                        onMouseLeave={unpick}
                        onFocus={(e) => { if (keyboardFocus(e.currentTarget)) pick(row, false) }}
                        onBlur={unpick}
                      >
                        <span className="sl-cn-rk" aria-hidden="true">{row.rank}</span>
                        <HubV5Avatar login={row.login} name={row.displayName} src={row.avatar} size={36} />
                        <span className="sl-cn-who" aria-hidden="true">
                          <span className="sl-cn-nm">{row.displayName}</span>
                          <span className="sl-cn-gm">{row.category || 'No category'}</span>
                        </span>
                        <span className="sl-cn-trk" aria-hidden="true">
                          <span className="sl-cn-fill" style={{ width: `${chatBarPct(row.perMin, maxPerMin)}%` }}>
                            {ticks ? <span className="sl-cn-tk" style={{ '--sl-cn-gap': `${ticks.gap}px`, '--sl-cn-dur': `${ticks.seconds.toFixed(3)}s` } as CSSProperties} /> : null}
                          </span>
                        </span>
                        <span className="sl-cn-fig" aria-hidden="true"><Swap text={row.fig} still={still} /><small>/min</small></span>
                        {/* its words for screen readers, the Hub tile's pattern (WCAG 2.5.3) */}
                        <span className="sl-cn-vh">{busiestAria(row, rows!.length)}</span>
                      </Link>
                    </li>
                  )
                })}
              </ol>
              {peek && peekRow ? <ChatPeek row={peekRow} emotes={chatEmotesPerMessage(hub, peekRow.login)} allowed={allowed} pointed={picked?.pointed === true && picked.row.login === peekRow.login} onScreen={onScreen} still={still} /> : null}
            </>
          )}
        </div>
      </div>
    </section>
  )
}
