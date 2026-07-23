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
  return {
    top: openAbove
      ? Math.max(8, trigger.top - gap - menuHeight)
      : trigger.bottom + gap,
    right: Math.max(8, viewport.width - trigger.right),
    minWidth: Math.max(trigger.width, 120),
    placement: openAbove ? 'above' : 'below',
  }
}

export function isTriggerVisibleInScrollport(
  trigger: RectLike,
  scrollport: RectLike | null,
  viewport: ViewportLike,
): boolean {
  const clipTop = scrollport ? Math.max(0, scrollport.top) : 0
  const clipBottom = scrollport ? Math.min(viewport.height, scrollport.bottom) : viewport.height
  const clipLeft = scrollport ? Math.max(0, scrollport.left) : 0
  const clipRight = scrollport ? Math.min(viewport.width, scrollport.right) : viewport.width

  if (clipBottom <= clipTop || clipRight <= clipLeft) return false
  return !(
    trigger.bottom <= clipTop
    || trigger.top >= clipBottom
    || trigger.right <= clipLeft
    || trigger.left >= clipRight
  )
}

export function findScrollportElement(start: HTMLElement | null): HTMLElement | null {
  let node = start
  while (node) {
    if (node.classList?.contains('pulse-panel-body')) return node
    const style = typeof getComputedStyle === 'function' ? getComputedStyle(node) : null
    const overflowY = style?.overflowY ?? ''
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') {
      return node
    }
    const parent = node.parentElement
    if (!parent && node.getRootNode) {
      const root = node.getRootNode()
      if (typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot) {
        node = root.host as HTMLElement
        continue
      }
    }
    node = parent as HTMLElement | null
  }
  return null
}
