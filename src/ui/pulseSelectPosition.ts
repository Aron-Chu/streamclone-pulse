export type RectLike = {
  top: number
  bottom: number
  left: number
  right: number
  width: number
  height: number
}

export type ViewportLike = {
  width: number
  height: number
}

export function computeSelectMenuPosition(
  trigger: RectLike,
  menuHeight: number,
  viewport: ViewportLike,
  gap = 4,
): { top: number; right: number; minWidth: number; placement: 'above' | 'below' } {
  const spaceBelow = viewport.height - trigger.bottom - gap
  const openAbove = spaceBelow < menuHeight && trigger.top > spaceBelow
  const top = openAbove
    ? Math.max(8, trigger.top - gap - menuHeight)
    : trigger.bottom + gap
  return {
    top,
    right: Math.max(8, viewport.width - trigger.right),
    minWidth: Math.max(trigger.width, 120),
    placement: openAbove ? 'above' : 'below',
  }
}

/** True when trigger has any intersection with the viewport (and optional scrollport). */
export function isTriggerVisibleInScrollport(
  trigger: RectLike,
  scrollport: RectLike | null,
  viewport: ViewportLike,
): boolean {
  const viewTop = 0
  const viewBottom = viewport.height
  const viewLeft = 0
  const viewRight = viewport.width

  const clipTop = scrollport ? Math.max(viewTop, scrollport.top) : viewTop
  const clipBottom = scrollport ? Math.min(viewBottom, scrollport.bottom) : viewBottom
  const clipLeft = scrollport ? Math.max(viewLeft, scrollport.left) : viewLeft
  const clipRight = scrollport ? Math.min(viewRight, scrollport.right) : viewRight

  if (clipBottom <= clipTop || clipRight <= clipLeft) return false

  return !(
    trigger.bottom <= clipTop
    || trigger.top >= clipBottom
    || trigger.right <= clipLeft
    || trigger.left >= clipRight
  )
}

export function findScrollportElement(start: HTMLElement | null): HTMLElement | null {
  let node: HTMLElement | null = start
  while (node) {
    if (node.classList?.contains('pulse-panel-scroll')) return node
    const style = typeof getComputedStyle === 'function' ? getComputedStyle(node) : null
    const overflowY = style?.overflowY ?? ''
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') {
      return node
    }
    const parent: Element | null = node.parentElement
    // Cross into shadow host when walking up from a light-DOM node inside shadow.
    if (!parent && node.getRootNode) {
      const root = node.getRootNode()
      if (root instanceof ShadowRoot) {
        node = root.host as HTMLElement
        continue
      }
    }
    node = parent as HTMLElement | null
  }
  return null
}
