/**
 * Focus across a layout switch (D1, 11-13; round 6, 11-14). Crossing the phone breakpoint moves an
 * open moment's watch row to another parent, which remounts its controls. Each control that moves
 * carries a stable `data-focus-key` (Save, Open VOD, Watch live now, the watch link). The group that
 * is removed notes the key that held focus, and the group that replaces it focuses the same key, so
 * focus stays on the same control, as when nothing moved.
 */
let carried: { scope: string; key: string; at: number } | null = null

/** How long a carry waits: the remount happens in the same commit, so a second is plenty. */
const CARRY_MS = 1000

/** The focus key of the element holding focus, when it is inside `root`. */
export function focusKeyWithin(root: Element | null): string | null {
  const active = document.activeElement
  if (!root || !active || !root.contains(active)) return null
  return active.closest('[data-focus-key]')?.getAttribute('data-focus-key') ?? null
}

/** Notes the control that held focus in a group about to be removed. A missing key leaves any carry in place. */
export function noteCarriedFocus(scope: string, key: string | null): void {
  if (key) carried = { scope, key, at: Date.now() }
}

/**
 * Gives focus back to the carried control when it is inside `root`, the carry is this group's and fresh,
 * and focus has fallen to the page. A carry this root does not hold waits for a wider one in the same commit.
 */
export function restoreCarriedFocus(scope: string, root: ParentNode | null): void {
  const carry = carried
  if (!carry || !root) return
  const active = document.activeElement
  if (carry.scope !== scope || Date.now() - carry.at >= CARRY_MS || (active && active !== document.body)) {
    carried = null
    return
  }
  const target = root.querySelector<HTMLElement>(`[data-focus-key="${carry.key}"]`)
  if (!target) return
  carried = null
  target.focus()
}
