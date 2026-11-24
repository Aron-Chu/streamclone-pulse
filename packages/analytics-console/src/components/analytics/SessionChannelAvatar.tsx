import { useState } from 'react'
import { twitchProfileImageRendition } from '../../utils/twitchProfileImage.ts'

/** The avatar's drawn width at each layout (sp-session-page.css: 44 px, 52 px from 640 px, 62 px from 1024 px). */
const AVATAR_SIZES = '(min-width: 1024px) 62px, (min-width: 640px) 52px, 44px'

/**
 * The channel's Twitch picture beside its name in the session header (C1, 11-11): a red
 * ring while the channel is live. Until Twitch answers, or when it has no picture or the
 * picture fails, the first letter of the name holds the same box, so nothing moves.
 * Decorative: the heading next to it says whose channel this is.
 * A Twitch picture loads as its 150 px rendition (300 px where the screen needs it), not the
 * 300-600 px original; if the rendition fails, the original is tried once before the letter.
 */
export function SessionChannelAvatar({ name, src, live }: { name: string; src?: string | null; live: boolean }) {
  const [failure, setFailure] = useState<{ src: string; count: number } | null>(null)
  const failures = src && failure?.src === src ? failure.count : 0
  const small = twitchProfileImageRendition(src, 150)
  const sized = Boolean(src && small && small !== src)
  const picture = !src || failures >= (sized ? 2 : 1)
    ? null
    : sized && failures === 0
      ? { src: small!, srcSet: `${small} 150w, ${twitchProfileImageRendition(src, 300)} 300w` }
      : { src, srcSet: undefined }
  const initial = Array.from(name.trim())[0]?.toUpperCase() ?? ''
  return (
    <span className="ssp-av" data-channel-avatar data-live={live || undefined} aria-hidden="true">
      {picture ? (
        <img
          key={picture.src}
          sizes={picture.srcSet ? AVATAR_SIZES : undefined}
          srcSet={picture.srcSet}
          src={picture.src}
          alt=""
          width={62}
          height={62}
          referrerPolicy="no-referrer"
          onError={() => setFailure({ src: src!, count: failures + 1 })}
        />
      ) : (
        <span className="ssp-av-mono">{initial}</span>
      )}
    </span>
  )
}
