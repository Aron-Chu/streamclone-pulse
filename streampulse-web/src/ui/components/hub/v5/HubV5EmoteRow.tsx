/**
 * Top emotes near the top of the hub (H1, 11-19): the hub answer's most used
 * emotes in one row under Busiest now, so a glance meets them before the chart
 * (the emote map sat about 2,500 px down on a phone). A chip finds its emote on
 * the emote map below, as a pick in the hub's search does; "Emote map ↓" goes
 * there. The row is the answer's recent emote pool, not the chart's range: the
 * backend counts it over its recent minutes and sends no window today, so the
 * row says "Recent window" (topEmotesWindowLabel) until it does.
 */
import { useState } from 'react'
import { emoteDisplaySrc, sanitizeEmoteImageUrl } from '../../../../lib/emoteAssetUrl'
import type { HubEmote } from '../../../../lib/publicHub'
import { tilePicUrl } from './hubV5EmoteMapModel'
import { formatHubInt, topEmotesWindowLabel } from './hubV5Model'
import { useHubV5SearchStore } from './hubV5SearchStore'

/** Chips in the row; the rest are on the emote map. */
export const EMOTE_ROW_COUNT = 8
/** The chip's picture, in CSS px: a small still frame (S1, 11-19). */
const PIC_PX = 28

const H_ID = 'hv5-emr-h'

export const EMOTE_ROW_NONE = 'Unavailable right now.'

const stamped = (windowMinutes: number | undefined): windowMinutes is number =>
  typeof windowMinutes === 'number' && Number.isFinite(windowMinutes) && windowMinutes > 0

/** The row's label: "Last ≈35 min" once the backend stamps the pool's window, else "Recent window". */
export const emoteRowWindow = (windowMinutes?: number) =>
  stamped(windowMinutes) ? `Last ${topEmotesWindowLabel(windowMinutes)}` : 'Recent window'

/** The same window in a sentence, as the pool's tip says it: "the last 35 minutes" or "the recent window". */
const windowWords = (windowMinutes?: number) =>
  stamped(windowMinutes) ? `the last ${Math.round(windowMinutes)} minutes` : 'the recent window'

export const emoteRowEmpty = (windowMinutes?: number) => `No emotes counted in ${windowWords(windowMinutes)} yet.`

/**
 * A chip's picture: a still frame, asked for as the emote map asks (tilePicUrl;
 * a 7TV still only for an emote flagged animated, since a still emote's _static
 * file is a 404). A still that fails falls back to the file the row used before;
 * that failing too hides the picture.
 */
function ChipPic({ emote, eager }: { emote: HubEmote; eager: boolean }) {
  const moving = emoteDisplaySrc(emote.imageUrl, PIC_PX)
  const asked = tilePicUrl(emote.imageUrl, PIC_PX, false, emote.animated === true)
  const still = asked && asked !== emote.imageUrl ? sanitizeEmoteImageUrl(asked) ?? moving : moving
  const [failed, setFailed] = useState<string | null>(null)
  const src = failed === still ? moving : still
  if (!src) return <span className="hv5-emr-pic" aria-hidden="true" />
  return (
    <img
      src={src}
      alt=""
      width={PIC_PX}
      height={PIC_PX}
      decoding="async"
      loading={eager ? 'eager' : 'lazy'}
      referrerPolicy="no-referrer"
      onError={(event) => {
        if (src !== moving) setFailed(src)
        else event.currentTarget.style.visibility = 'hidden'
      }}
    />
  )
}

export function HubV5EmoteRow({
  emotes,
  windowMinutes,
  loading = false,
  unavailable = false,
}: {
  emotes: readonly HubEmote[]
  /** The pool's window as the backend stamps it (emoteIntel.windowMinutes); absent today. */
  windowMinutes?: number
  loading?: boolean
  unavailable?: boolean
}) {
  const store = useHubV5SearchStore()
  const rows = emotes.filter((e) => e.name && e.count > 0).slice(0, EMOTE_ROW_COUNT)
  const find = (name: string) => store.actions.emote?.(name)
  const words = windowWords(windowMinutes)
  return (
    <section className="hv5-sec hv5-emr" aria-labelledby={H_ID} aria-busy={loading || undefined}>
      <div className="hv5-rh">
        <h2 id={H_ID}>Top emotes</h2>
        <span className="hv5-f2-fresh">{emoteRowWindow(windowMinutes)}</span>
        <span className="hv5-end"><a className="hv5-mo-all" href="#emotes">Emote map ↓</a></span>
      </div>
      {rows.length ? (
        <ol className="hv5-emr-list">
          {rows.map((e, i) => (
            <li key={`${e.provider ?? ''}:${e.id ?? e.name}:${i}`}>
              <button className="hv5-emr-c" type="button" onClick={() => find(e.name)}>
                <ChipPic emote={e} eager={i < 4} />
                <span className="hv5-emr-nm" aria-hidden="true">{e.name}</span>
                <span className="hv5-emr-n" aria-hidden="true">{formatHubInt(e.count)}</span>
                {/* Its words for screen readers; an aria-label would not match the chip's own text (WCAG 2.5.3). */}
                <span className="hv5-vh">{`${i + 1}. ${e.name}, ${formatHubInt(e.count)} uses in ${words}. Finds it on the emote map.`}</span>
              </button>
            </li>
          ))}
        </ol>
      ) : loading ? (
        <div className="hv5-emr-wait" aria-hidden="true" />
      ) : (
        <p className="hv5-emr-q">{unavailable ? EMOTE_ROW_NONE : emoteRowEmpty(windowMinutes)}</p>
      )}
    </section>
  )
}
