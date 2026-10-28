/**
 * As tall as the loaded chart block (720 px), so the page under it does not jump when the chart lands.
 *
 * Its first line sits where the chart's readout will be, in the readout's own style. On a phone the readout is the
 * largest text on screen and used to paint only with the chart, so the page's largest paint waited for all the data;
 * this line paints with the skeleton. It fits a 384 px skeleton too: the bars below need 288 px at least.
 */
export function AnalyticsConsoleDataSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading analytics chart"
      data-console-skeleton="chart"
      className="flex min-h-[45rem] animate-pulse flex-col rounded border border-white/[0.07] bg-white/[0.025] p-4"
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
