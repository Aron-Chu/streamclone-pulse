import { useEffect, useState } from 'react'

import { initial } from './hubFormat'

export interface ChannelAvatarProps {
  login: string
  name?: string
  src?: string
  className?: string
  fallbackClassName?: string
  alt?: string
  loading?: 'eager' | 'lazy'
}

/** Keep broken or stale channel image URLs from leaving a broken image glyph in dense tables. */
export function ChannelAvatar({
  login,
  name,
  src,
  className,
  fallbackClassName,
  alt = '',
  loading = 'lazy',
}: ChannelAvatarProps) {
  const normalizedSrc = src?.trim() || ''
  const [failedSrc, setFailedSrc] = useState('')

  useEffect(() => {
    setFailedSrc('')
  }, [normalizedSrc])

  const label = name?.trim() || login.trim() || '?'
  if (!normalizedSrc || failedSrc === normalizedSrc) {
    return (
      <span className={fallbackClassName} aria-hidden="true">
        {initial(label)}
      </span>
    )
  }

  return (
    <img
      className={className}
      src={normalizedSrc}
      alt={alt}
      loading={loading}
      decoding="async"
      onError={() => setFailedSrc(normalizedSrc)}
    />
  )
}
