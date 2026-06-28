import { useState, type ReactNode } from 'react'
import { cn } from '../../primitives/cn'
import type { TickerItem } from './landingData'

interface EmoteTickerProps {
  variant: 'a' | 'b'
  label: string
  icon?: ReactNode
  items: TickerItem[]
}

/**
 * Visual lead for a ticker item: a real 7TV emote (variant a) or channel
 * avatar (variant b) when an image resolves, otherwise the short text token.
 * Falls back to text if the CDN is blocked or the asset 404s.
 */
function TickerLead({ item, round }: { item: TickerItem; round: boolean }) {
  const [broken, setBroken] = useState(false)
  if (item.image && !broken) {
    return (
      <img
        className={cn('sl-ticker__img', round && 'sl-ticker__img--round')}
        src={item.image}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setBroken(true)}
      />
    )
  }
  return <span className="sl-ticker__lead">{item.lead}</span>
}

/**
 * Horizontal auto-scrolling ticker. The scrolling track is duplicated for a
 * seamless loop and marked aria-hidden (the same data is reachable on the hub
 * pages); the label remains readable. Animation is disabled under reduced motion.
 */
export function EmoteTicker({ variant, label, icon, items }: EmoteTickerProps) {
  const loop = items.length > 0 ? [...items, ...items] : items
  const round = variant === 'b'

  return (
    <div className={cn('sl-ticker', variant === 'a' ? 'sl-ticker--a' : 'sl-ticker--b')}>
      <span className="sl-ticker__lbl">
        <span className="sl-dot" aria-hidden="true" />
        {icon}
        {label}
      </span>
      <div className="sl-ticker__track" aria-hidden="true">
        {loop.map((item, index) => (
          <span key={`${item.label}-${index}`} className="sl-ticker__item">
            <TickerLead item={item} round={round} />
            <b>{item.label}</b> {item.value}
            {item.delta ? (
              <span className={item.tone === 'up' ? 'sl-up' : item.tone === 'dn' ? 'sl-dn' : undefined}>
                {' '}
                {item.delta}
              </span>
            ) : null}
          </span>
        ))}
      </div>
    </div>
  )
}
