import { describe, expect, it } from 'vitest'
import {
  resolveConfiguredRosterDisplay,
  validatePublicHubInvariants,
  normalizePublicHub,
} from '../src/lib/publicHub'

describe('resolveConfiguredRosterDisplay', () => {
  it('conserves confirmed + unresolved == live (92/87 → 5)', () => {
    const display = resolveConfiguredRosterDisplay({
      live: 92,
      collecting: 87,
      warming: 3,
      connectedQuiet: 2,
      configuredRosterConfirmed: 87,
      configuredRosterUnresolved: 5,
    })
    expect(display.confirmed).toBe(87)
    expect(display.unresolved).toBe(5)
    expect(display.confirmed + display.unresolved).toBe(display.live)
    expect(display.consistent).toBe(true)
  })

  it('never adds warming + connectedQuiet into unresolved total', () => {
    const display = resolveConfiguredRosterDisplay({
      live: 92,
      collecting: 87,
      warming: 3,
      connectedQuiet: 2,
      configuredRosterConfirmed: 87,
      configuredRosterUnresolved: 5,
    })
    // Old bug: 5 + 3 + 2 = 10
    expect(display.unresolved).toBe(5)
    expect(display.unresolved).not.toBe(5 + 3 + 2)
    expect(display.warming).toBe(3)
    expect(display.connectedQuiet).toBe(2)
  })

  it('allows overlapping warming/quiet subcategories within unresolved', () => {
    const display = resolveConfiguredRosterDisplay({
      live: 100,
      collecting: 90,
      warming: 8,
      connectedQuiet: 7,
      configuredRosterConfirmed: 90,
      configuredRosterUnresolved: 10,
    })
    // 8 + 7 > 10 but each alone fits — overlap is OK
    expect(display.unresolved).toBe(10)
    expect(display.consistent).toBe(true)
  })

  it('derives unresolved from live - confirmed when unresolved is missing', () => {
    const display = resolveConfiguredRosterDisplay({
      live: 92,
      collecting: 87,
      warming: 4,
      connectedQuiet: 1,
      configuredRosterConfirmed: 87,
    })
    expect(display.unresolved).toBe(5)
    expect(display.consistent).toBe(true)
  })

  it('handles zero roster', () => {
    const display = resolveConfiguredRosterDisplay({
      live: 0,
      collecting: 0,
      warming: 0,
      connectedQuiet: 0,
      configuredRosterConfirmed: 0,
      configuredRosterUnresolved: 0,
    })
    expect(display).toMatchObject({
      live: 0,
      confirmed: 0,
      unresolved: 0,
      warming: 0,
      connectedQuiet: 0,
      consistent: true,
    })
  })

  it('clamps negatives and marks inconsistent', () => {
    const display = resolveConfiguredRosterDisplay({
      live: 10,
      collecting: 8,
      warming: -2,
      connectedQuiet: 1,
      configuredRosterConfirmed: 8,
      configuredRosterUnresolved: 2,
    })
    expect(display.warming).toBe(0)
    expect(display.consistent).toBe(false)
    expect(display.inconsistencyReason).toMatch(/warming/i)
  })

  it('degrades inconsistent backend totals without inventing healthy numbers', () => {
    const display = resolveConfiguredRosterDisplay({
      live: 92,
      collecting: 87,
      warming: 0,
      connectedQuiet: 0,
      configuredRosterConfirmed: 87,
      configuredRosterUnresolved: 10,
    })
    expect(display.confirmed).toBe(87)
    expect(display.unresolved).toBe(10)
    expect(display.consistent).toBe(false)
    expect(display.inconsistencyReason).toMatch(/!= live/)
  })

  it('flags subcategory overflow past unresolved', () => {
    const display = resolveConfiguredRosterDisplay({
      live: 92,
      collecting: 87,
      warming: 9,
      connectedQuiet: 0,
      configuredRosterConfirmed: 87,
      configuredRosterUnresolved: 5,
    })
    expect(display.unresolved).toBe(5)
    expect(display.warming).toBe(9)
    expect(display.consistent).toBe(false)
  })

  it('handles missing optional connectedQuiet', () => {
    const display = resolveConfiguredRosterDisplay({
      live: 50,
      collecting: 48,
      warming: 1,
      configuredRosterConfirmed: 48,
      configuredRosterUnresolved: 2,
    })
    expect(display.connectedQuiet).toBe(0)
    expect(display.unresolved).toBe(2)
    expect(display.consistent).toBe(true)
  })
})

describe('validatePublicHubInvariants configured roster conservation', () => {
  it('errors when confirmed + unresolved != live', () => {
    const hub = normalizePublicHub({
      corpusPipeline: {
        roster: {
          live: 92,
          collecting: 87,
          warming: 0,
          configuredRosterConfirmed: 87,
          configuredRosterUnresolved: 10,
          collectorTracking: 90,
          expectedCollectorRows: 92,
          liveCollectorDeficitRows: 2,
          metadataOnly: 0,
          metadataStale: 0,
          admissionDisabled: 0,
          capacityBlocked: 0,
          viewerOnly: 0,
          zeroChatAfterAge: 0,
        },
      },
      activity: { windowMinutes: 30, channelCount: 1, points: [] },
    })
    expect(
      validatePublicHubInvariants(hub).some((i) => i.code === 'configured_roster_conservation'),
    ).toBe(true)
  })
})
