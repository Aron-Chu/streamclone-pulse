import type { ReactNode } from 'react'
import { cn } from '../../primitives/cn'
import { ResilientImage } from '../ResilientImage'
import { TICKER_PICTURE_PX, type TickerItem } from './landingData'

interface EmoteTickerProps {
  variant: 'a' | 'b'
  label: string
  icon?: ReactNode
  items: TickerItem[]
}

function TickerLead({ item, round }: { item: TickerItem; round: boolean }) {
  return (
    <ResilientImage
      className={cn('sl-ticker__img', round && 'sl-ticker__img--round')}
      src={item.image}
      fallbackSrc={item.imageFallback}
      alt=""
      loading="lazy"
      decoding="async"
      width={TICKER_PICTURE_PX}
      height={TICKER_PICTURE_PX}
      fallback={<span className="sl-ticker__lead">{item.lead}</span>}
    />
  )
}

function TickerItems({ items, round }: { items: TickerItem[]; round: boolean }) {
  return items.map((item, index) => (
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
  ))
}

/**
 * Horizontal auto-scrolling ticker. Two identical tracks in a marquee wrapper
 * keep the loop seamless (avoids the stutter from duplicated inline items).
 */
export function EmoteTicker({ variant, label, icon, items }: EmoteTickerProps) {
  if (items.length === 0) return null
  const round = variant === 'b'

  return (
    <div className={cn('sl-ticker', variant === 'a' ? 'sl-ticker--a' : 'sl-ticker--b')}>
      <span className="sl-ticker__lbl">
        <span className="sl-dot" aria-hidden="true" />
        {icon}
        {label}
      </span>
      <div className="sl-ticker__marquee" aria-hidden="true">
        <div className="sl-ticker__track">
          <TickerItems items={items} round={round} />
        </div>
        <div className="sl-ticker__track">
          <TickerItems items={items} round={round} />
        </div>
      </div>
    </div>
  )
}
