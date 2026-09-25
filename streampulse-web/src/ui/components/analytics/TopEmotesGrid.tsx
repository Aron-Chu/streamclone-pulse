import { useState } from 'react'
import { Smile } from 'lucide-react'
import type { HubEmote } from '../../../lib/publicHub'
import { Skeleton } from '../../primitives'
import { compact } from './hubFormat'
import { sanitizeEmoteImageUrl } from '../../../lib/emoteAssetUrl'

interface TopEmotesGridProps {
  emotes: HubEmote[]
  loading?: boolean
}

function EmoteThumb({ imageUrl, name }: { imageUrl?: string; name: string }) {
  const [broken, setBroken] = useState(false)
  const safeSrc = sanitizeEmoteImageUrl(imageUrl)
  if (!safeSrc || broken) return <Smile size={22} aria-hidden="true" />
  return <img src={safeSrc} alt="" loading="lazy" onError={() => setBroken(true)} />
}

export function TopEmotesGrid({ emotes, loading = false }: TopEmotesGridProps) {
  if (loading) {
    return (
      <div className="hub-emotes" aria-busy="true">
        {Array.from({ length: 8 }).map((_, index) => (
          <Skeleton key={index} height={86} radius="var(--sc-radius)" />
        ))}
      </div>
    )
  }

  if (emotes.length === 0) {
    return (
      <div className="hub-empty">
        <Smile size={22} aria-hidden="true" />
        <strong>No emote activity yet</strong>
        <span>Top emotes across live rooms appear here once chat starts flowing.</span>
      </div>
    )
  }

  return (
    <div className="hub-emotes">
      {emotes.slice(0, 8).map((emote, index) => (
        <div className="hub-emote" key={`${emote.name}-${index}`}>
          <span className="hub-emote__g">
            <EmoteThumb imageUrl={emote.imageUrl} name={emote.name} />
          </span>
          <div className="hub-emote__b">
            <div className="hub-emote__n">
              <code>{emote.name}</code>
            </div>
            <div className="hub-emote__m">
              <b>{compact(emote.count)}</b>
              <small>uses</small>
              {emote.sharePct > 0 ? <span className="tr hub-up">{emote.sharePct.toFixed(1)}% of measured sends</span> : null}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
