import { useEffect, useState } from 'react'
import { preferSmallerSevenTVAsset } from '../../utils/emoteImageUrl.ts'

function emoteInitial(name: string): string {
  const trimmed = name.trim()
  return trimmed ? trimmed.charAt(0).toUpperCase() : '?'
}

function retryUrl(src: string): string {
  const hashIndex = src.indexOf('#')
  const base = hashIndex >= 0 ? src.slice(0, hashIndex) : src
  const hash = hashIndex >= 0 ? src.slice(hashIndex) : ''
  if (base.startsWith('data:')) return src
  const retryBase = preferSmallerSevenTVAsset(base)
  return `${retryBase}${retryBase.includes('?') ? '&' : '?'}sp_retry=1${hash}`
}

export function ConsoleEmoteImg({
  src,
  name,
  className,
  fallbackClassName,
  fallbackSrc,
  width,
  height,
}: {
  src?: string
  name: string
  className?: string
  fallbackClassName?: string
  fallbackSrc?: string
  width?: number
  height?: number
}) {
  const normalizedSrc = src?.trim() ?? ''
  const normalizedFallbackSrc = fallbackSrc?.trim() ?? ''
  const [failure, setFailure] = useState<{ src: string; attempt: number } | null>(null)
  const currentFailure = failure?.src === normalizedSrc ? failure : null

  useEffect(() => {
    setFailure(current => current?.src === normalizedSrc ? current : null)
  }, [normalizedSrc])

  const attempt = currentFailure?.attempt ?? 0
  const imageSrc = attempt === 0
    ? normalizedSrc
    : normalizedFallbackSrc || retryUrl(normalizedSrc)

  if (!normalizedSrc || attempt > 1 || !imageSrc) {
    return (
      <span
        className={fallbackClassName ?? 'inline-flex shrink-0 items-center justify-center rounded bg-white/[0.06] text-[10px] font-black text-zinc-500'}
        aria-hidden="true"
      >
        {emoteInitial(name)}
      </span>
    )
  }
  return (
    <img
      src={imageSrc}
      alt=""
      aria-hidden
      className={className}
      width={width}
      height={height}
      key={`${normalizedSrc}:${attempt}`}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailure(current => ({
        src: normalizedSrc,
        attempt: current?.src === normalizedSrc ? Math.min(2, current.attempt + 1) : 1,
      }))}
    />
  )
}
