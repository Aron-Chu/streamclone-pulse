import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { ExtensionEmote } from '../shared/messages.ts'
import { extensionEmoteImageUrls } from '../shared/emoteUrl.ts'
import { resolveProxiedEmoteSrc } from '../shared/emoteImageProxy.ts'
import { theme } from './theme.ts'

export interface PulseEmoteImgProps {
  emote: Pick<ExtensionEmote, 'id' | 'name' | 'imageUrl' | 'provider' | 'providerEmoteId' | 'count'>
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
  const candidates = useMemo(
    () => extensionEmoteImageUrls(emote, backendUrl),
    [emote.id, emote.imageUrl, emote.name, emote.provider, emote.providerEmoteId, backendUrl],
  )
  const candidateKey = candidates.join('\n')
  const [candidateIndex, setCandidateIndex] = useState(0)
  const [resolved, setResolved] = useState<string | undefined>()

  useEffect(() => {
    setCandidateIndex(0)
  }, [candidateKey])

  const candidate = candidates[candidateIndex]

  useEffect(() => {
    let active = true
    setResolved(undefined)
    if (!candidate) return () => { active = false }
    resolveProxiedEmoteSrc(candidate)
      .then(next => {
        if (!active) return
        if (next) {
          setResolved(next)
        } else {
          setCandidateIndex(index => index + 1)
        }
      })
      .catch(() => {
        if (active) setCandidateIndex(index => index + 1)
      })
    return () => {
      active = false
    }
  }, [candidate])

  if (!resolved) {
    if (candidate) {
      return (
        <span className="pulse-emote-loading" style={{ ...styles.loading, width, height }} aria-hidden="true" />
      )
    }
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
      decoding="async"
      onError={() => setCandidateIndex(index => index + 1)}
    />
  )

  if (!showHoverPreview) return img

  return (
    <span className="pulse-emote-hover-wrap" title={`${emote.name} · ${emote.count}`}>
      {img}
      <span className="pulse-emote-hover-preview" aria-hidden="true">
        <span style={styles.previewSwatch}>{emote.name.slice(0, 6)}</span>
        <span style={styles.previewName}>{emote.name}</span>
      </span>
    </span>
  )
}

const styles: Record<string, CSSProperties> = {
  img: { display: 'block', objectFit: 'contain' },
  loading: {
    background: 'rgba(148, 163, 184, 0.12)',
    borderRadius: 4,
    display: 'block',
  },
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
  previewSwatch: {
    alignItems: 'center',
    color: theme.textSecondary,
    display: 'flex',
    fontSize: 11,
    fontWeight: 800,
    height: 48,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 48,
  },
}
