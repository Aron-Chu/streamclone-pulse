import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink, Play } from 'lucide-react'
import { clipEmbedSrc, clipVodHref, type NativeClip } from '../../../lib/nativeClips'
import { ClipThumb, GameArt, ViewsLine, formatAgo, formatClock, formatDate, viewsLabel } from './NativeClipParts'

/**
 * Twitch's own clip player, mounted only after Play: opening a clip's page
 * requests no player from Twitch. Give it `key={clip.id}` so a new clip starts unloaded.
 */
export function ClipPlayer({ clip }: { clip: NativeClip }) {
  const [playing, setPlaying] = useState(false)
  if (!clip.available) {
    return (
      <div className="nc-player" data-unavailable>
        <ClipThumb clip={clip} art={null} badges={false} />
        <div className="nc-player-gone">
          <strong>This clip is no longer on Twitch.</strong>
          <span>It may have been deleted on Twitch. StreamPulse never stores the video, so it can't play here.</span>
        </div>
      </div>
    )
  }
  return (
    <div className="nc-player-wrap">
      <div className="nc-player">
        {playing ? (
          <iframe title={`Twitch clip: ${clip.title}`} src={clipEmbedSrc(clip.id, window.location.hostname)} allow="autoplay; fullscreen" allowFullScreen />
        ) : (
          <button type="button" className="nc-player-start" aria-label="Play clip" onClick={() => setPlaying(true)}>
            <ClipThumb clip={clip} art={null} badges={false} />
            <span className="nc-player-icon"><Play size={26} aria-hidden="true" /></span>
          </button>
        )}
      </div>
      <p className="nc-player-note">Plays in Twitch's player. The video loads from Twitch when you press Play.</p>
    </div>
  )
}

/** The page address for a game's clips in the library. */
export const gameClipsPath = (gameId: string) => `/analytics/moments?view=clips&game=${encodeURIComponent(gameId)}&period=30d`

/**
 * The description box under the player: the numbers first, then why chat
 * made StreamPulse clip it, where it sits in the stream, and its game.
 */
export function ClipDescription({ clip, worthShare = null }: { clip: NativeClip; worthShare?: string | null }) {
  const r = clip.reaction
  const vodHref = clipVodHref(clip)
  return (
    <section className="nc-desc" aria-labelledby="nc-desc-title">
      <h2 id="nc-desc-title" className="sr-only">About this clip</h2>
      <p className="nc-desc-stats">
        <span>{viewsLabel(clip)}</span>
        <span aria-hidden="true"> · </span>
        <span>{formatAgo(clip.createdAt)}</span>
        <span aria-hidden="true"> · </span>
        <span className="nc-num">{formatClock(clip.durationSeconds)}</span>
        <span className="sr-only"> long</span>
        {worthShare ? <><span aria-hidden="true"> · </span><span className="nc-worth">{worthShare}</span></> : null}
      </p>

      <h3 className="nc-section-title">Why it was clipped</h3>
      <ul className="nc-facts">
        <li>
          Chat ran <span className="nc-heat-text nc-num">{r.chatLift.toFixed(1)}×</span> its usual pace for this stream
        </li>
        {r.emoteLift >= 1.1 ? <li>Emotes ran <span className="nc-num">{r.emoteLift.toFixed(1)}×</span> their usual pace</li> : null}
        <li>
          At least <span className="nc-num">{r.chatters.toLocaleString()}</span> people chatting, and no one sent more than{' '}
          <span className="nc-num">{Math.max(1, Math.round(r.largestShare * 100))}%</span> of the messages
        </li>
      </ul>
      <p className="nc-hint">This measures how chat reacted. It doesn't say whether the clip is good to watch.</p>

      <dl className="nc-dl">
        <div>
          <dt>Views</dt>
          <dd><ViewsLine clip={clip} /></dd>
        </div>
        <div>
          <dt>Made</dt>
          <dd>{formatDate(clip.createdAt)}, by StreamPulse's clip account</dd>
        </div>
        <div>
          <dt>In the stream</dt>
          <dd>
            {clip.vod?.offsetSeconds != null ? <span className="nc-num">{formatClock(clip.vod.offsetSeconds)}</span>
              : clip.vod ? 'Twitch hasn’t placed it in the VOD yet'
                : 'Not linked to a VOD'}
            {clip.available && vodHref ? (
              <>
                {' '}
                <a className="nc-link" href={vodHref} target="_blank" rel="noopener noreferrer">
                  Watch in the VOD<ExternalLink size={12} aria-hidden="true" />
                </a>
              </>
            ) : null}
          </dd>
        </div>
      </dl>

      {clip.game ? (
        <div className="nc-gamebox">
          <GameArt game={clip.game} size="l" />
          <div className="nc-gamebox-text">
            <span className="nc-strong">{clip.game.name}</span>
            <Link className="nc-link" to={gameClipsPath(clip.game.id)}>See clips from this game</Link>
          </div>
        </div>
      ) : null}
    </section>
  )
}
