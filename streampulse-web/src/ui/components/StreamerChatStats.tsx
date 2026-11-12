import { Link } from 'react-router-dom'
import { buildAnalyticsHref } from '../../lib/analyticsLinks'
import './streamer-chat-stats.css'

interface FeaturedStreamer {
  name: string
  login: string
  handleLabel?: string
}

/** Curated channels with measured history. Alphabetical, not a search-volume ranking. */
const STREAMERS: readonly FeaturedStreamer[] = [
  { name: 'AdinRoss', login: 'adinross' },
  { name: 'Asmongold', login: 'zackrawrr', handleLabel: 'zackrawrr' },
  { name: 'Auronplay', login: 'auronplay' },
  { name: 'Caedrel', login: 'caedrel' },
  { name: 'CaseOh', login: 'caseoh_' },
  { name: 'Cinna', login: 'cinna' },
  { name: 'HasanAbi', login: 'hasanabi' },
  { name: 'Ibai', login: 'ibai' },
  { name: 'IShowSpeed', login: 'ishowspeed' },
  { name: 'JasonTheWeen', login: 'jasontheween' },
  { name: 'Jynxzi', login: 'jynxzi' },
  { name: 'KaiCenat', login: 'kaicenat' },
  { name: 'Lacy', login: 'lacy' },
  { name: 'Marlon', login: 'marlon' },
  { name: 'ohnePixel', login: 'ohnepixel' },
  { name: 'Pokimane', login: 'pokimane' },
  { name: 'Rubius', login: 'rubius' },
  { name: 'StableRonaldo', login: 'stableronaldo' },
  { name: 'TheBurntPeanut', login: 'theburntpeanut' },
  { name: 'xQc', login: 'xqc' },
]

export function StreamerChatStats() {
  return (
    <section id="streamer-chat-stats" className="streamer-chat-stats" aria-labelledby="streamer-chat-stats-title">
      <div className="streamer-chat-stats__header">
        <div>
          <h2 id="streamer-chat-stats-title">Twitch chat stats by streamer</h2>
          <p className="streamer-chat-stats__intro">
            Find chat activity, top emotes and reaction moments in broadcasts we’ve tracked.
            Choose a streamer to explore their available Twitch history.
          </p>
        </div>
        <Link className="streamer-chat-stats__browse" to="/analytics">Browse the Hub <span aria-hidden="true">→</span></Link>
      </div>
      <ul className="streamer-chat-stats__list">
        {STREAMERS.map(({ name, login, handleLabel }) => (
          <li key={login}>
            <Link to={buildAnalyticsHref({ login })}>
              <span className="streamer-chat-stats__name">{name}{handleLabel ? <small>{handleLabel}</small> : null}</span>
              <span className="streamer-chat-stats__arrow" aria-hidden="true">→</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="streamer-chat-stats__note">Measured broadcasts only. Availability and coverage vary by stream. <Link to="/guides/find-twitch-moments#data-details">How the stats are measured</Link></p>
    </section>
  )
}
