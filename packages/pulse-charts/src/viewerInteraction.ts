/** Keep only the measured viewer history through the active hover bucket. */
export function viewerHistoryValues(
  values: Array<number | null>,
  activeIndex: number | null,
): Array<number | null> {
  if (activeIndex == null || activeIndex < 0 || values.length === 0) return []
  const end = Math.min(values.length - 1, Math.floor(activeIndex))
  return values.map((value, index) => (index <= end ? value : null))
}

export type ViewerInteractionState =
  | 'rest'
  | 'hover-preview'
  | 'scrub'
  | 'locked'
  | 'locked-preview'

export function resolveViewerInteractionState(input: {
  hoverIndex: number | null
  selectedIndex: number | null
  scrubbing?: boolean
}): ViewerInteractionState {
  if (input.scrubbing) return 'scrub'
  if (input.selectedIndex != null && input.hoverIndex != null && input.selectedIndex !== input.hoverIndex) {
    return 'locked-preview'
  }
  if (input.selectedIndex != null) return 'locked'
  if (input.hoverIndex != null) return 'hover-preview'
  return 'rest'
}
