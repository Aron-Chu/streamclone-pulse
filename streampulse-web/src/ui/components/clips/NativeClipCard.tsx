import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { clipHeadline, clipPagePath, type NativeClip } from '../../../lib/nativeClips'
import { ChannelAvatar, ClipThumb, SaveClipButton, formatAgo, viewsLabel } from './NativeClipParts'

/** What a clip's page is told about where it was opened from. */
export interface ClipLinkState { from?: string; clip?: NativeClip }

/**
 * One clip as a link to its page: the picture with its game's box art, then
 * the channel's picture beside StreamPulse's two-line headline, Twitch's own
 * title on one line, the channel, and one number with the clip's age. `row`
 * is the narrower Up next layout, without Twitch's title.
 */
export function ClipCard({ clip, from, variant = 'grid', navIndex, onStatus, number }: {
  clip: NativeClip
  /** The list it was opened from, so Up next carries on through it. */
  from?: string
  variant?: 'grid' | 'row'
  /** Grid cards move with the arrow keys: only the active one is in the tab order. */
  navIndex?: number
  onStatus?: (message: string) => void
  /** The card's one number; Twitch views when nothing better is known. */
  number?: ReactNode
}) {
  const state: ClipLinkState = { from, clip }
  const row = variant === 'row'
  const headline = clipHeadline(clip)
  return (
    <article className="nc-card" data-variant={variant} role="listitem">
      <Link className="nc-card-hit" to={clipPagePath(clip.id)} state={state} data-nav={navIndex == null ? undefined : ''} tabIndex={navIndex == null ? undefined : navIndex === 0 ? 0 : -1}>
        <ClipThumb clip={clip} art={row ? 's' : 'm'} />
        {row ? null : <ChannelAvatar channel={clip.channel} size={36} />}
        <span className="nc-card-text">
          <span className="nc-card-title">{headline}</span>
          {row || headline === clip.title ? null : <span className="nc-card-twitch">{clip.title}</span>}
          <span className="nc-card-channel">{clip.channel.displayName}</span>
          <span className="nc-card-meta">
            {number ?? viewsLabel(clip)}
            <span aria-hidden="true"> · </span>
            {formatAgo(clip.createdAt)}
            {clip.game ? <span className="sr-only">, {clip.game.name}</span> : null}
          </span>
        </span>
      </Link>
      {row ? null : <div className="nc-card-save"><SaveClipButton clip={clip} compact onStatus={onStatus} /></div>}
    </article>
  )
}
