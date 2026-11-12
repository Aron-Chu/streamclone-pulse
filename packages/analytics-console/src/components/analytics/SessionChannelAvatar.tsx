import { useState } from 'react'

/**
 * The channel's Twitch picture beside its name in the session header (C1, 11-11): a red
 * ring while the channel is live. Until Twitch answers, or when it has no picture or the
 * picture fails, the first letter of the name holds the same box, so nothing moves.
 * Decorative: the heading next to it says whose channel this is.
 */
export function SessionChannelAvatar({ name, src, live }: { name: string; src?: string | null; live: boolean }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const picture = src && src !== failedSrc ? src : null
  const initial = Array.from(name.trim())[0]?.toUpperCase() ?? ''
  return (
    <span className="ssp-av" data-channel-avatar data-live={live || undefined} aria-hidden="true">
      {picture ? (
        <img src={picture} alt="" width={62} height={62} referrerPolicy="no-referrer" onError={() => setFailedSrc(picture)} />
      ) : (
        <span className="ssp-av-mono">{initial}</span>
      )}
    </span>
  )
}
