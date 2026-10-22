/**
 * Where the emote map's and the rack's hover cards go (mockup hub-emap.js /
 * hub-r4.js gameCard): right of the item, else left of it; with no room either
 * side, centred under it (over it when there is no room under); always 8 px
 * inside the window.
 */
export function placeHubV5Card(card: HTMLElement, el: Element, within?: Element | null): void {
  let r: Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom' | 'width'> = el.getBoundingClientRect()
  // a zoomed emote tile can be bigger than its map: go by the part on show
  if (within) {
    const b = within.getBoundingClientRect()
    const left = Math.max(r.left, b.left)
    const top = Math.max(r.top, b.top)
    const right = Math.min(r.right, b.right)
    const bottom = Math.min(r.bottom, b.bottom)
    if (right > left && bottom > top) r = { left, top, right, bottom, width: right - left }
  }
  const w = card.offsetWidth
  const h = card.offsetHeight
  const m = 8
  const vw = window.innerWidth
  const vh = window.innerHeight
  let x = r.right + m
  let y = r.top
  if (x + w > vw - m) x = r.left - w - m
  if (x < m) {
    x = Math.min(Math.max(m, r.left + r.width / 2 - w / 2), vw - w - m)
    y = r.bottom + m
    if (y + h > vh - m) y = r.top - h - m
  }
  y = Math.min(Math.max(m, y), vh - h - m)
  card.style.left = `${Math.round(x)}px`
  card.style.top = `${Math.round(y)}px`
  card.style.visibility = ''
}

export const isFocusVisible = (el: Element | null | undefined): boolean => {
  if (!el) return false
  try {
    return el.matches(':focus-visible')
  } catch {
    return false
  }
}
