import { useState } from 'react'
import { MOMENTS_WINDOW_MS } from '../../../../lib/momentsFeed'
import type { MomentsGame } from '../../../../lib/momentsGames'

const HOURS = MOMENTS_WINDOW_MS / 3_600_000
const ini = (name: string) => name.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase() || '?'

/** A game's cover; its initials when Twitch sends none or the picture fails. */
function Cover({ g }: { g: MomentsGame }) {
  const [failed, setFailed] = useState(false)
  return <span className="mk-gc-art">
    {g.art && !failed ? <img src={g.art} alt="" width={285} height={380} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <span>{ini(g.name)}</span>}
  </span>
}

/**
 * The Games tab (B2, 2026-10-22): Twitch's Browse → Categories grid, busiest
 * first. A card shows that game's moments under Latest; the bar's search finds a
 * game here.
 */
export function MomentsGamesGrid({ games, q, picked, loaded, onPick }: {
  games: MomentsGame[]; q: string; picked: string | null; loaded: boolean; onPick: (id: string) => void
}) {
  const qq = q.trim().toLowerCase()
  const shown = qq ? games.filter(g => g.name.toLowerCase().includes(qq)) : games
  const n = games.length
  return <section className="mk-games" aria-label="Games">
    <p className="mk-games-h">{!loaded ? 'Loading games…' : `${n} ${n === 1 ? 'game' : 'games'} with moments in the last ${HOURS} hours, busiest first`}</p>
    {shown.length ? <ul className="mk-games-g">
      {shown.map(g => <li key={g.id}>
        <button className="mk-gc" type="button" aria-pressed={g.id === picked} onClick={() => onPick(g.id)}
          aria-label={`${g.name}: ${g.moments} ${g.moments === 1 ? 'moment' : 'moments'}${g.live ? `, ${g.live} ${g.live === 1 ? 'channel' : 'channels'} live now` : ''}. Shows its moments.`}>
          <Cover g={g} />
          <span className="mk-gc-nm">{g.name}</span>
          <span className="mk-gc-ct">{g.moments} {g.moments === 1 ? 'moment' : 'moments'}</span>
          {g.live ? <span className="mk-gc-live"><i aria-hidden="true" />{g.live} live</span> : null}
        </button>
      </li>)}
    </ul> : loaded ? <p className="mk-empty">{qq ? 'No game matches.' : `No moments in the last ${HOURS} hours.`}</p> : null}
  </section>
}
