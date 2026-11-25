/**
 * The VOD panel of the bar strip and the moment player (mockup `.mpl`): the
 * preview tile, Play, and the "On the VOD's clock" caption.
 *
 * Nothing loads from Twitch until the viewer presses Play. Play swaps Twitch's
 * player into the box at `playAt` (seconds on the VOD's clock) with
 * `parent=location.hostname` (MomentVodPreview.tsx:52) and moves focus to it.
 * Without a hostname (file://) Play opens the VOD in a new tab instead. A new
 * VOD or Play time puts the picture back.
 *
 * `preview` (11-21, Aron: "why cant we just load the preview instead of having
 * to click a button"): the selected-minute card on a desktop pointer loads
 * Twitch's player paused at `playAt` once the pick holds still for
 * VOD_PREVIEW_SETTLE_MS, so arrowing through bars loads nothing. Phones, data
 * saver and the moment rows keep Play.
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { formatStripClock } from '../../utils/sessionBarStrip.ts'
import { buildTwitchVodUrl, formatTwitchVodTimeParam } from '../../utils/twitchVodUrl.ts'
import { MomentPreviewTile, type MomentPreviewTileProps } from './MomentPreviewTile.tsx'

const VOD_ID = /^\d{6,20}$/

/** Unpadded stream-clock time, the mockup's h:mm:ss ("0:50:39"). */
export const formatClock = formatStripClock

/** Twitch's embedded player at a VOD time; parent must be the page's own host. `autoplay` false loads it paused. */
export function twitchPlayerSrc(vodId: string, playAt: number, parentHost: string, autoplay = true): string {
  return `https://player.twitch.tv/?video=v${vodId}&time=${formatTwitchVodTimeParam(playAt)}`
    + `&parent=${encodeURIComponent(parentHost)}&autoplay=${autoplay ? 'true' : 'false'}`
}

/** How long a pick holds still before the paused player loads. */
export const VOD_PREVIEW_SETTLE_MS = 300
/** A mouse or trackpad on a window 768 px or wider (the inverse of the strip's touch rule, sp-session-strip.css). */
const VOD_PREVIEW_QUERY = '(min-width: 768px) and (pointer: fine)'

/** The paused player may load: a desktop pointer, and no data saver (Save-Data, or prefers-reduced-data). */
export function vodAutoPreviewAllowed(win: Window | undefined = typeof window === 'undefined' ? undefined : window): boolean {
  if (!win || typeof win.matchMedia !== 'function') return false
  const connection = (win.navigator as Navigator & { connection?: { saveData?: boolean } } | undefined)?.connection
  if (connection?.saveData) return false
  if (win.matchMedia('(prefers-reduced-data: reduce)')?.matches) return false
  return Boolean(win.matchMedia(VOD_PREVIEW_QUERY)?.matches)
}

function subscribePreview(cb: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const mq = window.matchMedia(VOD_PREVIEW_QUERY)
  mq.addEventListener?.('change', cb)
  return () => mq.removeEventListener?.('change', cb)
}

/** Whether this window may load the paused player (follows the pointer and the window's width). */
export function useVodAutoPreview(): boolean {
  return useSyncExternalStore(subscribePreview, () => vodAutoPreviewAllowed(), () => false)
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
  /**
   * G1 (11-13): a new token starts the player as Play would (a moment card's Play). The same token on a new
   * VOD time plays again, so a lock that settles a moment later still lands on the moment's lead-in.
   */
  autoPlayToken?: number | null
  /** The VOD's Twitch link (the strip's): it sits with Play, so the two read as one pair (in the page, on Twitch). */
  link?: ReactNode
  /**
   * 11-21: load Twitch's player paused at `playAt` once the pick holds still (a 16:9 box holds its place until
   * then), in place of the picture and Play. Play from a moment (`autoPlayToken`) still starts it playing. Needs
   * the page's hostname; the caller decides when it may (useVodAutoPreview).
   */
  preview?: boolean
}

export function MomentVodPanel({
  vodId,
  playAt,
  playVerb,
  leadCaption,
  hostname = () => (typeof window === 'undefined' ? '' : window.location.hostname),
  autoPlayToken,
  link,
  preview = false,
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
  const host = hostname()
  const canPreview = preview && key != null && host !== ''
  const [previewKey, setPreviewKey] = useState<string | null>(null)
  const previewing = canPreview && !playing && previewKey === key
  const waiting = canPreview && !playing && previewKey !== key

  // A different VOD or time puts the picture back (the player never carries over).
  useEffect(() => {
    setPlayingKey((current) => (current === key ? current : null))
  }, [key])

  // The paused player loads once the pick has held still, so arrowing through bars loads nothing from Twitch.
  useEffect(() => {
    if (!canPreview || !key) return
    const id = window.setTimeout(() => setPreviewKey(key), VOD_PREVIEW_SETTLE_MS)
    return () => window.clearTimeout(id)
  }, [canPreview, key])

  useLayoutEffect(() => {
    if (!playing || !focusOnPlay.current) return
    focusOnPlay.current = false
    boxRef.current?.focus({ preventScroll: true })
  }, [playing])

  const onPlay = () => {
    if (!validVod || at == null || !key) return
    if (!host) {
      // file:// has no host for Twitch's parent check
      window.open(buildTwitchVodUrl(validVod, at), '_blank', 'noopener')
      return
    }
    focusOnPlay.current = true
    setPlayingKey(key)
  }

  // After the reset above, so a card's Play on a fresh lock still starts the player.
  const autoPlay = autoPlayToken != null && key ? `${autoPlayToken}:${key}` : null
  const autoPlayed = useRef<string | null>(null)
  useEffect(() => {
    if (!autoPlay || autoPlayed.current === autoPlay) return
    autoPlayed.current = autoPlay
    onPlay()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlay])

  // the same frame either way: Play on a paused preview reloads it with autoplay on, at the Play time
  const player = (playing || previewing) && validVod && at != null ? (
    <iframe
      className="mpl-if"
      title={`Twitch VOD from ${formatClock(at)}`}
      src={twitchPlayerSrc(validVod, at, host, playing)}
      allow="autoplay; fullscreen"
      allowFullScreen
      data-vod-player-mounted="true"
      data-vod-player={playing ? 'playing' : 'preview'}
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
        paused={previewing}
        waiting={waiting}
      />
      {link ? <div className="mpl-link">{link}</div> : null}
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
