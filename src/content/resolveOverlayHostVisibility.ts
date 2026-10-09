import type { OverlayPlacement, SidebarTab } from '../shared/storage.ts'

export const SIDEBAR_FLOAT_FALLBACK_MS = 800

/** Sidebar panels narrower than this use the compact metrics row (Overlay). */
export const SIDEBAR_COMPACT_WIDTH = 360

/**
 * Whether a sidebar layout change needs a React render, or only new host
 * styles. The panel reads the layout only to pick the compact metrics row, so
 * a move or resize inside the same width class restyles the hosts and leaves
 * the Overlay tree alone.
 */
export function snapLayoutNeedsRender(
  previous: { readonly panel: { readonly width: number } } | null,
  next: { readonly panel: { readonly width: number } } | null,
): boolean {
  return !previous || !next
    || (previous.panel.width < SIDEBAR_COMPACT_WIDTH) !== (next.panel.width < SIDEBAR_COMPACT_WIDTH)
}

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

  if (storedPlacement !== 'sidebar') {
    return { effectivePlacement: storedPlacement, sidebarSnapped: false, mode: 'floating' }
  }

  if (sidebarLayoutPresent) {
    return { effectivePlacement: 'sidebar', sidebarSnapped: true, mode: 'sidebar' }
  }

  if (chatClosedPulseDockEnabled && sidebarFallbackToFloat && sidebarTab === 'pulse') {
    return { effectivePlacement: 'right', sidebarSnapped: false, mode: 'floating' }
  }

  return { effectivePlacement: 'sidebar', sidebarSnapped: false, mode: 'hidden' }
}
