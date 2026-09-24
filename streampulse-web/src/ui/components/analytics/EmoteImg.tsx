import { useState, type CSSProperties } from 'react'
import { initial } from './hubFormat'

import { emoteDisplaySrc, emoteSrcSet, sanitizeEmoteImageUrl } from '../../../lib/emoteAssetUrl'

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
  hideFallbackText?: boolean
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
  hideFallbackText = false,
}: EmoteImgProps) {
  const [failedSource, setFailedSource] = useState<string>()
  const cssPx = displayPx ?? width ?? 28
  const safeSrc = sanitizeEmoteImageUrl(emoteDisplaySrc(src, cssPx))
  const safeSrcSet = sanitizeEmoteSrcSet(emoteSrcSet(src))
  const sourceKey = `${safeSrc ?? ''}|${safeSrcSet ?? ''}`
  if (!safeSrc || failedSource === sourceKey) {
    if (hideFallbackText) {
      return (
        <span
          className={`emote-fallback-icon ${fallbackClassName || ''}`}
          aria-hidden="true"
          style={{ width: width ?? cssPx, height: height ?? cssPx, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <svg width={Math.min(cssPx, 20)} height={Math.min(cssPx, 20)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.6">
            <circle cx="12" cy="12" r="10" />
            <path d="M8 14s1.5 2 4 2 4-2 4-2" />
            <line x1="9" y1="9" x2="9.01" y2="9" />
            <line x1="15" y1="9" x2="15.01" y2="9" />
          </svg>
        </span>
      )
    }
    const fallbackClass = fallbackClassName
      ? `${fallbackClassName} emote-name-badge`
      : 'emote-name-badge'
    return (
      <span className={fallbackClass} title={name} aria-label={name}>
        {initial(name)}
      </span>
    )
  }
  return (
    <img
      key={sourceKey}
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
      onError={event => {
        // A replaced DOM image must not poison the current source.
        if (event.currentTarget.isConnected) setFailedSource(sourceKey)
      }}
    />
  )
}
