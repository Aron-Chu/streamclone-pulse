import type { HubPublicClip } from '../../../lib/publicClipsContract'
import { compact } from './hubFormat'
import './figma-analytics.css'

export interface TopClipsShelfProps {
  clips: HubPublicClip[]
  loading?: boolean
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

/**
 * Public Top clips shelf — only server-approved, playback-verified clips.
 * Omit entirely when the list is empty (no fake media).
 */
export function TopClipsShelf({ clips, loading = false }: TopClipsShelfProps) {
  if (!loading && clips.length === 0) return null

  return (
    <section
      id="section-top-clips"
      className="figma-block top-clips-shelf"
      aria-labelledby="top-clips-shelf-title"
    >
      <div className="figma-block__head">
        <h2 id="top-clips-shelf-title" className="figma-block__title">
          Top clips
        </h2>
        <p className="figma-block__sub">
          Published, playback-verified clips only — not private candidates or unverified jobs.
        </p>
      </div>

      {loading && clips.length === 0 ? (
        <div className="top-clips-shelf__grid" aria-busy="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="top-clips-shelf__card top-clips-shelf__card--skeleton" />
          ))}
        </div>
      ) : (
        <ul className="top-clips-shelf__grid">
          {clips.map((clip) => (
            <li key={clip.id} className="top-clips-shelf__item">
              <a
                className="top-clips-shelf__card"
                href={clip.playbackUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span className="top-clips-shelf__thumb">
                  <img src={clip.thumbnailUrl} alt="" loading="lazy" decoding="async" />
                  <span className="top-clips-shelf__duration">{formatDuration(clip.durationSeconds)}</span>
                </span>
                <span className="top-clips-shelf__body">
                  <strong className="top-clips-shelf__title">{clip.title}</strong>
                  <span className="top-clips-shelf__meta">
                    {clip.displayName ?? clip.login}
                    {clip.topReaction ? ` · ${clip.topReaction.name}` : ''}
                  </span>
                </span>
              </a>
              {clip.analyticsHref ? (
                <a className="top-clips-shelf__secondary" href={clip.analyticsHref}>
                  Analytics
                </a>
              ) : clip.vodHref ? (
                <a
                  className="top-clips-shelf__secondary"
                  href={clip.vodHref}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  VOD
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {!loading && clips.length > 0 ? (
        <p className="top-clips-shelf__count muted">{compact(clips.length)} published</p>
      ) : null}
    </section>
  )
}
