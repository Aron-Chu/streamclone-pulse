export function AnalyticsConsoleDataSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading analytics chart"
      data-console-skeleton="chart"
      className="min-h-96 animate-pulse rounded border border-white/[0.07] bg-white/[0.025] p-4"
    >
      <span className="sr-only">Loading analytics chart</span>
      <div className="flex h-full min-h-80 flex-col justify-between gap-6" aria-hidden="true">
        <div className="space-y-3">
          <div className="h-4 w-40 rounded bg-zinc-800/80" />
          <div className="h-3 w-64 max-w-full rounded bg-zinc-800/60" />
        </div>
        <div className="flex min-h-52 items-end gap-3 border-b border-l border-white/[0.07] px-3">
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
