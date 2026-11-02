import { useEffect, useRef, useState } from 'react'
import type { MomentsGame } from '../../../lib/momentsPage'

const initials = (name: string) => name.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase() || '?'
const count = (n: number) => `${n} ${n === 1 ? 'moment' : 'moments'}`

/** A game's cover; its initials when Twitch sends none or the picture fails. */
function Cover({ game }: { game: MomentsGame }) {
  const [failed, setFailed] = useState(false)
  return <span className="moments-cover-art">
    {game.art && !failed ? <img src={game.art} alt="" width={285} height={380} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <span>{initials(game.name)}</span>}
  </span>
}

/**
 * The games on top (M1, 10-22, ported from the checked Moments page): big
 * covers in one row above the list, "All games" first, then the busiest. A
 * cover shows that game's moments and, pressed again, all of them. The row
 * scrolls sideways with its scrollbar hidden: an up/down wheel turns it, and
 * an edge with more past it fades.
 */
export function MomentsGameRow({ games, total, picked, onPick }: {
  games: MomentsGame[]; total: number; picked: string; onPick: (name: string | null) => void
}) {
  const ref = useRef<HTMLUListElement>(null)
  const [edge, setEdge] = useState({ left: false, right: false })
  // a game picked with nothing in this list (a link, or a refresh that moved on) keeps a card, so the pick can be cleared
  const shown = picked && !games.some(game => game.name === picked) ? [{ name: picked, art: null, moments: 0 }, ...games] : games

  useEffect(() => {
    const row = ref.current
    if (!row) return undefined
    const measure = () => {
      const max = row.scrollWidth - row.clientWidth
      setEdge(previous => {
        const next = { left: row.scrollLeft > 1, right: row.scrollLeft < max - 1 }
        return next.left === previous.left && next.right === previous.right ? previous : next
      })
    }
    // At either end the page scrolls; sideways swipes and Shift+wheel stay native; Ctrl+wheel stays the browser's zoom.
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.shiftKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return
      const max = row.scrollWidth - row.clientWidth
      const dy = event.deltaY * (event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? row.clientWidth : 1)
      if (max <= 1 || (dy > 0 && row.scrollLeft >= max - 1) || (dy < 0 && row.scrollLeft <= 1)) return
      event.preventDefault()
      row.scrollLeft += dy
    }
    measure()
    row.addEventListener('scroll', measure, { passive: true })
    row.addEventListener('wheel', onWheel, { passive: false })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(row)
    return () => {
      row.removeEventListener('scroll', measure)
      row.removeEventListener('wheel', onWheel)
      observer?.disconnect()
    }
  }, [shown.length])

  // a game picked before the row drew (?category=, the hub's game link) brings its cover into view, once
  const brought = useRef(false)
  useEffect(() => {
    const row = ref.current
    if (brought.current || !picked || !row) return
    const card = [...row.querySelectorAll<HTMLElement>('[data-game]')].find(el => el.dataset.game === picked)
    if (!card) return
    brought.current = true
    if (card.offsetLeft + card.offsetWidth > row.clientWidth) row.scrollLeft = card.offsetLeft - 8
  }, [picked, shown.length])

  return <ul ref={ref} className={`moments-covers${edge.left ? ' more-l' : ''}${edge.right ? ' more-r' : ''}`} aria-label="Games, busiest first">
    <li>
      <button className="moments-cover moments-cover-all" type="button" aria-pressed={!picked} onClick={() => onPick(null)}
        aria-label={`All games: ${count(total)}. Shows every game’s moments.`}>
        <span className="moments-cover-art"><span>All games</span></span>
        <span className="moments-cover-name">Everything</span>
        <span className="moments-cover-count">{count(total)}</span>
      </button>
    </li>
    {shown.map(game => <li key={game.name}>
      <button className="moments-cover" type="button" data-game={game.name} aria-pressed={game.name === picked} onClick={() => onPick(game.name === picked ? null : game.name)}
        aria-label={`${game.name}: ${count(game.moments)}. ${game.name === picked ? 'Shows every game again.' : 'Shows its moments.'}`}>
        <Cover game={game} />
        <span className="moments-cover-name">{game.name}</span>
        <span className="moments-cover-count">{count(game.moments)}</span>
      </button>
    </li>)}
  </ul>
}
