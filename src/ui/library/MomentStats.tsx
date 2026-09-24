import { useState } from 'react'
import type { MomentContext } from './MomentPreview.tsx'

const valid = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
const display = (value: number | null | undefined) => valid(value) ? value.toLocaleString() : 'Not available'

/** Arithmetic description of one measured bucket, never a Pulse score or viewer engagement estimate. */
export function emoteShare(uses: number, total: number | null): string | null {
  return valid(uses) && valid(total) && total > 0 && uses <= total ? `${(100 * uses / total).toFixed(1)}%` : null
}

export function MomentStats({ context }: { context: MomentContext }) {
  const density = valid(context.selectedEmotes) && valid(context.selectedMessages) && context.selectedMessages > 0
    ? (100 * context.selectedEmotes / context.selectedMessages).toFixed(1) : 'Not available'
  return <section className="pl-stack" aria-label="Selected minute statistics">
    <div className="pl-row pl-between"><h3>At this moment</h3><span className="pl-muted">Selected minute · {context.coverage} coverage</span></div>
    <dl className="pl-metrics pl-moment-stats">
      <div><dt>Viewers</dt><dd>{display(context.selectedViewers)}</dd></div>
      <div><dt>Chat / min</dt><dd>{display(context.selectedMessages)}</dd></div>
      <div><dt>Emotes / min</dt><dd>{display(context.selectedEmotes)}</dd></div>
    </dl>
    <p className="pl-muted">Emote density · <strong>{density}</strong> uses / 100 messages</p>
    <details><summary>How these rates are measured</summary><p>Chat / min counts messages; emotes / min counts individual emote occurrences in the selected measured minute. Viewers is the audience sample associated with that minute, not unique chatters. Multiple emotes can occur in one message; density is not a percentage of viewers or messages using emotes and can exceed 100. Missing measurements remain unavailable.</p></details>
  </section>
}

/** Only supplied static provider artwork; no per-message fetches or name-to-provider guesses. */
function EmoteArtwork({ emote }: { emote: MomentContext['topEmotes'][number] }) {
  const [failed, setFailed] = useState<string | null>(null)
  const src = emote.staticImageUrl
  let allowed = false
  try {
    const url = new URL(src ?? '')
    allowed = url.protocol === 'https:' && !url.username && !url.password && ['cdn.7tv.app', 'static-cdn.jtvnw.net', 'cdn.betterttv.net', 'cdn.frankerfacez.com'].includes(url.hostname)
  } catch { /* Keep the readable name when an asset is missing or invalid. */ }
  return <span className="pl-emote-art" aria-hidden="true">{allowed && failed !== src
    ? <img src={src} alt="" width="32" height="32" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(src!)} />
    : <span title="Artwork unavailable">—</span>}</span>
}

export function MomentEmotes({ context, compact = false }: { context: MomentContext; compact?: boolean }) {
  return <section className="pl-stack" aria-label="Emote usage in selected minute">
    <div className="pl-row pl-between"><h3>Emote mix</h3><span className="pl-muted">7TV + other detected providers</span></div>
    {context.topEmotes.length ? <ul className="pl-emote-mix">{context.topEmotes.slice(0, compact ? 3 : 10).map((emote, index) => {
      const share = emoteShare(emote.count, context.selectedEmotes)
      return <li key={`${emote.provider ?? 'unknown'}-${emote.name}-${index}`}>
        <EmoteArtwork emote={emote} />
        <div className="pl-emote-name"><strong>{emote.name}</strong><span className="pl-muted">{emote.provider ?? 'Provider unverified'}</span></div>
        <div className="pl-emote-usage"><strong>{display(emote.count)} uses / min</strong><span className="pl-muted">{share ? `${share} of emote uses` : 'Usage share unavailable'}</span></div>
      </li>
    })}</ul> : <p className="pl-muted">No emote breakdown is available for this minute.</p>}
    <details><summary>About emote usage</summary><p>Usage share = this emote’s occurrences ÷ all measured emote occurrences in the same minute. Not a sentiment score. Provider and artwork come from resolved metadata, not guessed names. Missing artwork keeps its readable name.{compact && context.topEmotes.length > 3 ? ' More in Analysis.' : ''}</p></details>
  </section>
}

/** List-sized context: useful without opening the full inspector. */
export function MomentGlance({ context }: { context: MomentContext }) {
  return <div className="pl-glance">
    <dl className="pl-glance-metrics" aria-label="Selected minute statistics">
      <div><dt>Viewers</dt><dd>{display(context.selectedViewers)}</dd></div>
      <div><dt>Chat / min</dt><dd>{display(context.selectedMessages)}</dd></div>
      <div><dt>Emotes / min</dt><dd>{display(context.selectedEmotes)}</dd></div>
    </dl>
    {context.topEmotes.length ? <ul className="pl-glance-emotes" aria-label="Leading emotes in this minute">{context.topEmotes.slice(0, 3).map((emote, index) => <li key={index}>
      <EmoteArtwork emote={emote} />
      <span><strong>{emote.name}</strong><span className="pl-muted">{emote.provider ?? 'Unverified provider'} · {display(emote.count)} uses</span></span>
    </li>)}</ul> : null}
    <span className="pl-glance-provenance">{context.provenance === 'fixture' ? 'Example statistics' : 'Saved snapshot'} · {context.coverage} coverage · selected minute</span>
  </div>
}
