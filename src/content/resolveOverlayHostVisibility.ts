import type { OverlayPlacement, SidebarTab } from '../shared/storage.ts'

export const SIDEBAR_FLOAT_FALLBACK_MS = 800

export interface OverlayHostVisibilityInput {
  storedPlacement: OverlayPlacement
  sidebarLayoutPresent: boolean
  sidebarFallbackToFloat: boolean
  placementResolved: boolean
  chatClosedPulseDockEnabled: boolean
  sidebarTab?: SidebarTab
}

export type OverlayHostVisibilityMode = 'hidden' | 'sidebar' | 'floating'

export interface OverlayHostVisibility {
  effectivePlacement: OverlayPlacement
  sidebarSnapped: boolean
  mode: OverlayHostVisibilityMode
}

export function resolveOverlayHostVisibility(input: OverlayHostVisibilityInput): OverlayHostVisibility {
  const {
    storedPlacement,
    sidebarLayoutPresent,
    sidebarFallbackToFloat,
    placementResolved,
    chatClosedPulseDockEnabled,
    sidebarTab = 'pulse',
  } = input

  if (!placementResolved) {
    return { effectivePlacement: storedPlacement, sidebarSnapped: false, mode: 'hidden' }
  }

  if (storedPlacement === 'hidden') {
    return { effectivePlacement: 'hidden', sidebarSnapped: false, mode: 'hidden' }
  }

  // Chat column present: always CHAT/PULSE sidebar chrome (ignore right/bottom prefs).
  if (sidebarLayoutPresent) {
    return { effectivePlacement: 'sidebar', sidebarSnapped: true, mode: 'sidebar' }
  }

  // Chat column absent: floating dock only when the chat-closed dock toggle is on.
  if (!chatClosedPulseDockEnabled) {
    return { effectivePlacement: storedPlacement, sidebarSnapped: false, mode: 'hidden' }
  }

  if (storedPlacement === 'right' || storedPlacement === 'bottom') {
    return { effectivePlacement: storedPlacement, sidebarSnapped: false, mode: 'floating' }
  }

  // Sidebar preference + dock on: optional floating right fallback after timer.
  if (sidebarFallbackToFloat && sidebarTab === 'pulse') {
    return { effectivePlacement: 'right', sidebarSnapped: false, mode: 'floating' }
  }

  return { effectivePlacement: 'sidebar', sidebarSnapped: false, mode: 'hidden' }
}
