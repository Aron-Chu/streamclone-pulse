import type { KeyboardEvent } from 'react'

/** Implements the WAI-ARIA horizontal tabs keyboard pattern. */
export function activateRovingTab(event: KeyboardEvent<HTMLButtonElement>): void {
  const tablist = event.currentTarget.closest('[role="tablist"]')
  if (!tablist) return
  const tabs = Array.from(tablist.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'))
  const currentIndex = tabs.indexOf(event.currentTarget)
  if (currentIndex < 0 || tabs.length === 0) return

  let nextIndex: number | null = null
  switch (event.key) {
    case 'ArrowRight':
    case 'ArrowDown':
      nextIndex = (currentIndex + 1) % tabs.length
      break
    case 'ArrowLeft':
    case 'ArrowUp':
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length
      break
    case 'Home':
      nextIndex = 0
      break
    case 'End':
      nextIndex = tabs.length - 1
      break
    default:
      return
  }

  event.preventDefault()
  tabs[nextIndex].focus()
  tabs[nextIndex].click()
}
