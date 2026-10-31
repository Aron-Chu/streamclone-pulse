/**
 * Featured stream (picks I1 and I1b, 10-30): the hub's featured stream, under
 * Busiest now, with its 3 top moments. The backend picks it as the live row
 * with the highest chat/min (hub_featured_session.go pickHubFeaturedChannel),
 * and that rate is the row's own average over the reply's lookback (minutes
 * with data only; hub_overview.go summarizeChannelWindow), not the 5-minute
 * chat check. So the card names that rate only while Busiest now ranks by the
 * same recent average (hubChatBasis 'avg_35': a 30m or 24h answer with the
 * check down) and lists this stream, so the two give it one rate; otherwise it
 * shows the stream without a number (I1b; reviews 10-30). Its name and game
 * come from the answer's live row for the same login when there is one,
 * exactly as Busiest now shows them (no game there means none here), whatever
 * the stream ids (pick 15B, 10-30): the backend takes them from the stored
 * stream record, which can name another game (a guest streaming together, or a
 * game switch not yet synced). Its moments and link stay the record's. Shown
 * only when the featured stream is ready; while Busiest now holds its place on
 * a load, a grey block holds the card's (pick K1, 10-30); otherwise nothing.
 */
import { Link } from 'react-router-dom'
import type { HubFeaturedSession, HubLiveChannel } from '../../../../lib/publicHub'
import { HubV5Avatar } from './HubV5Avatar'
import { channelHref, formatHubInt, formatHubRate } from './hubV5Model'

const H_ID = 'hv5-most-h'

/** The top moments the card names, in the reply's order (score first; extension_api.go buildReactionPeakCandidates). */
export const MOST_CHAT_MOMENTS = 3

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/** "0:13:54": a moment's offset into the stream, always h:mm:ss (pick I1, 10-30). */
export function mostChatOffset(seconds: number): string {
  const total = Math.max(0, Math.floor(finite(seconds) ? seconds : 0))
  const two = (n: number) => String(n).padStart(2, '0')
  return `${Math.floor(total / 3600)}:${two(Math.floor((total % 3600) / 60))}:${two(total % 60)}`
}

export interface MostChatMoment {
  key: string
  /** "0:13:54" */
  at: string
  /** The moment's top emote and its count, when the reply names one. */
  emote: string | null
  count: number | null
}

export interface MostChatModel {
  login: string
  name: string
  /** "Just Chatting · 10,682 watching", the parts the reply has. */
  meta: string
  /** The recent average, else null. */
  chat: number | null
  href: string
  moments: MostChatMoment[]
}

/**
 * The card, or null: the featured stream must be ready with a login (pick I1,
 * 10-30). Wrong-typed text reads as absent. `live`: the answer's live row for
 * the same login; its name and game are used as Busiest now uses them (reviews
 * and pick 15B, 10-30).
 */
export function mostChatModel(
  featured: HubFeaturedSession | null | undefined,
  live?: Pick<HubLiveChannel, 'displayName' | 'category'> | null,
): MostChatModel | null {
  if (!featured || featured.state !== 'ready') return null
  const login = text(featured.login).toLowerCase()
  if (!login) return null
  const streamId = text(featured.streamId) || undefined
  const row = live ?? null
  const category = row ? text(row.category) : text(featured.category)
  const viewers = finite(featured.viewers) && featured.viewers > 0 ? featured.viewers : null
  const moments = (Array.isArray(featured.topMoments) ? featured.topMoments : [])
    .filter((m) => m && finite(m.offsetSeconds))
    .slice(0, MOST_CHAT_MOMENTS)
    .map((m, i) => {
      const top = Array.isArray(m.topEmotes) ? m.topEmotes[0] : undefined
      const named = text(top?.name)
      const count = top?.count
      return {
        key: `${i}:${m.offsetSeconds}`,
        at: mostChatOffset(m.offsetSeconds),
        // a bare topEmoteCode names the emote without a count
        emote: named || text(m.topEmoteCode) || null,
        count: named && finite(count) ? count : null,
      }
    })
  return {
    login,
    name: (row ? text(row.displayName) : text(featured.displayName)) || login,
    meta: [category, viewers != null ? `${formatHubInt(viewers)} watching` : ''].filter(Boolean).join(' · '),
    chat: finite(featured.chatPerMin) && featured.chatPerMin > 0 ? featured.chatPerMin : null,
    href: channelHref({ login, streamId }),
    moments,
  }
}

/**
 * `featured`: the hub answer's featured stream, or null (a saved copy or totals only, where Busiest now shows no rows).
 * `showRate`: name its chat/min; true only while Busiest now ranks by the same recent average and lists the stream.
 * `live`: the answer's live row for the same login, if any; its name and game are used.
 * `avatars`: login → profile picture, from the answer's live rows (the featured stream carries none).
 * `waiting`: Busiest now is holding its place for an answer; with no card yet, a grey block of the card's size
 * (without the chat/min line) holds this one, so nothing below moves when a card lands (pick K1, 10-30).
 */
export function HubV5MostChat({ featured, showRate, live, avatars, waiting = false }: {
  featured: HubFeaturedSession | null
  showRate: boolean
  live?: HubLiveChannel | null
  avatars?: ReadonlyMap<string, string>
  waiting?: boolean
}) {
  const model = mostChatModel(featured, live)
  if (!model) {
    // the card's own rows, hidden, so the block takes exactly a one-line card's height
    return waiting ? (
      <section className="hv5-sec hv5-most hv5-mst-wait" aria-hidden="true">
        <p className="hv5-mst-lb">Featured stream</p>
        <div className="hv5-mst-rw">
          <HubV5Avatar login="" name="" size={28} />
          <span className="hv5-mst-tx"><span className="hv5-mst-l1">{'\u00a0'}</span></span>
        </div>
        <p className="hv5-mst-note">{'\u00a0'}</p>
      </section>
    ) : null
  }
  return (
    <section className="hv5-sec hv5-most" aria-labelledby={H_ID} data-login={model.login}>
      <h2 id={H_ID} className="hv5-mst-lb">Featured stream</h2>
      <div className="hv5-mst-rw">
        <HubV5Avatar login={model.login} name={model.name} src={avatars?.get(model.login)} size={28} />
        <span className="hv5-mst-tx">
          <span className="hv5-mst-l1">
            <span className="hv5-mst-nm">{model.name}</span>
            {model.meta ? <span className="hv5-mst-m"> · {model.meta}</span> : null}
          </span>
          {showRate && model.chat != null ? (
            <span className="hv5-mst-l2">
              <b className="hv5-mst-x">{formatHubRate(model.chat)}</b> <span className="hv5-mst-m">chat/min · recent average</span>
            </span>
          ) : null}
        </span>
        <Link className="hv5-mst-open" to={model.href} aria-label={`Open stream: ${model.name}`}>Open stream →</Link>
      </div>
      {model.moments.length ? (
        <p className="hv5-mst-note">
          <span className="hv5-vh">Top moments: </span>
          {model.moments.map((m, i) => (
            <span key={m.key}>
              {i ? ' · ' : null}
              <span className="hv5-mst-mo">
                {m.at}
                {m.emote ? ` ${m.emote}` : ''}
                {m.count != null ? ` ${formatHubInt(m.count)}` : ''}
              </span>
            </span>
          ))}
        </p>
      ) : null}
    </section>
  )
}
