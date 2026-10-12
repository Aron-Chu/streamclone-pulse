import { describe, expect, it } from 'vitest'
import {
  resolveOverlayHostVisibility,
  SIDEBAR_COMPACT_WIDTH,
  snapLayoutNeedsRender,
} from '../src/content/resolveOverlayHostVisibility.ts'

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

  it('uses floating placement for non-sidebar preferences', () => {
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
      mode: 'floating',
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

describe('snapLayoutNeedsRender', () => {
  const layout = (width: number) => ({ panel: { width } })

  it('renders when the sidebar layout appears or disappears', () => {
    expect(snapLayoutNeedsRender(null, layout(340))).toBe(true)
    expect(snapLayoutNeedsRender(layout(340), null)).toBe(true)
    expect(snapLayoutNeedsRender(null, null)).toBe(true)
  })

  it('only restyles the hosts for a move or resize inside the same width class', () => {
    expect(snapLayoutNeedsRender(layout(340), layout(340))).toBe(false)
    expect(snapLayoutNeedsRender(layout(340), layout(300))).toBe(false)
    expect(snapLayoutNeedsRender(layout(420), layout(500))).toBe(false)
  })

  it('renders when the panel crosses the compact metrics width', () => {
    expect(SIDEBAR_COMPACT_WIDTH).toBe(360)
    expect(snapLayoutNeedsRender(layout(359), layout(360))).toBe(true)
    expect(snapLayoutNeedsRender(layout(420), layout(340))).toBe(true)
  })
})
