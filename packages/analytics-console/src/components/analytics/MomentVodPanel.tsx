/**
 * The VOD panel of the bar strip and the moment player (mockup `.mpl`): the
 * preview tile, Play, and the "On the VOD's clock" caption.
 *
 * Nothing loads from Twitch until the viewer presses Play. Play swaps Twitch's
 * player into the box at `playAt` (seconds on the VOD's clock) with
 * `parent=location.hostname` (MomentVodPreview.tsx:52) and moves focus to it.
 * Without a hostname (file://) Play opens the VOD in a new tab instead. A new
 * VOD or Play time puts the picture back.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { formatStripClock } from '../../utils/sessionBarStrip.ts'
import { buildTwitchVodUrl, formatTwitchVodTimeParam } from '../../utils/twitchVodUrl.ts'
import { MomentPreviewTile, type MomentPreviewTileProps } from './MomentPreviewTile.tsx'

const VOD_ID = /^\d{6,20}$/

/** Unpadded stream-clock time, the mockup's h:mm:ss ("0:50:39"). */
export const formatClock = formatStripClock

/** Twitch's embedded player at a VOD time; parent must be the page's own host. */
export function twitchPlayerSrc(vodId: string, playAt: number, parentHost: string): string {
  return `https://player.twitch.tv/?video=v${vodId}&time=${formatTwitchVodTimeParam(playAt)}`
    + `&parent=${encodeURIComponent(parentHost)}&autoplay=true`
}

/** The caption's tooltip: how the VOD's clock relates to the stream's (moment-rows.js vodNote). */
export function vodClockNote(alignSeconds: number, leadSeconds: number): string {
  const al = Math.round(alignSeconds)
  const shift = al < 0 ? `− ${-al}` : `+ ${al}`
  const why = al < 0
    ? ` (the VOD starts ${-al} s after the stream went live)`
    : al > 0 ? ` (the VOD starts ${al} s before the stream clock's 0:00:00)` : ''
  return `VOD time = stream time ${shift} s${why}, then ${leadSeconds} s earlier so the moment plays in`
}

export interface MomentVodPanelProps extends Omit<MomentPreviewTileProps, 'player' | 'onPlay' | 'playLabel'> {
  vodId: string | null
  /** VOD second Play starts at; null = no Play (`message` says why). */
  playAt: number | null
  /** e.g. "Play VOD from" (a moment, with lead-in) or "Play from" (a bar). */
  playVerb: string
  /** The lead-in caption under the box, for a moment: "On the VOD's clock · 10 s before the moment". */
  leadCaption?: { leadSeconds: number; alignSeconds: number } | null
  /** Test hook: the page's hostname. */
  hostname?: () => string
}

export function MomentVodPanel({
  vodId,
  playAt,
  playVerb,
  leadCaption,
  hostname = () => (typeof window === 'undefined' ? '' : window.location.hostname),
  ...tile
}: MomentVodPanelProps) {
  const validVod = vodId && VOD_ID.test(vodId) ? vodId : null
  const playable = validVod != null && playAt != null && Number.isFinite(playAt) && playAt >= 0
  const at = playable ? Math.max(0, Math.floor(playAt)) : null
  const key = validVod && at != null ? `${validVod}:${at}` : null
  const [playingKey, setPlayingKey] = useState<string | null>(null)
  const playing = key != null && playingKey === key
  const boxRef = useRef<HTMLDivElement>(null)
  const focusOnPlay = useRef(false)

  // A different VOD or time puts the picture back (the player never carries over).
  useEffect(() => {
    setPlayingKey((current) => (current === key ? current : null))
  }, [key])

  useLayoutEffect(() => {
    if (!playing || !focusOnPlay.current) return
    focusOnPlay.current = false
    boxRef.current?.focus({ preventScroll: true })
  }, [playing])

  const onPlay = () => {
    if (!validVod || at == null || !key) return
    const host = hostname()
    if (!host) {
      // file:// has no host for Twitch's parent check
      window.open(buildTwitchVodUrl(validVod, at), '_blank', 'noopener')
      return
    }
    focusOnPlay.current = true
    setPlayingKey(key)
  }

  const player = playing && validVod && at != null ? (
    <iframe
      className="mpl-if"
      title={`Twitch VOD from ${formatClock(at)}`}
      src={twitchPlayerSrc(validVod, at, hostname())}
      allow="autoplay; fullscreen"
      allowFullScreen
      data-vod-player-mounted="true"
    />
  ) : undefined

  return (
    <div className="mpl" data-moment-vod-panel>
      <MomentPreviewTile
        ref={boxRef}
        {...tile}
        playLabel={playable && at != null ? `${playVerb} ${formatClock(at)}` : null}
        onPlay={playable ? onPlay : undefined}
        player={player}
      />
      {leadCaption && playable ? (
        <p className="mpl-cap">
          <span title={vodClockNote(leadCaption.alignSeconds, leadCaption.leadSeconds)}>
            On the VOD&apos;s clock<span aria-hidden="true"> · </span><span className="sr-only">, </span>
            {leadCaption.leadSeconds} s before the moment
          </span>
        </p>
      ) : null}
    </div>
  )
}
