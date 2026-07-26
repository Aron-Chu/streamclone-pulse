import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { ExtensionEmote } from '../shared/messages.ts'
import { extensionEmoteImageUrl } from '../shared/emoteUrl.ts'
import { theme } from './theme.ts'

export interface PulseEmoteImgProps {
  emote: Pick<ExtensionEmote, 'id' | 'name' | 'imageUrl' | 'provider' | 'count'>
  backendUrl: string
  width?: number
  height?: number
  style?: CSSProperties
  className?: string
  showHoverPreview?: boolean
}

export function PulseEmoteImg({
  emote,
  backendUrl,
  width = 28,
  height = 28,
  style,
  className = 'pulse-emote-img',
  showHoverPreview = false,
}: PulseEmoteImgProps) {
  const resolved = extensionEmoteImageUrl(emote, backendUrl)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
  }, [resolved])

  if (!resolved || failed) {
    return (
      <span className="pulse-emote-fallback" style={styles.fallback} title={emote.name}>
        {emote.name.slice(0, 6)}
      </span>
    )
  }

  const img = (
    <img
      src={resolved}
      alt={emote.name}
      width={width}
      height={height}
      className={className}
      style={{ ...styles.img, ...style }}
      referrerPolicy="no-referrer"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  )

  if (!showHoverPreview) return img

  return (
    <span className="pulse-emote-hover-wrap" title={`${emote.name} · ${emote.count}`}>
      {img}
      <span className="pulse-emote-hover-preview" aria-hidden="true">
        <img src={resolved} alt="" width={48} height={48} referrerPolicy="no-referrer" />
        <span style={styles.previewName}>{emote.name}</span>
      </span>
    </span>
  )
}

const styles: Record<string, CSSProperties> = {
  img: { display: 'block', objectFit: 'contain' },
  fallback: {
    color: theme.textSecondary,
    fontSize: 10,
    fontWeight: 700,
    padding: '0 4px',
  },
  previewName: {
    color: theme.textPrimary,
    display: 'block',
    fontSize: 10,
    fontWeight: 800,
    marginTop: 4,
    maxWidth: 72,
    overflow: 'hidden',
    textAlign: 'center',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
}
