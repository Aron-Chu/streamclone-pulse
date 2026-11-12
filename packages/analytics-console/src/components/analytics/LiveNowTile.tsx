/**
 * "Live now": Twitch's own live picture of the channel, on top of the Moments list while the page says this
 * stream is the channel's live one (candidate, 10-30, PIC-4). The page sets `liveNowLogin` only then
 * (SessionRecapMomentsStrip); never on a moment card or the bar strip, where a live picture would pass for the
 * moment's own frame.
 *
 * The picture is Twitch's previews-ttv thumbnail, which Twitch itself refreshes every few minutes, so the label
 * says it can be a few minutes old and shows no time of its own (we never learn when Twitch took it). The URL
 * carries a 5-minute bucket so a browser cache can't hold an older one, and the tile asks again every 5 minutes.
 * A failed load hides the tile until the next bucket. A tab kept in view never learns a stream ended (a tab return,
 * Refresh data or a reload re-reads it), and Twitch answers an offline channel's URL with its offline picture (no
 * error), so the tile also hides once the newest measured minute (`lastMinuteMs`, what the header's "Updated" names)
 * is over 10 minutes old, checked on the same 5-minute tick. The package can't import WEB's hubFormat.ts
 * (twitchLivePreviewUrlFresh, a 3-minute bucket), so the URL is built here.
 * Styles: WEB/src/ui/charts/sp-session-rows.css (`.ssr-live*`).
 */
import { useEffect, useState } from 'react'

/** How often the tile asks Twitch for a newer picture, and the URL's cache bucket. */
export const LIVE_NOW_REFRESH_MS = 5 * 60_000
export const LIVE_NOW_LABEL = "Twitch's picture, can be a few minutes old"
/** No measured minute for this long: the feed has stalled or the stream ended, so no "Live now". */
export const LIVE_NOW_STALE_MS = 10 * 60_000

const TWITCH_LOGIN = /^[a-z0-9_]{1,25}$/

/** Twitch's live picture for `login` at `width`x`height`, bucketed to 5 minutes; null for a login Twitch can't have. */
export function liveNowPreviewUrl(login: string, nowMs: number, width = 640, height = 360): string | null {
  const slug = typeof login === 'string' ? login.trim().toLowerCase() : ''
  if (!TWITCH_LOGIN.test(slug) || !Number.isFinite(nowMs)) return null
  const bucket = Math.floor(nowMs / LIVE_NOW_REFRESH_MS)
  return `https://static-cdn.jtvnw.net/previews-ttv/live_user_${slug}-${width}x${height}.jpg?t=${bucket}`
}

export function LiveNowTile({ login, lastMinuteMs, now = Date.now }: { login: string; lastMinuteMs: number | null; now?: () => number }) {
  const [nowMs, setNowMs] = useState(() => now())
  const [failed, setFailed] = useState<string | null>(null)

  useEffect(() => {
    const timer = setInterval(() => setNowMs(now()), LIVE_NOW_REFRESH_MS)
    return () => clearInterval(timer)
  }, [now])

  const src = liveNowPreviewUrl(login, nowMs)
  if (!src || failed === src) return null
  if (lastMinuteMs == null || !Number.isFinite(lastMinuteMs) || nowMs - lastMinuteMs > LIVE_NOW_STALE_MS) return null
  return (
    <figure className="ssr-live" data-live-now>
      <span className="ssr-live-pic" aria-hidden="true">
        <img
          src={src}
          alt=""
          width={640}
          height={360}
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(src)}
        />
      </span>
      <figcaption className="ssr-live-cap">
        <span className="ssr-live-dot" aria-hidden="true" />
        <b>Live now</b>
        <span aria-hidden="true"> · </span>
        <span className="ssr-vh">, </span>
        {LIVE_NOW_LABEL}
      </figcaption>
    </figure>
  )
}
