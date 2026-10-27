/**
 * Moments (R5-2, mockup hub-r4.js momRow / momCard / momentHover): who, which
 * game, and how the minute compares with the stream's own average before it
 * (emotes for an emote spike, chat for a chat spike). Mouse and pen show the
 * numbers in a card after a 150 ms rest, keyboard focus at once; the card never
 * takes the pointer, so the row under it keeps the click. Leave, blur, Esc or
 * any scroll hides it. A click opens the moment in Analytics → Moments.
 * The hub sends no per-minute series for a moment, so the card has no bars.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { sanitizeEmoteImageUrl } from '../../../../lib/emoteAssetUrl'
import type { HubLivePulseMoment } from '../../../../lib/publicHub'
import { HubToggletip } from '../d3/HubToggletip'
import '../d3/hub-d3-tokens.css'
import { HubV5Avatar } from './HubV5Avatar'
import {
  formatHubMultiplier,
  formatHubRate,
  hubClock,
  isLowMultiplier,
  momentRowAria,
  momentRowsV5,
  momentsTip,
  type HubMomentRowV5,
} from './hubV5Model'

const H_ID = 'hv5-mo-h'
const REST_MS = 150
const PHONE_ROWS = 5

function useMedia(query: string): boolean {
  const get = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches
  const [matches, setMatches] = useState(get)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined
    const mq = window.matchMedia(query)
    const onChange = () => setMatches(mq.matches)
    onChange()
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [query])
  return matches
}

const metric = (row: HubMomentRowV5) => (row.series === 'chat' ? 'chat' : 'emotes')

function GameArt({ moment }: { moment: HubLivePulseMoment }) {
  return moment.boxArtUrl && !moment.categoryMetadataRejected
    ? <img src={moment.boxArtUrl} alt="" width={12} height={16} decoding="async" referrerPolicy="no-referrer" />
    : null
}

function MomentCard({ row, avatar }: { row: HubMomentRowV5; avatar: string | null }) {
  const m = row.moment
  const unit = `${metric(row)}/min`
  const cmp = row.cmp
  const emoteSrc = sanitizeEmoteImageUrl(row.topEmote?.imageUrl)
  return (
    <>
      <div className="hv5-mc-h">
        <HubV5Avatar login={row.login} name={row.displayName} src={avatar} size={24} />
        <span className="hv5-mc-nm">{row.displayName}</span>
        {row.at != null ? <span className="hv5-mc-t">{hubClock(row.at)}</span> : null}
      </div>
      <div className="hv5-mc-g"><GameArt moment={m} /><span>{m.category || 'Game not sent'}</span></div>
      <div className="hv5-mc-r"><b>{formatHubRate(row.rate)}</b> {unit}<span className="hv5-mc-l">{row.label}</span></div>
      {'x' in cmp ? (
        <p className="hv5-mc-x">
          <b className={isLowMultiplier(cmp.x) ? 'lo' : undefined}>{formatHubMultiplier(cmp.x)}</b> its own average
          <span>{formatHubRate(cmp.avg)} {unit} on average before this, over {cmp.mins} measured min</span>
        </p>
      ) : (
        <p className="hv5-mc-x hv5-mc-na">{cmp.long}</p>
      )}
      {row.topEmoteName ? (
        <div className="hv5-mc-e">
          Top emote {emoteSrc ? <img src={emoteSrc} alt="" width={20} height={20} decoding="async" /> : null}
          <b>{row.topEmoteName}</b>
        </div>
      ) : null}
      <p className="hv5-mc-go">Click to open in Moments</p>
    </>
  )
}

export interface HubV5MomentsProps {
  moments: readonly HubLivePulseMoment[]
  /** Profile pictures from the live pool, by login (moments may not carry their own). */
  avatars?: ReadonlyMap<string, string>
  loading?: boolean
}

export function HubV5Moments({ moments, avatars, loading = false }: HubV5MomentsProps) {
  const rows = useMemo(() => momentRowsV5(moments), [moments])
  const phone = useMedia('(max-width: 719px)')
  const fine = useMedia('(pointer: fine)')
  const shown = phone ? rows.slice(0, PHONE_ROWS) : rows
  const byKey = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows])
  const avatarOf = (row: HubMomentRowV5) => row.moment.profileImageUrl || avatars?.get(row.login) || null

  const [on, setOn] = useState<{ key: string; el: HTMLElement } | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const timer = useRef<number | undefined>(undefined)
  const hide = useCallback(() => {
    window.clearTimeout(timer.current)
    setOn(null)
  }, [])

  useEffect(() => () => window.clearTimeout(timer.current), [])
  // A row that left the list (a new poll) takes its card with it.
  useEffect(() => {
    if (on && !byKey.has(on.key)) hide()
  }, [byKey, on, hide])

  useEffect(() => {
    if (!on) return undefined
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') hide() }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', hide, { passive: true, capture: true })
    window.addEventListener('resize', hide)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', hide, { capture: true })
      window.removeEventListener('resize', hide)
    }
  }, [on, hide])

  // Beside the row (right, else left); with no room beside it, under or over. Kept 8 px inside the window.
  useLayoutEffect(() => {
    const card = cardRef.current
    if (!on || !card) return
    const b = on.el.getBoundingClientRect()
    const w = card.offsetWidth
    const h = card.offsetHeight
    const g = 10
    let left = b.right + g
    if (left + w > window.innerWidth - 8) left = b.left - g - w
    let top = b.top + b.height / 2 - h / 2
    if (left < 8) {
      left = Math.max(8, Math.min(window.innerWidth - w - 8, b.left))
      top = b.bottom + g + h <= window.innerHeight - 8 ? b.bottom + g : b.top - g - h
    }
    card.style.left = `${Math.round(left)}px`
    card.style.top = `${Math.round(Math.max(8, Math.min(window.innerHeight - h - 8, top)))}px`
    card.style.visibility = ''
  }, [on])

  const rowOf = (target: EventTarget | null) => (target instanceof Element ? target.closest<HTMLElement>('[data-mom-key]') : null)

  const onPointerOver = (event: PointerEvent<HTMLOListElement>) => {
    const el = rowOf(event.target)
    if (!el || el === on?.el || event.pointerType === 'touch' || !fine) return
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      if (el.isConnected && el.matches(':hover')) setOn({ key: el.dataset.momKey!, el })
    }, on ? 0 : REST_MS)
  }
  const onPointerOut = (event: PointerEvent<HTMLOListElement>) => {
    const el = rowOf(event.target)
    if (!el || (event.relatedTarget instanceof Node && el.contains(event.relatedTarget))) return
    window.clearTimeout(timer.current)
    if (on?.el === el) hide()
  }
  const onFocus = (event: FocusEvent<HTMLOListElement>) => {
    const el = rowOf(event.target)
    let visible = false
    try { visible = Boolean(el?.matches(':focus-visible')) } catch { visible = false }
    if (el && visible) setOn({ key: el.dataset.momKey!, el })
    else if (on) hide()
  }
  const onBlur = (event: FocusEvent<HTMLOListElement>) => {
    if (on && event.target === on.el) hide()
  }

  const cardRow = on ? byKey.get(on.key) : undefined

  return (
    <aside id="latest" className="hv5-sec hv5-latest" aria-labelledby={H_ID}>
      <div className="hv5-rh">
        <h2 id={H_ID}>Moments</h2>
        <HubToggletip tip={momentsTip(rows.length)} label="About Moments" />
        <span className="hv5-end"><Link className="hv5-mo-all" to="/analytics/moments">All moments →</Link></span>
      </div>
      {shown.length ? (
        <ol className="hv5-mo-list" aria-labelledby={H_ID} onPointerOver={onPointerOver} onPointerOut={onPointerOut} onFocus={onFocus} onBlur={onBlur}>
          {shown.map((row) => (
            <li key={row.key}>
              <Link className="hv5-mo" to={row.href} data-mom-key={row.key} aria-label={momentRowAria(row)}>
                <HubV5Avatar login={row.login} name={row.displayName} src={avatarOf(row)} size={28} />
                <span className="hv5-mo-tx">
                  <span className="hv5-mo-nm">{row.displayName}</span>
                  <span className="hv5-mo-gm"><GameArt moment={row.moment} /><span>{row.moment.category || 'Game not sent'}</span></span>
                </span>
                <span className="hv5-mo-v">
                  {'x' in row.cmp ? (
                    <>
                      <span className={`hv5-mo-x${isLowMultiplier(row.cmp.x) ? ' lo' : ''}`}>{formatHubMultiplier(row.cmp.x)}</span>
                      <span className="hv5-mo-u">{metric(row)} vs avg</span>
                    </>
                  ) : (
                    <span className="hv5-mo-why">{row.cmp.why}</span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      ) : loading ? null : (
        <p className="hv5-none">No moments from live channels right now.</p>
      )}
      {cardRow && typeof document !== 'undefined'
        ? createPortal(
          <div ref={cardRef} className="hub-d3-layer hv5-layer hv5-mo-card" aria-hidden="true" data-hv5-moment-card="" style={{ left: 0, top: 0, visibility: 'hidden' }}>
            <MomentCard row={cardRow} avatar={avatarOf(cardRow)} />
          </div>,
          document.body,
        )
        : null}
    </aside>
  )
}
