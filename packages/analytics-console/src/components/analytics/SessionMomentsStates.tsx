/**
 * The session Moments tab's in-between states (11-13):
 *
 * - L1 (SESSION-MOMENTS-10): while the recap is out, one large and two small grey cards in the reel's own
 *   shape (16:9 with a verified VOD, the compact flat cards without), so nothing jumps when moments land.
 *   After about 5 s a status line says 'Still loading. Live data can take a moment.'
 * - R1 (SESSION-MOMENTS-4): when the recap failed or came back without moments, one plain line over the rows
 *   ranked from minute data, 'Recap unavailable, ranked from minute data', with Try again.
 *
 * Styles: the reel's classes (WEB/src/ui/charts/sp-session-rows.css) and the console's own skeleton and
 * Try again (AnalyticsConsoleDataSkeleton.tsx, StreamSidebar.tsx).
 */
import { useEffect, useState } from 'react'

export const MOMENTS_LATE_MS = 5_000
export const MOMENTS_LATE_LINE = 'Still loading. Live data can take a moment.'
export const RECAP_FALLBACK_LINE = 'Recap unavailable, ranked from minute data'
export const RECAP_UNAVAILABLE_LINE = 'Recap unavailable.'

const SKELETON_CARD = 'ssr-sk block rounded-lg border border-white/[0.07] bg-zinc-800/80 animate-pulse motion-reduce:animate-none'

export function SessionMomentsLoading({ framed, lateMs = MOMENTS_LATE_MS }: {
  /** The cards will carry VOD frames (a verified VOD): 16:9 placeholders; otherwise the flat cards' height. */
  framed: boolean
  lateMs?: number
}) {
  const [late, setLate] = useState(false)
  useEffect(() => {
    const id = setTimeout(() => setLate(true), lateMs)
    return () => clearTimeout(id)
  }, [lateMs])
  return (
    <section className="ssr ssr--rail" aria-label="Pulse moments recap" aria-busy="true" data-moments-loading>
      <div className="ssr-list">
        <div className={`ssr-reel${framed ? '' : ' ssr-sk-flat'}`} aria-hidden="true" data-console-skeleton="moments">
          <span className={`${SKELETON_CARD} ssr-sk--hero`} />
          <div className="ssr-reel-two">
            <span className={SKELETON_CARD} />
            <span className={SKELETON_CARD} />
          </div>
        </div>
      </div>
      <p role="status" className={late ? 'ssr-late' : 'ssr-vh'} data-moments-late={late ? '' : undefined}>
        {late ? MOMENTS_LATE_LINE : 'Loading moments'}
      </p>
    </section>
  )
}

export function SessionMomentsFallbackNotice({ ranked, retrying, failedAgain, onRetry }: {
  /** Rows ranked from minute data follow; false when the minutes hold none yet. */
  ranked: boolean
  retrying: boolean
  /** The last Try again failed too: said to screen readers, the button keeps focus. */
  failedAgain: boolean
  onRetry: () => void
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-white/[0.07] px-3 py-2 text-xs font-semibold text-zinc-400"
      data-moments-fallback-notice
    >
      <p role="status" className="m-0 min-w-0 flex-1">
        {ranked ? RECAP_FALLBACK_LINE : RECAP_UNAVAILABLE_LINE}
        {failedAgain && !retrying ? <span className="sr-only"> Still unavailable.</span> : null}
      </p>
      {/* aria-disabled, not disabled: a disabled button would drop the focus it holds while it retries */}
      <button
        type="button"
        onClick={() => {
          if (!retrying) onRetry()
        }}
        aria-disabled={retrying || undefined}
        aria-busy={retrying || undefined}
        data-moments-retry
        className={`min-h-11 rounded border border-white/15 bg-white/[0.05] px-3 py-2 text-xs font-black uppercase text-zinc-200 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 ${retrying ? 'opacity-50' : ''}`}
      >
        {retrying ? 'Trying again…' : 'Try again'}
      </button>
    </div>
  )
}
