import { useMemo, type MouseEvent, type ReactNode } from 'react'
import { formatHeatOffset } from '@streampulse/pulse-core'
import type { AnalyticsMinuteRollup, AnalyticsTopEmote, PulseRecapEmote, PulseStreamRecap } from '../../apiTypes.ts'
import {
  resolveRecapBurstHighlight,
  resolveRecapDisplayEmotes,
} from '../../utils/recapEmoteEnrich.ts'
import { count, getEmoteImageUrl } from '../../utils/consoleFormat.ts'
import { buildTwitchVodUrl } from '../../utils/twitchVodUrl.ts'
import { ConsoleEmoteImg } from './ConsoleEmoteImg.tsx'
import { EmoteProviderBadge } from './ConsoleBits.tsx'

export function StreamRecapPanel({
  recap,
  topEmotesCatalog,
  rollups,
  streamStartedAt,
  vodId,
  vodAlignSeconds,
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
  onJumpToOffset?: (offsetSeconds: number) => void
  onPreviewOffset?: (offsetSeconds: number | null) => void
}) {
  const topMoments = recap.topMoments ?? []
  const topEmotes = useMemo(
    () => resolveRecapDisplayEmotes(recap.topEmotes ?? [], topEmotesCatalog, 10),
    [recap.topEmotes, topEmotesCatalog],
  )
  const clipCandidates = recap.clipCandidates ?? []
  const topMoment = topMoments[0]
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
      className="w-full rounded border border-white/[0.07] bg-white/[0.025] p-4"
      data-stream-recap-panel
    >
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-xs font-black uppercase text-zinc-400">Stream Recap</h3>
          <p className="mt-1 text-[10px] font-semibold leading-relaxed text-zinc-500">
            Session highlights from Pulse rollups
          </p>
        </div>
        {topMoment ? (
          <span className="shrink-0 rounded border border-amber-400/20 bg-amber-500/10 px-2 py-1 text-[10px] font-black text-amber-200">
            Top {topMoment.score}
          </span>
        ) : null}
      </div>
      {hasHeadlineMetric ? (
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="min-h-[3.5rem] rounded border border-white/5 bg-white/[0.022] p-2.5 leading-snug">
            <div className="text-[10px] font-black uppercase text-zinc-500">Messages</div>
            <div className="mt-1 font-black text-zinc-200">{count(recap.totalMessages)}</div>
          </div>
          <div className="min-h-[3.5rem] rounded border border-white/5 bg-white/[0.022] p-2.5 leading-snug">
            <div className="text-[10px] font-black uppercase text-zinc-500">Peak Chat</div>
            <div className="mt-1 font-black text-zinc-200">{count(recap.peakChatPerMin)}/min</div>
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
            >
              Biggest spike at{' '}
              <RecapOffsetTimestamp
                offsetSeconds={recap.biggestChatSpike.offsetSeconds}
                vodId={vodId}
                vodAlignSeconds={vodAlignSeconds}
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
            >
              {burstEmote ? <RecapEmoteChip emote={burstEmote} /> : null}
              <span className="min-w-0">
                Emote burst at{' '}
                <RecapOffsetTimestamp
                  offsetSeconds={burstOffsetSeconds}
                  vodId={vodId}
                  vodAlignSeconds={vodAlignSeconds}
                />
                {recap.funniestEmoteBurst.code ? ` · ${recap.funniestEmoteBurst.code}` : ''} (
                {count(recap.funniestEmoteBurst.count)})
              </span>
            </RecapHighlightButton>
          ) : null}
        </div>
      ) : null}
      {topEmotes.length > 0 ? (
        <div className="mt-4 overflow-hidden rounded border border-white/[0.07]">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2 border-b border-white/[0.07] bg-white/[0.015] px-2 py-1.5 text-[10px] font-black uppercase text-zinc-500">
            <span>Top 7TV</span>
            <span>Provider</span>
            <span className="text-right">Uses</span>
          </div>
          <ul>
            {topEmotes.slice(0, 5).map((emote) => (
              <li key={emote.code}>
                <RecapEmoteRow emote={emote} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {topMoment && onJumpToOffset ? (
        <button
          type="button"
          onClick={() => onJumpToOffset(topMoment.offsetSeconds)}
          onMouseEnter={() => onPreviewOffset?.(topMoment.offsetSeconds)}
          onMouseLeave={() => onPreviewOffset?.(null)}
          className="mt-4 w-full rounded border border-white/[0.07] bg-white/[0.022] px-3 py-2 text-left text-[10px] font-semibold leading-relaxed text-zinc-400 transition hover:bg-white/[0.04]"
        >
          Top moment at{' '}
          <strong className="font-black text-amber-200">{formatHeatOffset(topMoment.offsetSeconds)}</strong>
          {' · '}
          score <strong className="font-black text-amber-200">{topMoment.score}</strong>
          <span className="text-zinc-500"> — jump on chart</span>
        </button>
      ) : null}
      {clipCandidates.length > 0 ? (
        <p className="mt-3 text-[10px] font-semibold leading-relaxed text-zinc-500">
          {clipCandidates.length} clip candidate{clipCandidates.length === 1 ? '' : 's'} from Pulse scores
          {' · '}
          see Moments tab for the full ranked list
        </p>
      ) : null}
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
  children,
}: {
  canJump: boolean
  offsetSeconds: number
  onJumpToOffset?: (offsetSeconds: number) => void
  onPreviewOffset?: (offsetSeconds: number | null) => void
  ariaLabel: string
  className?: string
  children: ReactNode
}) {
  const baseClass =
    `w-full rounded border border-white/5 bg-white/[0.022] px-3 py-2 text-left font-semibold text-zinc-400 transition ${className}`.trim()
  if (!canJump) {
    return <div className={baseClass}>{children}</div>
  }
  return (
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
}

/** Cyan offset — Twitch VOD deep link when vodId is known. */
export function RecapOffsetTimestamp({
  offsetSeconds,
  vodId,
  vodAlignSeconds,
}: {
  offsetSeconds: number
  vodId?: string
  vodAlignSeconds?: number | null
}) {
  const label = formatHeatOffset(offsetSeconds)
  const id = vodId?.trim()
  const hasVerifiedAlignment = typeof vodAlignSeconds === 'number' && Number.isFinite(vodAlignSeconds)
  if (!id || !hasVerifiedAlignment) {
    return <strong className="text-cyan-200">{label}</strong>
  }
  return (
    <a
      href={buildTwitchVodUrl(id, Math.max(0, vodAlignSeconds + offsetSeconds))}
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
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded border border-white/[0.07] bg-white/[0.028] px-1.5 py-0.5 text-[10px] font-bold text-zinc-400">
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded bg-black/30 p-0.5">
        <ConsoleEmoteImg
          src={imageUrl}
          name={emote.code}
          className="max-h-full max-w-full object-contain"
          fallbackClassName="inline-flex h-3.5 w-3.5 items-center justify-center rounded bg-white/[0.06] text-[8px] font-black text-zinc-500"
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
  const provider = emote.provider ?? 'seventv'
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 border-b border-white/5 px-2 py-1.5 text-xs last:border-b-0">
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-black/30 p-0.5">
          <ConsoleEmoteImg
            src={imageUrl}
            name={emote.code}
            className="max-h-full max-w-full object-contain"
            fallbackClassName="inline-flex h-4 w-4 items-center justify-center rounded bg-white/[0.06] text-[8px] font-black text-zinc-500"
          />
        </span>
        <span className="truncate font-semibold text-zinc-300" title={emote.code}>
          {emote.code}
        </span>
      </span>
      <span className="flex shrink-0 items-center self-center">
        <EmoteProviderBadge provider={provider} />
      </span>
      <span className="shrink-0 text-right font-mono text-[11px] font-semibold tabular-nums text-zinc-400">
        {count(emote.count)}
      </span>
    </div>
  )
}
