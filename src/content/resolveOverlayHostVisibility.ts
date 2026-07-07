import type { OverlayPlacement } from '../shared/storage.ts'

export const SIDEBAR_FLOAT_FALLBACK_MS = 800

export interface OverlayHostVisibilityInput {
  storedPlacement: OverlayPlacement
  sidebarLayoutPresent: boolean
  sidebarFallbackToFloat: boolean
  placementResolved: boolean
  chatClosedPulseDockEnabled: boolean
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
  } = input

  if (!placementResolved) {
    return { effectivePlacement: storedPlacement, sidebarSnapped: false, mode: 'hidden' }
  }

  if (storedPlacement === 'hidden') {
    return { effectivePlacement: 'hidden', sidebarSnapped: false, mode: 'hidden' }
  }

  if (storedPlacement !== 'sidebar') {
    return { effectivePlacement: storedPlacement, sidebarSnapped: false, mode: 'floating' }
  }

  if (sidebarLayoutPresent) {
    return { effectivePlacement: 'sidebar', sidebarSnapped: true, mode: 'sidebar' }
  }

  if (chatClosedPulseDockEnabled && sidebarFallbackToFloat) {
    return { effectivePlacement: 'right', sidebarSnapped: false, mode: 'floating' }
  }

  return { effectivePlacement: 'sidebar', sidebarSnapped: false, mode: 'hidden' }
}
