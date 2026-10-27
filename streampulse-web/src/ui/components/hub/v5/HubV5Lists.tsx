/**
 * The d3-v5 hub's two short lists beside Moments (round 5, mockup hub-r4.js):
 * Top emotes (R5-5: picture, name over a share bar against #1, the share) and
 * Where chat is (R5-6: the top 10 games by share of chat; a click lists that
 * game's channels in Channels below). Drawing an emote on the chart (E4) needs
 * the shared chart's overlay panel and is not part of this page yet, so the
 * emote rows are not buttons.
 */
import { sanitizeEmoteImageUrl } from '../../../../lib/emoteAssetUrl'
import type { HubEmote } from '../../../../lib/publicHub'
import { HubToggletip } from '../d3/HubToggletip'
import { gameAria, topEmoteRows, topEmotesTip, topEmotesWindowLabel, whereChatIsTip, type HubWhereChatIs } from './hubV5Model'

/** Only an allowlisted https emote URL reaches <img src>; any other gets the empty tile, as a missing one does. */
function TopEmoteImage({ url }: { url?: string }) {
  const src = sanitizeEmoteImageUrl(url)
  return src
    ? <img src={src} alt="" width={28} height={28} decoding="async" loading="lazy" />
    : <span className="hv5-te5-x" aria-hidden="true" />
}

export function HubV5TopEmotes({ topEmotes, windowMinutes, uniqueEmotes }: { topEmotes: readonly HubEmote[]; windowMinutes?: number; uniqueEmotes?: number }) {
  const rows = topEmoteRows(topEmotes)
  return (
    <section id="emotes" className="hv5-sec hv5-emotes" aria-labelledby="hv5-te-h">
      <div className="hv5-rh">
        <h2 id="hv5-te-h">Top emotes</h2>
        <span className="hv5-meta">share of uses · {topEmotesWindowLabel(windowMinutes)}</span>
        <HubToggletip tip={topEmotesTip(rows, uniqueEmotes, windowMinutes)} label="About Top emotes" />
      </div>
      {rows.length ? (
        <ol className="hv5-te5-list" aria-labelledby="hv5-te-h">
          {rows.map((row) => (
            <li key={row.emote.id ?? `${row.emote.provider ?? ''}|${row.emote.name}`}>
              <div className="hv5-te5">
                <span className="hv5-te5-im"><TopEmoteImage url={row.emote.imageUrl} /></span>
                <span className="hv5-te5-tx">
                  <span className="hv5-te5-nm">{row.emote.name}</span>
                  <span className="hv5-te5-bar" aria-hidden="true"><i style={{ width: `${row.width.toFixed(1)}%` }} /></span>
                </span>
                <span className="hv5-te5-sh">{row.share}</span>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="hv5-none">No named emote uses in the recent window.</p>
      )}
    </section>
  )
}

export function HubV5WhereChatIs({ games, game, onGame }: { games: HubWhereChatIs; game: string | null; onGame: (game: string | null) => void }) {
  const max = games.top[0]?.chatShare || 1
  return (
    <section id="games" className="hv5-sec hv5-games" aria-labelledby="hv5-gm-h">
      <div className="hv5-rh">
        <h2 id="hv5-gm-h">Where chat is</h2>
        <span className="hv5-meta">share of chat in the top 500 live channels · last 5 min</span>
        <HubToggletip tip={whereChatIsTip(games)} label="About Where chat is" />
      </div>
      {games.top.length ? (
        <ol className="hv5-gm5-list" aria-labelledby="hv5-gm-h">
          {games.top.map((g) => {
            const pressed = game === g.name
            return (
              <li key={g.name}>
                <button
                  type="button"
                  className="hv5-gm5"
                  data-game={g.name}
                  aria-pressed={pressed}
                  aria-label={gameAria(g, pressed)}
                  onClick={() => onGame(pressed ? null : g.name)}
                >
                  <span className="hv5-gm5-art" />
                  <span className="hv5-gm5-tx">
                    <span className="hv5-gm5-nm">{g.name}</span>
                    <span className="hv5-gm5-bar" aria-hidden="true"><i style={{ width: `${Math.max(2, (g.chatShare / max) * 100).toFixed(1)}%` }} /></span>
                  </span>
                  <span className="hv5-gm5-v">{g.chatShare.toFixed(1)}%</span>
                </button>
              </li>
            )
          })}
        </ol>
      ) : (
        <p className="hv5-none">No channel has a full 5-minute window right now.</p>
      )}
    </section>
  )
}
