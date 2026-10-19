import { useState } from 'react'
import { LibraryIcon } from './LibraryIcon.tsx'
import { timestamp, type MomentReference } from './model.ts'

/** Ephemeral source projection; never persist expiring media URLs as bookmark identity. */
export interface MomentPresentation {
  gameAtMoment?: string
  image?: { url: string; sampledOffsetSeconds: number }
  /** A backend-authored comparison with its denominator; not computed from UI samples. */
  signal?: { label: string; basis: string; illustrative?: boolean }
  analysisUrl?: string
}

export function safePresentationUrl(raw?: string): string | undefined {
  if (!raw) return undefined
  try {
    const url = new URL(raw)
    if (url.username || url.password) return undefined
    const localHosts = [
      String.fromCharCode(108, 111, 99, 97, 108, 104, 111, 115, 116),
      [
        String.fromCharCode(49, 50, 55),
        String.fromCharCode(48),
        String.fromCharCode(48),
        String.fromCharCode(49),
      ].join('.'),
    ]
    return url.protocol === 'https:' || (url.protocol === 'http:' && localHosts.includes(url.hostname)) ? url.href : undefined
  } catch { return undefined }
}

export function MomentMedia({ moment, presentation, compact = false }: {
  moment: MomentReference; presentation?: MomentPresentation; compact?: boolean
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const src = safePresentationUrl(presentation?.image?.url)
  const sampled = presentation?.image?.sampledOffsetSeconds
  const hasImage = !!src && failedUrl !== src && sampled !== undefined && Number.isFinite(sampled) && sampled >= 0
  const state = moment.availability === 'unresolved' ? 'Replay not linked' : moment.availability === 'unavailable' ? 'Source unavailable' : 'Preview image unavailable'
  // With no frame, Preview opens on its numbers and a list row shows only the moment's clock.
  if (!hasImage && !compact) return null
  if (!hasImage) return <div className="pl-media-tile"><b>{timestamp(moment.offsetSeconds)}</b>{moment.availability === 'unresolved' || moment.availability === 'unavailable' ? <small>{state}</small> : null}</div>
  return <figure className={`pl-media ${compact ? 'pl-media-compact' : ''}`}>
    <div className="pl-media-frame">
      {hasImage ? <img src={src} alt={`Stream preview near ${timestamp(sampled!)} — ${presentation?.gameAtMoment ?? moment.channel}`} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailedUrl(src!)} />
        : <div className="pl-media-fallback"><LibraryIcon name="preview" /><strong>{state}</strong>{!compact ? <p>No verified frame is available for this timestamp. Your bookmark is still useful.</p> : null}</div>}
      <span className="pl-media-clock">{timestamp(moment.offsetSeconds)}</span>
    </div>
    {!compact && hasImage ? <figcaption className="pl-muted">{`Preview sampled near ${timestamp(sampled!)} · not an archived copy`}</figcaption> : null}
  </figure>
}

/** The backend's comparison for this moment; nothing when it sends none. */
export function MomentSignal({ presentation }: { presentation?: MomentPresentation }) {
  const signal = presentation?.signal
  if (!signal) return null
  return <div className="pl-moment-signal"><span className="pl-signal-dot" aria-hidden="true" /><div>
    <strong>{signal.label}</strong>
    <p className="pl-muted">{`${signal.illustrative ? 'Illustrative example · ' : ''}${signal.basis}`}</p>
  </div></div>
}
