/**
 * Reserve a representative initial chart with one short named emote: 818 px below 610 px (toolbar wraps),
 * 786 px at 610-639 px, 778 px at 640-719 px, 878 px from 720 px (taller plot), and 874 px in the desktop
 * columns from 1280 px. The accessible emote bar reserves 44 px touch rows. Long names, additional emotes,
 * games and other content can wrap to more rows; this is not an all-data zero-layout-shift guarantee.
 *
 * Z01 (round 2): with `minuteTableOutside` (one column, under 1280 px) the "Minute-by-minute table" line
 * (12 px gap + 44 px summary) sits after the chart region, so each reserve under 1280 px is 56 px shorter:
 * 762, 730, 722 and 822 px. Desktop keeps 874 px.
 *
 * A readout-styled loading line paints before the data; its text stays out of the spoken status.
 */
export function AnalyticsConsoleDataSkeleton({ minuteTableOutside = false }: { minuteTableOutside?: boolean } = {}) {
  const reserve = minuteTableOutside
    ? 'min-h-[47.625rem] min-[610px]:min-h-[45.625rem] sm:min-h-[45.125rem] min-[720px]:min-h-[51.375rem]'
    : 'min-h-[51.125rem] min-[610px]:min-h-[49.125rem] sm:min-h-[48.625rem] min-[720px]:min-h-[54.875rem]'
  return (
    <div
      role="status"
      aria-label="Loading analytics chart"
      data-console-skeleton="chart"
      className={`flex ${reserve} xl:min-h-[54.625rem] animate-pulse flex-col rounded border border-white/[0.07] bg-white/[0.025] p-4`}
    >
      <span className="sr-only">Loading analytics chart</span>
      <div className="ssc-head" aria-hidden="true">
        <div className="ssc ssc-top">
          <div className="ssc-ro-row">
            <p className="ssc-ro" data-console-skeleton-readout="">
              Latest · loading viewers, chat and emotes for every minute of this stream
            </p>
          </div>
        </div>
      </div>
      <div className="flex min-h-72 flex-1 flex-col justify-between gap-6" aria-hidden="true">
        <div className="space-y-3">
          <div className="h-4 w-40 rounded bg-zinc-800/80" />
          <div className="h-3 w-64 max-w-full rounded bg-zinc-800/60" />
        </div>
        <div className="flex min-h-52 flex-1 items-end gap-3 border-b border-l border-white/[0.07] px-3">
          <div className="h-20 flex-1 rounded-t bg-violet-500/10" />
          <div className="h-36 flex-1 rounded-t bg-cyan-500/10" />
          <div className="h-28 flex-1 rounded-t bg-violet-500/10" />
          <div className="h-44 flex-1 rounded-t bg-cyan-500/10" />
          <div className="h-24 flex-1 rounded-t bg-violet-500/10" />
        </div>
      </div>
    </div>
  )
}

/**
 * As tall as a full Stream Recap on desktop and phone (title, two totals, two one-line highlight rows,
 * five top emotes: 456 px), so the Moments tabs under it do not jump when the recap lands.
 * Silent: the chart skeleton speaks for the loading page.
 */
export function StreamRecapSkeleton() {
  return (
    <div
      aria-hidden="true"
      data-console-skeleton="recap"
      className="min-h-[28.5rem] w-full min-w-0 animate-pulse rounded border border-white/[0.07] bg-white/[0.025] p-3"
    >
      <div className="h-4 w-28 rounded bg-zinc-800/80" />
    </div>
  )
}
