/**
 * Busiest now (R5-1, the round-5 Strip; mockup busiest-variants.js Strip +
 * Carousel): the 12 chattiest channels of the shared 5-minute window, about
 * 5.5 tiles in view, ‹ › in the header, edge fades, no auto-advance and one
 * roving tab stop (arrow keys, Home, End). An up/down wheel over the strip
 * moves it one tile per notch; at either end the page scrolls as usual.
 * Pictures (mockup §5, Aron 10-31): while the numbers are Live, each tile shows
 * Twitch's live picture over its face tile; otherwise the face tile.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { liveNowPreviewUrl } from '../../../../../../packages/analytics-console/src/components/analytics/LiveNowTile.tsx'
import { isTwitchOfflinePreview } from '../../../../../../packages/analytics-console/src/utils/twitchBoxArt.ts'
import type { HubLiveChannel } from '../../../../lib/publicHub'
import { twitchProfileImageRendition } from '../../../../lib/twitchProfileImage'
import { ResilientImage } from '../../ResilientImage'
import { HubToggletip } from '../d3/HubToggletip'
import { HubV5Icon } from './HubV5Icon'
import { HUB_BUSIEST_COUNT, HUB_CHAT_COUNTS_DOWN, busiestAria, busiestCue, busiestShowsPictures, busiestTip, hubAvatarTone, hubChatBasis, hubClock, hubMonogram, rankBusiest, screenerDown, type HubBusiestRow } from './hubV5Model'
import { useHubStrip } from './useHubStrip'

const H_ID = 'hv5-busy-h'
const TRACK_ID = 'hv5-busy-track'
/** A tile's face is 40 % of the tile's height (34–70 px from 390 to 2560 wide), so it asks for Twitch's 150 px rendition; the original is the fallback. */
const FACE_RENDITION = 150
/** The caption's small face is 16–20 px. */
const SMALL_FACE_RENDITION = 70

/** Twitch's live picture size: 440×248, or 640×360 at a pixel ratio of 2 or more (mockup build note, 10-15). */
const livePictureSize = (): readonly [number, number] =>
  typeof window !== 'undefined' && window.devicePixelRatio >= 2 ? [640, 360] : [440, 248]

/**
 * One tile. While `pictures` (live 5-minute numbers), Twitch's live picture covers the face tile once it has loaded
 * and proven not to be Twitch's offline picture (an offline channel's URL answers with that picture, not an error).
 * The URL moves to a new 5-minute bucket (`liveNowPreviewUrl`, as the stream page's Live now tile), and the last
 * proven picture stays up while the next one is checked under it, fully drawn, so the swap never shows the face.
 * A failed or offline picture drops back to the face tile until the next bucket, and a check that ends after its
 * bucket has passed changes nothing. Over a live picture the caption adds the small face, only from a real profile
 * image (one that failed is tried again when the profile image changes). Your follows uses it too: a row with no chat
 * rate Busiest now would count shows its viewers.
 */
export function BusiestTile({ row, total, tab, pictures, nowMs }: { row: HubBusiestRow; total: number; tab: boolean; pictures: boolean; nowMs: number }) {
  const [width, height] = livePictureSize()
  const src = pictures ? liveNowPreviewUrl(row.login, nowMs, width, height) : null
  const [shown, setShown] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [failedSmallFace, setFailedSmallFace] = useState<string | null>(null)
  const current = useRef(src)
  // a layout effect, so the new picture's load (a later task) never finds the old URL here and drops its check
  useLayoutEffect(() => { current.current = src }, [src])
  useEffect(() => {
    if (!src) setShown(null)
  }, [src])
  const settle = (pic: string, ok: boolean) => {
    if (current.current !== pic) return
    setShown(ok ? pic : null)
    if (!ok) setFailed(pic)
  }
  const visible = src != null ? shown : null
  const checking = src != null && src !== shown && src !== failed ? src : null
  const smallFace = visible != null && !!row.avatar && failedSmallFace !== row.avatar
  return (
    <Link className="hv5-bzt-t hv5-bzc-c" to={row.href} aria-label={busiestAria(row, total, !!visible)} tabIndex={tab ? 0 : -1}>
      <span className="hv5-bzv-face" style={{ background: `radial-gradient(120% 90% at 50% 40%, ${hubAvatarTone(row.login)} 0%, #101012 100%)` }}>
        <ResilientImage
          className="hv5-bzv-fa"
          src={twitchProfileImageRendition(row.avatar, FACE_RENDITION)}
          fallbackSrc={row.avatar}
          fallback={<span className="hv5-bzv-fa hv5-bzv-fam" aria-hidden="true">{hubMonogram(row.displayName, row.login)}</span>}
          alt=""
          decoding="async"
          referrerPolicy="no-referrer"
        />
      </span>
      {/* the next picture first, so it waits under the proven one; React 18 sets props in this order, so
          loading, crossOrigin and referrerPolicy come before src (set after it, they restart the request,
          and Firefox ignores a late loading="lazy") */}
      {[checking, visible].map((pic) => pic && (
        <img
          key={pic}
          className="hv5-bzv-prev"
          alt=""
          width={width}
          height={height}
          decoding="async"
          loading="lazy"
          crossOrigin="anonymous"
          referrerPolicy="no-referrer"
          src={pic}
          data-shown={pic === visible ? '' : undefined}
          data-under={pic !== visible && visible != null ? '' : undefined}
          onLoad={pic === visible ? undefined : (event) => {
            void isTwitchOfflinePreview(event.currentTarget)
              .then((offline) => settle(pic, !offline))
              .catch(() => settle(pic, true))
          }}
          onError={() => settle(pic, false)}
        />
      ))}
      <span className="hv5-bzt-fig"><b>{row.fig}</b> {row.viewersOnly ? (row.viewers === 1 ? 'viewer' : 'viewers') : 'chat/min'}</span>
      <span className={`hv5-bzt-cap${smallFace ? ' hf' : ''}`}>
        {smallFace ? (
          <ResilientImage
            className="hv5-bzv-av"
            src={twitchProfileImageRendition(row.avatar, SMALL_FACE_RENDITION)}
            fallbackSrc={row.avatar}
            fallback={null}
            onError={() => setFailedSmallFace(row.avatar)}
            alt=""
            width={20}
            height={20}
            decoding="async"
            referrerPolicy="no-referrer"
          />
        ) : null}
        <span className="hv5-bzt-nm">{row.displayName}</span>
        <span className="hv5-bzt-cat">{row.category || 'No category'}</span>
      </span>
    </Link>
  )
}

/**
 * `unavailable`: the hub request failed, so an empty list says so rather than that no channel qualifies (INT-02).
 * `windowKey`: the window of the hub answer on screen (the old one while a new range loads); on 30m and 24h a screener outage ranks by the recent average (up to 35 min) (candidate, 10-30).
 */
export function HubV5Busiest({ live, nowMs, loading = false, unavailable = false, windowKey }: { live: readonly HubLiveChannel[]; nowMs: number; loading?: boolean; unavailable?: boolean; windowKey?: string }) {
  const set = useMemo(() => rankBusiest(live, HUB_BUSIEST_COUNT, hubChatBasis(live, windowKey)), [live, windowKey])
  // the recent average is never "Live" (candidate, 10-30)
  const avg = set.basis === 'avg_35'
  const cue = busiestCue(set, nowMs)
  const pictures = busiestShowsPictures(set, cue)
  const rows = set.rows
  const N = rows.length
  const { trackRef, pos, prevOff, nextOff, more, rove, page, onTrackKeyDown } = useHubStrip(N, rows.map((row) => row.login).join(' '))

  const hasWindow = Number.isFinite(set.windowEnd)

  return (
    <section id="busiest" className="hv5-sec hv5-busiest" aria-labelledby={H_ID} data-cue={hasWindow ? cue : avg ? 'stale' : undefined}>
      <div className="hv5-bzv-in">
        <header className="hv5-bzv-rh">
          <h2 id={H_ID}>Busiest now</h2>
          {hasWindow || avg ? <HubToggletip tip={<span className="hv5-pre">{busiestTip(set, cue)}</span>} label="About Busiest now" /> : null}
          {avg ? (
            <span className="hv5-bzv-cue" data-cue="stale">
              <i aria-hidden="true" />
              5-min counts unavailable
            </span>
          ) : hasWindow ? (
            <span className="hv5-bzv-cue" data-cue={cue}>
              <i aria-hidden="true" />
              {cue === 'live' ? 'Live' : `Not updated since ${hubClock(set.windowEnd)}`}
            </span>
          ) : null}
          <p className="hv5-bzv-meta">{avg ? 'Chat messages per minute · recent average' : 'Chat messages per minute · last 5 min'}</p>
          {N ? (
            <div className="hv5-bzc-pg">
              <span className="hv5-bzc-pos" aria-live="polite">{pos}</span>
              <button className="hv5-ib" type="button" aria-label="Previous channels" aria-controls={TRACK_ID} aria-disabled={prevOff} onClick={() => page(-1)}>
                <HubV5Icon name="left" />
              </button>
              <button className="hv5-ib" type="button" aria-label="Next channels" aria-controls={TRACK_ID} aria-disabled={nextOff} onClick={() => page(1)}>
                <HubV5Icon name="right" />
              </button>
            </div>
          ) : loading ? (
            // the pager's room while the tiles load: on a phone it takes its own row
            <div className="hv5-bzc-pg hv5-bzc-pg-wait" aria-hidden="true">
              <span className="hv5-bzc-pos" />
              <span className="hv5-ib" />
              <span className="hv5-ib" />
            </div>
          ) : null}
        </header>
        {N ? (
          <div className={`hv5-bzc-vp hv5-bzs-vp${more.l ? ' more-l' : ''}${more.r ? ' more-r' : ''}`}>
            <ol ref={trackRef} id={TRACK_ID} className="hv5-bzc-track" aria-labelledby={H_ID} onKeyDown={onTrackKeyDown}>
              {rows.map((row, i) => (
                <li key={row.login} className="hv5-bzc-it" data-rank={row.rank} data-login={row.login}>
                  <BusiestTile row={row} total={N} tab={i === rove} pictures={pictures} nowMs={nowMs} />
                </li>
              ))}
            </ol>
          </div>
        ) : loading ? (
          <div className="hv5-bzs-wait" aria-hidden="true" />
        ) : (
          // our 5-minute read failed, not the channels: say so rather than blame their windows (fix, 10-30)
          <p className="hv5-bzv-none">{unavailable ? 'Unavailable right now.' : screenerDown(live) ? HUB_CHAT_COUNTS_DOWN : 'No synced channel has a full 5-minute window right now.'}</p>
        )}
      </div>
    </section>
  )
}
