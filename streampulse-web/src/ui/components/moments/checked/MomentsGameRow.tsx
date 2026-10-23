import { useEffect, useRef, useState } from 'react'
import type { MomentsGame } from '../../../../lib/momentsGames'

const ini = (name: string) => name.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase() || '?'
const n = (count: number) => `${count} ${count === 1 ? 'moment' : 'moments'}`

/** A game's cover; its initials when Twitch sends none or the picture fails. */
function Cover({ g }: { g: MomentsGame }) {
  const [failed, setFailed] = useState(false)
  return <span className="mk-gc-art">
    {g.art && !failed ? <img src={g.art} alt="" width={285} height={380} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <span>{ini(g.name)}</span>}
  </span>
}

/**
 * The games on top (M1, 2026-10-22): B2's covers in one row under the title, "All games" first, then the busiest. A cover
 * shows that game's moments in every list and pressed again shows them all. The row scrolls sideways with its scrollbar
 * hidden: an up/down wheel turns it, as the hub's game strip does, and an edge with more past it fades.
 */
export function MomentsGameRow({ games, total, picked, pickedLabel, loaded, onPick }: {
  games: MomentsGame[]; total: number; picked: string | null; pickedLabel: { name: string; art: string | null } | null; loaded: boolean
  onPick: (id: string | null) => void
}) {
  const ref = useRef<HTMLUListElement>(null)
  const [edge, setEdge] = useState({ l: false, r: false })
  // a game picked where the row has no card for it (a link to a game with nothing in the window) keeps one, so it shows
  const shown = picked && pickedLabel && !games.some(g => g.id === picked) ? [{ id: picked, ...pickedLabel, moments: 0, live: null }, ...games] : games

  useEffect(() => {
    const row = ref.current
    if (!row) return undefined
    const measure = () => {
      const max = row.scrollWidth - row.clientWidth
      setEdge(e => {
        const next = { l: row.scrollLeft > 1, r: row.scrollLeft < max - 1 }
        return next.l === e.l && next.r === e.r ? e : next
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

  // a game picked before the row drew (?game=, the hub's "Elden Ring moments →") brings its cover into view, once
  const brought = useRef(false)
  useEffect(() => {
    const row = ref.current
    if (brought.current || !picked || !row) return
    const card = [...row.querySelectorAll<HTMLElement>('[data-game]')].find(el => el.dataset.game === picked)
    if (!card) return
    brought.current = true
    if (card.offsetLeft + card.offsetWidth > row.clientWidth) row.scrollLeft = card.offsetLeft - 8
  }, [picked, shown.length])

  return <ul ref={ref} className={`mk-covers${edge.l ? ' more-l' : ''}${edge.r ? ' more-r' : ''}`} aria-label="Games, busiest first">
    <li>
      <button className="mk-gc mk-gc-all" type="button" aria-pressed={!picked} onClick={() => onPick(null)}
        aria-label={`All games: ${loaded ? n(total) : 'loading'}. Shows every game’s moments.`}>
        <span className="mk-gc-art"><span>All games</span></span>
        <span className="mk-gc-nm">Everything</span>
        <span className="mk-gc-ct">{loaded ? n(total) : '…'}</span>
      </button>
    </li>
    {!loaded ? Array.from({ length: 8 }, (_, i) => <li key={i} aria-hidden="true"><span className="mk-gc-wait" /></li>) : null}
    {shown.map(g => <li key={g.id}>
      <button className="mk-gc" type="button" data-game={g.id} aria-pressed={g.id === picked} onClick={() => onPick(g.id === picked ? null : g.id)}
        aria-label={`${g.name}: ${n(g.moments)}${g.live ? `, ${g.live} ${g.live === 1 ? 'channel' : 'channels'} live now` : ''}. ${g.id === picked ? 'Shows every game again.' : 'Shows its moments.'}`}>
        <Cover g={g} />
        <span className="mk-gc-nm">{g.name}</span>
        <span className="mk-gc-ct">{n(g.moments)}</span>
        {g.live ? <span className="mk-gc-live"><i aria-hidden="true" />{g.live} live</span> : null}
      </button>
    </li>)}
  </ul>
}
