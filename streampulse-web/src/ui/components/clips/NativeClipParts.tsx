import { useState, type CSSProperties, type ReactNode } from 'react'
import { Bookmark, BookmarkCheck, Clock } from 'lucide-react'
import { isNewClip, type NativeClip, type NativeClipChannel, type NativeClipGame } from '../../../lib/nativeClips'
import { toggleSavedClip, useSavedClips } from '../../../lib/savedNativeClips'
import { twitchProfileImageRendition } from '../../../lib/twitchProfileImage'

const DAY_MS = 86_400_000

export function formatCount(n: number) {
  if (n < 1000) return String(n)
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`
  if (n < 1_000_000) return `${Math.round(n / 1000)}K`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

export function formatAgo(ts: number, now = Date.now()) {
  const s = Math.max(0, (now - ts) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`
  if (s < 172_800) return 'yesterday'
  return `${Math.floor(s / 86_400)} days ago`
}

export function formatClock(sec: number) {
  const total = Math.max(0, Math.round(sec))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

const dateFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
export const formatDate = (ts: number) => dateFormat.format(ts)

/** Twitch's view count was last read over a day ago. */
export const viewsStale = (clip: NativeClip, now = Date.now()) => !!clip.views && now - clip.views.checkedAt > DAY_MS

function hash(text: string) {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}

/** A quiet frame tinted by channel, behind a missing or broken preview. Nothing is fetched for it. */
function frameStyle(clip: NativeClip): CSSProperties {
  const h = hash(clip.id)
  const c = hash(clip.channel.login) % 360
  return {
    background: [
      `radial-gradient(70% 90% at ${20 + (h % 60)}% ${25 + ((h >> 8) % 50)}%, hsl(${c} 55% 45% / .4), transparent 62%)`,
      `linear-gradient(${150 + (h % 60)}deg, hsl(${c} 30% 13%), hsl(${c} 35% 7%))`,
    ].join(', '),
  }
}

export function ChannelAvatar({ channel, size = 20 }: { channel: NativeClipChannel; size?: number }) {
  const src = twitchProfileImageRendition(channel.profileImageUrl, 70)
  const [failed, setFailed] = useState<string | null>(null)
  if (src && failed !== src) {
    return <img className="nc-avatar" src={src} alt="" width={size} height={size} loading="lazy" decoding="async" onError={() => setFailed(src)} />
  }
  return (
    <span className="nc-avatar" aria-hidden="true" style={{ width: size, height: size, fontSize: size * 0.48, background: `hsl(${hash(channel.login) % 360} 40% 32%)` }}>
      {channel.displayName.slice(0, 1).toUpperCase()}
    </span>
  )
}

/**
 * A game's box art from Twitch, or its first two letters when there is none
 * or it won't load (as Moments draws categories). Decoration: the game's name
 * is always written or read out beside it.
 */
export function GameArt({ game, size = 'm', corner = false }: { game: Pick<NativeClipGame, 'name' | 'boxArtUrl'>; size?: 'xs' | 's' | 'm' | 'l'; corner?: boolean }) {
  const [failed, setFailed] = useState<string | null>(null)
  const src = game.boxArtUrl && failed !== game.boxArtUrl ? game.boxArtUrl : ''
  return (
    <span className="nc-art" data-size={size} data-corner={corner || undefined} aria-hidden="true" title={corner ? game.name : undefined}>
      {src ? <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(src)} /> : size === 'xs' ? null : game.name.slice(0, 2)}
    </span>
  )
}

/** Twitch's preview with the clip's length, its game's box art in the corner, and New for the last 6 hours. */
export function ClipThumb({ clip, art = 'm', badges = true }: { clip: NativeClip; art?: 's' | 'm' | null; badges?: boolean }) {
  const [failed, setFailed] = useState<string | null>(null)
  const image = clip.available && clip.thumbnailUrl && failed !== clip.thumbnailUrl ? clip.thumbnailUrl : ''
  return (
    <span className="nc-thumb" style={image ? undefined : frameStyle(clip)} data-unavailable={!clip.available || undefined}>
      {image ? <img src={image} alt="" loading="lazy" decoding="async" onError={() => setFailed(image)} /> : null}
      {!clip.available ? <span className="nc-thumb-gone">No longer on Twitch</span> : null}
      {art && clip.game ? <GameArt game={clip.game} size={art} corner /> : null}
      {badges && clip.available && isNewClip(clip) ? <span className="nc-thumb-badge nc-thumb-new">New</span> : null}
      {badges ? <span className="nc-thumb-badge nc-thumb-length">{formatClock(clip.durationSeconds)}</span> : null}
    </span>
  )
}

/** The card's one number: Twitch views, never shown as zero when unknown. */
export function viewsLabel(clip: NativeClip): string {
  return clip.views ? `${formatCount(clip.views.count)} ${clip.views.count === 1 ? 'view' : 'views'}` : 'Views not in yet'
}

/** Views with how fresh the number is. */
export function ViewsLine({ clip }: { clip: NativeClip }) {
  if (!clip.views) return <span className="nc-muted">Twitch hasn't reported views yet</span>
  const stale = viewsStale(clip)
  return (
    <span>
      <span className="nc-num">{clip.views.count.toLocaleString()}</span> views{' '}
      <span className={stale ? 'nc-stale' : 'nc-muted'}>
        {stale ? <Clock size={12} aria-hidden="true" /> : null} checked {formatAgo(clip.views.checkedAt)}
      </span>
    </span>
  )
}

export function SaveClipButton({ clip, compact = false, onStatus }: { clip: NativeClip; compact?: boolean; onStatus?: (message: string) => void }) {
  const saved = useSavedClips().items.some(item => item.id === clip.id)
  return (
    <button
      type="button"
      className="nc-btn"
      data-compact={compact || undefined}
      aria-pressed={saved}
      aria-label={compact ? (saved ? 'Saved. Remove from saved clips' : 'Save clip') : undefined}
      onClick={event => {
        event.stopPropagation()
        onStatus?.(toggleSavedClip(clip))
      }}
    >
      {saved ? <BookmarkCheck size={15} aria-hidden="true" /> : <Bookmark size={15} aria-hidden="true" />}
      {compact ? null : saved ? 'Saved' : 'Save'}
    </button>
  )
}

/** Chat pace against its usual pace for that stream, as a small heat meter. Heat colours mean intensity only. */
export function ReactionChip({ clip }: { clip: NativeClip }) {
  const lift = clip.reaction.chatLift
  if (!(lift > 0)) return null
  const level = Math.min(4, Math.max(1, Math.round(lift / 2.2)))
  return (
    <span className="nc-reaction" title="Chat pace against its usual pace for that stream">
      <span className="nc-heat-bars" aria-hidden="true">
        {[1, 2, 3, 4].map(i => <span key={i} data-on={i <= level || undefined} style={{ height: 3 + i * 2 }} />)}
      </span>
      <span className="nc-num">{lift.toFixed(1)}×</span>
      <span className="sr-only">chat pace</span>
    </span>
  )
}

/** A message in place of clips: off, failed, empty or nothing matching. */
export function Notice({ title, body, action, alert = false }: { title: string; body?: ReactNode; action?: ReactNode; alert?: boolean }) {
  return (
    <div className="nc-notice" role={alert ? 'alert' : 'status'}>
      <strong>{title}</strong>
      {body ? <p>{body}</p> : null}
      {action}
    </div>
  )
}
