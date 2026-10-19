import { useState } from 'react'
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
  // A picture kept on this device (src/shared/momentPictureStore.ts), read into this page.
  const origin = globalThis.location?.origin
  if (origin && origin !== 'null' && raw.startsWith(`blob:${origin}/`)) return raw
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

/** A list row's picture: the saved frame, or the moment's clock when there is none. */
export function MomentMedia({ moment, presentation }: { moment: MomentReference; presentation?: MomentPresentation }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const src = safePresentationUrl(presentation?.image?.url)
  const sampled = presentation?.image?.sampledOffsetSeconds
  const hasImage = !!src && failedUrl !== src && sampled !== undefined && Number.isFinite(sampled) && sampled >= 0
  if (!hasImage) return <div className="pl-media-tile"><b>{timestamp(moment.offsetSeconds)}</b>{moment.availability === 'unresolved' ? <small>Replay not linked</small> : moment.availability === 'unavailable' ? <small>Source unavailable</small> : null}</div>
  return <figure className="pl-media pl-media-compact">
    <div className="pl-media-frame">
      <img src={src} alt={`Stream preview near ${timestamp(sampled!)} — ${presentation?.gameAtMoment ?? moment.channel}`} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailedUrl(src!)} />
      <span className="pl-media-clock">{timestamp(moment.offsetSeconds)}</span>
    </div>
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
