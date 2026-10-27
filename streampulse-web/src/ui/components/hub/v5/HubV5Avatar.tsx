/**
 * The d3-v5 hub's channel picture: the profile image, else a toned monogram
 * (mockup hub-r4.js `av`). Decorative: the row's own label names the channel.
 * Every caller draws it at 32 px or less, so it asks for Twitch's 70 px
 * rendition and keeps the original URL as the fallback.
 */
import { twitchProfileImageRendition } from '../../../../lib/twitchProfileImage'
import { ResilientImage } from '../../ResilientImage'
import { hubAvatarTone, hubMonogram } from './hubV5Model'

export function HubV5Avatar({ login, name, src, size }: { login: string; name?: string; src?: string | null; size: number }) {
  const box = { width: size, height: size }
  const mono = (
    <span className="hv5-av hv5-mono" style={{ ...box, background: hubAvatarTone(login) }} aria-hidden="true">
      {hubMonogram(name, login)}
    </span>
  )
  return (
    <ResilientImage
      className="hv5-av"
      src={twitchProfileImageRendition(src, 70)}
      fallbackSrc={src}
      fallback={mono}
      alt=""
      width={size}
      height={size}
      style={box}
      decoding="async"
      loading="lazy"
      referrerPolicy="no-referrer"
    />
  )
}

/** A value the backend did not measure: a dash on screen, the reason for screen readers and on hover. */
export function HubV5Dash({ why }: { why: string }) {
  return (
    <>
      <span className="hv5-na" title={why} aria-hidden="true">—</span>
      <span className="hv5-vh">{why}</span>
    </>
  )
}
