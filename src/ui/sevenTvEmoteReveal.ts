/** Collapsed picker page size; the CTA reveals at most this many next. */
export const EMOTE_PICKER_PAGE_SIZE = 6

/** How many emotes the "Show N more" button should claim for the next click. */
export function nextEmoteRevealCount(
  total: number,
  visibleLimit: number,
  pageSize = EMOTE_PICKER_PAGE_SIZE,
): number {
  const remaining = Math.max(0, total - Math.max(0, visibleLimit))
  return Math.min(Math.max(1, pageSize), remaining)
}
