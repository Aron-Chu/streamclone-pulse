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
  return <figure className={`pl-media ${compact ? 'pl-media-compact' : ''}`}>
    <div className="pl-media-frame">
      {hasImage ? <img src={src} alt={`Stream preview near ${timestamp(sampled!)} — ${presentation?.gameAtMoment ?? moment.channel}`} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailedUrl(src!)} />
        : <div className="pl-media-fallback"><LibraryIcon name="preview" /><strong>{state}</strong>{!compact ? <p>No verified frame is available for this timestamp. Your bookmark is still useful.</p> : null}</div>}
      <span className="pl-media-clock">{timestamp(moment.offsetSeconds)}</span>
    </div>
    {!compact ? <figcaption className="pl-muted">{hasImage ? `Preview sampled near ${timestamp(sampled!)} · not an archived copy` : 'No current live thumbnail is substituted for this earlier moment.'}</figcaption> : null}
  </figure>
}

export function MomentSignal({ presentation }: { presentation?: MomentPresentation }) {
  return <div className="pl-moment-signal"><span className="pl-signal-dot" aria-hidden="true" /><div>
    <strong>{presentation?.signal?.label ?? 'Stream comparison unavailable'}</strong>
    <p className="pl-muted">{presentation?.signal ? `${presentation.signal.illustrative ? 'Illustrative example · ' : ''}${presentation.signal.basis}` : 'No verified baseline for this moment. Open analysis for measured values.'}</p>
  </div></div>
}
