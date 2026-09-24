import { momentRankAccent, momentReasonChipTone } from '../../utils/momentListDisplay.tsx'
import { count, getEmoteImageUrl } from '../../utils/consoleFormat.ts'
import { ConsoleEmoteImg } from './ConsoleEmoteImg.tsx'

export interface MomentRowEmote {
  name: string
  count: number
  provider?: string
  id?: string
  imageUrl?: string
  /** Canonical `provider:id` key when the source row carries one. */
  key?: string
}

export interface MomentRowModel {
  key: string
  /** 1-based rank within the visible list. */
  rank: number
  primaryTime: string
  secondaryTime?: string | null
  score: number
  /** Score as a fraction of the top-ranked moment in this list. */
  scoreRatio: number
  reasonLabel: string
  reasonCode: string
  statsLine: string
  /** True when the row describes the detection window, not a measured minute. */
  snapshotOnly?: boolean
  /** Extra provenance appended to the row tooltip, e.g. an estimated score. */
  scoreNote?: string
  emotes: MomentRowEmote[]
}

/**
 * Reaction intensity relative to this stream's own top moment.
 *
 * The raw Pulse score is out of 100 but is not a grade — a stream whose loudest
 * minute scores 49 still has a loudest minute. Rendering `49/100` made the top
 * row read as a failure, so the bar is scaled to the list maximum and the raw
 * number stays available but de-emphasised.
 */
function MomentIntensityBar({ ratio, score }: { ratio: number; score: number }) {
  const clamped = Math.max(0, Math.min(1, ratio))
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <span
        aria-hidden="true"
        className="relative block h-1.5 w-10 overflow-hidden rounded-full bg-white/[0.08]"
      >
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-amber-400/70"
          style={{ width: `${Math.max(6, clamped * 100)}%` }}
        />
      </span>
      <span className="w-5 text-right text-xs font-black tabular-nums text-zinc-500">
        {score}
      </span>
    </span>
  )
}

/**
 * The one moment row design. Both the recap-backed rail list and the
 * rollup-backed fallback list render through this so a moment never looks like
 * two different things depending on which data path produced it.
 */
export function MomentRow({
  model,
  selected,
  previewed = false,
  expanded = false,
  onSelect,
  onPreview,
}: {
  model: MomentRowModel
  selected: boolean
  previewed?: boolean
  expanded?: boolean
  onSelect: () => void
  onPreview?: (hovering: boolean) => void
}) {
  const reasonTone = momentReasonChipTone(model.reasonCode)
  const tone = selected
    ? 'border-amber-500/25 bg-amber-500/10 ring-1 ring-amber-400/15'
    : previewed
      ? 'border-amber-300/20 bg-amber-500/[0.05]'
      : 'border-white/[0.07] bg-white/[0.028] hover:bg-white/[0.04]'

  return (
    <button
      type="button"
      data-moment-row
      data-moment-rank={model.rank}
      aria-expanded={expanded}
      aria-current={selected ? 'true' : undefined}
      onClick={onSelect}
      onMouseEnter={() => onPreview?.(true)}
      onMouseLeave={() => onPreview?.(false)}
      onFocus={() => onPreview?.(true)}
      onBlur={() => onPreview?.(false)}
      title={`${model.reasonLabel} · Pulse reaction score ${model.score} of 100 — ranks reactions, not clip quality${
        model.scoreNote ? ` · ${model.scoreNote}` : ''
      }`}
      className={`flex w-full flex-col gap-1 rounded border px-2 py-1.5 text-left text-xs transition-colors ${tone}${
        selected ? ' sc-moment-row-selected' : ''
      }`}
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            className={`inline-flex h-4 min-w-[1.25rem] shrink-0 items-center justify-center rounded px-1 text-xs font-black tabular-nums ${momentRankAccent(model.rank - 1).badge}`}
          >
            #{model.rank}
          </span>
          <span className="font-mono text-xs font-bold tabular-nums text-zinc-300">
            {model.primaryTime}
          </span>
          {model.secondaryTime ? (
            <span className="truncate text-xs font-semibold text-zinc-600">
              {model.secondaryTime}
            </span>
          ) : null}
        </span>
        <MomentIntensityBar ratio={model.scoreRatio} score={model.score} />
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-1">
        <span
          className={`inline-flex max-w-full shrink-0 truncate rounded border px-1.5 py-0.5 text-xs font-black uppercase ${reasonTone.chip}`}
        >
          {model.reasonLabel}
        </span>
        {model.snapshotOnly ? (
          <span
            title="No measured minute lines up with this detection, so the numbers come from the detection window itself."
            className="inline-flex shrink-0 rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-xs font-black uppercase text-zinc-500"
          >
            Snapshot
          </span>
        ) : null}
      </div>

      <div className="min-w-0 truncate text-xs font-semibold tabular-nums text-zinc-500">
        {model.statsLine}
      </div>

      {model.emotes.length > 0 ? (
        <div className="flex min-w-0 items-center gap-1">
          {model.emotes.map((emote, emoteIndex) => (
            <span
              key={`${model.key}-${emote.key ?? emote.name}-${emoteIndex}`}
              title={`${emote.name}: ${count(emote.count)} uses`}
              aria-label={`${emote.name}: ${count(emote.count)} uses`}
              className="inline-flex shrink-0 items-center gap-1 rounded border border-white/10 bg-black/25 py-0.5 pl-0.5 pr-1.5"
            >
              <ConsoleEmoteImg
                src={getEmoteImageUrl(emote)}
                name={emote.name}
                width={14}
                height={14}
                className="h-3.5 w-3.5 shrink-0 object-contain"
                fallbackClassName="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded bg-white/[0.06] text-xs font-black text-zinc-500"
              />
              <span className="text-xs font-bold tabular-nums text-zinc-500">
                {count(emote.count)}
              </span>
            </span>
          ))}
        </div>
      ) : null}
    </button>
  )
}

/** Shared legend so the intensity bar is never an unexplained decoration. */
export function MomentListLegend() {
  return (
    <p className="text-xs font-semibold text-zinc-600">
      Select a moment to review its minute and watch the source. The bar shows reaction
      intensity relative to this stream&rsquo;s loudest moment — Pulse ranks reactions, not
      clip quality.
    </p>
  )
}
