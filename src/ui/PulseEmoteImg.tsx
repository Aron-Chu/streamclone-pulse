import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { ExtensionEmote } from '../shared/messages.ts'
import { extensionEmoteImageUrls } from '../shared/emoteUrl.ts'
import { peekProxiedEmoteSrc, resolveProxiedEmoteSrc } from '../shared/emoteImageProxy.ts'
import { formatCount } from './mostReacted.ts'
import { theme } from './theme.ts'

export const EMOTE_TOOLTIP_DELAY_MS = 300

export interface PulseEmoteImgProps {
  emote: Pick<ExtensionEmote, 'id' | 'name' | 'imageUrl' | 'provider' | 'providerEmoteId' | 'count'>
  backendUrl: string
  width?: number
  height?: number
  style?: CSSProperties
  className?: string
  showHoverPreview?: boolean
  previewFocusable?: boolean
  /**
   * Load immediately instead of lazily. Inspector thumbnails are already inside
   * the viewport when they mount, so lazy loading only adds an intersection
   * round-trip before the request starts.
   */
  eager?: boolean
}

export function PulseEmoteImg({
  emote,
  backendUrl,
  width = 28,
  height = 28,
  style,
  className = 'pulse-emote-img',
  showHoverPreview = false,
  previewFocusable = false,
  eager = false,
}: PulseEmoteImgProps) {
  const candidates = useMemo(
    () => extensionEmoteImageUrls(emote, backendUrl),
    [emote.id, emote.imageUrl, emote.name, emote.provider, emote.providerEmoteId, backendUrl],
  )
  const candidateKey = candidates.join('\n')
  const [candidateIndex, setCandidateIndex] = useState(0)
  // Seed from the synchronous cache so a warm emote paints an <img> on the very
  // first frame instead of a loading placeholder.
  const [resolved, setResolved] = useState<string | undefined>(
    () => peekProxiedEmoteSrc(candidates[0]),
  )
  const [tooltipOpen, setTooltipOpen] = useState(false)
  const tooltipTimerRef = useRef<number | null>(null)
  const previewId = `pulse-emote-tooltip-${useId().replace(/:/g, '')}`

  useEffect(() => {
    setCandidateIndex(0)
  }, [candidateKey])

  const candidate = candidates[candidateIndex]

  useEffect(() => {
    let active = true
    if (!candidate) {
      setResolved(undefined)
      return () => { active = false }
    }
    // A synchronously available src must not be cleared first — clearing would
    // reintroduce the one-frame placeholder this seeding exists to avoid.
    const immediate = peekProxiedEmoteSrc(candidate)
    if (immediate) {
      setResolved(immediate)
      return () => { active = false }
    }
    setResolved(undefined)
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

  useEffect(() => () => {
    if (tooltipTimerRef.current != null) window.clearTimeout(tooltipTimerRef.current)
  }, [])

  const providerLabel = emote.provider ? `Provider ${emote.provider}` : 'Provider unavailable'
  const accessibleLabel = `${emote.name}, ${formatCount(emote.count)} uses, ${providerLabel}`

  function cancelTooltipTimer(): void {
    if (tooltipTimerRef.current == null) return
    window.clearTimeout(tooltipTimerRef.current)
    tooltipTimerRef.current = null
  }

  function scheduleTooltip(): void {
    cancelTooltipTimer()
    if (tooltipOpen) return
    tooltipTimerRef.current = window.setTimeout(() => {
      tooltipTimerRef.current = null
      setTooltipOpen(true)
    }, EMOTE_TOOLTIP_DELAY_MS)
  }

  function hideTooltip(): void {
    cancelTooltipTimer()
    setTooltipOpen(false)
  }

  const content = resolved ? (
    <img
      src={resolved}
      alt={previewFocusable && showHoverPreview ? '' : emote.name}
      width={width}
      height={height}
      className={className}
      style={{ ...styles.img, ...style }}
      referrerPolicy="no-referrer"
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      onError={() => setCandidateIndex(index => index + 1)}
    />
  ) : candidate ? (
    <span className="pulse-emote-loading" style={{ ...styles.loading, width, height }} aria-hidden="true" />
  ) : (
    <span
      className="pulse-emote-fallback"
      style={{ ...styles.fallback, boxSizing: 'border-box', height, minWidth: width, width }}
      aria-hidden={previewFocusable && showHoverPreview ? true : undefined}
    >
      {emote.name.slice(0, 6)}
    </span>
  )

  if (!showHoverPreview) return content

  return (
    <span
      className="pulse-emote-hover-wrap"
      data-tooltip-open={tooltipOpen ? 'true' : 'false'}
      tabIndex={previewFocusable ? 0 : undefined}
      role={previewFocusable ? 'img' : undefined}
      aria-label={previewFocusable ? accessibleLabel : undefined}
      aria-describedby={previewFocusable ? previewId : undefined}
      style={{ ...styles.previewTrigger, height, width }}
      onMouseEnter={scheduleTooltip}
      onMouseLeave={hideTooltip}
      onFocus={scheduleTooltip}
      onBlur={hideTooltip}
    >
      {content}
      <span
        className="pulse-emote-hover-preview"
        data-emote-tooltip="true"
        id={previewId}
        role="tooltip"
        aria-hidden={!tooltipOpen}
      >
        {resolved ? (
          <img
            src={resolved}
            alt=""
            width={48}
            height={48}
            style={styles.previewImage}
            aria-hidden="true"
          />
        ) : (
          <span style={styles.previewFallback} aria-hidden="true">
            {emote.name.slice(0, 6)}
          </span>
        )}
        <span style={styles.previewName}>{emote.name}</span>
        <span style={styles.previewProvider}>{providerLabel}</span>
        <span style={styles.previewCount}>{formatCount(emote.count)} uses</span>
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
    alignItems: 'center',
    color: theme.textSecondary,
    display: 'inline-flex',
    fontSize: 10,
    fontWeight: 700,
    justifyContent: 'center',
    padding: '0 4px',
  },
  previewTrigger: {
    alignItems: 'center',
    display: 'inline-flex',
    flex: '0 0 auto',
    justifyContent: 'center',
    position: 'relative',
    verticalAlign: 'middle',
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
  previewImage: { display: 'block', height: 48, objectFit: 'contain', width: 48 },
  previewFallback: {
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
  previewProvider: {
    color: theme.accentSoft,
    display: 'block',
    fontSize: 9,
    fontWeight: 700,
    maxWidth: 150,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  previewCount: {
    color: theme.textMuted,
    display: 'block',
    fontSize: 9,
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 700,
    marginTop: 2,
    whiteSpace: 'nowrap',
  },
}
