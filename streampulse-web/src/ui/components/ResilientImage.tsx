import { useState, type ImgHTMLAttributes, type ReactNode } from 'react'

export interface ResilientImageProps
  extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'onError'> {
  src?: string | null
  /** Tried once when `src` fails (e.g. the original URL behind a resized rendition). */
  fallbackSrc?: string | null
  fallback: ReactNode
  onError?: ImgHTMLAttributes<HTMLImageElement>['onError']
}

/**
 * Renders the caller's existing fallback when an image URL is absent or fails.
 * Failures are keyed by the requested URLs, so live channel rows recover when
 * Twitch refreshes a profile-image URL without requiring a remount.
 */
export function ResilientImage({ src, fallbackSrc, fallback, onError, ...imageProps }: ResilientImageProps) {
  const candidates = [src, fallbackSrc].filter(
    (value, index, all): value is string => Boolean(value) && all.indexOf(value) === index,
  )
  const key = candidates.join('\n')
  const [failures, setFailures] = useState({ key, count: 0 })
  const attempt = failures.key === key ? failures.count : 0
  const current = candidates[attempt]

  if (!current) return <>{fallback}</>

  return (
    <img
      {...imageProps}
      src={current}
      onError={(event) => {
        setFailures({ key, count: attempt + 1 })
        if (attempt + 1 >= candidates.length) onError?.(event)
      }}
    />
  )
}
