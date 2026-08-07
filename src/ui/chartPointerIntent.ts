export type ChartPointerIntent = 'pending' | 'horizontal' | 'vertical'
export type ChartSelectionAction = 'lock' | 'clear'

export function canLockChartBucket(bucket: { missing?: boolean } | null | undefined): boolean {
  return bucket != null && bucket.missing !== true
}

export function resolveChartPointerIntent(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
  threshold = 6,
): ChartPointerIntent {
  const dx = Math.abs(currentX - startX)
  const dy = Math.abs(currentY - startY)
  if (dx < threshold && dy < threshold) return 'pending'
  if (dx > dy) return 'horizontal'
  if (dy > dx) return 'vertical'
  return 'pending'
}

/** Local chart input has precedence over list preview and the existing lock. */
export function resolveChartInspectionTarget(args: {
  localHoverOffset: number | null | undefined
  externalPreviewOffset: number | null | undefined
  lockedOffset: number | null | undefined
}): number | null {
  return args.localHoverOffset
    ?? args.externalPreviewOffset
    ?? args.lockedOffset
    ?? null
}

export function resolveChartSelectionAction(args: {
  index: number
  selectedIndex: number | null | undefined
  lockedIndex: number | null | undefined
}): ChartSelectionAction {
  return args.selectedIndex === args.index || args.lockedIndex === args.index ? 'clear' : 'lock'
}
