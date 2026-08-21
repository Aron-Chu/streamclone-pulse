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
  hoverPreviewPlacement?: 'above' | 'below'
  decorative?: boolean
}

export function PulseEmoteImg({
  emote,
  backendUrl,
  width = 28,
  height = 28,
  style,
  className = 'pulse-emote-img',
  showHoverPreview = false,
  hoverPreviewPlacement = 'below',
  decorative = false,
}: PulseEmoteImgProps) {
  const resolved = extensionEmoteImageUrl(emote, backendUrl)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
  }, [resolved])

  const mainContent = !resolved || failed ? (
    <span
      className="pulse-emote-fallback"
      style={{ ...styles.fallback, width, height }}
      title={showHoverPreview ? undefined : emote.name}
      aria-hidden={decorative || undefined}
    >
      {emote.name.slice(0, 2)}
    </span>
  ) : (
    <img
      src={resolved}
      alt={decorative ? '' : emote.name}
      width={width}
      height={height}
      className={className}
      style={{ ...styles.img, ...style }}
      referrerPolicy="no-referrer"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  )

  if (!showHoverPreview) return mainContent

  return (
    <span
      className={`pulse-emote-hover-wrap pulse-emote-hover-wrap--${hoverPreviewPlacement}`}
      title={`${emote.name} · ${emote.count}`}
    >
      {mainContent}
      <span className="pulse-emote-hover-preview" aria-hidden="true">
        {resolved && !failed ? (
          <img src={resolved} alt="" width={48} height={48} referrerPolicy="no-referrer" />
        ) : (
          <span style={{ ...styles.previewFallback, width: 48, height: 48 }}>
            {emote.name.slice(0, 2)}
          </span>
        )}
        <span style={styles.previewName}>{emote.name}</span>
        <span style={styles.previewCount}>{emote.count} uses</span>
      </span>
    </span>
  )
}

const styles: Record<string, CSSProperties> = {
  img: { display: 'block', objectFit: 'contain' },
  fallback: {
    alignItems: 'center',
    color: theme.textSecondary,
    display: 'flex',
    fontSize: 10,
    fontWeight: 700,
    justifyContent: 'center',
    lineHeight: 1,
    overflow: 'hidden',
  },
  previewFallback: {
    alignItems: 'center',
    background: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 6,
    color: theme.textPrimary,
    display: 'flex',
    fontSize: 14,
    fontWeight: 850,
    justifyContent: 'center',
  },
  previewName: {
    color: theme.textPrimary,
    display: 'block',
    fontSize: 10,
    fontWeight: 800,
    marginTop: 4,
    lineHeight: 1.2,
    maxWidth: 160,
    textAlign: 'center',
    overflowWrap: 'anywhere',
  },
  previewCount: {
    color: theme.textMuted,
    fontSize: 9,
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 700,
    marginTop: 2,
    whiteSpace: 'nowrap',
  },
}
