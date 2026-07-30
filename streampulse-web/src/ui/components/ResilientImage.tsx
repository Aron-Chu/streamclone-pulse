import { useEffect, useState, type ImgHTMLAttributes, type ReactNode } from 'react'

export interface ResilientImageProps
  extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'onError'> {
  src?: string | null
  fallback: ReactNode
  onError?: ImgHTMLAttributes<HTMLImageElement>['onError']
}

/**
 * Renders the caller's existing fallback when an image URL is absent or fails.
 * Resetting the failure state when src changes lets live channel rows recover
 * when Twitch refreshes a profile-image URL without requiring a remount.
 */
export function ResilientImage({ src, fallback, onError, ...imageProps }: ResilientImageProps) {
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
  }, [src])

  if (!src || failed) return <>{fallback}</>

  return (
    <img
      {...imageProps}
      src={src}
      onError={(event) => {
        setFailed(true)
        onError?.(event)
      }}
    />
  )
}
