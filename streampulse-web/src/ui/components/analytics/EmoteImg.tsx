import { useState, type CSSProperties } from 'react'

import { emoteDisplaySrc, emoteSrcSet, isAllowedEmoteImageUrl } from '../../../lib/emoteAssetUrl'
import { initial } from './hubFormat'

interface EmoteImgProps {
  src?: string
  name: string
  className?: string
  width?: number
  height?: number
  style?: CSSProperties
  fallbackClassName?: string
  /** Hint for scale selection; defaults to width or 28. */
  displayPx?: number
  fetchPriority?: 'high' | 'low' | 'auto'
}

export function EmoteImg({
  src,
  name,
  className,
  width,
  height,
  style,
  fallbackClassName,
  displayPx,
  fetchPriority = 'low',
}: EmoteImgProps) {
  const [failed, setFailed] = useState(false)
  const cssPx = displayPx ?? width ?? 28
  const resolved = emoteDisplaySrc(src, cssPx)
  const safeSrc = resolved && isAllowedEmoteImageUrl(resolved) ? resolved : undefined
  const srcSet = emoteSrcSet(src)
  const safeSrcSet =
    srcSet &&
    srcSet
      .split(',')
      .map((part) => part.trim())
      .every((part) => {
        const url = part.split(/\s+/)[0]
        return isAllowedEmoteImageUrl(url)
      })
      ? srcSet
      : undefined
  if (!safeSrc?.trim() || failed) {
    return (
      <span className={fallbackClassName} aria-hidden="true">
        {initial(name)}
      </span>
    )
  }
  return (
    <img
      className={className}
      src={safeSrc}
      srcSet={safeSrcSet}
      sizes={`${cssPx}px`}
      alt=""
      loading="lazy"
      decoding="async"
      // React 18 DOM: lowercase custom attribute for fetch priority hint.
      {...{ fetchpriority: fetchPriority }}
      width={width}
      height={height}
      style={style}
      onError={() => setFailed(true)}
    />
  )
}
