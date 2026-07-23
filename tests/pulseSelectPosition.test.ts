import { describe, expect, it } from 'vitest'
import {
  computeSelectMenuPosition,
  isTriggerVisibleInScrollport,
} from '../src/ui/pulseSelectPosition.ts'

describe('pulseSelectPosition', () => {
  it('opens below when there is enough space', () => {
    const position = computeSelectMenuPosition(
      { top: 100, bottom: 130, left: 50, right: 200, width: 150, height: 30 },
      120,
      { width: 800, height: 600 },
    )
    expect(position).toMatchObject({ placement: 'below', top: 134, minWidth: 150 })
  })

  it('opens above when space below is short', () => {
    const position = computeSelectMenuPosition(
      { top: 500, bottom: 530, left: 50, right: 200, width: 150, height: 30 },
      200,
      { width: 800, height: 560 },
    )
    expect(position.placement).toBe('above')
    expect(position.top).toBeLessThan(500)
  })

  it('treats partial overlap with the scrollport as visible', () => {
    expect(
      isTriggerVisibleInScrollport(
        { top: 90, bottom: 120, left: 10, right: 100, width: 90, height: 30 },
        { top: 100, bottom: 400, left: 0, right: 300, width: 300, height: 300 },
        { width: 800, height: 600 },
      ),
    ).toBe(true)
  })

  it('closes when the trigger is outside the scrollport clip', () => {
    const scrollport = { top: 100, bottom: 400, left: 0, right: 300, width: 300, height: 300 }
    const viewport = { width: 800, height: 600 }
    expect(
      isTriggerVisibleInScrollport(
        { top: 40, bottom: 70, left: 10, right: 100, width: 90, height: 30 },
        scrollport,
        viewport,
      ),
    ).toBe(false)
    expect(
      isTriggerVisibleInScrollport(
        { top: 410, bottom: 440, left: 10, right: 100, width: 90, height: 30 },
        scrollport,
        viewport,
      ),
    ).toBe(false)
  })

  it('uses the viewport when there is no scrollport', () => {
    expect(
      isTriggerVisibleInScrollport(
        { top: 10, bottom: 40, left: 10, right: 100, width: 90, height: 30 },
        null,
        { width: 800, height: 600 },
      ),
    ).toBe(true)
    expect(
      isTriggerVisibleInScrollport(
        { top: 610, bottom: 640, left: 10, right: 100, width: 90, height: 30 },
        null,
        { width: 800, height: 600 },
      ),
    ).toBe(false)
  })
})
