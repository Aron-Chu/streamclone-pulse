import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { LANDING_EMOTES, landingEmoteImageUrl } from './landingEmotes'

interface Drop {
  name: string
  url: string
  style: CSSProperties
}

/**
 * Decorative emote-rain backdrop — mostly 7TV culture emotes with a few Twitch
 * globals mixed in. Purely presentational (aria-hidden) and disabled under
 * `prefers-reduced-motion` via landing.css.
 */
export function EmoteRain({ count = 18 }: { count?: number }) {
  const drops = useMemo<Drop[]>(() => {
    return Array.from({ length: count }, (_, index) => {
      const emote = LANDING_EMOTES[index % LANDING_EMOTES.length]!
      const size = 1.4 + Math.random() * 1.5
      return {
        name: emote.name,
        url: landingEmoteImageUrl(emote, '2x'),
        style: {
          left: `${Math.random() * 100}%`,
          ['--sz' as string]: `${size.toFixed(2)}rem`,
          fontSize: `${(size * 0.5).toFixed(2)}rem`,
          animationDuration: `${(26 + Math.random() * 22).toFixed(1)}s`,
          animationDelay: `${(-Math.random() * 44).toFixed(1)}s`,
          ['--r' as string]: `${(Math.random() * 20 - 10).toFixed(0)}deg`,
          ['--op' as string]: `${(0.1 + Math.random() * 0.12).toFixed(3)}`,
        },
      }
    })
  }, [count])

  return (
    <div className="sl-fx" aria-hidden="true">
      {drops.map((drop, index) => (
        <EmoteDrop key={index} drop={drop} />
      ))}
    </div>
  )
}

function EmoteDrop({ drop }: { drop: Drop }) {
  const [broken, setBroken] = useState(false)
  return (
    <span className="sl-em" style={drop.style}>
      {broken ? (
        drop.name
      ) : (
        <img
          src={drop.url}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setBroken(true)}
        />
      )}
    </span>
  )
}
