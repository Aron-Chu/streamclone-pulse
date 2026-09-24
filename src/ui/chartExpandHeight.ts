/** Shared Stream activity Expand / Reset heights. Live, offline recap, and VOD recap must stay in lockstep. */
export function chartExpandTargetHeight(opts: {
  sidebarFill: boolean
  expanded: boolean
}): number {
  if (opts.sidebarFill) {
    return opts.expanded ? 312 : 216
  }
  return opts.expanded ? 268 : 184
}
