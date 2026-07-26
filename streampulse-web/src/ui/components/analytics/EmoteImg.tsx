import { useState, type CSSProperties } from 'react'

import { emoteDisplaySrc, emoteSrcSet, sanitizeEmoteImageUrl } from '../../../lib/emoteAssetUrl'
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

function sanitizeEmoteSrcSet(srcSet: string | undefined): string | undefined {
  if (!srcSet) return undefined
  const parts: string[] = []
  for (const part of srcSet.split(',')) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const [rawUrl, descriptor] = trimmed.split(/\s+/, 2)
    const safe = sanitizeEmoteImageUrl(rawUrl)
    if (!safe) return undefined
    parts.push(descriptor ? `${safe} ${descriptor}` : safe)
  }
  return parts.length > 0 ? parts.join(', ') : undefined
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
  const safeSrc = sanitizeEmoteImageUrl(emoteDisplaySrc(src, cssPx))
  const safeSrcSet = sanitizeEmoteSrcSet(emoteSrcSet(src))
  if (!safeSrc || failed) {
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
