import { useState, type CSSProperties } from 'react'

import { initial } from './hubFormat'

interface EmoteImgProps {
  src?: string
  name: string
  className?: string
  width?: number
  height?: number
  style?: CSSProperties
  fallbackClassName?: string
}

export function EmoteImg({
  src,
  name,
  className,
  width,
  height,
  style,
  fallbackClassName,
}: EmoteImgProps) {
  const [failed, setFailed] = useState(false)
  if (!src?.trim() || failed) {
    return (
      <span className={fallbackClassName} aria-hidden="true">
        {initial(name)}
      </span>
    )
  }
  return (
    <img
      className={className}
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      width={width}
      height={height}
      style={style}
      onError={() => setFailed(true)}
    />
  )
}