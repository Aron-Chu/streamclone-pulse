import { describe, expect, it } from 'vitest'
import { resolveOverlayHostVisibility } from '../src/content/resolveOverlayHostVisibility.ts'

const dockOn = { chatClosedPulseDockEnabled: true } as const
const dockOff = { chatClosedPulseDockEnabled: false } as const

describe('resolveOverlayHostVisibility', () => {
  it('hides hosts until placement preference is resolved', () => {
    expect(
      resolveOverlayHostVisibility({
        storedPlacement: 'sidebar',
        sidebarLayoutPresent: false,
        sidebarFallbackToFloat: false,
        placementResolved: false,
        ...dockOff,
      }),
    ).toEqual({
      effectivePlacement: 'sidebar',
      sidebarSnapped: false,
      mode: 'hidden',
    })
  })

  it('snaps to sidebar when layout is present regardless of dock setting', () => {
    expect(
      resolveOverlayHostVisibility({
        storedPlacement: 'sidebar',
        sidebarLayoutPresent: true,
        sidebarFallbackToFloat: false,
        placementResolved: true,
        ...dockOff,
      }),
    ).toEqual({
      effectivePlacement: 'sidebar',
      sidebarSnapped: true,
      mode: 'sidebar',
    })
  })

  it('waits hidden when chat is closed and dock setting is off', () => {
    expect(
      resolveOverlayHostVisibility({
        storedPlacement: 'sidebar',
        sidebarLayoutPresent: false,
        sidebarFallbackToFloat: false,
        placementResolved: true,
        ...dockOff,
      }),
    ).toEqual({
      effectivePlacement: 'sidebar',
      sidebarSnapped: false,
      mode: 'hidden',
    })
  })

  it('hides when chat is closed and dock is off even for right or bottom placement', () => {
    expect(
      resolveOverlayHostVisibility({
        storedPlacement: 'right',
        sidebarLayoutPresent: false,
        sidebarFallbackToFloat: false,
        placementResolved: true,
        ...dockOff,
      }),
    ).toEqual({
      effectivePlacement: 'right',
      sidebarSnapped: false,
      mode: 'hidden',
    })
    expect(
      resolveOverlayHostVisibility({
        storedPlacement: 'bottom',
        sidebarLayoutPresent: false,
        sidebarFallbackToFloat: true,
        placementResolved: true,
        ...dockOff,
      }),
    ).toEqual({
      effectivePlacement: 'bottom',
      sidebarSnapped: false,
      mode: 'hidden',
    })
  })

  it('falls back to floating right dock when chat is closed and dock setting is on', () => {
    expect(
      resolveOverlayHostVisibility({
        storedPlacement: 'sidebar',
        sidebarLayoutPresent: false,
        sidebarFallbackToFloat: true,
        placementResolved: true,
        ...dockOn,
      }),
    ).toEqual({
      effectivePlacement: 'right',
      sidebarSnapped: false,
      mode: 'floating',
    })
  })

  it('does not float when dock setting is off even after fallback timer', () => {
    expect(
      resolveOverlayHostVisibility({
        storedPlacement: 'sidebar',
        sidebarLayoutPresent: false,
        sidebarFallbackToFloat: true,
        placementResolved: true,
        ...dockOff,
      }),
    ).toEqual({
      effectivePlacement: 'sidebar',
      sidebarSnapped: false,
      mode: 'hidden',
    })
  })

  it('floats explicit right or bottom placement when chat is closed and dock is on', () => {
    expect(
      resolveOverlayHostVisibility({
        storedPlacement: 'right',
        sidebarLayoutPresent: false,
        sidebarFallbackToFloat: false,
        placementResolved: true,
        ...dockOn,
      }),
    ).toEqual({
      effectivePlacement: 'right',
      sidebarSnapped: false,
      mode: 'floating',
    })
    expect(
      resolveOverlayHostVisibility({
        storedPlacement: 'bottom',
        sidebarLayoutPresent: false,
        sidebarFallbackToFloat: false,
        placementResolved: true,
        ...dockOn,
      }),
    ).toEqual({
      effectivePlacement: 'bottom',
      sidebarSnapped: false,
      mode: 'floating',
    })
  })

  it('keeps sidebar snap when chat is open even if placement is bottom or right', () => {
    expect(
      resolveOverlayHostVisibility({
        storedPlacement: 'bottom',
        sidebarLayoutPresent: true,
        sidebarFallbackToFloat: false,
        placementResolved: true,
        ...dockOff,
      }),
    ).toEqual({
      effectivePlacement: 'sidebar',
      sidebarSnapped: true,
      mode: 'sidebar',
    })
    expect(
      resolveOverlayHostVisibility({
        storedPlacement: 'right',
        sidebarLayoutPresent: true,
        sidebarFallbackToFloat: true,
        placementResolved: true,
        ...dockOn,
      }),
    ).toEqual({
      effectivePlacement: 'sidebar',
      sidebarSnapped: true,
      mode: 'sidebar',
    })
  })

  it('hides hosts when placement preference is hidden', () => {
    expect(
      resolveOverlayHostVisibility({
        storedPlacement: 'hidden',
        sidebarLayoutPresent: false,
        sidebarFallbackToFloat: false,
        placementResolved: true,
        ...dockOn,
      }),
    ).toEqual({
      effectivePlacement: 'hidden',
      sidebarSnapped: false,
      mode: 'hidden',
    })
  })
})
