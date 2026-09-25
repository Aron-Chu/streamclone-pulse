import { useMemo, type MouseEvent, type ReactNode } from 'react'
import { formatHeatOffset } from '@streampulse/pulse-core'
import type { AnalyticsMinuteRollup, AnalyticsTopEmote, PulseRecapEmote, PulseStreamRecap } from '../../apiTypes.ts'
import {
  resolveRecapBurstHighlight,
  resolveRecapDisplayEmotes,
} from '../../utils/recapEmoteEnrich.ts'
import { count, getEmoteImageUrl } from '../../utils/consoleFormat.ts'
import { alignedVodOffset, buildTwitchVodUrl } from '../../utils/twitchVodUrl.ts'
import { ConsoleEmoteImg } from './ConsoleEmoteImg.tsx'
import { EmoteProviderBadge } from './ConsoleBits.tsx'

export function StreamRecapPanel({
  recap,
  topEmotesCatalog,
  rollups,
  streamStartedAt,
  vodId,
  vodAlignSeconds,
  vodDurationSeconds,
  onJumpToOffset,
  onPreviewOffset,
}: {
  recap: PulseStreamRecap
  topEmotesCatalog?: AnalyticsTopEmote[]
  rollups?: AnalyticsMinuteRollup[]
  streamStartedAt?: string
  /** When set, cyan timestamps link to Twitch VOD at that offset. */
  vodId?: string
  /** Verified Twitch VOD alignment. Without it, offsets remain chart actions only. */
  vodAlignSeconds?: number | null
  vodDurationSeconds?: number | null
  onJumpToOffset?: (offsetSeconds: number) => void
  onPreviewOffset?: (offsetSeconds: number | null) => void
}) {
  const topMoments = recap.topMoments ?? []
  const topEmotes = useMemo(
    () => resolveRecapDisplayEmotes(recap.topEmotes ?? [], topEmotesCatalog, 10),
    [recap.topEmotes, topEmotesCatalog],
  )
  const hasHeadlineMetric =
    (recap.totalMessages ?? 0) > 0 || (recap.peakChatPerMin ?? 0) > 0
  const burstHighlight = useMemo(() => {
    if (!recap.funniestEmoteBurst) return null
    return resolveRecapBurstHighlight({
      burst: recap.funniestEmoteBurst,
      rollups,
      streamStartedAt,
      topEmotesCatalog,
    })
  }, [recap.funniestEmoteBurst, rollups, streamStartedAt, topEmotesCatalog])
  const burstEmote = burstHighlight?.emote
  const burstOffsetSeconds =
    burstHighlight?.offsetSeconds ?? recap.funniestEmoteBurst?.offsetSeconds ?? 0
  const canJump = Boolean(onJumpToOffset)

  if (
    !hasHeadlineMetric
    && topMoments.length === 0
    && topEmotes.length === 0
    && !recap.funniestEmoteBurst
  ) {
    return null
  }

  return (
    <section
      className="w-full min-w-0 rounded border border-white/[0.07] bg-white/[0.025] p-3"
      data-stream-recap-panel
    >
      <div className="mb-3">
        <h3 className="m-0 text-sm font-bold text-zinc-200">Stream Recap</h3>
      </div>
      {hasHeadlineMetric ? (
        <div className="grid grid-cols-2 gap-3 border-b border-white/[0.07] pb-3 text-xs">
          <div className="min-w-0 leading-snug">
            <div className="text-xs font-semibold text-zinc-400">Measured messages</div>
            <div className="mt-1 text-lg font-bold tabular-nums text-zinc-100">{count(recap.totalMessages)}</div>
          </div>
          <div className="min-w-0 leading-snug">
            <div className="text-xs font-semibold text-zinc-400">Peak measured chat</div>
            <div className="mt-1 text-lg font-bold tabular-nums text-zinc-100">{count(recap.peakChatPerMin)}<span className="text-xs font-normal text-zinc-400"> / min</span></div>
          </div>
        </div>
      ) : null}
      {recap.biggestChatSpike || recap.funniestEmoteBurst ? (
        <div
          className="mt-3 grid gap-2 text-xs leading-relaxed"
          onMouseLeave={() => onPreviewOffset?.(null)}
        >
          {recap.biggestChatSpike ? (
            <RecapHighlightButton
              canJump={canJump}
              offsetSeconds={recap.biggestChatSpike.offsetSeconds}
              onJumpToOffset={onJumpToOffset}
              onPreviewOffset={onPreviewOffset}
              ariaLabel={`Biggest spike at ${formatHeatOffset(recap.biggestChatSpike.offsetSeconds)}`}
              vodLink={(
                <RecapVodLink
                  offsetSeconds={recap.biggestChatSpike.offsetSeconds}
                  vodId={vodId}
                  vodAlignSeconds={vodAlignSeconds}
                  vodDurationSeconds={vodDurationSeconds}
                />
              )}
            >
              Biggest spike at{' '}
              <RecapOffsetTimestamp
                offsetSeconds={recap.biggestChatSpike.offsetSeconds}
                vodId={vodId}
                vodAlignSeconds={vodAlignSeconds}
                vodDurationSeconds={vodDurationSeconds}
                plain={canJump}
              />{' '}
              ({count(recap.biggestChatSpike.chatPerMin)}/min)
            </RecapHighlightButton>
          ) : null}
          {recap.funniestEmoteBurst ? (
            <RecapHighlightButton
              canJump={canJump}
              offsetSeconds={burstOffsetSeconds}
              onJumpToOffset={onJumpToOffset}
              onPreviewOffset={onPreviewOffset}
              ariaLabel={`Emote burst at ${formatHeatOffset(burstOffsetSeconds)}`}
              className="flex flex-wrap items-center gap-2"
              vodLink={(
                <RecapVodLink
                  offsetSeconds={burstOffsetSeconds}
                  vodId={vodId}
                  vodAlignSeconds={vodAlignSeconds}
                  vodDurationSeconds={vodDurationSeconds}
                />
              )}
            >
              {burstEmote ? <RecapEmoteChip emote={burstEmote} /> : null}
              <span className="min-w-0">
                Emote burst at{' '}
                <RecapOffsetTimestamp
                  offsetSeconds={burstOffsetSeconds}
                  vodId={vodId}
                  vodAlignSeconds={vodAlignSeconds}
                  vodDurationSeconds={vodDurationSeconds}
                  plain={canJump}
                />
                {recap.funniestEmoteBurst.code ? ` · ${recap.funniestEmoteBurst.code}` : ''} (
                {count(recap.funniestEmoteBurst.count)})
              </span>
            </RecapHighlightButton>
          ) : null}
        </div>
      ) : null}
      {topEmotes.length > 0 ? (
        <div className="mt-3 min-w-0">
          <div className="grid grid-cols-[minmax(0,1fr)_4rem_3rem] gap-2 border-b border-white/[0.07] py-2 text-xs font-semibold text-zinc-400">
            <span>Top emotes</span>
            <span>Provider</span>
            <span className="text-right">Uses</span>
          </div>
          <ul className="m-0 list-none p-0">
            {topEmotes.slice(0, 5).map((emote) => (
              <li key={emote.code}>
                <RecapEmoteRow emote={emote} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {/* No "top moment" button and no clip-candidate count here. The ranked
          Pulse Moments list sits directly below this panel in the same rail and
          row #1 is that same moment — restating it made one selection appear in
          four places at once. */}
    </section>
  )
}

function RecapHighlightButton({
  canJump,
  offsetSeconds,
  onJumpToOffset,
  onPreviewOffset,
  ariaLabel,
  className = '',
  vodLink,
  children,
}: {
  canJump: boolean
  offsetSeconds: number
  onJumpToOffset?: (offsetSeconds: number) => void
  onPreviewOffset?: (offsetSeconds: number | null) => void
  ariaLabel: string
  className?: string
  /** Shown beside the jump button; a link cannot sit inside it. */
  vodLink?: ReactNode
  children: ReactNode
}) {
  const baseClass =
    `w-full min-w-0 min-h-11 rounded px-2 py-2 text-left font-semibold text-zinc-300 transition ${className}`.trim()
  if (!canJump) {
    return <div className={baseClass}>{children}</div>
  }
  const button = (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={() => onJumpToOffset?.(offsetSeconds)}
      onMouseEnter={() => onPreviewOffset?.(offsetSeconds)}
      onFocus={() => onPreviewOffset?.(offsetSeconds)}
      onBlur={() => onPreviewOffset?.(null)}
      className={`${baseClass} cursor-pointer hover:border-white/10 hover:bg-white/[0.04]`}
    >
      {children}
    </button>
  )
  if (!vodLink) return button
  return <div className="flex min-w-0 items-center gap-1">{button}{vodLink}</div>
}

function recapVodHref(
  offsetSeconds: number,
  vodId: string | undefined,
  vodAlignSeconds: number | null | undefined,
  vodDurationSeconds: number | null | undefined,
): string | undefined {
  const id = vodId?.trim()
  const mappedOffset = alignedVodOffset(offsetSeconds, vodAlignSeconds, vodDurationSeconds)
  return id && mappedOffset !== undefined ? buildTwitchVodUrl(id, mappedOffset) : undefined
}

/** Sibling VOD link for a jumpable recap highlight. */
function RecapVodLink({
  offsetSeconds,
  vodId,
  vodAlignSeconds,
  vodDurationSeconds,
}: {
  offsetSeconds: number
  vodId?: string
  vodAlignSeconds?: number | null
  vodDurationSeconds?: number | null
}) {
  const href = recapVodHref(offsetSeconds, vodId, vodAlignSeconds, vodDurationSeconds)
  if (!href) return null
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={`Open ${formatHeatOffset(offsetSeconds)} in the Twitch VOD`}
      className="inline-flex min-h-11 shrink-0 items-center rounded px-2 text-xs font-black text-cyan-200 underline decoration-cyan-200/40 underline-offset-2 hover:text-cyan-100"
    >
      VOD ↗
    </a>
  )
}

/** Cyan offset — Twitch VOD deep link when vodId is known. */
export function RecapOffsetTimestamp({
  offsetSeconds,
  vodId,
  vodAlignSeconds,
  vodDurationSeconds,
  plain = false,
}: {
  offsetSeconds: number
  vodId?: string
  vodAlignSeconds?: number | null
  vodDurationSeconds?: number | null
  /** Text only, for use inside a button; the VOD link is rendered beside it. */
  plain?: boolean
}) {
  const label = formatHeatOffset(offsetSeconds)
  const href = plain ? undefined : recapVodHref(offsetSeconds, vodId, vodAlignSeconds, vodDurationSeconds)
  if (!href) {
    return <strong className="text-cyan-200">{label}</strong>
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="font-black text-cyan-200 underline decoration-cyan-200/40 underline-offset-2 hover:text-cyan-100"
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        event.stopPropagation()
      }}
    >
      {label}
    </a>
  )
}

function RecapEmoteChip({ emote }: { emote: PulseRecapEmote }) {
  const imageUrl = getEmoteImageUrl({
    provider: emote.provider,
    id: emote.id,
    imageUrl: emote.imageUrl,
  })
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded border border-white/[0.1] bg-white/[0.028] px-1.5 py-0.5 text-xs font-bold text-zinc-300">
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded bg-black/30 p-0.5">
        <ConsoleEmoteImg
          src={imageUrl}
          name={emote.code}
          className="max-h-full max-w-full object-contain"
          fallbackClassName="inline-flex h-3.5 w-3.5 items-center justify-center rounded bg-white/[0.06] text-xs font-black text-zinc-500"
        />
      </span>
      <span className="max-w-[6rem] truncate">{emote.code}</span>
      <span className="font-mono text-zinc-500">{count(emote.count)}</span>
    </span>
  )
}

function RecapEmoteRow({ emote }: { emote: PulseRecapEmote }) {
  const imageUrl = getEmoteImageUrl({
    provider: emote.provider,
    id: emote.id,
    imageUrl: emote.imageUrl,
  })
  const provider = emote.provider ?? 'unknown'
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_4rem_3rem] items-center gap-2 py-2 text-xs">
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-black/30 p-0.5">
          <ConsoleEmoteImg
            src={imageUrl}
            name={emote.code}
            className="max-h-full max-w-full object-contain"
            fallbackClassName="inline-flex h-4 w-4 items-center justify-center rounded bg-white/[0.06] text-xs font-black text-zinc-500"
          />
        </span>
        <span className="truncate font-semibold text-zinc-300" title={emote.code}>
          {emote.code}
        </span>
      </span>
      <span className="flex shrink-0 items-center self-center">
        <EmoteProviderBadge provider={provider} />
      </span>
      <span className="shrink-0 text-right font-mono text-xs font-semibold tabular-nums text-zinc-300">
        {count(emote.count)}
      </span>
    </div>
  )
}
